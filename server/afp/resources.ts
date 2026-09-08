import type { AfpResource } from "../../shared/afp";
const planned = (
  id: string,
  name: string,
  category: AfpResource["category"],
  description: string,
): AfpResource => ({
  id,
  name,
  category,
  status: "Planned",
  availability: "Planned AFP resource",
  description,
  isolation:
    "Separate ownership and access contract required; not provisioned.",
  reference: "server/afp/resources.ts",
  provisionable: false,
});
export function afpResources(): AfpResource[] {
  return [
    {
      id: "primary-database",
      name: "Primary application database",
      category: "Databases",
      status: "Implemented",
      availability: "Existing application",
      description:
        "SQLite stores application data in DATA_DIR/atlas.sqlite. Production deploys persistent EBS storage.",
      isolation:
        "Shared database with firm/case access checks; not a per-feature database.",
      reference:
        "server/store.ts; server/index.ts; deploy/injury-atlas.service",
      provisionable: false,
    },
    planned(
      "extension-database",
      "AFP extension database",
      "Databases",
      "Optional private or firm-owned feature database.",
    ),
    planned(
      "graph-database",
      "Graph database",
      "Databases",
      "Separate graph service for a future feature.",
    ),
    planned(
      "vector-database",
      "Vector database",
      "Databases",
      "Separate embedding/search service with scoped case access.",
    ),
    {
      id: "application-compute",
      name: "Standard application compute",
      category: "Compute",
      status: "Implemented",
      availability: "Existing application",
      description:
        "Node HTTP process and a child production worker. EC2/systemd is the production deployment target.",
      isolation:
        "The worker is a separate process on the same host, not an isolated tenant or AFP runtime.",
      reference: "server/index.ts; deploy/injury-atlas.service",
      provisionable: false,
    },
    planned(
      "dedicated-cpu",
      "Dedicated CPU compute",
      "Compute",
      "An optional separate CPU service for a feature.",
    ),
    planned(
      "gpu-compute",
      "GPU compute",
      "Compute",
      "Future private GPU rendering service; no GPU resource is discovered or provisioned here.",
    ),
    planned(
      "afp-runtime",
      "Dedicated AFP runtime",
      "Compute",
      "Isolated extension execution with scoped data and resource capabilities.",
    ),
    {
      id: "evidence-storage",
      name: "Application and evidence storage",
      category: "Storage",
      status: "Implemented",
      availability: "Existing application",
      description: process.env.S3_BUCKET
        ? "S3 environment configuration is present; evidence adapter retains private file fallback for legacy artifacts. This view does not verify bucket access or health."
        : "Private file evidence storage is the default. An optional version-pinned S3 adapter is implemented; S3 is not configured in this process.",
      isolation:
        "Case routes gate access. New S3 artifacts pin object version and byte hash.",
      reference: "server/evidence-storage.ts; server/index.ts",
      provisionable: false,
    },
    planned(
      "extension-storage",
      "AFP extension storage",
      "Storage",
      "Optional feature-owned storage without copying private base evidence.",
    ),
    planned(
      "managed-sidecar",
      "AFP-managed service / sidecar",
      "External services",
      "A future resource layer could connect services using an approved contract. Existing firm integrations are not AFP sidecar provisioning.",
    ),
  ];
}
