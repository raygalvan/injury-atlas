import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  manifestSchema,
  AFP_SCHEMA,
  AFP_VERSION,
  RENDERING_CONTRACT,
  protectedBoundaries,
  type AfpManifest,
} from "../../shared/afp-manifest";
import type { AfpPolicy } from "../../shared/afp";
import type { User } from "../store";
export function applicationVersion() {
  try {
    const sha = JSON.parse(readFileSync("dist/release.json", "utf8")).commit;
    if (/^[a-f0-9]{40}$/.test(sha)) return sha;
  } catch {}
  return process.env.NODE_ENV === "production" ? "unavailable" : "0.1.0+development";
}
export const manifestJsonSchema = {
  ...z.toJSONSchema(manifestSchema),
  $id: "urn:injury.bot:afp:manifest:0.1",
};
export const digest = (input: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(input) ?? "undefined")
    .digest("hex");
const policySnapshot = (p: AfpPolicy[]) =>
  p
    .map(({ id, level, revision }) => ({ id, level, revision }))
    .sort((a, b) => a.id.localeCompare(b.id));
export function manifestTemplate(
  actor: User,
  policies: AfpPolicy[],
  version = applicationVersion(),
): AfpManifest {
  return {
    schemaVersion: AFP_SCHEMA,
    protocolVersion: AFP_VERSION,
    experimental: true,
    extensionId: "private-rendering-preflight",
    definitionVersion: "0.1.0",
    application: { id: "injury.bot", version },
    protectedBoundaries: [...protectedBoundaries],
    extensionPoints: [
      { id: "rendering-pipeline", contract: RENDERING_CONTRACT },
    ],
    customizationPolicies: policySnapshot(policies),
    allowedResourceClasses: ["application-cpu"],
    requestedResources: ["application-cpu"],
    requestedPermissions: ["rendering.recipe.inspect"],
    compatibility: {
      sdkVersion: AFP_VERSION,
      contractVersion: AFP_VERSION,
      applicationVersion: version,
    },
    ownership: { scope: "Private", ownerId: actor.id, firmId: actor.firm_id },
    activation: false,
  };
}
export function validateManifest(
  input: unknown,
  actor: User | null,
  policies: AfpPolicy[],
  version: string,
  operation: "manage" | "use" = "manage",
) {
  const parsed = manifestSchema.safeParse(input);
  const reasons: string[] = [];
  if (!parsed.success) {
    const codes: Record<string, string> = {
      schemaVersion: "unknown_schema_version",
      protocolVersion: "unknown_protocol_version",
      extensionPoints: "unknown_extension_contract",
      protectedBoundaries: "protected_boundaries_invalid",
      requestedPermissions: "permission_not_allowed",
      requestedResources: "unsupported_resource",
      allowedResourceClasses: "unsupported_resource",
      ownership: "invalid_ownership",
      activation: "activation_unavailable",
      compatibility: "incompatible_contract_version",
    };
    return {
      result: "Incompatible" as const,
      reasons: [
        ...new Set(
          parsed.error.issues.map(
            (i) => codes[String(i.path[0])] || "invalid_manifest_schema",
          ),
        ),
      ],
      manifest: null,
    };
  }
  const m = parsed.data;
  if(version === "unavailable") reasons.push("application_version_unavailable");
  if (!actor || !actor.active || actor.role === "client")
    reasons.push("actor_not_authorized");
  if (new Set(m.protectedBoundaries).size !== protectedBoundaries.length)
    reasons.push("protected_boundaries_incomplete");
  if (m.ownership.scope !== "Private" && m.ownership.scope !== "Firm")
    reasons.push("scope_not_implemented");
  if (
    actor &&
    (m.ownership.firmId !== actor.firm_id ||
      (m.ownership.scope === "Private" && m.ownership.ownerId !== actor.id))
  )
    reasons.push("ownership_mismatch");
  if (
    actor &&
    m.ownership.scope === "Firm" &&
    operation === "manage" &&
    (actor.role !== "owner" || m.ownership.ownerId !== actor.id)
  )
    reasons.push("firm_owner_required");
  if (
    m.application.version !== version ||
    m.compatibility.applicationVersion !== version
  )
    reasons.push("incompatible_application_version");
  const permission = policies.find((p) => p.id === "rendering-preflight");
  if (!permission || permission.level === "Protected")
    reasons.push("permission_protected");
  // A manifest cannot redefine these locks, even if other customization rules are Allowed.
  if (
    policies.filter((p) =>
      [
        "authentication",
        "tenant-boundaries",
        "evidence-provenance",
        "audit-logging",
      ].includes(p.id),
    ).length !== 4 ||
    policies.some(
      (p) =>
        [
          "authentication",
          "tenant-boundaries",
          "evidence-provenance",
          "audit-logging",
        ].includes(p.id) && p.level !== "Protected",
    )
  )
    reasons.push("protected_policy_violation");
  if (reasons.length)
    return { result: "Incompatible" as const, reasons, manifest: m };
  if (
    JSON.stringify(
      [...m.customizationPolicies].sort((a, b) => a.id.localeCompare(b.id)),
    ) !== JSON.stringify(policySnapshot(policies))
  )
    reasons.push("stale_policy_snapshot");
  if (permission?.level === "Approval Required")
    reasons.push("permission_requires_review");
  return {
    result: reasons.length
      ? ("Requires Review" as const)
      : ("Compatible" as const),
    reasons,
    manifest: m,
  };
}
