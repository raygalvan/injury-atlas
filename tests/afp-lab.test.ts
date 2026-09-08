import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, issueLink, consumeLink, type User } from "../server/store";
import { createApp } from "../server/app";
import { createAfpSdk } from "../server/afp/sdk";
import {
  labState,
  permissionDecision,
  presentationPolicies,
} from "../server/afp/lab";
import {
  defaults,
  saveSettings,
  saveCredential,
  ensureAi,
} from "../server/ai/settings";
import { executeCoordinatorTool } from "../server/ai/coordinator";
import {
  validateManifest,
  atlasPresentationManifest,
  presentationManifest,
  digest,
} from "../server/afp/manifest";
import { labCategories } from "../shared/afp-lab";

test("AFP Lab grants only private bounded presentation, records permission source, survives builds and restores normal policy", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "afp-lab-")),
    file = path.join(dir, "atlas.sqlite"),
    db = openStore(file),
    users: Record<string, User> = {};
  for (const [id, role, firm] of [
    ["admin", "attorney", "a"],
    ["owner", "owner", "a"],
    ["peer", "attorney", "a"],
    ["other", "owner", "b"],
    ["client", "client", "a"],
  ]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      id + "@example.test",
      id,
      role,
      firm,
    );
    users[id] = db.prepare("SELECT * FROM users WHERE id=?").get(id) as User;
  }
  const server = createApp(db, {
    dataDir: dir,
    origin: "http://localhost",
    send: async () => {
      throw Error("No mail");
    },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  db.prepare("INSERT INTO platform_admins VALUES('admin')").run();
  const realFetch = globalThis.fetch,
    base = "http://127.0.0.1:" + (server.address() as any).port,
    sessions = Object.fromEntries(
      Object.keys(users).map((id) => [id, consumeLink(db, issueLink(db, id)!)]),
    );
  const call = (who: string, url: string, body?: unknown) =>
    realFetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: "atlas_session=" + sessions[who],
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const configure = async (who: string, patch: unknown) => {
    const state = await (await call(who, "/afp/lab")).json();
    return call(who, "/afp/lab", {
      ...(patch as any),
      revision: state.revision,
    });
  };
  const color = async (who: string) =>
    (await (await call(who, "/afp/preferences/presentation")).json())
      .selectInjuriesColor;
  try {
    for (const who of ["peer", "client", "missing"])
      assert.ok(
        [401, 403].includes(
          (
            await call(who, "/afp/lab", {
              action: "toggle",
              enabled: true,
              revision: 0,
            })
          ).status,
        ),
      );
    assert.equal(
      (await configure("owner", { action: "preset", preset: "Safe" })).status,
      200,
    );
    assert.equal(
      (
        await call("owner", "/afp/preferences/atlas", {
          action: "set",
          selectInjuriesColor: "blue",
        })
      ).status,
      422,
    );
    assert.equal(
      (await configure("owner", { action: "toggle", enabled: true })).status,
      200,
    );
    assert.equal(
      (await configure("admin", { action: "toggle", enabled: true })).status,
      200,
    );
    assert.equal(labState(db, "owner").enabled, true);
    assert.equal(labState(db, "peer").enabled, false);
    assert.equal(labState(db, "other").enabled, false);
    for (const c of labCategories.filter((c) => c.locked)) {
      assert.equal(permissionDecision(db, "owner", c.id).level, "Blocked");
      assert.equal(
        (
          await configure("owner", {
            action: "category",
            category: c.id,
            level: "Allow Automatically",
          })
        ).status,
        422,
      );
    }
    for (const name of ["enable_lab_mode", "set_lab_mode", "set_settings"])
      await assert.rejects(
        executeCoordinatorTool(db, users.owner, name, { enabled: true }, name),
      );
    const missing = await executeCoordinatorTool(
      db,
      users.owner,
      "inspect_afp_capability",
      { category: "widgets" },
      "inspect",
    );
    assert.equal(JSON.parse(missing.speech).outcome, "Not Implemented");
    const cfg = defaults();
    cfg.agents.coordinator.provider = "openai";
    cfg.agents.coordinator.model = cfg.models.find(
      (m) => m.provider === "openai",
    )!.model;
    cfg.voice.enabled = true;
    saveSettings(db, "platform", cfg, users.admin);
    saveCredential(db, "platform", "openai", "synthetic-lab-key", users.admin);
    let turns = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/realtime/client_secrets")) {
        const session = JSON.parse(String(options!.body)).session;
        assert.ok(
          session.tools.some(
            (t: any) => t.name === "set_private_afp_presentation",
          ),
        );
        assert.ok(
          !session.tools.some((t: any) =>
            /enable_lab|set_settings|shell|sql/.test(t.name),
          ),
        );
        return Response.json({ value: "synthetic-voice" });
      }
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      turns++;
      return Response.json({
        output:
          turns === 1
            ? [
                {
                  type: "function_call",
                  name: "set_private_afp_presentation",
                  call_id: "lab-text",
                  arguments: JSON.stringify({
                    action: "set",
                    selectInjuriesColor: "blue",
                  }),
                },
              ]
            : [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: "Your Select Injuries color is blue.",
                    },
                  ],
                },
              ],
      });
    };
    assert.equal(
      (
        await call("owner", "/assistant/messages", {
          text: "Make the Select Injuries button blue for me.",
        })
      ).status,
      200,
    );
    assert.equal(await color("owner"), "blue");
    for (const who of ["peer", "other"])
      assert.equal(await color(who), "default");
    const v = await (
      await call("owner", "/assistant/realtime-session", {})
    ).json();
    const voice = {
      sessionId: v.sessionId,
      callId: "lab-voice",
      args: { action: "set", selectInjuriesColor: "green" },
    };
    assert.equal(
      (
        await call(
          "owner",
          "/assistant/tools/set_private_afp_presentation",
          voice,
        )
      ).status,
      200,
    );
    assert.equal(await color("owner"), "green");
    assert.equal(
      (
        await call(
          "peer",
          "/assistant/tools/set_private_afp_presentation",
          voice,
        )
      ).status,
      403,
    );
    const labHistory = await (
      await call("owner", "/afp/preferences/presentation/history")
    ).json();
    for (const source of ["text coordinator", "voice coordinator"])
      assert.ok(
        labHistory.some(
          (h: any) =>
            h.source === source &&
            h.labAuthorized &&
            h.preset === "Lab" &&
            h.permission.category === "styling",
        ),
      );
    for (const bad of [
      { action: "set", selectInjuriesColor: "#123456" },
      { action: "set", selectInjuriesColor: "blue", css: "body{display:none}" },
      { action: "set", selectInjuriesColor: "<script>" },
      { action: "set", selectInjuriesColor: "url(https://evil.test)" },
      { action: "set", selectInjuriesColor: "blue", userId: "peer" },
      { action: "set", selectInjuriesColor: "blue", firmId: "b" },
      { action: "set", selectInjuriesColor: "blue", enabled: true },
    ])
      assert.equal(
        (await call("owner", "/afp/preferences/atlas", bad)).status,
        422,
      );
    assert.equal(
      (
        await call("owner", "/afp/lab", {
          action: "toggle",
          enabled: true,
          userId: "peer",
          revision: labState(db, "owner").revision,
        })
      ).status,
      422,
    );
    const pol = presentationPolicies(db, "owner", "styling"),
      m = atlasPresentationManifest(users.owner, pol, "old-app-build");
    assert.equal(
      validateManifest(m, users.owner, pol, "new-unrelated-build", "use")
        .result,
      "Compatible",
    );
    assert.equal(
      validateManifest(
        {
          ...m,
          extensionPoints: [
            {
              id: "atlas-presentation",
              contract: "injury.bot.atlas.presentation/2",
            },
          ],
        },
        users.owner,
        pol,
        "new-unrelated-build",
      ).result,
      "Incompatible",
    );
    assert.equal(
      validateManifest(
        { ...m, requestedPermissions: ["database.query"] },
        users.owner,
        pol,
        "new-unrelated-build",
      ).result,
      "Incompatible",
    );
    const old = JSON.stringify(m);
    db.prepare(
      "UPDATE afp_private_preferences SET manifest=?,digest=? WHERE user_id=?",
    ).run(old, digest(m), "owner");
    assert.equal(await color("owner"), "green");
    const label = presentationManifest(
      users.owner,
      presentationPolicies(db, "owner", "labels"),
      "previous-build",
    );
    assert.equal(
      validateManifest(
        label,
        users.owner,
        presentationPolicies(db, "owner", "labels"),
        "next-build",
      ).result,
      "Compatible",
    );
    await configure("owner", {
      action: "category",
      category: "styling",
      level: "Blocked",
    });
    assert.equal(await color("owner"), "default");
    assert.equal(
      (
        await call("owner", "/afp/preferences/atlas", {
          action: "set",
          selectInjuriesColor: "red",
        })
      ).status,
      422,
    );
    await configure("owner", {
      action: "category",
      category: "styling",
      level: "Allow Automatically",
    });
    assert.equal(await color("owner"), "green");
    await configure("owner", { action: "toggle", enabled: false });
    assert.equal(labState(db, "owner").preset, "Safe");
    assert.equal(
      (
        await call("owner", "/afp/preferences/atlas", {
          action: "set",
          selectInjuriesColor: "red",
        })
      ).status,
      422,
    );
    assert.equal(
      (await call("owner", "/afp/preferences/atlas", { action: "disable" }))
        .status,
      200,
    );
    assert.equal(await color("owner"), "default");
    await configure("owner", { action: "toggle", enabled: true });
    await call("owner", "/afp/preferences/atlas", {
      action: "set",
      selectInjuriesColor: "amber",
    });
    await call("owner", "/afp/preferences/atlas", { action: "remove" });
    assert.equal(await color("owner"), "default");
    assert.equal((await call("peer", "/afp/lab/history")).status, 200);
    const peerHistory = await (await call("peer", "/afp/lab/history")).json();
    assert.ok(peerHistory.every((entry: any) => entry.actor === "peer" && entry.result === "rejected"));
    const before = labState(db, "owner");
    ensureAi(db);
    assert.deepEqual(labState(db, "owner"), before);
    const reopen = openStore(file);
    try {
      assert.equal(labState(reopen, "owner").enabled, true);
    } finally {
      reopen.close();
    }
    db.prepare("UPDATE users SET role='attorney' WHERE id='owner'").run();
    assert.equal(labState(db, "owner").enabled, false);
    assert.equal(
      (
        await call("owner", "/afp/lab", {
          action: "toggle",
          enabled: true,
          revision: before.revision,
        })
      ).status,
      403,
    );
    const history = JSON.stringify(
      db.prepare("SELECT body FROM afp_preference_audit").all(),
    );
    assert.ok(!history.includes("synthetic-lab-key"));
    assert.ok(!history.includes("body{display:none}"));
    assert.ok(!history.includes("Make the Select Injuries button"));
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
