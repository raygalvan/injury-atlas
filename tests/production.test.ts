import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, issueLink, consumeLink } from "../server/store";
import { createApp } from "../server/app";
import { productionRecord } from "../server/production";
import {
  claimJob,
  processProduction,
  notifyNext,
} from "../server/injury-worker";
import {
  claimLibraryJob,
  processLibraryDefinition,
} from "../server/library-agent";
import { createEvidenceStorage } from "../server/evidence-storage";

test("durable production, separate reviews, private files, publication and retrying notifications", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "injury-production-")),
    db = openStore(path.join(dir, "db.sqlite")),
    storage = createEvidenceStorage(dir);
  for (const [id, role, firm] of [
    ["admin", "owner", "f"],
    ["lawyer", "attorney", "f"],
    ["client", "client", "f"],
    ["foreign", "owner", "other"],
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
        throw new Error("No real emails in tests");
      },
    }),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  db.prepare("INSERT INTO platform_admins VALUES(?)").run("admin");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cookies = Object.fromEntries(
    ["admin", "lawyer", "client", "foreign"].map((id) => [
      id,
      "atlas_session=" + consumeLink(db, issueLink(db, id)!),
    ]),
  );
  const call = (id: string, url: string, body?: unknown) =>
    fetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: cookies[id],
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const c = await (
      await call("admin", "/cases", {
        title: "Synthetic test case",
        client: "Fictional person",
        incident: "",
      })
    ).json();
    db.prepare("INSERT INTO grants VALUES(?,?)").run("client", c.id);
    const prefix = `/cases/${c.id}/production`;
    assert.equal((await call("client", prefix)).status, 403);
    assert.equal((await call("foreign", prefix)).status, 404);
    assert.equal(
      (
        await call("lawyer", prefix, {
          name: "Test",
          description: "Description",
          evidenceId: "foreign-evidence",
        })
      ).status,
      400,
    );
    const r = await (
      await call("lawyer", prefix, {
        name: "Test injury",
        description: "Supplied documented description",
        medicalDescription: "Generic explanation",
        medicalReferences: "Educational reference",
        clientImpact: "Reported activity limitation",
        impactCitation: "Client statement, page 1",
      })
    ).json();
    assert.equal(
      (await call("lawyer", `${prefix}/${r.id}/review`, { decision: "source" }))
        .status,
      400,
    );
    assert.equal(
      (await call("lawyer", `${prefix}/${r.id}/queue`, {})).status,
      202,
    );
    assert.equal(
      (await call("lawyer", `${prefix}/${r.id}/queue`, {})).status,
      409,
    );
    const job = claimJob(db)!;
    assert.equal(job.id, r.id);
    assert.equal(claimJob(db), undefined);
    await processProduction(db, storage, job.id);
    let record = productionRecord(db, r.id)!;
    assert.equal(record.state, "complete");
    assert.equal(record.assets.length, 2);
    assert.equal(record.source_review, 0);
    assert.equal(record.placement_review, 0);
    assert.equal(record.render_review, 0);
    const pdf = record.assets.find((a) => a.kind === "document")!;
    assert.equal(
      (await call("lawyer", `/cases/${c.id}/evidence/${pdf.id}`)).status,
      200,
    );
    assert.equal(
      (await call("client", `/cases/${c.id}/evidence/${pdf.id}`)).status,
      404,
    );
    assert.equal(
      (await call("foreign", `/cases/${c.id}/evidence/${pdf.id}`)).status,
      404,
    );
    assert.equal(
      (await call("lawyer", `${prefix}/${r.id}/review`, { decision: "apply" }))
        .status,
      409,
    );
    await notifyNext(
      db,
      async () => {
        throw new Error("SES unavailable");
      },
      "https://injury.bot",
    );
    assert.equal(productionRecord(db, r.id)!.notification, "retrying");
    db.prepare("UPDATE injury_notifications SET next_attempt=0").run();
    let delivered = "";
    await notifyNext(
      db,
      async (email, url) => {
        assert.equal(email, "lawyer@example.test");
        delivered = url;
      },
      "https://injury.bot",
    );
    assert.ok(delivered.endsWith(`case=${c.id}&injury=${r.id}`));
    assert.equal(productionRecord(db, r.id)!.notification, "sent");
    await notifyNext(
      db,
      async () => {
        throw new Error("duplicate");
      },
      "https://injury.bot",
    );
    process.env.ANTHROPIC_API_KEY = "synthetic-test-not-a-key";
    await call("lawyer", `${prefix}/${r.id}/submit`, {
      name: "Generic injury",
      description: "No case data",
      medicalReferences: "Generic reference",
      kind: "documentation",
    });
    const privateLibrary = await (
      await call("foreign", "/injury-library")
    ).json();
    assert.equal(privateLibrary.length, 0);
    const entries = await (await call("lawyer", "/injury-library")).json();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].production_id, undefined);
    assert.equal(entries[0].clientImpact, undefined);
    assert.equal(
      (
        await call("foreign", `/injury-library/${entries[0].id}/review`, {
          status: "approved",
          note: "",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("admin", `/injury-library/${entries[0].id}/review`, {
          status: "approved",
          note: "",
        })
      ).status,
      409,
    );
    const libraryJob = claimLibraryJob(db)!;
    let libraryCalls = 0;
    await processLibraryDefinition(db, libraryJob.publication_id, {
      messages: {
        create: async (request: any) => {
          assert(
            !JSON.stringify(request).includes("Reported activity limitation"),
          );
          libraryCalls++;
          return {
            content:
              libraryCalls === 1
                ? [
                    {
                      type: "text",
                      text: JSON.stringify({ name: "Generic injury" }),
                    },
                  ]
                : [
                    {
                      type: "text",
                      text: "Generic researched definition.",
                      citations: [
                        {
                          type: "web_search_result_location",
                          url: "https://medlineplus.gov/injuries.html",
                        },
                      ],
                    },
                  ],
          };
        },
      },
    });
    assert.equal(
      (
        await call("admin", `/injury-library/${entries[0].id}/review`, {
          status: "approved",
          note: "Reviewed",
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await call("foreign", "/injury-library")).json()).length,
      1,
    );
    assert.ok(productionRecord(db, r.id));
    // Failed geometry is actionable, not permanently "Generating".
    const fail = await (
      await call("lawyer", prefix, {
        name: "Unsupported placement",
        description: "Synthetic",
        measurementBasis: "Illustrative test dimensions",
        recipe: {
          kind: "fracture",
          parentId: "FJ3229",
          center: [0.08, 1.38, 0.01],
          normal: [0, 0, 1],
          widthMm: 20,
          heightMm: 20,
          depthMm: 1,
        },
      })
    ).json();
    await call("lawyer", `${prefix}/${fail.id}/queue`, {});
    claimJob(db);
    await processProduction(db, storage, fail.id, async () => {
      throw new Error("No intersection");
    });
    assert.equal(productionRecord(db, fail.id)!.state, "failed");
    assert.match(productionRecord(db, fail.id)!.error, /intersection/);
    // Restart recovery works from persisted rows.
    db.prepare(
      "UPDATE injury_production SET state='running',updated=0 WHERE id=?",
    ).run(fail.id);
    claimJob(db);
    assert.equal(productionRecord(db, fail.id)!.state, "failed");
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
