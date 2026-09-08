import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, issueLink, consumeLink } from "../server/store";
import { createApp } from "../server/app";
import {
  matchByKeywords,
  matchInjuries,
  listLibrary,
} from "../server/injuries";
test("only workflow injuries enter the catalogue; plain requests queue the Injury Creation Agent", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "injury-panel-")),
    db = openStore(":memory:");
  for (const [id, role] of [
    ["owner", "owner"],
    ["client", "client"],
  ])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      id + "@example.test",
      id,
      role,
      "firm",
    );
  const app = createApp(db, {
      dataDir,
      origin: "http://localhost",
      send: async () => {
        throw Error("No test emails");
      },
    }),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    cookie = (id: string) =>
      "atlas_session=" + consumeLink(db, issueLink(db, id)!);
  const owner = cookie("owner"),
    client = cookie("client");
  const call = (c: string, url: string, body?: any) =>
    fetch(base + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: c,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const priorKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.deepEqual(await (await call(owner, "/api/injuries")).json(), []);
    assert.deepEqual(listLibrary(db), []);
    assert.equal((await call(client, "/api/injuries")).status, 403);
    const c = await (
      await call(owner, "/api/cases", {
        title: "Synthetic workflow",
        client: "Fictional subject",
        incident: "",
      })
    ).json();
    const initial = await (
      await call(owner, `/api/cases/${c.id}/injuries`)
    ).json();
    db.prepare("INSERT INTO grants VALUES(?,?)").run("client", c.id);
    assert.deepEqual(initial.catalogue, []);
    assert.deepEqual(initial.applied, []);
    assert.equal(
      (
        await call(owner, `/api/cases/${c.id}/injuries/apply`, {
          injuries: [{ id: "skull-fracture", hidden: false }],
        })
      ).status,
      400,
    );
    const match = await (
      await call(owner, `/api/cases/${c.id}/injuries/match`, {
        description: "broken knee cap",
      })
    ).json();
    assert.deepEqual(match.matches, []);
    assert.equal(match.unmatched, "broken knee cap");
    assert.equal(
      (
        await call(owner, `/api/cases/${c.id}/injuries/generate`, {
          name: "broken knee cap",
          description: "broken knee cap",
        })
      ).status,
      503,
    );
    process.env.ANTHROPIC_API_KEY = "synthetic-no-network";
    const queued = await call(owner, `/api/cases/${c.id}/injuries/generate`, {
      name: "broken knee cap",
      description: "broken knee cap",
    });
    assert.equal(queued.status, 202);
    const q = await queued.json();
    const record = db
      .prepare("SELECT * FROM injury_production WHERE id=?")
      .get(q.id)!;
    assert.equal(record.state, "queued");
    assert.equal(JSON.parse(String(record.body)).agentManaged, true);
    assert.equal(JSON.parse(String(record.body)).recipe, null);
    const state = await (
      await call(owner, `/api/cases/${c.id}/injuries`)
    ).json();
    assert.equal(state.generated[0].id, q.id);
    assert.equal(state.generated[0].status, "queued");
    assert.deepEqual(state.catalogue, []);
    assert.equal(
      (
        await call(client, `/api/cases/${c.id}/injuries/generate`, {
          name: "test",
          description: "test",
        })
      ).status,
      403,
    );
  } finally {
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
test("matching uses actual library entries and never substitutes test anatomy", async () => {
  const library = [
    {
      id: "authored-patella",
      name: "Patella fracture",
      shortName: "Patellar fracture",
      section: "Injury library",
      laterality: "unspecified",
    },
  ] as any;
  assert.deepEqual(matchByKeywords("broken kneecap", library).matches, [
    "authored-patella",
  ]);
  const failing = {
    messages: {
      create: async () => {
        throw Error("synthetic provider failure");
      },
    },
  } as any;
  assert.deepEqual(
    (await matchInjuries("broken knee cap", library, failing)).matches,
    ["authored-patella"],
  );
  const fake = {
    messages: {
      create: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              matches: ["authored-patella", "skull-fracture"],
              unmatched: [],
            }),
          },
        ],
      }),
    },
  } as any;
  assert.deepEqual(
    (await matchInjuries("broken kneecap", library, fake)).matches,
    ["authored-patella"],
  );
});
