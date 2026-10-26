export const permissionLevels = [
  "Allow Automatically",
  "Require Approval",
  "Blocked",
] as const;
export type PermissionLevel = (typeof permissionLevels)[number];
export const presets = ["Safe", "Standard", "Lab"] as const;
export type PermissionPreset = (typeof presets)[number];
const low = (
  id: string,
  name: string,
  implemented = false,
  standard = false,
) => ({
  id,
  name,
  risk: "private" as const,
  implemented,
  standard,
  locked: false,
});
const external = (id: string, name: string) => ({
  id,
  name,
  risk: "resource" as const,
  implemented: false,
  standard: false,
  locked: false,
});
const protectedCategory = (id: string, name: string) => ({
  id,
  name,
  risk: "protected" as const,
  implemented: false,
  standard: false,
  locked: true,
});
export const labCategories = [
  low("ui-editing", "All private UI presentation edits", true, true),
  low("labels", "UI text and labels", true, true),
  low("styling", "UI colors and styling", true, true),
  low("typography", "Typography", true, true),
  low("spacing", "Spacing and sizing", true, true),
  low("visibility", "Show/hide UI elements", true, true),
  low("layout", "Ordering and layout", true, true),
  low("panels", "Private workspace panels", true, true),
  low("widgets", "Private dashboard/workspace widgets"),
  low("presentation", "Presentation preferences", true, true),
  low("workflow", "Private staged checklist and notes workflows", true, true),
  low("declarative", "Declarative AFP features", true, true),
  low("preview", "Declarative workflow previews", true, true),
  low("rendering-preflight", "Rendering-preflight requests", true, true),
  external("external-services", "External services"),
  external("external-storage", "External storage"),
  external("databases", "Separate databases"),
  external("gpu", "GPU compute"),
  external("runtime", "Dedicated runtime"),
  protectedCategory("code", "Executable/generated code"),
  protectedCategory("activation", "Production activation"),
  protectedCategory("authentication", "Authentication"),
  protectedCategory("tenancy", "Tenant/firm boundaries"),
  protectedCategory("credentials", "Credentials/secrets"),
  protectedCategory("audit", "Audit controls"),
  protectedCategory("provenance", "Evidence provenance"),
  protectedCategory("destructive", "Destructive database operations"),
  protectedCategory("sql", "Unrestricted SQL"),
  protectedCategory("filesystem", "Unrestricted filesystem access"),
  protectedCategory("shell", "Shell/command execution"),
  protectedCategory(
    "escalation",
    "Permission self-escalation / other users’ settings",
  ),
  protectedCategory("evidence", "Unrestricted case evidence access"),
  protectedCategory(
    "geometry",
    "Arbitrary Atlas geometry / unreviewed rendering",
  ),
];
export function presetLevel(
  preset: PermissionPreset,
  id: string,
): PermissionLevel {
  const c = labCategories.find((c) => c.id === id);
  if (!c || c.locked) return "Blocked";
  if (c.risk === "resource") return "Require Approval";
  return preset === "Lab" || (preset === "Standard" && c.standard)
    ? "Allow Automatically"
    : "Require Approval";
}
export const colorTokens = [
  "default",
  "blue",
  "green",
  "red",
  "amber",
  "gray",
] as const;
export type ColorToken = (typeof colorTokens)[number];
