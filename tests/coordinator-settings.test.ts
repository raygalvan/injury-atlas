import { usagePolicy } from "../server/ai/usage";
import { createRealtimeProtocol } from "../src/assistant/realtime-protocol";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { openStore, issueLink, consumeLink, type User } from "../server/store";
import { createApp } from "../server/app";
import {
  defaults,
  saveSettings,
  saveCredential,
  credentialFor,
  credentialSummaries,
  memoryContext,
  agentConfig,
  firmScope,
} from "../server/ai/settings";
import {
  executeCoordinatorTool,
  greeting,
  coordinatorInstructions,
} from "../server/ai/coordinator";
import { sealCredential, openCredential } from "../server/ai/vault";
import { agentClient } from "../server/ai/agent-client";
import { createProviderTurn } from "../server/ai/providers";
import {
  createProduction,
  productionSchema,
  productionRecord,
} from "../server/production";
import { processProduction } from "../server/injury-worker";
import { createEvidenceStorage } from "../server/evidence-storage";

test("coordinator settings, tools and provider routing preserve access and run real background work", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "coordinator-")),
    db = openStore(path.join(dir, "db.sqlite"));
  const users: Record<string, User> = {};
  for (const [id, role, firm] of [
    ["admin", "owner", "f"],
    ["atty", "attorney", "f"],
    ["client", "client", "f"],
    ["other", "owner", "other"],
  ]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      id,
      id + "@example.test",
      id === "admin" ? "Ray Example" : id,
      role,
      firm,
    );
    users[id] = db.prepare("SELECT * FROM users WHERE id=?").get(id) as User;
  }
  const server = createApp(db, {
    dataDir: dir,
    origin: "http://localhost",
    send: async () => {
      throw new Error("No emails in tests");
    },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  db.prepare("INSERT INTO platform_admins VALUES('admin')").run();
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    sessions = Object.fromEntries(
      Object.keys(users).map((id) => [id, consumeLink(db, issueLink(db, id)!)]),
    );
  const realFetch = globalThis.fetch;
  const call = (u: string, url: string, body?: unknown) =>
    realFetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: `atlas_session=${sessions[u]}`,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.match(greeting("Ray Example"), /^Hello Ray,/);
    assert.match(
      coordinatorInstructions(db, users.admin, undefined),
      /new or existing client/,
    );
    assert.equal((await call("client", "/assistant")).status, 403);
    assert.equal((await call("atty", "/settings")).status, 403);
    assert.equal((await call("other", "/settings?scope=platform")).status, 403);
    const initial = await (
      await call("admin", "/settings?scope=platform")
    ).json();
    assert.equal(initial.settings.agents.coordinator.provider, "openai");
    saveCredential(
      db,
      "platform",
      "openai",
      "synthetic-openai-platform-key",
      users.admin,
    );
    saveCredential(
      db,
      "platform",
      "anthropic",
      "synthetic-anthropic-key",
      users.admin,
    );
    saveCredential(db, "platform", "xai", "synthetic-xai-key", users.admin);
    const credential = sealCredential("private-key", "scope-one");
    assert.equal(
      openCredential(credential.encrypted, credential.context, "scope-one"),
      "private-key",
    );
    assert.throws(() =>
      openCredential(credential.encrypted, credential.context, "scope-two"),
    );
    const masked = await (
      await call("admin", "/settings?scope=platform")
    ).text();
    assert.ok(!masked.includes("synthetic-openai"));
    assert.match(masked, /suffix/);
    const firm = defaults();
    firm.credentialSource = "firm";
    saveSettings(db, firmScope("other"), firm, users.other);
    assert.equal(credentialFor(db, "other", "openai"), "");
    assert.throws(() => agentConfig(db, "other", "coordinator"), /Add a/);
    saveCredential(
      db,
      firmScope("other"),
      "openai",
      "synthetic-other-firm-key",
      users.other,
    );
    assert.equal(
      credentialFor(db, "other", "openai"),
      "synthetic-other-firm-key",
    );
    assert.equal(
      credentialFor(db, "f", "openai"),
      "synthetic-openai-platform-key",
    );
    const newCase = await executeCoordinatorTool(
      db,
      users.admin,
      "create_case",
      { clientName: "Fictional Person" },
      "create-once",
    );
    const caseId = JSON.parse(newCase.speech).caseId;
    assert.deepEqual(
      await executeCoordinatorTool(
        db,
        users.admin,
        "create_case",
        { clientName: "Fictional Person" },
        "create-once",
      ),
      newCase,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM cases").get()!.n, 1);
    await assert.rejects(
      executeCoordinatorTool(
        db,
        users.other,
        "start_injury_analysis",
        { caseId, description: "broken kneecap" },
        "cross-firm",
      ),
      /unavailable/,
    );
    await assert.rejects(
      executeCoordinatorTool(db, users.client, "find_cases", {}, "client"),
      /not available/,
    );
    const queued = await executeCoordinatorTool(
      db,
      users.admin,
      "start_injury_analysis",
      { caseId, description: "broken kneecap" },
      "analysis",
    );
    const injury = productionRecord(db, JSON.parse(queued.speech).id)!;
    assert.equal(injury.state, "queued");
    assert.equal(injury.body.description, "broken kneecap");
    assert.equal(injury.body.agentManaged, true);
    assert.equal(injury.source_review, 0);
    const library = await executeCoordinatorTool(
      db,
      users.admin,
      "add_library_injury",
      { name: "broken kneecap" },
      "library",
    );
    assert.match(library.card!.href!, /library=/);
    assert.equal(
      db.prepare("SELECT state FROM injury_library_jobs").get()!.state,
      "queued",
    );
    await executeCoordinatorTool(
      db,
      users.admin,
      "propose_memory",
      { content: "Case-only memory", caseId },
      "memory",
    );
    assert.ok(!memoryContext(db, "f", caseId).includes("Case-only memory"));
    const mem = db.prepare("SELECT id FROM ai_memories").get()!;
    assert.equal(
      (
        await call("admin", "/settings/memory", {
          action: "approve",
          id: mem.id,
        })
      ).status,
      200,
    );
    assert.ok(memoryContext(db, "f", caseId).includes("Case-only memory"));
    assert.ok(!memoryContext(db, "f").includes("Case-only memory"));
    assert.ok(!memoryContext(db, "other", caseId).includes("Case-only memory"));
    const cfg = defaults();
    cfg.agents.coordinator.skills = cfg.agents.coordinator.skills.filter(
      (x) => x !== "create_case",
    );
    saveSettings(db, "platform", cfg, users.admin);
    await assert.rejects(
      executeCoordinatorTool(
        db,
        users.admin,
        "create_case",
        { clientName: "No" },
        "disabled",
      ),
      /not available/,
    );
    saveSettings(db, "platform", defaults(), users.admin);
    const requests: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const body = JSON.parse(init?.body || "{}");
      requests.push({ url: String(url), body, headers: init?.headers });
      if (String(url).endsWith("/realtime/client_secrets"))
        return Response.json({
          value: "synthetic-ephemeral-token",
          expires_at: 12345,
        });
      if (String(url).endsWith("/models")) return Response.json({ data: [] });
      if (String(url).endsWith("/messages"))
        return Response.json({
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"result":"ok"}' }],
        });
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: '{"result":"ok"}',
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://medlineplus.gov/",
                    title: "Medical reference",
                  },
                ],
              },
            ],
          },
        ],
      });
    }) as typeof fetch;
    const providerConfig = defaults();
    providerConfig.agents["injury-creation"] = {
      ...providerConfig.agents["injury-creation"],
      provider: "openai",
      model: providerConfig.models[0].model,
    };
    saveSettings(db, "platform", providerConfig, users.admin);
    await agentClient(
      db,
      "f",
      "admin",
      "injury-creation",
      caseId,
    ).messages.create({
      max_tokens: 3000,
      system: "Source rules",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { media_type: "application/pdf", data: "cGRm" },
            },
          ],
        },
      ],
    });
    assert.equal(
      requests.at(-1).headers.Authorization,
      "Bearer synthetic-openai-platform-key",
    );
    assert.equal(requests.at(-1).body.model, providerConfig.models[0].model);
    assert.equal(requests.at(-1).body.input[0].content[0].type, "input_file");
    assert.equal(requests.at(-1).body.store, false);
    const researchCfg = defaults();
    researchCfg.agents["library-research"] = {
      ...researchCfg.agents["library-research"],
      provider: "openai",
      model: researchCfg.models[0].model,
    };
    saveSettings(db, "platform", researchCfg, users.admin);
    const researched = await agentClient(
      db,
      "f",
      "admin",
      "library-research",
    ).messages.create({
      system: "Research only",
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          allowed_domains: ["medlineplus.gov"],
        },
      ],
      messages: [{ role: "user", content: "Patellar fracture" }],
    });
    assert.deepEqual(requests.at(-1).body.tools[0].filters.allowed_domains, [
      "medlineplus.gov",
    ]);
    assert.ok(!requests.at(-1).body.instructions.includes("Case-only memory"));
    assert.equal(
      researched.content[0].citations[0].url,
      "https://medlineplus.gov/",
    );
    await agentClient(db, "f", "admin", "injury-creation").messages.create({
      system: "Test",
      messages: [{ role: "user", content: "Test" }],
    });
    assert.equal(
      requests.at(-1).headers["x-api-key"],
      "synthetic-anthropic-key",
    );
    await createProviderTurn(
      { provider: "xai", apiKey: "synthetic-grok", model: "configured-model" },
      {
        instructions: "test",
        input: [{ role: "user", content: "test" }],
        tools: [],
      },
    );
    assert.equal(requests.at(-1).url, "https://api.x.ai/v1/responses");
    assert.equal(requests.at(-1).body.model, "configured-model");
    const voice = await call("admin", "/assistant/realtime-session", {
      caseId,
    });
    assert.equal(voice.status, 200);
    const voiceBody = await voice.json();
    assert.ok(voiceBody.sessionId);
    assert.equal(voiceBody.clientSecret, "synthetic-ephemeral-token");
    assert.match(requests.at(-1).body.session.instructions, /Hello Ray/);
    assert.equal(
      (
        await call("atty", "/assistant/tools/find_cases", {
          sessionId: voiceBody.sessionId,
          callId: "forged",
          args: {},
        })
      ).status,
      403,
    );
    // Real voice event -> authenticated endpoint -> persisted background library job.
    assert.ok(requests.at(-1).body.session.tools.some((t: any) => t.name === "add_library_injury"));
    const sent: any[] = [];
    const cards: any[] = [];
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const protocol = createRealtimeProtocol({
      onUserTranscript() {}, onAssistantTranscript() {},
      onToolCall: async (name, args, callId) => {
        const response = await call("admin", `/assistant/tools/${name}`, { sessionId: voiceBody.sessionId, args, callId });
        assert.equal(response.status, 200);
        const result = await response.json();
        cards.push(result.card);
        return result.output;
      },
    }, { send: event => { sent.push(event); if (event.type === "response.create") finish(); }, setMicOpen() {}, now: () => 0, setTimer: () => 0, clearTimer() {} });
    const voiceCall = { type: "response.done", response: { status: "completed", output: [{ type: "function_call", status: "completed", name: "add_library_injury", call_id: "voice-library", arguments: JSON.stringify({ name: "Synthetic voice kneecap injury" }) }] } };
    protocol.onServerEvent(voiceCall);
    protocol.onServerEvent(voiceCall);
    await finished;
    const receipt = JSON.parse(sent[0].item.output);
    assert.equal(cards[0].title, "Library injury queued");
    assert.equal(db.prepare("SELECT count(*) n FROM injury_library_jobs WHERE publication_id=?").get(receipt.id)!.n, 1);
    assert.equal(db.prepare("SELECT state FROM injury_library_jobs WHERE publication_id=?").get(receipt.id)!.state, "queued");
    assert.equal(cards.length, 1);
    protocol.dispose();
    const voiceAction = await call("admin", "/assistant/tools/find_cases", {
      sessionId: voiceBody.sessionId,
      callId: "voice-find",
      args: {},
    });
    assert.equal(voiceAction.status, 200);
    assert.match((await voiceAction.json()).output, /Fictional Person/);
    assert.equal(
      (
        await call("admin", "/assistant/transcripts", {
          sessionId: voiceBody.sessionId,
          role: "user",
          text: "Hello",
        })
      ).status,
      200,
    );
    const own = await (await call("admin", "/assistant")).json(),
      other = await (await call("atty", "/assistant")).json();
    assert.ok(own.messages.some((m: any) => m.content === "Hello"));
    assert.ok(!other.messages.some((m: any) => m.content === "Hello"));
    let modelRound = 0;
    globalThis.fetch = (async (_url: any, init: any) => {
      const b = JSON.parse(init.body);
      assert.match(b.instructions, /Hello Ray/);
      if (modelRound++ === 0)
        return Response.json({
          output: [
            {
              type: "function_call",
              call_id: "text-create",
              name: "create_case",
              arguments: JSON.stringify({
                clientName: "Second Fictional Client",
              }),
            },
          ],
        });
      assert.ok(b.input.some((i: any) => i.type === "function_call_output"));
      return Response.json({
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "Your client file is ready." },
            ],
          },
        ],
      });
    }) as typeof fetch;
    const chat = await call("admin", "/assistant/messages", {
      text: "Create a client file for Second Fictional Client",
    });
    assert.equal(chat.status, 200);
    assert.equal(
      (await chat.json()).tools[0].card.title,
      "Client file created: Second Fictional Client",
    );
    const complete = createProduction(
      db,
      users.admin,
      caseId,
      productionSchema.parse({
        name: "Documented injury",
        description: "Source-linked injury",
        medicalDescription: "Documented fracture.",
        citation: "page 1",
      }),
    );
    db.prepare("UPDATE injury_production SET state='complete' WHERE id=?").run(
      complete.id,
    );
    const demand = await executeCoordinatorTool(
      db,
      users.admin,
      "prepare_demand_section",
      { caseId },
      "demand",
    );
    const demandId = JSON.parse(demand.speech).id;
    await processProduction(
      db,
      createEvidenceStorage(dir),
      demandId,
      undefined,
      {
        messages: {
          create: async () => ({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  medicalDescription: "Source-bound injury summary.",
                  demandNarrative:
                    "Attorney-review draft citing the supplied records.",
                }),
              },
            ],
          }),
        },
      } as any,
    );
    assert.equal(
      productionRecord(db, demandId)!.state,
      "complete",
      productionRecord(db, demandId)!.error,
    );
    assert.ok(
      productionRecord(db, demandId)!.assets.some((a) => a.kind === "demand"),
    );
    assert.equal(productionRecord(db, demandId)!.source_review, 0);
    assert.equal((await call("atty", "/settings/config?scope=platform", {section:"usage",value:usagePolicy(db)})).status,403);
    assert.equal((await call("other", "/settings/config", {section:"usage",value:usagePolicy(db)})).status,403);
    assert.equal((await call("admin", "/settings/config?scope=platform", {section:"usage",value:{...usagePolicy(db),testingEnabled:false}})).status,200);
    const quota = defaults();
    quota.dailyRunLimit = 1;
    saveSettings(db, "platform", quota, users.admin);
    await assert.rejects(
      agentClient(db, "f", "admin", "coordinator").messages.create({
        system: "test",
        messages: [],
      }),
      /daily AI/,
    );
  } finally {
    globalThis.fetch = realFetch;
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deployment ships runtime shared model contracts", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /tar -czf release.tgz.*server shared/);
});
