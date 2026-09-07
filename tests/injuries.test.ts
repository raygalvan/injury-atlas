import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, issueLink, consumeLink } from "../server/store";
import { createApp } from "../server/app";
import { ensureInjuryTables, matchByKeywords, matchInjuries, SEED_LIBRARY, listLibrary } from "../server/injuries";

test("injury library, case applications, matching and generation queue", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "atlas-injuries-"));
  const db = openStore(":memory:");
  for (const [id, role] of [["owner", "owner"], ["client", "client"]])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(id, `${id}@example.test`, id, role, "firm");
  const app = createApp(db, { dataDir, origin: "http://localhost", send: async () => {} });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const cookie = (id: string) => "atlas_session=" + consumeLink(db, issueLink(db, id)!);
  const owner = cookie("owner"), client = cookie("client");
  const call = (session: string, url: string, body?: unknown) =>
    fetch(base + url, {
      method: body !== undefined ? "POST" : "GET",
      headers: { cookie: session, origin: "http://localhost", "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  try {
    // Seeded library mirrors the engine's reference groups and is idempotent.
    const library = await (await call(owner, "/api/injuries")).json();
    assert.equal(library.length, SEED_LIBRARY.length);
    assert.equal(listLibrary(db).length, SEED_LIBRARY.length);
    assert.equal((await call(client, "/api/injuries")).status, 403);

    const c = await (await call(owner, "/api/cases", { title: "Homer Cortez", client: "Homer Cortez", incident: "" })).json();
    db.prepare("INSERT INTO grants VALUES(?,?)").run("client", c.id);
    assert.deepEqual(await (await call(owner, `/api/cases/${c.id}/injuries`)).json(), { applied: [], generated: [] });

    // Applying replaces the set; unknown ids are dropped; hidden persists.
    let state = await (await call(owner, `/api/cases/${c.id}/injuries/apply`, { injuries: [{ id: "brain-hemorrhage" }, { id: "left-ribs-2-4", hidden: true }, { id: "made-up" }] })).json();
    assert.deepEqual(state.applied.map((a: { id: string; hidden: boolean }) => [a.id, a.hidden]), [["brain-hemorrhage", false], ["left-ribs-2-4", true]]);
    state = await (await call(owner, `/api/cases/${c.id}/injuries/apply`, { injuries: [{ id: "left-ribs-2-4", hidden: false }] })).json();
    assert.deepEqual(state.applied.map((a: { id: string }) => a.id), ["left-ribs-2-4"]);
    assert.equal((await call(client, `/api/cases/${c.id}/injuries/apply`, { injuries: [] })).status, 403);
    // Clients on the case can read what is applied; other firms cannot see the case.
    assert.equal((await call(client, `/api/cases/${c.id}/injuries`)).status, 200);

    // Matching without a key uses keywords and reports the same shape Claude would.
    const match = await (await call(owner, `/api/cases/${c.id}/injuries/match`, { description: "Left frontal skull fracture with subarachnoid bleed; two fractured ribs on the left; broken femur." })).json();
    assert.deepEqual([...match.matches].sort(), ["brain-hemorrhage", "left-ribs-2-4", "skull-fracture"]);
    assert.equal(match.unmatched, "Femur fracture");
    assert.equal(match.method, "keywords");
    assert.equal((await call(owner, `/api/cases/${c.id}/injuries/match`, { description: "" })).status, 400);

    // Generation is queued as a library row tied to the case, without an engine id.
    const queued = await call(owner, `/api/cases/${c.id}/injuries/generate`, { name: "Femur fracture", description: "broken femur" });
    assert.equal(queued.status, 202);
    const q = await queued.json();
    assert.equal(q.status, "queued");
    state = await (await call(owner, `/api/cases/${c.id}/injuries`)).json();
    assert.deepEqual(state.generated, [{ id: q.id, name: "Femur fracture", status: "queued" }]);
    assert.equal(listLibrary(db).length, SEED_LIBRARY.length, "generated rows stay out of the applicable library until placed");
    assert.ok(db.prepare("SELECT 1 FROM audit WHERE action='injury.generation-queued'").get());
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("keyword matcher handles rib laterality and Claude failures fall back", async () => {
  const db = openStore(":memory:");
  ensureInjuryTables(db);
  const library = listLibrary(db);
  const ribs = matchByKeywords("several broken ribs", library);
  assert.ok(ribs.matches.includes("left-ribs-2-4") && ribs.matches.includes("right-ribs-2-5"));
  const lower = matchByKeywords("right ribs 8 and 9 fractured", library);
  assert.deepEqual(lower.matches, ["right-ribs-8-10"]);
  const fake = { messages: { create: async () => { throw new Error("synthetic outage"); } } } as never;
  const result = await matchInjuries("skull fracture", library, fake);
  assert.equal(result.method, "keywords");
  assert.deepEqual(result.matches, ["skull-fracture"]);
  const canned = { messages: { create: async () => ({ content: [{ type: "text", text: 'Sure: {"matches":["skull-fracture","nope"],"unmatched":["Femur fracture"]}' }] }) } } as never;
  const parsed = await matchInjuries("anything", library, canned);
  assert.deepEqual(parsed, { matches: ["skull-fracture"], unmatched: "Femur fracture", method: "claude" });
});
