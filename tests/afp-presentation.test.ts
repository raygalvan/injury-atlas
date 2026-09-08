import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openStore, issueLink, consumeLink, type User } from "../server/store";
import { createApp } from "../server/app";
import { createAfpSdk } from "../server/afp/sdk";
import { defaults, saveSettings, saveCredential } from "../server/ai/settings";
import { executeCoordinatorTool } from "../server/ai/coordinator";
import {
  presentationManifest,
  applicationVersion,
  validateManifest,
  digest,
} from "../server/afp/manifest";
import { readControlPlane } from "../server/afp/control-plane";
import { developmentContext } from "../server/afp/development-context";

test("private presentation: authenticated text/voice, isolation, policy, compatibility, audit and product-only context", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "afp-presentation-")),
    file = path.join(dir, "atlas.sqlite"),
    db = openStore(file),
    users: Record<string, User> = {};
  for (const [id, role, firm] of [
    ["a", "owner", "one"],
    ["b", "attorney", "one"],
    ["c", "owner", "two"],
    ["client", "client", "one"],
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
  db.prepare("INSERT INTO platform_admins VALUES('a')").run();
  const base = "http://127.0.0.1:" + (server.address() as any).port,
    realFetch = globalThis.fetch;
  const sessions = Object.fromEntries(
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
  const read = async (who: string) =>
    (await call(who, "/afp/preferences/presentation")).json();
  try {
    const cfg = defaults();
    cfg.agents.coordinator.provider = "openai";
    cfg.agents.coordinator.model = cfg.models.find(
      (m) => m.provider === "openai",
    )!.model;
    cfg.voice.enabled = true;
    saveSettings(db, "platform", cfg, users.a);
    saveCredential(
      db,
      "platform",
      "openai",
      "synthetic-secret-not-for-export",
      users.a,
    );
    let responseCalls = 0;
    globalThis.fetch = async (url, opts) => {
      if (String(url).endsWith("/realtime/client_secrets")) {
        const session = JSON.parse(String(opts!.body)).session;
        const t = session.tools.find(
          (t: any) => t.name === "set_private_afp_ui_preference",
        );
        assert.ok(t);
        assert.equal(t.parameters.additionalProperties, false);
        assert.ok(!JSON.stringify(t).includes("firmId"));
        return Response.json({ value: "synthetic-session-secret" });
      }
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      responseCalls++;
      return Response.json({
        output:
          responseCalls === 1
            ? [
                {
                  type: "function_call",
                  name: "set_private_afp_ui_preference",
                  call_id: "text-pref",
                  arguments: JSON.stringify({
                    action: "set",
                    textTabLabel: "Text",
                  }),
                },
              ]
            : [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: "Your private tab is Text." },
                  ],
                },
              ],
      });
    };
    assert.equal((await read("a")).textTabLabel, "Text Chat");
    const text = await call("a", "/assistant/messages", {
      text: "Change Text Chat to Text for me.",
    });
    assert.equal(text.status, 200, JSON.stringify(await text.clone().json()));
    assert.equal(responseCalls, 2);
    assert.equal((await read("a")).textTabLabel, "Text");
    for (const who of ["b", "c"])
      assert.equal((await read(who)).textTabLabel, "Text Chat");
    const voice = await (
      await call("a", "/assistant/realtime-session", {})
    ).json();
    const voiceArgs = {
      sessionId: voice.sessionId,
      callId: "voice-pref",
      args: { action: "set", textTabLabel: "My Text" },
    };
    const receipt = await call(
      "a",
      "/assistant/tools/set_private_afp_ui_preference",
      voiceArgs,
    );
    assert.equal(receipt.status, 200);
    assert.equal(JSON.parse((await receipt.json()).output).applied, true);
    assert.equal((await read("a")).textTabLabel, "My Text");
    assert.equal(
      (
        await call(
          "b",
          "/assistant/tools/set_private_afp_ui_preference",
          voiceArgs,
        )
      ).status,
      403,
    );
    await call(
      "a",
      "/assistant/tools/set_private_afp_ui_preference",
      voiceArgs,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM afp_preference_audit").get()!.n,
      2,
      "duplicate call uses receipt",
    );
    for (const bad of [
      { action: "set", textTabLabel: "" },
      { action: "set", textTabLabel: "x".repeat(25) },
      { action: "set", textTabLabel: "<script>alert(1)</script>" },
      { action: "set", textTabLabel: "Text\nChat" },
      { action: "set", textTabLabel: "Text\n" },
      { action: "set", textTabLabel: "Text", userId: "b" },
      { action: "set", textTabLabel: "Text", firmId: "two" },
      { action: "set", textTabLabel: "Text", source: "settings" },
      { action: "set", textTabLabel: "Text", css: "body{}" },
      { action: "set", textTabLabel: null },
    ]) {
      assert.equal(
        (await call("a", "/afp/preferences/presentation", bad)).status,
        422,
      );
      assert.equal((await read("a")).textTabLabel, "My Text");
    }
    const failure = await executeCoordinatorTool(
      db,
      users.a,
      "set_private_afp_ui_preference",
      { action: "set", textTabLabel: "<b>Text</b>" },
      "invalid-tool",
    );
    assert.match(failure.speech, /not applied/);
    assert.equal(failure.card?.title, "Preference not changed");
    for (const who of ["unknown", "client"]) {
      const r = await call(who, "/afp/preferences/presentation", {
        action: "set",
        textTabLabel: "Text",
      });
      assert.ok([401, 403].includes(r.status));
    }
    const saved = (await read("a")).feature;
    assert.equal(saved.scope, "Private");
    assert.equal(saved.owner, "a");
    assert.equal(saved.manifest.schemaVersion, "injury.bot.afp/0.1");
    assert.equal(saved.compatibility, "Compatible");
    const policies = readControlPlane(db).policies,
      m = presentationManifest(users.a, policies);
    for (const patch of [
      { ownership: { scope: "Firm", ownerId: "a", firmId: "one" } },
      { ownership: { scope: "Private", ownerId: "b", firmId: "one" } },
      { requestedPermissions: ["rendering.recipe.inspect"] },
      { requestedResources: ["gpu"] },
      { activation: true },
    ])
      assert.equal(
        validateManifest(
          { ...m, ...patch },
          users.a,
          policies,
          applicationVersion(),
        ).result,
        "Incompatible",
      );
    const draft = createAfpSdk(db, "a").saveManifest({
      revision: 0,
      manifest: m,
    });
    assert.equal(draft.status, 200);
    assert.equal(
      createAfpSdk(db, "a").inspectRenderingRecipe({
        manifestId: (draft.body as any).id,
        revision: 1,
        request: {
          resourceClass: "application-cpu",
          recipe: {
            kind: "fracture",
            parentId: "FJ123",
            center: [0, 0, 0],
            normal: [0, 1, 0],
            widthMm: 1,
            heightMm: 1,
            depthMm: 1,
          },
        },
      }).status,
      400,
    );
    const stale = { ...m, application: { id: "injury.bot", version: "stale" } };
    db.prepare(
      "UPDATE afp_private_preferences SET manifest=?,digest=? WHERE user_id=?",
    ).run(JSON.stringify(stale), digest(stale), "a");
    assert.equal((await read("a")).textTabLabel, "My Text");
    assert.equal((await read("a")).feature.compatibility, "Compatible");
    await call("a", "/afp/preferences/presentation", {
      action: "set",
      textTabLabel: "Text",
    });
    const policy = policies.find((p) => p.id === "assistant-presentation")!;
    db.prepare("INSERT INTO afp_policies VALUES(?,?)").run(
      policy.id,
      JSON.stringify({ ...policy, level: "Protected", revision: 2 }),
    );
    assert.equal((await read("a")).textTabLabel, "Text Chat");
    assert.equal(
      (
        await call("a", "/afp/preferences/presentation", {
          action: "set",
          textTabLabel: "Blocked",
        })
      ).status,
      422,
    );
    assert.equal(
      (await call("a", "/afp/preferences/presentation", { action: "disable" }))
        .status,
      200,
    );
    db.prepare("DELETE FROM afp_policies WHERE id=?").run(policy.id);
    await call("a", "/afp/preferences/presentation", {
      action: "set",
      textTabLabel: "Text",
    });
    await call("a", "/afp/preferences/presentation", { action: "remove" });
    assert.equal((await read("a")).textTabLabel, "Text Chat");
    assert.equal((await read("a")).feature.status, "removed");
    const hist = await (
      await call("a", "/afp/preferences/presentation/history")
    ).json();
    assert.ok(
      hist.some(
        (h: any) => h.source === "text coordinator" && h.newValue === "Text",
      ),
    );
    assert.ok(
      hist.some(
        (h: any) =>
          h.source === "voice coordinator" &&
          h.oldValue === "Text" &&
          h.newValue === "My Text",
      ),
    );
    assert.ok(
      hist.some((h: any) => h.source === "settings" && h.result === "rejected"),
    );
    assert.ok(
      hist.every(
        (h: any) => h.actor === "a" && h.firmId === "one" && h.timestamp,
      ),
    );
    assert.ok(!JSON.stringify(hist).includes("<script>"));
    assert.deepEqual(
      await (await call("b", "/afp/preferences/presentation/history")).json(),
      [],
    );
    const proposal = JSON.parse(
      (
        await executeCoordinatorTool(
          db,
          users.a,
          "record_afp_note",
          {
            kind: "proposal",
            title: "Private timeline panel",
            content:
              "Add a private workflow panel with controlled capabilities.",
          },
          "proposal",
        )
      ).speech,
    );
    db.prepare(
      "INSERT INTO assistant_messages VALUES('secret','one','a','user','text','UNRELATED-CONVERSATION-SECRET',NULL,1)",
    ).run();
    const context = await (
      await call("a", "/settings/afp/development-context")
    ).json();
    assert.equal(context.openCoordinatorProposals[0].id, proposal.id);
    assert.equal(context.openCoordinatorProposals[0].status, "proposed");
    for (const who of ["b", "c", "client", "unknown"])
      assert.ok(
        [401, 403].includes(
          (await call(who, "/settings/afp/development-context")).status,
        ),
      );
    const output = JSON.stringify(context);
    for (const forbidden of [
      "UNRELATED-CONVERSATION-SECRET",
      "synthetic-secret-not-for-export",
      "atlas_session",
      "My Text",
      "fake@example",
    ])
      assert.ok(!output.includes(forbidden));
    const cli = JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/afp-context.ts"],
        {
          env: {
            ...process.env,
            DATA_DIR: dir,
            AFP_CONTEXT_URL: "",
            AFP_CONTEXT_COOKIE: "",
          },
          encoding: "utf8",
        },
      ),
    );
    assert.equal(cli.openCoordinatorProposals[0].id, proposal.id);
    assert.equal(
      db.prepare("SELECT status FROM afp_entries WHERE id=?").get(proposal.id)!
        .status,
      "proposed",
    );
    // Read-only projection remains independent of all non-AFP data tables.
    const queries: string[] = [];
    const projection = developmentContext({
      prepare(sql: string) {
        queries.push(sql);
        return db.prepare(sql);
      },
    } as any);
    assert.ok(projection.openCoordinatorProposals.length);
    assert.ok(
      queries.every(
        (sql) =>
          !/\b(?:FROM|JOIN)\s+(cases|evidence|ai_credentials|assistant_messages|sessions|users)\b/i.test(
            sql,
          ),
      ),
    );
    await call("b", "/afp/preferences/presentation", {
      action: "set",
      textTabLabel: "Chat",
    });
    const reopened = openStore(file);
    try {
      assert.equal(
        (createAfpSdk(reopened, "b").readPrivatePresentation().body as any)
          .textTabLabel,
        "Chat",
      );
    } finally {
      reopened.close();
    }
    db.prepare("UPDATE users SET firm_id='moved' WHERE id='b'").run();
    assert.equal(
      (createAfpSdk(db, "b").readPrivatePresentation().body as any)
        .textTabLabel,
      "Text Chat",
    );
    db.prepare("UPDATE users SET active=0 WHERE id='a'").run();
    assert.equal(
      createAfpSdk(db, "a").setPrivatePresentation(
        { action: "set", textTabLabel: "Text" },
        "text coordinator",
      ).status,
      403,
    );
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
