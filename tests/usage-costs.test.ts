import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store";
import { ensureProduction } from "../server/production";
import { ensureInjuryTables } from "../server/injuries";
import { defaults, saveSettings, reserveRun } from "../server/ai/settings";
import { usagePolicy, usageSummary, recordUsage } from "../server/ai/usage";
import { agentClient } from "../server/ai/agent-client";
import {
  queueLibraryDefinition,
  claimLibraryJob,
  processLibraryDefinition,
  recoverLibraryLimitFailures,
  LEGACY_LIBRARY_LIMIT_ERRORS,
} from "../server/library-agent";
function fixture() {
  const db = openStore(":memory:");
  ensureInjuryTables(db);
  ensureProduction(db);
  for (const id of ["admin", "lawyer"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      id + "@example.test",
      id,
      id === "admin" ? "owner" : "attorney",
      "f",
    );
  db.prepare("INSERT INTO platform_admins VALUES(?)").run("admin");
  return db;
}
test("super-admin testing bypasses daily cap, ordinary users remain capped, and disabling testing restores it", () => {
  const db = fixture(),
    cfg = defaults();
  cfg.dailyRunLimit = 1;
  saveSettings(db, "platform", cfg, { id: "admin" } as any);
  const model = { provider: "anthropic" as const, model: "test" };
  reserveRun(db, { id: "admin", firm_id: "f" }, "library-research", model);
  reserveRun(db, { id: "admin", firm_id: "f" }, "library-research", model);
  assert.throws(
    () => reserveRun(db, { id: "lawyer", firm_id: "f" }, "library-research", model),
    /daily AI/,
  );
  db.prepare("INSERT INTO ai_cost_policy VALUES(1,?)").run(
    JSON.stringify({ ...usagePolicy(db), testingEnabled: false }),
  );
  assert.throws(
    () => reserveRun(db, { id: "admin", firm_id: "f" }, "library-research", model),
    /daily AI/,
  );
  db.close();
});
test("usage costs distinguish cache categories, price failures, and isolate firm totals", () => {
  const db = fixture(),
    p = usagePolicy(db);
  p.rates = [
    {
      provider: "anthropic",
      model: "test",
      input: 2,
      output: 10,
      cachedInput: 0.2,
      cacheWrite: 2.5,
      searchPerThousand: 10,
    },
  ];
  db.prepare("INSERT INTO ai_cost_policy VALUES(1,?)").run(JSON.stringify(p));
  const c = { db, firmId: "f", userId: "admin", agent: "library-research" };
  recordUsage(
    c,
    "anthropic",
    "test",
    {
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 100,
        server_tool_use: { web_search_requests: 2 },
      },
    },
    "max_tokens",
    50,
  );
  recordUsage(
    { ...c, firmId: "other" },
    "openai",
    "unpriced",
    {
      usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 50 } },
    },
    "completed",
    20,
  );
  const own: any = usageSummary(db, "f").totals;
  assert.equal(own.inputTokens, 1000);
  assert.equal(own.cachedTokens, 500);
  assert.equal(own.calls, 1);
  assert.ok(Math.abs(own.knownCostUsd - 0.02435) < 1e-8);
  const all: any = usageSummary(db, null).totals;
  assert.equal(all.calls, 2);
  assert.equal(all.unpricedCalls, 1);
  db.close();
});
test("real library adapter recovers truncation and repeated pauses, saves citations, and meters every call", async () => {
  const db = fixture(),
    original = globalThis.fetch,
    prior = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "synthetic";
  let calls = 0;
  const requests: any[] = [];
  globalThis.fetch = (async (_u: any, o: any) => {
    const b = JSON.parse(o.body);
    requests.push(b);
    calls++;
    const result =
      calls === 1
        ? { stop_reason: "max_tokens", content: [{ type: "text", text: '{"na' }] }
        : calls === 2
          ? {
              stop_reason: "end_turn",
              content: [{ type: "text", text: '{"name":"Synthetic injury"}' }],
            }
          : calls < 7
            ? {
                stop_reason: "pause_turn",
                content: [
                  {
                    type: "text",
                    text: "General cited explanation.",
                    citations: [
                      { type: "web_search_result_location", url: "https://www.nih.gov/example" },
                    ],
                  },
                ],
              }
            : {
                stop_reason: "end_turn",
                content: [{ type: "text", text: "General professional description." }],
              };
    return Response.json({
      ...result,
      id: "synthetic-" + calls,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  }) as any;
  try {
    const u = db.prepare("SELECT * FROM users WHERE id=?").get("admin") as any;
    const { id } = queueLibraryDefinition(db, u, "generic injury");
    claimLibraryJob(db);
    await processLibraryDefinition(db, id);
    const j = db.prepare("SELECT * FROM injury_library_jobs WHERE publication_id=?").get(id)!;
    assert.equal(j.state, "complete", String(j.error));
    assert.equal(calls, 7);
    assert.equal(requests[1].max_tokens, 4096);
    const p = db.prepare("SELECT * FROM injury_publications WHERE id=?").get(id)!;
    assert.equal(p.status, "submitted");
    assert.match(String(p.medical_references), /nih.gov/);
    const summary: any = usageSummary(db, "f");
    assert.equal(summary.totals.calls, 7);
    assert.equal(summary.totals.outputTokens, 350);
    assert.equal(summary.jobs[0].id, id);
  } finally {
    globalThis.fetch = original;
    if (prior === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prior;
    db.close();
  }
});
test("legacy limit recovery requeues eligible records once without recreating or approving definitions", () => {
  const db = fixture(),
    u = db.prepare("SELECT * FROM users WHERE id=?").get("admin") as any;
  const good = queueLibraryDefinition(db, u, "generic"),
    reviewed = queueLibraryDefinition(db, u, "reviewed"),
    unrelated = queueLibraryDefinition(db, u, "unrelated");
  for (const r of [good, reviewed, unrelated]) {
    db.prepare("UPDATE injury_publications SET status='failed' WHERE id=?").run(r.id);
    db.prepare("UPDATE injury_library_jobs SET state='failed',error=? WHERE publication_id=?").run(
      LEGACY_LIBRARY_LIMIT_ERRORS[0],
      r.id,
    );
  }
  db.prepare("UPDATE injury_publications SET reviewer='admin' WHERE id=?").run(reviewed.id);
  db.prepare("UPDATE injury_library_jobs SET error='Provider offline' WHERE publication_id=?").run(
    unrelated.id,
  );
  assert.equal(recoverLibraryLimitFailures(db), 1);
  assert.equal(recoverLibraryLimitFailures(db), 0);
  db.prepare("UPDATE injury_library_jobs SET state='failed',error=? WHERE publication_id=?").run(
    LEGACY_LIBRARY_LIMIT_ERRORS[0],
    good.id,
  );
  db.prepare("UPDATE injury_publications SET status='failed' WHERE id=?").run(good.id);
  assert.equal(recoverLibraryLimitFailures(db), 0);
  assert.equal(db.prepare("SELECT count(*) n FROM injury_publications").get()!.n, 3);
  db.close();
});
