export const readinessStatuses = [
  "Planned",
  "Foundation",
  "Partial",
  "Implemented",
  "Verified",
] as const;
export type ReadinessStatus = (typeof readinessStatuses)[number];
export type Verification = {
  at: number;
  by: string;
  reference: string;
  release: string | null;
};
export type ReadinessItem = {
  id: string;
  name: string;
  status: ReadinessStatus;
  ceiling: ReadinessStatus;
  description: string;
  evidence: string;
  nextStep: string;
  dependencies: string[];
  revision: number;
  lastVerified: Verification | null;
};
export type ExtensionPoint = {
  id: string;
  name: string;
  type: string;
  description: string;
  status: ReadinessStatus;
  customizationAllowed: string;
  extensionTypes: string[];
  protected: string[];
  resourceEscalation: boolean;
  resourcePolicy: string[];
  reference: string;
  dynamicAttachment: false;
  sdkContract?: string;
};
export const policyLevels = [
  "Allowed",
  "Approval Required",
  "Protected",
] as const;
export type PolicyLevel = (typeof policyLevels)[number];
export type AfpPolicy = {
  id: string;
  name: string;
  level: PolicyLevel;
  locked: boolean;
  description: string;
  reference: string;
  revision: number;
};
export type AfpResource = {
  id: string;
  name: string;
  category: "Databases" | "Compute" | "Storage" | "External services";
  status: ReadinessStatus;
  availability: "Existing application" | "Planned AFP resource";
  description: string;
  isolation: string;
  reference: string;
  provisionable: false;
};
export const featureScopes = [
  "Private",
  "Firm",
  "Community",
  "Official",
] as const;
export const featureStatuses = [
  "draft",
  "review",
  "preview",
  "active",
  "retired",
] as const;
export type AfpFeature = {
  id: string;
  name: string;
  owner: string;
  firmId: string;
  scope: (typeof featureScopes)[number];
  baseVersion: string;
  extensionPoints: string[];
  resources: string[];
  status: (typeof featureStatuses)[number];
  version: string;
  creator: string;
  compute: {
    description: string;
    estimatedMonthlyUsd: number | null;
    actualUsd: number | null;
  };
  tests: { status: "pending" | "passed" | "failed"; reference: string };
  security: { status: "pending" | "passed" | "failed"; reference: string };
  rollback: { status: "planned" | "documented"; reference: string };
  revision: number;
  created: number;
  updated: number;
};
export type AfpControlPlane = {
  schemaVersion: "injury.bot.afp-control-plane/1";
  manifestSchemaVersion: "injury.bot.afp/0.1";
  sdkBoundary: {
    version: "0.1.0";
    contract: "injury.bot.rendering.preflight/0.1";
    implemented: true;
    executable: false;
  };
  application: {
    name: "injury.bot";
    role: "Reference Implementation / Pilot";
    architecture: "Base Application + Isolated Extensions";
    architectureStatus: "Target architecture";
    baseVersion: string | null;
  };
  readiness: ReadinessItem[];
  extensionPoints: ExtensionPoint[];
  policies: AfpPolicy[];
  resources: AfpResource[];
  features: AfpFeature[];
  featureCount: number;
  overall: {
    label: string;
    criteria: { id: string; label: string; met: boolean }[];
    blockers: string[];
  };
  protectedBoundaries: { policyLocked: boolean; label: string };
  externalResources: { provisionable: false; label: string };
  runtime: {
    mcpConnected: false;
    sdkConnected: false;
    dynamicAttachment: false;
    provisioning: false;
  };
};
