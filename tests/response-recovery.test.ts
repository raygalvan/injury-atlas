import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store";
import { ensureInjuryTables } from "../server/injuries";
import {
  ensureProduction,
  createProduction,
  productionSchema,
  productionRecord,
} from "../server/production";
import {
  recoverResponseFailures,
  LEGACY_RESPONSE_ERROR,
} from "../server/injury-worker";
test("response repair requeues only eligible failed records once without duplicating or approving work", () => {
  const db = openStore(":memory:");
  ensureInjuryTables(db);
  ensureProduction(db);
  db.prepare(
    "INSERT INTO users VALUES('u','test@example.test','Tester','owner','f',1)",
  ).run();
  db.prepare(
    "INSERT INTO cases(id,firm_id,title,client,incident,created) VALUES('c','f','Synthetic','Synthetic','',0)",
  ).run();
  const make = (patch = {}) =>
    createProduction(
      db,
      { id: "u", firm_id: "f" } as any,
      "c",
      productionSchema.parse({
        name: "shoulder abrasion",
        description: "shoulder abrasion",
        agentManaged: true,
        ...patch,
      }),
    );
  const eligible = make(),
    reviewed = make(),
    unrelated = make(),
    demand = make({ workflow: "demand" }),
    manual = make({ agentManaged: false }),
    complete = make();
  for (const r of [eligible, reviewed, unrelated, demand, manual, complete])
    db.prepare(
      "UPDATE injury_production SET state='failed',error=? WHERE id=?",
    ).run(LEGACY_RESPONSE_ERROR, r.id);
  db.prepare("UPDATE injury_production SET source_review=1 WHERE id=?").run(
    reviewed.id,
  );
  db.prepare(
    "UPDATE injury_production SET error='Provider rate limit' WHERE id=?",
  ).run(unrelated.id);
  db.prepare("UPDATE injury_production SET state='complete' WHERE id=?").run(
    complete.id,
  );
  assert.equal(recoverResponseFailures(db), 1);
  const retried = productionRecord(db, eligible.id)!;
  assert.equal(retried.state, "queued");
  assert.equal(retried.body.description, "shoulder abrasion");
  assert.equal(retried.source_review, 0);
  assert.equal(productionRecord(db, reviewed.id)!.state, "failed");
  assert.equal(productionRecord(db, complete.id)!.state, "complete");
  assert.equal(recoverResponseFailures(db), 0);
  db.prepare(
    "UPDATE injury_production SET state='failed',error=? WHERE id=?",
  ).run(LEGACY_RESPONSE_ERROR, eligible.id);
  assert.equal(recoverResponseFailures(db), 0);
  assert.equal(
    db.prepare("SELECT count(*) n FROM injury_production").get()!.n,
    6,
  );
  db.close();
});
