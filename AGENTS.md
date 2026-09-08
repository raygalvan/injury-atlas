# Injury Atlas

Tool-first, attorney-facing injury evidence and reconstruction workspace. Human Atlas is the primary tool. Law.bot is a workflow reference, not a dependency.

- AWS only for production infrastructure. Preserve EC2/systemd deployment and persistent EBS data.
- Pin the separate Human Atlas engine in atlas.lock.json. Do not replace it with generated anatomy or copy synthetic test findings into real cases.
- Source evidence, anatomical placement, visual rendering and attorney/expert approval are separate decisions.
- Keep clients restricted to assigned cases and their own submissions. Enforce permissions on every API and asset route.
- Never commit source medical files, real case evidence, tokens, passwords, AWS keys or private sessions.
- Do not send invitations or other emails in tests or while developing.
- Use new branches from current main. Prepare unmerged PRs unless the user authorizes merging.
- Test with npm test, npm run build, npm run build:atlas. Deployment tests must verify actual runtime state; a frontend build alone is not a deployment test.

## AFP continuity

- Consider AFP compatibility while extending injury.bot: explicit component boundaries, scoped configuration, isolated user data, traceable versions, reproducible previews and reversible updates. Keep the injury workflow the primary product.
- Read `server/afp/memory.json` before architecture changes. Update its release checkpoints and gaps when a change materially advances AFP. Cite actual files, commits or validation; distinguish foundations from implemented AFP runtime capabilities.
- AFP Management separates committed project knowledge from structured definitions (`shared/afp.ts`, `server/afp/{readiness,extension-points,policy,resources,features}.ts`) and mutable runtime registries. Maintain truthful implementation ceilings and locked policies.
- AFP Management adds editable direction, journal records, review metadata and registry revisions in persistent SQLite. Do not overwrite these runtime records with release defaults. Notes made by the coordinator are proposals, not proof of implementation.
- AFP knowledge is super-admin product context. Never put case evidence, personal medical details, private firm data or credentials in the shared AFP memory.
- No AFP coding, fork provisioning or upstream reconciliation runtime exists yet. Do not represent the memory/settings interface as delivering those capabilities.

- AFP v0.1 is an internal manifest validator and read-only rendering recipe preflight (`server/afp/sdk.ts`). Preserve exact compatibility, fresh policy/ownership checks and audit. Do not expose DB/shell/filesystem access or infer arbitrary code execution from SDK availability.
