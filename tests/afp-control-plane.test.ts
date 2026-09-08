import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, consumeLink, issueLink, type User } from "../server/store";
import { createApp } from "../server/app";
import {
  ensureAfp,
  addAfpEntry,
  readAfp,
  afpMarkdown,
} from "../server/afp/management";
import { readControlPlane } from "../server/afp/control-plane";
import { deriveReadiness } from "../server/afp/readiness";

test("AFP registries enforce governance, preserve durable state and never activate unsupported infrastructure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "afp-control-")),
    file = path.join(dir, "atlas.sqlite"),
    db = openStore(file);
  const users: Record<string, User> = {};
  for (const [id, role, firm] of [
    ["admin", "owner", "a"],
    ["owner", "owner", "b"],
    ["atty", "attorney", "a"],
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
      throw Error("No email");
    },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  db.prepare("INSERT INTO platform_admins VALUES('admin')").run();
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const sessions = Object.fromEntries(
    Object.keys(users).map((id) => [id, consumeLink(db, issueLink(db, id)!)]),
  );
  const call = (who: string, url: string, body?: unknown) =>
    fetch(base + "/api/settings/afp" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: "atlas_session=" + sessions[who],
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const c = readControlPlane(db);
    assert.equal(c.readiness.length, 19);
    assert.equal(c.extensionPoints.length, 11);
    assert.equal(c.features.length, 0);
    assert.equal(new Set(c.readiness.map((r) => r.id)).size, 19);
    for (const r of c.readiness)
      for (const dependency of r.dependencies)
        assert.ok(c.readiness.some((d) => d.id === dependency));
    for (const p of c.extensionPoints) {
      assert.equal(p.dynamicAttachment, false);
      for (const id of p.resourcePolicy)
        assert.ok(c.policies.some((p) => p.id === id));
    }
    assert.ok(c.resources.every((r) => !r.provisionable));
    assert.ok(c.overall.blockers.includes("AFP MCP Connection"));
    assert.ok(
      deriveReadiness(
        c.readiness.map((r) => ({ ...r, status: "Verified" })),
      ).criteria.every((r) => r.met),
    );
    for (const who of ["owner", "atty", "client"]) {
      for (const route of [
        "/control-plane",
        "/manifest",
        "/history/policy:authentication",
      ])
        assert.equal((await call(who, route)).status, 403);
      for (const route of [
        "/readiness/mcp",
        "/policies/authentication",
        "/features",
        "/features/example",
      ])
        assert.equal((await call(who, route, {})).status, 403);
    }
    const manifest = await (await call("admin", "/manifest")).json();
    assert.equal(manifest.productionExecutable, false);
    assert.equal(manifest.runtime.mcpConnected, false);
    for (const id of [
      "authentication",
      "tenant-boundaries",
      "evidence-provenance",
      "audit-logging",
    ])
      assert.equal(
        (
          await call("admin", "/policies/" + id, {
            level: "Allowed",
            revision: 1,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await call("admin", "/policies/ui-additions", {
          level: "Approval Required",
          revision: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("admin", "/policies/ui-additions", {
          level: "Allowed",
          revision: 1,
        })
      ).status,
      409,
    );
    const review = {
      status: "Verified",
      evidence: "Synthetic registry assertions",
      nextStep: "Build validated SDK boundary",
      revision: 1,
    };
    assert.equal((await call("admin", "/readiness/mcp", review)).status, 400);
    assert.equal(
      (
        await call("admin", "/readiness/extension-registry", {
          ...review,
          evidence: "",
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("admin", "/readiness/extension-registry", review)).status,
      200,
    );
    assert.equal(
      (await call("admin", "/readiness/extension-registry", review)).status,
      409,
    );
    assert.equal(
      readControlPlane(db).readiness.find((r) => r.id === "extension-registry")!
        .lastVerified!.by,
      "admin",
    );
    const f = {
      id: "private-renderer",
      name: "Private renderer proposal",
      owner: "admin",
      scope: "Private",
      baseVersion: "test-release",
      extensionPoints: ["rendering-pipeline"],
      resources: ["gpu-compute"],
      status: "draft",
      version: "0.1.0",
      compute: {
        description: "Future isolated service",
        estimatedMonthlyUsd: null,
        actualUsd: null,
      },
      tests: { status: "pending", reference: "" },
      security: { status: "pending", reference: "" },
      rollback: { status: "planned", reference: "" },
    };
    for (const bad of [
      { ...f, status: "active" },
      { ...f, extensionPoints: ["unknown"] },
      { ...f, owner: "client" },
      { ...f, tests: { status: "passed", reference: "" } },
    ])
      assert.equal((await call("admin", "/features", bad)).status, 400);
    assert.equal((await call("admin", "/features", f)).status, 201);
    assert.equal((await call("admin", "/features", f)).status, 409);
    assert.equal(
      (
        await call("admin", "/features/" + f.id, {
          ...f,
          status: "preview",
          revision: 1,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("admin", "/features/" + f.id, {
          ...f,
          status: "review",
          revision: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("admin", "/features/" + f.id, {
          ...f,
          status: "retired",
          revision: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("admin", "/features/" + f.id, {
          ...f,
          status: "retired",
          revision: 2,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("admin", "/features/" + f.id, {
          ...f,
          status: "draft",
          revision: 3,
        })
      ).status,
      400,
    );
    const proposal = {
      kind: "experiment",
      title: "Try isolated output",
      content: "Measure tenant separation",
      status: "verified",
    };
    const entry = addAfpEntry(db, users.admin, proposal, "coordinator");
    assert.equal(entry.status, "proposed");
    assert.equal(
      addAfpEntry(db, users.admin, proposal, "coordinator").id,
      entry.id,
    );
    assert.equal(
      (
        await call("admin", "/entries/" + entry.id, {
          ...proposal,
          status: "verified",
          evidence: "Synthetic test evidence",
          revision: 1,
        })
      ).status,
      200,
    );
    const saved = readAfp(db, users.admin).entries[0];
    assert.equal(saved.reviewed_by, "admin");
    assert.ok(saved.reviewed_at);
    assert.equal(saved.source, "coordinator");
    assert.match(afpMarkdown(db, users.admin), /Revision history/);
    assert.match(
      afpMarkdown(db, users.admin),
      /"status": "proposed"|\\"status\\":\\"proposed\\"/,
    );
    // Separate connection/startup reproduces release restart against durable data.
    const reopened = openStore(file);
    ensureAfp(reopened);
    assert.equal(
      readAfp(reopened, users.admin).entries[0].reviewed_by,
      "admin",
    );
    assert.equal(readControlPlane(reopened).features[0].status, "retired");
    assert.equal(
      readControlPlane(reopened).policies.find((p) => p.id === "ui-additions")!
        .level,
      "Approval Required",
    );
    reopened.close();
    db.prepare("DELETE FROM platform_admins WHERE user_id='admin'").run();
    assert.equal((await call("admin", "/control-plane")).status, 403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AFP journal additive migration retains legacy entries, direction and revisions without inventing reviews", () => {
  const db = openStore(":memory:");
  try {
    db.exec(
      "CREATE TABLE afp_direction(id INTEGER PRIMARY KEY,vision TEXT,priorities TEXT,revision INTEGER,updated INTEGER); INSERT INTO afp_direction VALUES(1,'Existing vision','Existing priorities',7,1); CREATE TABLE afp_entries(id TEXT PRIMARY KEY,kind TEXT,title TEXT,content TEXT,status TEXT,evidence TEXT,source TEXT,actor TEXT,created INTEGER,updated INTEGER,revision INTEGER); INSERT INTO afp_entries VALUES('old','decision','Existing decision','Keep this','verified','PR evidence','admin','admin',1,2,3); CREATE TABLE afp_history(id TEXT PRIMARY KEY,target TEXT,body TEXT,actor TEXT,created INTEGER); INSERT INTO afp_history VALUES('h','old','{\"status\":\"proposed\"}','admin',1)",
    );
    ensureAfp(db);
    ensureAfp(db);
    assert.equal(
      db.prepare("SELECT vision FROM afp_direction").get()!.vision,
      "Existing vision",
    );
    const row = db.prepare("SELECT * FROM afp_entries").get()!;
    assert.equal(row.revision, 3);
    assert.equal(
      db.prepare("SELECT count(*) n FROM afp_entry_governance").get()!.n,
      0,
    );
    assert.equal(row.status, "verified");
    assert.equal(db.prepare("SELECT count(*) n FROM afp_history").get()!.n, 1);
  } finally {
    db.close();
  }
});
