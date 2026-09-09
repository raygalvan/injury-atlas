import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore, type User } from "../server/store";
import { ensureAi } from "../server/ai/settings";
import { createAfpSdk } from "../server/afp/sdk";
import { executeCoordinatorTool } from "../server/ai/coordinator";
import { uiTargets } from "../server/afp/ui";
import { validateManifest } from "../server/afp/manifest";
import { presentationPolicies } from "../server/afp/lab";
test("generic private UI: discovered targets, text/voice, isolation, integrity, audit, undo and permission enforcement", async () => {
  const db = openStore(":memory:");
  ensureAi(db);
  db.exec("CREATE TABLE platform_admins(user_id TEXT PRIMARY KEY)");
  for (const [id, role, firm] of [
    ["a", "owner", "one"],
    ["b", "attorney", "one"],
    ["c", "owner", "two"],
    ["client", "client", "one"],
  ])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      id + "@example.test",
      id,
      role,
      firm,
    );
  const u = db.prepare("SELECT * FROM users WHERE id='a'").get() as User,
    sdk = createAfpSdk(db, "a");
  const target = uiTargets.find(
    (t) => t.label === "Discuss AFP with the coordinator",
  )!;
  assert(target);
  assert(uiTargets.length > 100);
  const inspect = () =>
    sdk.inspectPrivateUi({ targetId: target.id }).body as any;
  const edit = (args: any) => sdk.editPrivateUi(args, "settings");
  const request = {
    action: "set",
    targetId: target.id,
    revision: 0,
    styles: {
      paddingTop: 12,
      paddingBottom: 12,
      paddingLeft: 20,
      paddingRight: 20,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
  };
  try {
    const result = await executeCoordinatorTool(
      db,
      u,
      "edit_private_afp_ui",
      request,
      "text-ui",
      "text coordinator",
    );
    assert.equal(JSON.parse(result.speech).saved, true);
    assert.equal(inspect().targets[0].edit.effective, true);
    for (const id of ["b", "c"])
      assert.deepEqual(
        (createAfpSdk(db, id).inspectPrivateUi().body as any).edits,
        [],
      );
    for (const id of ["client", "missing"])
      assert.equal(
        createAfpSdk(db, id).editPrivateUi(request, "settings").status,
        403,
      );
    assert.equal(edit(request).status, 409);
    for (const patch of [
      { ownerId: "b" },
      { firmId: "two" },
      { selector: "body" },
      { styles: { paddingTop: "12px" } },
      { styles: { backgroundImage: "url(https://example.test)" } },
      { styles: { paddingTop: -1 } },
      { text: "<script>alert(1)</script>" },
      { text: "x".repeat(81) },
    ])
      assert.equal(edit({ ...request, revision: 1, ...patch }).status, 422);
    const voice = await executeCoordinatorTool(
      db,
      u,
      "edit_private_afp_ui",
      {
        ...request,
        revision: 1,
        viewport: "mobile",
        styles: { paddingTop: 24 },
      },
      "voice-ui",
      "voice coordinator",
    );
    assert.equal(JSON.parse(voice.speech).saved, true);
    assert.equal(
      edit({ action: "undo", targetId: target.id, revision: 2 }).status,
      200,
    );
    assert.equal(inspect().targets[0].edit.body.variants.mobile, undefined);
    assert.equal(
      edit({ action: "disable", targetId: target.id, revision: 3 }).status,
      200,
    );
    assert.equal(inspect().targets[0].edit.effective, false);
    const manifest = inspect().targets[0].edit.manifest,
      policies = presentationPolicies(db, "a", "ui-editing");
    assert.equal(
      validateManifest(manifest, u, policies, "another-build").result,
      "Compatible",
    );
    for (const patch of [
      { requestedPermissions: ["shell.execute"] },
      { requestedResources: ["gpu"] },
      { activation: true },
      { ownership: { scope: "Private", ownerId: "b", firmId: "one" } },
    ])
      assert.equal(
        validateManifest(
          { ...manifest, ...patch },
          u,
          policies,
          "another-build",
        ).result,
        "Incompatible",
      );
    const policy = {
      ...policies.find((p) => p.id === "application-presentation"),
      level: "Protected",
    };
    db.prepare("INSERT INTO afp_policies VALUES(?,?)").run(
      "application-presentation",
      JSON.stringify(policy),
    );
    assert.equal(edit({ ...request, revision: 4 }).status, 422);
    assert.equal(
      edit({ action: "remove", targetId: target.id, revision: 4 }).status,
      200,
    );
    const history = JSON.stringify(sdk.privateUiHistory().body);
    assert.match(history, /voice coordinator/);
    assert.match(history, /text coordinator/);
    assert(!history.includes("<script>"));
    db.prepare("UPDATE users SET firm_id='moved' WHERE id='a'").run();
    assert.deepEqual((sdk.inspectPrivateUi().body as any).edits, []);
  } finally {
    db.close();
  }
});
