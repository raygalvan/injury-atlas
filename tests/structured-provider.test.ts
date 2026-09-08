import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store";
import { ensureProduction } from "../server/production";
import { ensureInjuryTables } from "../server/injuries";
import { agentClient } from "../server/ai/agent-client";
import { defaults, saveSettings } from "../server/ai/settings";
import { responseSchema } from "../server/ai/structured-response";
import { injuryAgentOutput } from "../server/injury-agent";
test("provider adapters send native constrained output formats, without leaking internal parameters", async () => {
  const db = openStore(":memory:");
  ensureInjuryTables(db);
  ensureProduction(db);
  const schema = responseSchema(injuryAgentOutput),
    originalFetch = globalThis.fetch;
  const saved = Object.fromEntries(
    ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"].map((k) => [
      k,
      process.env[k],
    ]),
  );
  for (const k of Object.keys(saved))
    process.env[k] = "synthetic-key-for-payload-tests";
  const seen: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json(
      String(url).endsWith("/messages")
        ? { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }
        : {
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "{}" }],
              },
            ],
            status: "completed",
          },
    );
  }) as any;
  try {
    for (const provider of ["anthropic", "openai", "xai"] as const) {
      const cfg = defaults();
      cfg.agents["injury-creation"].provider = provider;
      cfg.agents["injury-creation"].model = cfg.models.find(
        (m) => m.provider === provider,
      )!.model;
      saveSettings(db, "platform", cfg, { id: "test" } as any);
      await agentClient(db, "firm", "user", "injury-creation").messages.create({
        responseSchema: schema,
        model: "ignored-model",
        system: "Test only",
        messages: [{ role: "user", content: "broken kneecap" }],
        max_tokens: 8000,
      });
      const request = seen.at(-1).body;
      assert.equal(request.responseSchema, undefined);
      assert.equal(request.model, cfg.agents["injury-creation"].model);
      if (provider === "anthropic") {
        assert.deepEqual(request.output_config.format.schema, schema);
        assert.equal(request.output_config.format.type, "json_schema");
      } else {
        assert.deepEqual(request.text.format.schema, schema);
        assert.equal(request.text.format.strict, true);
        assert.equal(request.output_config, undefined);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    db.close();
  }
});
