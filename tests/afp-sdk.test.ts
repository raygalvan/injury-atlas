import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, consumeLink, issueLink, type User } from "../server/store";
import { createApp } from "../server/app";
import { createAfpSdk } from "../server/afp/sdk";
import {
  manifestTemplate,
  applicationVersion,
  validateManifest,
  digest,
} from "../server/afp/manifest";
import { readControlPlane } from "../server/afp/control-plane";
import { AFP_SCHEMA, preflightResponseSchema } from "../shared/afp-manifest";
import { recipeSchema } from "../server/production";

const recipe = {
  kind: "fracture",
  parentId: "FJ123",
  center: [0, 0, 0],
  normal: [0, 1, 0],
  widthMm: 12,
  heightMm: 10,
  depthMm: 2,
};
test("AFP SDK v0.1 enforces schema, tenancy, policy, revisions, resources and non-execution", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "afp-sdk-")),
    file = path.join(dir, "atlas.sqlite"),
    db = openStore(file),
    users: Record<string, User> = {};
  for (const [id, role, firm] of [
    ["admin", "owner", "a"],
    ["staff", "attorney", "a"],
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
  const base = "http://127.0.0.1:" + (server.address() as any).port,
    sessions = Object.fromEntries(
      Object.keys(users).map((id) => [id, consumeLink(db, issueLink(db, id)!)]),
    );
  const call = (who: string, url: string, body?: unknown) =>
    fetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: "atlas_session=" + sessions[who],
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const template = (who = "staff") =>
    manifestTemplate(users[who], readControlPlane(db).policies);
  try {
    const m = template();
    assert.equal(m.schemaVersion, AFP_SCHEMA);
    assert.equal(validateManifest(manifestTemplate(users.staff,readControlPlane(db).policies,"unavailable"),users.staff,readControlPlane(db).policies,"unavailable").result,"Incompatible");
    assert.equal(
      (await (await call("staff", "/afp/manifests/evaluate", m)).json()).result,
      "Compatible",
    );
    for (const bad of [
      { ...m, schemaVersion: "injury.bot.afp-draft/1" },
      { ...m, protocolVersion: "999" },
      {
        ...m,
        extensionPoints: [{ id: "evidence-library", contract: "arbitrary" }],
      },
      {
        ...m,
        protectedBoundaries: m.protectedBoundaries.map(() => "authentication"),
      },
      ...[
        "authentication.change",
        "tenant.override",
        "evidence.write",
        "audit.disable",
        "database.query",
        "shell.execute",
        "filesystem.read",
      ].map((permission) => ({ ...m, requestedPermissions: [permission] })),
      ...["gpu-compute", "extension-database", "application-database"].map(
        (resource) => ({ ...m, requestedResources: [resource] }),
      ),
      { ...m, application: { ...m.application, version: "old-release" } },
      { ...m, compatibility: { ...m.compatibility, sdkVersion: "2.0.0" } },
      { ...m, ownership: { ...m.ownership, ownerId: "peer" } },
      { ...m, ownership: { ...m.ownership, firmId: "b" } },
      ...["Community", "Official", "invalid"].map((scope) => ({
        ...m,
        ownership: { ...m.ownership, scope },
      })),
      { ...m, activation: true },
      { ...m, ownership: null },
      { ...m, shell: "secret-do-not-log" },
    ]) {
      const v = await (
        await call("staff", "/afp/manifests/evaluate", bad)
      ).json();
      assert.equal(v.result, "Incompatible", JSON.stringify(bad));
      assert.ok(v.reasons.length);
    }
    const sdk = createAfpSdk(db, "staff");
    assert.equal((sdk.describe().body as any).activationAvailable, false);
    assert.deepEqual(
      Object.keys(sdk).sort(),
      [
        "auditHistory",
        "describe",
        "evaluateManifest",
        "inspectRenderingRecipe",
        "listManifests",
        "saveManifest",
        "readPrivatePresentation",
        "setPrivatePresentation",
        "setPrivateAtlasPresentation",
        "inspectPrivateCapability",
        "privatePresentationHistory",
      ].sort(),
    );
    assert.equal(
      validateManifest(
        m,
        users.staff,
        readControlPlane(db).policies,
        "another-release",
      ).result,
      "Incompatible",
    );
    assert.equal(
      validateManifest(
        m,
        users.staff,
        readControlPlane(db).policies.map((p) =>
          p.id === "authentication" ? { ...p, level: "Allowed" } : p,
        ),
        applicationVersion(),
      ).result,
      "Incompatible",
    );
    const saved = await (
      await call("staff", "/afp/manifests", { revision: 0, manifest: m })
    ).json();
    assert.ok(saved.id);
    const input = {
      manifestId: saved.id,
      revision: 1,
      request: { resourceClass: "application-cpu", recipe },
    };
    const tables = [
      "users",
      "cases",
      "evidence",
      "findings",
      "injury_production",
      "injury_artifacts",
    ];
    const snapshot = () =>
      JSON.stringify(tables.map((t) => db.prepare("SELECT * FROM " + t).all()));
    const before = snapshot();
    const success = await (
      await call("staff", "/afp/rendering/preflight", input)
    ).json();
    assert.equal(success.schemaAccepted, true);
    assert.equal(success.enqueued, false);
    assert.equal(success.rendered, false);
    const { auditId, ...output } = success;
    assert.ok(preflightResponseSchema.safeParse(success).success);
    assert.equal(
      success.schemaAccepted,
      recipeSchema.safeParse(recipe).success,
    );
    assert.equal(snapshot(), before);
    assert.equal(
      (await call("peer", "/afp/rendering/preflight", input)).status,
      404,
    );
    assert.equal(
      (await call("other", "/afp/rendering/preflight", input)).status,
      404,
    );
    assert.equal(
      (await (await call("peer", "/afp/manifests")).json()).length,
      0,
    );
    assert.equal(
      (await (await call("other", "/afp/manifests")).json()).length,
      0,
    );
    for (const request of [
      { ...input.request, resourceClass: "gpu-compute" },
      { ...input.request, sql: "SELECT * FROM evidence" },
      { ...input.request, recipe: { ...recipe, evidence: "secret-case-note" } },
      { ...input.request, path: "/etc/passwd" },
    ])
      assert.equal(
        (await call("staff", "/afp/rendering/preflight", { ...input, request }))
          .status,
        400,
      );
    const badRecipe = await (
      await call("staff", "/afp/rendering/preflight", {
        ...input,
        request: { ...input.request, recipe: { ...recipe, widthMm: 999 } },
      })
    ).json();
    assert.equal(badRecipe.schemaAccepted, false);
    assert.equal(badRecipe.rendered, false);
    const updated = await (
      await call("staff", "/afp/manifests", {
        id: saved.id,
        revision: 1,
        manifest: { ...m, definitionVersion: "0.1.1" },
      })
    ).json();
    assert.equal(updated.revision, 2);
    assert.equal(
      (
        await call("staff", "/afp/manifests", {
          id: saved.id,
          revision: 1,
          manifest: m,
        })
      ).status,
      409,
    );
    assert.equal(
      (await call("staff", "/afp/rendering/preflight", input)).status,
      409,
    );
    const current = { ...input, revision: 2 };
    const pp = readControlPlane(db).policies.find(
      (p) => p.id === "rendering-preflight",
    )!;
    assert.equal(
      (
        await call("admin", "/settings/afp/policies/rendering-preflight", {
          level: "Approval Required",
          revision: pp.revision,
        })
      ).status,
      200,
    );
    const pending = await (
      await call("staff", "/afp/rendering/preflight", current)
    ).json();
    assert.equal(pending.result, "Requires Review");
    assert.ok(pending.reasons.includes("permission_requires_review"));
    assert.equal(
      (
        await call("admin", "/settings/afp/policies/rendering-preflight", {
          level: "Protected",
          revision: 2,
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await call("staff", "/afp/rendering/preflight", current)).json())
        .result,
      "Incompatible",
    );
    assert.equal(
      (
        await call("admin", "/settings/afp/policies/authentication", {
          level: "Allowed",
          revision: 1,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("admin", "/settings/afp/policies/rendering-preflight", {
          level: "Allowed",
          revision: 3,
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await call("staff", "/afp/rendering/preflight", current)).json())
        .result,
      "Requires Review",
    );
    const refreshed = template();
    await call("staff", "/afp/manifests", {
      id: saved.id,
      revision: 2,
      manifest: refreshed,
    });
    const firm = {
      ...template("admin"),
      extensionId: "firm-preflight",
      ownership: { scope: "Firm", ownerId: "admin", firmId: "a" },
    };
    assert.equal(
      (await (await call("staff", "/afp/manifests/evaluate", firm)).json())
        .result,
      "Incompatible",
    );
    const firmSaved = await (
      await call("admin", "/afp/manifests", { revision: 0, manifest: firm })
    ).json();
    const firmInput = { ...input, manifestId: firmSaved.id };
    assert.equal(
      (
        await (
          await call("staff", "/afp/rendering/preflight", firmInput)
        ).json()
      ).schemaAccepted,
      true,
    );
    assert.equal(
      (await call("other", "/afp/rendering/preflight", firmInput)).status,
      404,
    );
    db.prepare("UPDATE users SET role='attorney' WHERE id='admin'").run();
    assert.equal(
      (await call("staff", "/afp/rendering/preflight", firmInput)).status,
      403,
    );
    const priorRelease = {
      ...refreshed,
      application: { ...refreshed.application, version: "old-release" },
    };
    db.prepare("UPDATE afp_manifests SET body=?,digest=? WHERE id=?").run(
      JSON.stringify(priorRelease),
      digest(priorRelease),
      saved.id,
    );
    assert.ok(
      (
        await (
          await call("staff", "/afp/rendering/preflight", {
            ...input,
            revision: 3,
          })
        ).json()
      ).reasons.includes("incompatible_application_version"),
    );
    db.prepare("UPDATE afp_manifests SET digest='tampered' WHERE id=?").run(
      saved.id,
    );
    assert.equal(
      (
        await (
          await call("staff", "/afp/rendering/preflight", {
            ...input,
            revision: 3,
          })
        ).json()
      ).reasons[0],
      "manifest_integrity_failed",
    );
    for (const route of ["/afp/contract", "/afp/manifests", "/afp/audit"])
      assert.equal((await call("client", route)).status, 403);
    assert.equal(
      (await call("client", "/afp/rendering/preflight", input)).status,
      403,
    );
    db.prepare("UPDATE users SET active=0 WHERE id='staff'").run();
    assert.equal(
      sdk.inspectRenderingRecipe({ ...input, revision: 3 }).status,
      403,
    );
    const logs = JSON.stringify(
      db.prepare("SELECT body FROM afp_sdk_audit").all(),
    );
    assert.ok(!logs.includes("secret-do-not-log"));
    assert.ok(!logs.includes("secret-case-note"));
    assert.ok(!logs.includes("widthMm"));
    assert.match(logs, /manifest-evaluated/);
    assert.match(logs, /stale_manifest_revision/);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM afp_manifest_revisions WHERE manifest_id=?",
        )
        .get(saved.id)!.n,
      3,
    );
    const reopened = openStore(file);
    assert.equal(
      reopened.prepare("SELECT count(*) n FROM afp_manifests").get()!.n,
      2,
    );
    reopened.close();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
