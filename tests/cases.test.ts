import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, issueLink, consumeLink } from "../server/store";
import { createApp } from "../server/app";

test("cases can be edited, archived and deleted under role and confirmation rules", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "atlas-cases-"));
  const db = openStore(":memory:");
  for (const [id, role] of [
    ["owner", "owner"],
    ["attorney", "attorney"],
    ["client", "client"],
  ])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      `${id}@example.test`,
      id,
      role,
      "firm",
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
    attorney = cookie("attorney"),
    client = cookie("client");
  const call = (
    session: string,
    url: string,
    body?: unknown,
    form?: FormData,
  ) =>
    fetch(base + url, {
      method: body !== undefined || form ? "POST" : "GET",
      headers: {
        cookie: session,
        origin: "http://localhost",
        ...(form ? {} : { "content-type": "application/json" }),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  try {
    const created = await (
      await call(owner, "/api/cases", {
        title: "Homer Cortez",
        client: "Homer Cortez",
        incident: "",
      })
    ).json();
    db.prepare("INSERT INTO grants VALUES(?,?)").run("client", created.id);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("evidence bytes")]), "note.txt");
    assert.equal(
      (await call(owner, `/api/cases/${created.id}/evidence`, undefined, form))
        .status,
      201,
    );
    assert.equal(readdirSync(path.join(dataDir, "evidence")).length, 1);

    // Clients cannot manage cases at all.
    assert.equal(
      (
        await call(client, `/api/cases/${created.id}/update`, {
          title: "x",
          client: "x",
          incident: "",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call(client, `/api/cases/${created.id}/archive`, { archived: true }))
        .status,
      403,
    );

    // Attorneys edit and archive; the listing reflects both.
    const updated = await (
      await call(attorney, `/api/cases/${created.id}/update`, {
        title: "Homer Cortez Civil Rights 1983",
        client: "Homer Cortez",
        incident: "Updated notes",
      })
    ).json();
    assert.equal(updated.title, "Homer Cortez Civil Rights 1983");
    assert.equal(updated.incident, "Updated notes");
    const archived = await (
      await call(attorney, `/api/cases/${created.id}/archive`, { archived: true })
    ).json();
    assert.equal(archived.archived, 1);
    const listed = await (await call(owner, "/api/cases")).json();
    assert.equal(listed[0].archived, 1);
    assert.equal(listed[0].title, "Homer Cortez Civil Rights 1983");

    // Deletion is owner-only and needs the exact title.
    assert.equal(
      (
        await call(attorney, `/api/cases/${created.id}/delete`, {
          confirmTitle: "Homer Cortez Civil Rights 1983",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call(owner, `/api/cases/${created.id}/delete`, { confirmTitle: "wrong" }))
        .status,
      400,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM evidence").get()?.n,
      1,
      "A refused deletion must not remove evidence",
    );
    assert.equal(
      (
        await call(owner, `/api/cases/${created.id}/delete`, {
          confirmTitle: "Homer Cortez Civil Rights 1983",
        })
      ).status,
      200,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM cases").get()?.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM evidence").get()?.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM grants").get()?.n, 0);
    assert.equal(readdirSync(path.join(dataDir, "evidence")).length, 0);
    assert.equal((await call(owner, `/api/cases/${created.id}/evidence`)).status, 404);
    assert.ok(
      db.prepare("SELECT 1 FROM audit WHERE action='case.deleted'").get(),
      "Deletion stays in the audit trail",
    );
    assert.ok(existsSync(dataDir));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
