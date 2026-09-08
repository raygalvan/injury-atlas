import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store";
import {
  createProduction,
  ensureProduction,
  productionSchema,
} from "../server/production";
import { runInjuryAgent, geometryPlan } from "../server/injury-agent";
import { ensureInjuryTables } from "../server/injuries";
const atlas = {
  parts: [
    {
      id: "FJ3275",
      name: "Left patella",
      system: "skeletal",
      bounds: [
        [0.01, 0.45, 0.01],
        [0.05, 0.5, 0.03],
      ],
    },
  ],
};
const result = {
  name: "Patellar fracture",
  medicalDescription:
    "Attorney describes a broken kneecap. No source records were supplied.",
  generalDefinition: "A fracture of the patella.",
  clientImpact: null,
  impactCitation: null,
  evidenceId: null,
  citation: null,
  demandNarrative:
    "The described injury requires review against the medical records.",
  uncertainties: ["Side and fracture pattern are unspecified."],
  placement: {
    method: "fracture",
    structureId: "FJ3275",
    anchorId: null,
    laterality: "unknown",
    orientation: "transverse",
    surface: "anterior",
    widthMm: null,
    heightMm: null,
    depthMm: null,
    measurementCitation: null,
  },
};
test("null client facts from the live AI response produce a registered plan without physician fields", async () => {
  const db = openStore(":memory:");
  ensureInjuryTables(db);
  ensureProduction(db);
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
    "u",
    "u@example.test",
    "Tester",
    "owner",
    "f",
  );
  db.prepare(
    "INSERT INTO cases(id,firm_id,title,client,incident,created) VALUES(?,?,?,?,?,?)",
  ).run("c", "f", "Synthetic", "Fictional", "", "0");
  const r = createProduction(
    db,
    { id: "u", firm_id: "f" } as any,
    "c",
    productionSchema.parse({
      name: "broken knee cap",
      description: "broken knee cap",
      agentManaged: true,
      useAI: true,
    }),
  );
  let calls = 0;
  const client = {
    messages: {
      create: async (request: any) => {
        calls++;
        if (calls === 1) {
          assert(JSON.stringify(request.messages).includes("broken knee cap"));
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        assert(!JSON.stringify(request).includes("Fictional"));
        return { content: [] };
      },
    },
  };
  const plan = await runInjuryAgent(db, {} as any, r, () => {}, client, atlas);
  assert.equal(plan.body.recipe!.parentId, "FJ3275");
  assert.equal(plan.body.recipe!.kind, "fracture");
  for (const key of [
    "clientImpact",
    "impactCitation",
    "evidenceId",
    "citation",
  ] as const)
    assert.equal(plan.body[key], "");
  assert(plan.body.agentNotes!.includes("Side is unspecified"));
  assert(plan.body.measurementBasis.includes("illustrative"));
  assert.deepEqual(plan.body.recipe!.normal, [0, 1, 0]);
  assert.equal(calls, 2);
  db.close();
});
test("agent anatomy validation rejects wrong side and non-bone fracture plans", () => {
  assert.throws(
    () =>
      geometryPlan({ ...result.placement, laterality: "right" } as any, atlas),
    /conflicts/,
  );
  assert.throws(
    () =>
      geometryPlan(result.placement as any, {
        parts: [{ ...atlas.parts[0], system: "nervous" }],
      }),
    /bone/,
  );
  assert.equal(
    geometryPlan({ ...result.placement, method: "unavailable" } as any, atlas)
      .recipe,
    null,
  );
});

test("null geometric choices are illustrative defaults, while invalid AI fields are repaired automatically", async () => {
  const { structuredResponse, responseSchema, ResponseContractError } =
    await import("../server/ai/structured-response");
  const { injuryAgentOutput } = await import("../server/injury-agent");
  const schema = responseSchema(injuryAgentOutput);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, Object.keys(schema.properties));
  assert.equal(schema.properties.placement.additionalProperties, false);
  assert.ok(JSON.stringify(schema).includes("surface-abrasion"));
  assert.ok(!JSON.stringify(schema).includes('"maximum":'));
  const nullable = {
    ...result,
    placement: { ...result.placement, orientation: null, surface: null },
  };
  const parsed = injuryAgentOutput.parse(nullable);
  assert.equal(parsed.placement.orientation, "transverse");
  assert.equal(parsed.placement.surface, "anterior");
  let calls = 0;
  const diagnostics: any[] = [];
  const client = {
    messages: {
      create: async (request: any) => {
        calls++;
        assert.deepEqual(request.responseSchema, schema);
        if (calls === 1)
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ...nullable,
                  generalDefinition: null,
                  placement: { ...nullable.placement, method: "bone fracture" },
                }),
              },
            ],
            meta: { provider: "anthropic", model: "test-model" },
          };
        assert.match(request.messages.at(-1).content, /generalDefinition/);
        assert.match(request.messages.at(-1).content, /placement.method/);
        return { content: [{ type: "text", text: JSON.stringify(nullable) }] };
      },
    },
  };
  const fixed = await structuredResponse(
    client,
    {
      system: "Keep source facts separate.",
      messages: [{ role: "user", content: "broken kneecap" }],
    },
    injuryAgentOutput,
    (d) => diagnostics.push(d),
  );
  assert.equal(fixed.placement.method, "fracture");
  assert.equal(calls, 2);
  assert.equal(diagnostics[0].issues[0].path, "generalDefinition");
  assert.ok(!JSON.stringify(diagnostics).includes("broken kneecap"));
  let failedCalls = 0;
  await assert.rejects(
    structuredResponse(
      {
        messages: {
          create: async () => {
            failedCalls++;
            return {
              content: [{ type: "text", text: '{"generalDefinition":null}' }],
            };
          },
        },
      },
      { system: "Test", messages: [] },
      injuryAgentOutput,
    ),
    ResponseContractError,
  );
  assert.equal(failedCalls, 3);
});
