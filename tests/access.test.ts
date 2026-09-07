import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  openStore,
  issueLink,
  consumeLink,
  sessionUser,
} from "../server/store";
import { createApp } from "../server/app";
test("single-use links expire, reject replay and respect revoked membership", () => {
  const db = openStore(":memory:");
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
    "u",
    "owner@example.test",
    "Owner",
    "owner",
    "firm",
  );
  const old = issueLink(db, "u", 0)!;
  assert.equal(consumeLink(db, old, 900001), null);
  const raw = issueLink(db, "u")!;
  const session = consumeLink(db, raw)!;
  assert.ok(session);
  assert.equal(consumeLink(db, raw), null);
  assert.equal(sessionUser(db, session)?.id, "u");
  db.prepare("UPDATE users SET active=0").run();
  assert.equal(sessionUser(db, session), undefined);
  db.close();
});
test("tenant and client boundaries; uploads retain bytes; approval does not approve placement", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "atlas-test-"));
  const db = openStore(":memory:");
  for (const [id, role, firm] of [
    ["owner", "owner", "a"],
    ["client", "client", "a"],
    ["other", "owner", "b"],
  ])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      `${id}@example.test`,
      id,
      role,
      firm,
    );
  const app = createApp(db, {
    dataDir,
    origin: "http://localhost",
    send: async () => {},
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const cookie = (id: string) =>
    "atlas_session=" + consumeLink(db, issueLink(db, id)!);
  const owner = cookie("owner"),
    client = cookie("client"),
    other = cookie("other");
  async function request(url: string, c: string, body?: unknown) {
    return fetch(base + "/api" + url, {
      headers: {
        cookie: c,
        origin: "http://localhost",
        ...(body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(body !== undefined
        ? {
            method: "POST",
            body: body instanceof FormData ? body : JSON.stringify(body),
          }
        : {}),
    });
  }
  try {
    assert.equal((await request("/cases", "")).status, 401);
    const created = await request("/cases", owner, {
      title: "Synthetic case",
      client: "Test subject",
      incident: "",
    });
    assert.equal(created.status, 201);
    const c = (await created.json()) as { id: string };
    assert.equal(
      (await request("/cases/" + c.id + "/evidence", other)).status,
      404,
    );
    assert.equal(
      (await request("/cases/" + c.id + "/evidence", client)).status,
      404,
    );
    db.prepare("INSERT INTO grants VALUES(?,?)").run("client", c.id);
    const form = new FormData();
    form.append("file", new Blob(["source bytes"]), "source.txt");
    assert.equal(
      (await request(`/cases/${c.id}/evidence`, client, form)).status,
      201,
    );
    const evidence = (await (
      await request(`/cases/${c.id}/evidence`, owner)
    ).json()) as { id: string; sha256: string }[];
    assert.equal(
      evidence[0].sha256,
      createHash("sha256").update("source bytes").digest("hex"),
    );
    assert.equal(
      await (
        await request(`/cases/${c.id}/evidence/${evidence[0].id}`, client)
      ).text(),
      "source bytes",
    );
    assert.equal(
      (await request(`/cases/${c.id}/findings`, client)).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/atlas-engine/index.html", {
          headers: { cookie: client },
        })
      ).status,
      403,
    );
    const draft = await request(`/cases/${c.id}/findings`, owner, {
      anatomicalStructure: "Synthetic left rib",
      type: "bone",
      laterality: "left",
      notes: "Test only",
      evidenceId: evidence[0].id,
      citation: "Page 1",
    });
    assert.equal(draft.status, 201);
    const f = (await draft.json()) as { id: string };
    const reviewed = (await (
      await request(`/cases/${c.id}/findings/${f.id}/review`, owner, {
        decision: "approve-source",
      })
    ).json()) as {
      sourceStatus: string;
      placementStatus: string;
      renderStatus: string;
    };
    assert.equal(reviewed.sourceStatus, "verified");
    assert.equal(reviewed.placementStatus, "not_started");
    assert.equal(reviewed.renderStatus, "not_started");
    assert.equal(
      (
        await fetch(base + "/api/cases", {
          method: "POST",
          headers: {
            cookie: owner,
            origin: "https://evil.test",
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    await request("/auth/logout", owner, {});
    assert.equal((await request("/me", owner)).status, 401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
