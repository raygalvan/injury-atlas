import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, issueLink, consumeLink, type User } from "../server/store";
import { createApp } from "../server/app";
import { createAfpSdk } from "../server/afp/sdk";
import { digest, validateManifest } from "../server/afp/manifest";
import { presentationPolicies } from "../server/afp/lab";
import { executeCoordinatorTool, enabledTools } from "../server/ai/coordinator";
import { developmentContext } from "../server/afp/development-context";

const definition = {
  title: "Private review workflow",
  description: "Organize my review without changing evidence.",
  stages: [
    {
      id: "gather",
      title: "Gather records",
      items: [{ id: "records", label: "Collect records", required: true }],
    },
    {
      id: "review",
      title: "Review gaps",
      items: [
        { id: "gaps", label: "Check missing information", required: true },
      ],
    },
  ],
};
test("AFP workflows: text/voice, manifests, private persistence, preview, versioning, policy and protected-core isolation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "afp-workflow-")),
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
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    sessions = Object.fromEntries(
      Object.keys(users).map((id) => [id, consumeLink(db, issueLink(db, id)!)]),
    );
  const call = (who: string, route: string, body?: unknown) =>
    fetch(base + "/api" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
        ...(sessions[who] ? { Cookie: `atlas_session=${sessions[who]}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const sdk = createAfpSdk(db, "a");
  const state = () => sdk.listPrivateWorkflows().body as any;
  const cmd = (body: any) => sdk.managePrivateWorkflow(body, "settings");
  try {
    assert(
      !enabledTools(db, users.a).some(
        (t) => t.name === "execute_development_task",
      ),
    );
    await assert.rejects(
      executeCoordinatorTool(
        db,
        users.a,
        "execute_development_task",
        { request: "Change everyone's app" },
        "old-voice",
      ),
    );
    assert.equal((await call("none", "/afp/workflows")).status, 401);
    assert.equal((await call("client", "/afp/workflows")).status, 403);
    const text = await executeCoordinatorTool(
      db,
      users.a,
      "manage_private_afp_workflow",
      { action: "draft", revision: 0, definition },
      "draft",
      "text coordinator",
    );
    const receipt = JSON.parse(text.speech),
      id = receipt.id;
    assert.equal(receipt.state, "preview");
    assert.equal(state().features[0].active_version, null);
    assert.equal(
      sdk.usePrivateWorkflow(
        { action: "start", featureId: id, title: "First run" },
        "settings",
      ).status,
      409,
    );
    assert.equal(
      createAfpSdk(db, "b").managePrivateWorkflow(
        { action: "activate", id, revision: 1, version: 1 },
        "settings",
      ).status,
      404,
    );
    for (const user of ["b", "c"]) {
      assert.equal(
        ((await (await call(user, "/afp/workflows")).json()) as any).features
          .length,
        0,
      );
    }
    assert.equal(
      cmd({ action: "draft", revision: 0, definition, ownerId: "b" }).status,
      422,
    );
    for (const bad of [
      { ...definition, title: "<script>alert(1)</script>" },
      { ...definition, title: "x".repeat(101) },
      { ...definition, shell: "rm -rf" },
      {
        ...definition,
        stages: [
          {
            ...definition.stages[0],
            items: [{ ...definition.stages[0].items[0], id: "gather" }],
          },
        ],
      },
    ])
      assert.equal(
        cmd({ action: "draft", revision: 0, definition: bad }).status,
        422,
      );
    const m = state().features[0].versions[0].manifest;
    assert.equal(m.schemaVersion, "injury.bot.afp/0.1");
    assert.equal(m.extensionPoints[0].id, "private-workspace");
    assert.equal(m.ownership.ownerId, "a");
    const policies = presentationPolicies(db, "a", "workflow");
    assert.equal(
      validateManifest(m, users.a, policies, "later-build").result,
      "Compatible",
    );
    for (const bad of [
      { ...m, requestedPermissions: ["database.query"] },
      { ...m, requestedResources: ["gpu"] },
      { ...m, ownership: { ...m.ownership, scope: "Firm" } },
      { ...m, activation: true },
      { ...m, compatibility: { ...m.compatibility, contractVersion: "9.0.0" } },
    ])
      assert.equal(
        validateManifest(bad, users.a, policies, "later-build").result,
        "Incompatible",
      );
    // The same route that handles voice tools derives user/source from the voice session.
    db.prepare("INSERT INTO assistant_voice_sessions VALUES(?,?,?,?,?)").run(
      "voice",
      users.a.id,
      users.a.firm_id,
      null,
      Date.now() + 60000,
    );
    const voice = await call(
      "a",
      "/assistant/tools/manage_private_afp_workflow",
      {
        args: { action: "activate", id, revision: 1, version: 1 },
        callId: "voice-activate",
        sessionId: "voice",
      },
    );
    assert.equal(voice.status, 200, await voice.clone().text());
    assert.equal(state().features[0].state, "active");
    assert.equal(cmd({ action: "disable", id, revision: 1 }).status, 409);
    const run = sdk.usePrivateWorkflow(
      { action: "start", featureId: id, title: "Private run sentinel" },
      "settings",
    ).body as any;
    assert.equal(run.stage, "gather");
    assert.equal(
      createAfpSdk(db, "c").usePrivateWorkflow(
        { action: "update", id: run.id, revision: 1, completed: [], notes: "" },
        "settings",
      ).status,
      409,
    );
    assert.equal(
      sdk.usePrivateWorkflow(
        {
          action: "update",
          id: run.id,
          revision: 1,
          completed: ["unknown"],
          notes: "",
        },
        "settings",
      ).status,
      422,
    );
    const updated = sdk.usePrivateWorkflow(
      {
        action: "update",
        id: run.id,
        revision: 1,
        completed: ["records"],
        notes: "PRIVATE-NOTES-SENTINEL",
      },
      "settings",
    );
    assert.equal(updated.status, 200);
    assert.equal((updated.body as any).stage, "review");
    assert.equal(
      cmd({
        action: "draft",
        id,
        revision: 2,
        definition: { ...definition, title: "Second version" },
      }).status,
      200,
    );
    assert.equal(state().features[0].active_version, 1);
    assert.equal(
      cmd({ action: "activate", id, revision: 3, version: 2 }).status,
      200,
    );
    assert.equal(state().runs[0].version, 1, "old runs keep their definition");
    assert.equal(
      cmd({ action: "rollback", id, revision: 4, version: 1 }).status,
      200,
    );
    assert.equal(state().features[0].active_version, 1);
    assert.equal(cmd({ action: "disable", id, revision: 5 }).status, 200);
    assert.equal(
      sdk.usePrivateWorkflow(
        { action: "start", featureId: id, title: "Blocked" },
        "settings",
      ).status,
      409,
    );
    assert.equal(
      cmd({ action: "activate", id, revision: 6, version: 1 }).status,
      200,
    );
    const policy = {
      ...policies.find((p) => p.id === "private-workspace"),
      level: "Protected",
    };
    db.prepare("INSERT INTO afp_policies VALUES(?,?)").run(
      "private-workspace",
      JSON.stringify(policy),
    );
    assert.equal(
      sdk.usePrivateWorkflow(
        { action: "start", featureId: id, title: "Policy bypass" },
        "settings",
      ).status,
      403,
    );
    assert.equal(
      cmd({ action: "activate", id, revision: 7, version: 2 }).status,
      403,
    );
    assert.equal(
      cmd({ action: "disable", id, revision: 7 }).status,
      200,
      "disabling remains possible after policy revocation",
    );
    db.prepare("DELETE FROM afp_policies WHERE id='private-workspace'").run();
    db.prepare(
      "UPDATE afp_workflow_versions SET digest='tampered' WHERE feature_id=? AND version=2",
    ).run(id);
    assert.equal(
      cmd({ action: "activate", id, revision: 8, version: 2 }).status,
      403,
    );
    const audit = JSON.stringify(sdk.privateWorkflowHistory().body);
    assert.match(audit, /voice coordinator/);
    assert.match(audit, /text coordinator/);
    assert(!audit.includes("PRIVATE-NOTES-SENTINEL"));
    assert(!audit.includes("Private run sentinel"));
    const context = JSON.stringify(developmentContext(db));
    assert(!context.includes("PRIVATE-NOTES-SENTINEL"));
    assert(!context.includes("Private run sentinel"));
    assert(!context.includes("Private review workflow"));
    const reopened = openStore(file);
    assert.equal(
      reopened.prepare("SELECT count(*) n FROM afp_workflow_versions").get()?.n,
      2,
    );
    reopened.close();
    db.prepare("UPDATE users SET firm_id='moved' WHERE id='a'").run();
    assert.equal(state().features.length, 0);
    db.prepare("UPDATE users SET firm_id='one' WHERE id='a'").run();
    assert.equal(cmd({ action: "remove", id, revision: 8 }).status, 200);
    assert.equal(state().features.length, 0);
    assert.equal(
      db.prepare("SELECT count(*) n FROM afp_workflow_versions").get()?.n,
      2,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM afp_development_jobs").get()?.n,
      0,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
