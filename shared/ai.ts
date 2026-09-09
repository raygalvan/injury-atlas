export const providers = ["openai", "anthropic", "xai"] as const;
export type Provider = (typeof providers)[number];
export const providerNames = {
  openai: "OpenAI",
  anthropic: "Claude",
  xai: "Grok",
};
export const agentRoster = [
  {
    id: "coordinator",
    name: "Coordinator",
    charge:
      "Guides new and existing client work, delegates analysis, and tracks results.",
    skills: [
      "find_cases",
      "create_case",
      "start_injury_analysis",
      "add_library_injury",
      "injury_status",
      "prepare_demand_section",
      "propose_memory",
      "read_connections",
      "read_afp_memory",
      "record_afp_note",
      "set_private_afp_ui_preference",
      "set_private_afp_presentation",
      "inspect_afp_capability",
      "read_private_afp_workflows",
      "manage_private_afp_workflow",
      "use_private_afp_workflow",
    ],
  },
  {
    id: "injury-creation",
    name: "Injury Creation Agent",
    charge:
      "Reads case evidence and plans registered anatomical illustrations.",
    skills: ["read_evidence", "plan_geometry"],
  },
  {
    id: "library-research",
    name: "Medical Library Agent",
    charge: "Researches generic medical definitions and cited references.",
    skills: ["medical_research"],
  },
  {
    id: "demand-writer",
    name: "Demand Preparation Agent",
    charge:
      "Drafts the injury section using documented case facts and source citations.",
    skills: ["draft_demand"],
  },
] as const;
export type AgentId = (typeof agentRoster)[number]["id"];
export type AgentSetting = {
  enabled: boolean;
  instructions: string;
  provider: Provider;
  model: string;
  skills: string[];
};
export type AiSettings = {
  instructions: string;
  credentialSource: "platform" | "firm";
  dailyRunLimit: number;
  researchWebEnabled: boolean;
  models: { provider: Provider; model: string; enabled: boolean }[];
  agents: Record<AgentId, AgentSetting>;
  voice: { enabled: boolean; model: string; voice: string; language: string };
};
export type AssistantCard = {
  title: string;
  body?: string;
  href?: string;
  items?: { id: string; title: string; detail?: string; href?: string }[];
};
export const skillLabels: Record<string, string> = {
  read_private_afp_workflows:"Read my private AFP workflows",
  manage_private_afp_workflow:"Create and manage my private AFP workflows",
  use_private_afp_workflow:"Use my private AFP workflows",
  read_afp_memory: "Discuss AFP progress (super admin)",
  set_private_afp_presentation:"Change my private Select Injuries color",
  inspect_afp_capability:"Inspect my AFP capability and permission",
  set_private_afp_ui_preference: "Change my private Coordinator text-tab label",
  record_afp_note: "Record AFP proposals (super admin)",
  find_cases: "Find client cases",
  create_case: "Create a client case",
  start_injury_analysis: "Start injury analysis",
  add_library_injury: "Create a library injury",
  injury_status: "Check injury progress",
  prepare_demand_section: "Prepare injury demand material",
  propose_memory: "Propose memory for review",
  read_connections: "Read connected services",
  read_evidence: "Read case evidence",
  plan_geometry: "Plan supported anatomical geometry",
  medical_research: "Research medical references",
  draft_demand: "Draft supported demand content",
};
