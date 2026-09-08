import type { ExtensionPoint } from "../../shared/afp";
const point = (
  id: string,
  name: string,
  type: string,
  description: string,
  extensionTypes: string[],
  protectedData: string[],
  reference: string,
  resourcePolicy: string[] = [],
): ExtensionPoint => ({
  id,
  name,
  type,
  description,
  extensionTypes,
  protected: protectedData,
  reference,
  status: "Foundation",
  dynamicAttachment: false,
  customizationAllowed:
    "Candidate boundary. Changes require reviewed application code today; declarative registration does not enable attachment.",
  resourceEscalation: resourcePolicy.length > 0,
  resourcePolicy,
});
export const extensionPoints: ExtensionPoint[] = [
  point(
    "injury-workspace",
    "Injury Workspace",
    "UI workspace",
    "Case injury requests, production progress and independent review controls.",
    ["UI panel", "workflow action"],
    ["case access", "source, placement and render approvals"],
    "src/InjuryWorkspace.tsx; server/production-routes.ts",
  ),
  point(
    "rendering-pipeline",
    "Rendering Pipeline",
    "Background worker",
    "processProduction validates recipes and calls the pinned engine generator. A future renderer service could return versioned artifacts through this boundary.",
    ["renderer adapter", "background job"],
    [
      "anatomical registration",
      "measurement basis",
      "case isolation",
      "immutable artifacts",
    ],
    "server/injury-worker.ts: processProduction; server/production.ts: recipeSchema; scripts/build-atlas.mjs",
    ["gpu-compute", "dedicated-runtime"],
  ),
  point(
    "evidence-library",
    "Evidence Library",
    "Storage adapter",
    "EvidenceStorage put/get supports private file and S3 backends; routes enforce case access.",
    ["storage adapter", "evidence viewer"],
    ["byte hashes", "object versions", "uploader identity", "case permissions"],
    "server/evidence-storage.ts: EvidenceStorage; server/app.ts: evidence routes",
    ["external-storage"],
  ),
  point(
    "evidence-generation",
    "Evidence Generation",
    "Artifact pipeline",
    "saveArtifact and injuryDocuments produce and retain evidence-linked documents and illustrations.",
    ["document template", "artifact generator"],
    ["source citations", "artifact immutability", "attorney review"],
    "server/injury-worker.ts: saveArtifact; server/injury-documents.ts: injuryDocuments",
    ["dedicated-runtime"],
  ),
  point(
    "demand-generation",
    "Demand Injury Section",
    "Agent workflow",
    "The demand workflow assembles documented case injuries into an attorney-review draft.",
    ["drafting agent", "document template"],
    ["documented facts", "source citations", "unresolved reviews"],
    "server/injury-worker.ts: workflow demand; server/ai/coordinator.ts: prepare_demand_section",
    ["external-services"],
  ),
  point(
    "client-uploads",
    "Client Uploads",
    "Intake boundary",
    "Assigned clients upload evidence through authenticated case routes.",
    ["upload UI", "intake validator"],
    [
      "assigned-case grants",
      "uploader access",
      "file limits",
      "private attorney material",
    ],
    "server/app.ts: /api/cases/:caseId/evidence; src/main.tsx",
    ["external-storage"],
  ),
  point(
    "coordinator-tools",
    "Coordinator Tools",
    "Tool interface",
    "Registered tool schemas and executeCoordinatorTool provide shared text/voice actions and receipts.",
    ["registered server tool"],
    ["tool allowlist", "session identity", "case access", "idempotency"],
    "server/ai/coordinator.ts; src/assistant/realtime-protocol.ts",
    ["external-services"],
  ),
  point(
    "injury-library",
    "Injury Library",
    "Catalogue workflow",
    "Private generic definitions, research jobs and publication review remain distinct from client findings.",
    ["research adapter", "catalogue metadata"],
    ["firm ownership", "publication approval", "generic versus client facts"],
    "server/library-agent.ts; server/production-routes.ts; server/injuries.ts",
    ["additional-databases"],
  ),
  point(
    "atlas-viewer",
    "3D Atlas",
    "Versioned engine bridge",
    "A separately maintained pinned viewer exchanges validated case/application messages with the host.",
    ["viewer panel", "engine adapter"],
    [
      "origin validation",
      "mesh identifiers",
      "approved applications",
      "engine pin",
    ],
    "src/Atlas.tsx; atlas.lock.json; server/anatomy-compatibility.ts",
    ["gpu-compute"],
  ),
  point(
    "case-workspace",
    "Case Workspace",
    "Domain boundary",
    "Cases, grants and evidence are organized by firm and case identity.",
    ["case panel", "case workflow"],
    ["tenant ownership", "client grants", "case deletion rules"],
    "server/store.ts; server/app.ts: case routes; src/main.tsx",
    ["additional-databases"],
  ),
  point(
    "agent-registry",
    "Agent Registry",
    "Configuration interface",
    "Installed agent roster, model choices, instructions and skills have firm/platform settings.",
    ["agent configuration", "reviewed agent implementation"],
    [
      "installed skills",
      "encrypted credentials",
      "firm scope",
      "provider policy",
    ],
    "shared/ai.ts: agentRoster; server/ai/settings.ts",
    ["external-services", "dedicated-runtime"],
  ),
];

const rendering = extensionPoints.find((p) => p.id === "rendering-pipeline")!;
rendering.sdkContract = "injury.bot.rendering.preflight/0.1";
rendering.status = "Implemented";
rendering.customizationAllowed =
  "Implemented read-only recipe inspection contract. No rendering, job creation, evidence access or dynamic code attachment.";
rendering.reference += "; server/afp/sdk.ts; server/rendering/recipe.ts";

extensionPoints.push({
  ...point(
    "assistant-presentation",
    "Coordinator Presentation",
    "Declarative preference",
    "Private text-tab label, read through the authenticated SDK.",
    ["private plain-text label"],
    ["authentication", "firm and user ownership", "audit", "shared UI"],
    "server/afp/presentation.ts; src/assistant/assistant-console.tsx",
  ),
  sdkContract: "injury.bot.assistant.presentation/0.1",
  status: "Implemented",
  customizationAllowed:
    "Only a private text-tab label, 1–24 ASCII letters/spaces. No code, styling, markup or resource escalation.",
});

extensionPoints.push({id:"atlas-presentation",name:"Atlas Presentation",type:"Declarative preference",description:"Private Select Injuries color using six reviewed tokens.",extensionTypes:["private color token"],protected:["geometry","case access","provenance","shared UI"],reference:"server/afp/presentation.ts; src/Atlas.tsx; human-atlas app/injurybot-bridge.ts",status:"Implemented",dynamicAttachment:false,customizationAllowed:"Private color token only; no arbitrary CSS.",resourceEscalation:false,resourcePolicy:[],sdkContract:"injury.bot.atlas.presentation/0.1"});
