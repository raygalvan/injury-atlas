import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, issueLink, consumeLink } from "../server/store";
import { createApp } from "../server/app";
import {
  claimLibraryJob,
  processLibraryDefinition,
  notifyLibraryNext,
} from "../server/library-agent";

test("name-only library jobs are durable, private, researched by AI and reviewable without manual fields", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "library-agent-")),
    db = openStore(path.join(dir, "db.sqlite"));
  for (const [id, role, firm] of [
    ["admin", "owner", "f"],
    ["lawyer", "attorney", "f"],
    ["client", "client", "f"],
    ["other", "owner", "other"],
  ])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      `${id}@example.test`,
      id,
      role,
      firm,
    );
  const app = createApp(db, {
      dataDir: dir,
      origin: "http://localhost",
      send: async () => {
        throw new Error("No email in tests");
      },
    }),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  db.prepare("INSERT INTO platform_admins VALUES('admin')").run();
  const sessions = Object.fromEntries(
    ["admin", "lawyer", "client", "other"].map((id) => [
      id,
      consumeLink(db, issueLink(db, id)!),
    ]),
  );
  const call = (u: string, route: string, body?: any) =>
    fetch(
      `http://127.0.0.1:${(server.address() as any).port}/api/injury-library${route}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          cookie: `atlas_session=${sessions[u]}`,
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(
      (await call("lawyer", "", { name: "broken left femur" })).status,
      503,
    );
    process.env.ANTHROPIC_API_KEY = "synthetic-test-not-a-key";
    assert.equal(
      (await call("client", "", { name: "broken left femur" })).status,
      403,
    );
    const queued = await call("lawyer", "", { name: "broken left femur" });
    assert.equal(queued.status, 202);
    const { id } = await queued.json();
    assert.equal((await (await call("other", "")).json()).length, 0);
    assert.equal(
      (await call("other", `/${id}/revise`, { name: "fracture" })).status,
      404,
    );
    assert.equal(
      (await call("admin", `/${id}/review`, { status: "approved", note: "" }))
        .status,
      409,
    );
    assert.equal(claimLibraryJob(db)!.publication_id, id);
    assert.equal(claimLibraryJob(db), undefined);
    // Restart recovery persists the failed request and supports retry of that same row.
    db.prepare(
      "UPDATE injury_library_jobs SET updated=0 WHERE publication_id=?",
    ).run(id);
    claimLibraryJob(db);
    assert.equal((await call("other", `/${id}/retry`, {})).status, 404);
    assert.equal((await call("lawyer", `/${id}/retry`, {})).status, 202);
    claimLibraryJob(db);
    let calls = 0;
    const client = {
      messages: {
        create: async (request: any) => {
          calls++;
          assert(!JSON.stringify(request).includes("case_id"));
          if (calls % 2 === 1)
            return {
              content: [
                { type: "text", text: '{"name":"Left femoral fracture"}' },
              ],
            };
          return {
            content: [
              {
                type: "text",
                text: "A generic femoral fracture definition.",
                citations: [
                  {
                    type: "web_search_result_location",
                    url: "https://orthoinfo.aaos.org/en/diseases--conditions/femur-shaft-fractures-broken-thighbone/",
                  },
                ],
              },
            ],
          };
        },
      },
    };
    await processLibraryDefinition(db, id, client);
    const row = db
      .prepare("SELECT * FROM injury_publications WHERE id=?")
      .get(id)!;
    assert.equal(row.status, "submitted");
    assert.match(String(row.description), /generic/);
    assert.match(String(row.medical_references), /aaos.org/);
    assert.equal(
      (await call("lawyer", `/${id}/review`, { status: "approved", note: "" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call("admin", `/${id}/review`, {
          status: "approved",
          note: "Reviewed",
        })
      ).status,
      200,
    );
    assert.equal((await (await call("other", "")).json()).length, 1);
    const revised = await (
      await call("lawyer", `/${id}/revise`, { name: "femoral neck fracture" })
    ).json();
    assert.notEqual(revised.id, id);
    assert.equal(
      db.prepare("SELECT status FROM injury_publications WHERE id=?").get(id)!
        .status,
      "approved",
    );
    assert.equal((await (await call("other", "")).json()).length, 1);
    claimLibraryJob(db);
    await processLibraryDefinition(db, revised.id, {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: '{"name":"Femoral neck fracture"}' }],
        }),
      },
    });
    assert.equal(
      db
        .prepare("SELECT state FROM injury_library_jobs WHERE publication_id=?")
        .get(revised.id)!.state,
      "failed",
    );
    assert.equal(
      (
        await call("admin", `/${revised.id}/review`, {
          status: "approved",
          note: "",
        })
      ).status,
      409,
    );
    let delivered = 0;
    await notifyLibraryNext(
      db,
      async () => {
        throw new Error("SES temporarily unavailable");
      },
      "https://injury.bot",
    );
    assert.equal(
      db
        .prepare(
          "SELECT notification FROM injury_library_jobs WHERE publication_id=?",
        )
        .get(id)!.notification,
      "retrying",
    );
    db.prepare("UPDATE injury_library_jobs SET next_notification=0").run();
    await notifyLibraryNext(
      db,
      async (email, url) => {
        delivered++;
        assert.equal(email, "lawyer@example.test");
        assert.equal(url, `https://injury.bot/injuries?library=${id}`);
      },
      "https://injury.bot",
    );
    await notifyLibraryNext(
      db,
      async () => {
        delivered++;
      },
      "https://injury.bot",
    );
    assert.equal(delivered, 1);
    // No new worker/schema initialization resets completed records or pending jobs.
    assert.equal(
      db.prepare("SELECT count(*) n FROM injury_publications").get()!.n,
      2,
    );
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
