import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import express from "express";
import { openStore, type User } from "../server/store";
import { ensureAi } from "../server/ai/settings";
import { executeCoordinatorTool, enabledTools } from "../server/ai/coordinator";
import {
  ensureDevelopment,
  executorRoutes,
  developmentAllowed,
} from "../server/afp/development";
import { verifyExecutorToken } from "../server/afp/executor-auth";
test("development OIDC rejects wrong repository, ref, workflow, audience, expiry and signatures", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "development-test",
  };
  const fetcher = (async () => Response.json({ keys: [jwk] })) as typeof fetch;
  const now = Math.floor(Date.now() / 1000),
    claims = {
      iss: "https://token.actions.githubusercontent.com",
      aud: "injury.bot/afp-development",
      repository: "raygalvan/injury-atlas",
      ref: "refs/heads/main",
      workflow_ref:
        "raygalvan/injury-atlas/.github/workflows/afp-development.yml@refs/heads/main",
      event_name: "schedule",
      exp: now + 300,
      nbf: now - 1,
      run_id: "123",
    };
  const jwt = (extra = {}) => {
    const parts = [
      { alg: "RS256", kid: jwk.kid },
      { ...claims, ...extra },
    ]
      .map((o) => Buffer.from(JSON.stringify(o)).toString("base64url"))
      .join(".");
    return (
      parts +
      "." +
      sign("RSA-SHA256", Buffer.from(parts), privateKey).toString("base64url")
    );
  };
  assert.equal(await verifyExecutorToken(jwt(), fetcher), "123");
  for (const bad of [
    { repository: "evil/repo" },
    { ref: "refs/heads/other" },
    {
      workflow_ref:
        "raygalvan/injury-atlas/.github/workflows/ci.yml@refs/heads/main",
    },
    { aud: "other" },
    { exp: now - 1 },
    { event_name: "pull_request" },
    { run_id: "x" },
  ])
    await assert.rejects(verifyExecutorToken(jwt(bad), fetcher));
  await assert.rejects(
    verifyExecutorToken(jwt().slice(0, -20) + "bad", fetcher),
  );
});
test("shared coding is suspended, pending jobs retain cancelled history and signed runners cannot publish", async () => {
  const db = openStore(":memory:");
  ensureAi(db);
  ensureDevelopment(db);
  db.exec("CREATE TABLE platform_admins(user_id TEXT PRIMARY KEY)");
  db.prepare(
    "INSERT INTO users VALUES('owner','owner@example.test','Owner','owner','a',1)",
  ).run();
  const u = db.prepare("SELECT * FROM users WHERE id='owner'").get() as User;
  db.prepare(
    "INSERT INTO afp_development_jobs(id,actor,firm_id,request,delivery,source,state,created,updated) VALUES('old','owner','a','Old request','deploy','voice coordinator','running',1,1)",
  ).run();
  ensureDevelopment(db);
  assert.equal(
    db.prepare("SELECT state FROM afp_development_jobs WHERE id='old'").get()
      ?.state,
    "cancelled",
  );
  assert.equal(developmentAllowed(db, u), false);
  assert(
    !enabledTools(db, u).some((t) => t.name === "execute_development_task"),
  );
  await assert.rejects(
    executeCoordinatorTool(
      db,
      u,
      "execute_development_task",
      { request: "Shared change" },
      "old-session",
    ),
  );
  const app = express();
  app.use(express.json());
  executorRoutes(app, db, async (token) => {
    if (token !== "signed") throw Error("bad");
    return "123";
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    for (const op of ["claim", "authorize", "complete"]) {
      const r = await fetch(
        `http://127.0.0.1:${(server.address() as any).port}/api/afp/executor/${op}`,
        { method: "POST", headers: { Authorization: "Bearer signed" } },
      );
      assert.equal(r.status, 410);
      assert(!JSON.stringify(await r.json()).includes("openaiKey"));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
