import { z } from "zod";
export const AFP_SCHEMA = "injury.bot.afp/0.1" as const;
export const AFP_VERSION = "0.1.0" as const;
export const RENDERING_CONTRACT = "injury.bot.rendering.preflight/0.1" as const;
export const protectedBoundaries = [
  "authentication",
  "tenant-boundaries",
  "evidence-provenance",
  "audit-logging",
  "database-access",
  "filesystem-access",
  "shell-access",
] as const;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);
export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(AFP_SCHEMA),
  protocolVersion: z.literal(AFP_VERSION),
  experimental: z.literal(true),
  extensionId: id,
  definitionVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  application: z.strictObject({
    id: z.literal("injury.bot"),
    version: z.string().min(1).max(100),
  }),
  protectedBoundaries: z
    .array(z.enum(protectedBoundaries))
    .length(protectedBoundaries.length),
  extensionPoints: z.tuple([
    z.strictObject({
      id: z.literal("rendering-pipeline"),
      contract: z.literal(RENDERING_CONTRACT),
    }),
  ]),
  customizationPolicies: z
    .array(
      z.strictObject({
        id,
        level: z.enum(["Allowed", "Approval Required", "Protected"]),
        revision: z.number().int().positive(),
      }),
    )
    .max(40),
  allowedResourceClasses: z.tuple([z.literal("application-cpu")]),
  requestedResources: z.tuple([z.literal("application-cpu")]),
  requestedPermissions: z.tuple([z.literal("rendering.recipe.inspect")]),
  compatibility: z.strictObject({
    sdkVersion: z.literal(AFP_VERSION),
    contractVersion: z.literal(AFP_VERSION),
    applicationVersion: z.string().min(1).max(100),
  }),
  ownership: z.strictObject({
    scope: z.enum(["Private", "Firm", "Community", "Official"]),
    ownerId: id,
    firmId: id,
  }),
  activation: z.literal(false),
});
export type AfpManifest = z.infer<typeof manifestSchema>;
export type Evaluation = {
  result: "Compatible" | "Incompatible" | "Requires Review";
  reasons: string[];
  manifestDigest: string;
  auditId: string;
  applicationVersion: string;
  executable: false;
};
export const preflightRequestSchema = z.strictObject({
  resourceClass: z.literal("application-cpu"),
  recipe: z.strictObject({
    kind: z.enum(["abrasion", "subarachnoid", "fracture"]),
    parentId: z.string().regex(/^FJ\d+$/),
    center: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    normal: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    widthMm: z.number().finite(),
    heightMm: z.number().finite(),
    depthMm: z.number().finite(),
  }),
});
export const preflightResponseSchema = z.strictObject({
  auditId: z.string().uuid(),
  contract: z.literal(RENDERING_CONTRACT),
  schemaAccepted: z.boolean(),
  reasonCodes: z.array(z.enum(["recipe_constraints_failed"])),
  rendered: z.literal(false),
  enqueued: z.literal(false),
  basis: z.literal(
    "Production recipe schema only; geometry, anatomical placement and clinical accuracy are not verified.",
  ),
});
export type ManifestRecord = {
  id: string;
  revision: number;
  manifest: AfpManifest;
  digest: string;
  created: number;
  updated: number;
};
