# Private AFP workflows

This release corrects the shared coding detour. Personal AFP requests no longer queue repository edits or deployments. The old workflow is suspended, its timer/deployment trigger removed, and startup cancels pending/running jobs while preserving history. Even a previously started signed runner is denied at its publication authorization endpoint after this release is deployed. Old voice sessions cannot invoke the removed coding tool. GitHub Actions remains the normal base-application deployment mechanism, not the personal feature runtime.

## Implemented contract

Experimental `injury.bot.afp/0.1` accepts a fourth SDK contract, `injury.bot.private-workflow/0.1`, at `private-workspace`. Permission `workflow.private.use` is enforced through current global policy and the user's private Lab workflow category. Declared resources are application CPU and SDK-scoped private workflow state in existing storage, not unrestricted database access. No resource provisioning or spending authority is added.

The Coordinator composes staged checklists from a generic request using `manage_private_afp_workflow`. Each stage has named items with required/optional completion. `read_private_afp_workflows` returns the requesting user's definitions and saved runs. `use_private_afp_workflow` starts runs and saves requested progress/notes. Both text and voice share these SDK methods. Identity/source come from the authenticated host, never model arguments.

Example: “Create and activate a private injury review workflow with stages for gathering records, checking gaps and preparing review. Give each stage a checklist and notes.” No technical form is required. For explicit create-and-use requests the Coordinator may draft and activate immediately using returned version/revision. Preview-only requests remain inactive.

`My AFP Workspace` at `/afp` is available to staff and appears within AFP Management → AFP Features. It renders the actual package in preview, supports active runs, and exposes immutable versions, manifest, ownership, compatibility and audit. A preview's checkbox/notes state is discarded. Activation affects only the authenticated account. Existing runs remain pinned to their starting version when the definition changes. Rollback selects a prior compatible version for subsequent runs. Disable/remove stops use, retains versions/runs/audit, and leaves the shared base unchanged.

Definitions contain only validated text and reviewed checklist structures. This is an actual **declarative interpreter**, not arbitrary JavaScript, generated HTML, a shell or a coding-agent runtime. No core controls are replaced. Checklist completion does not approve evidence, medical conclusions, rendering or exhibits. Feature notes are private application data and are excluded from the AFP product journal/context and lifecycle audit.

Manifest `activation:false` continues to mean arbitrary executable activation is unavailable. Private declarative activation is explicitly performed by the workflow SDK, not by evaluating a manifest. Build identity is retained as provenance; compatibility follows the supported 0.1 contract, schema, current policy and ownership. Incompatible/tampered packages cannot activate or execute. No automatic migration/reconciliation is claimed.

## Storage and migration

Additive SQLite tables `afp_workflow_features`, `afp_workflow_versions`, `afp_workflow_runs` and `afp_workflow_audit` live in existing durable application storage. No paid infrastructure, credentials or new server configuration is needed. Feature changes use optimistic revisions and atomic transactions. Text/voice skill migration preserves model settings and disabled agent state while replacing shared coding skills. Journal records and their review history are untouched. Committed memory holds architecture/checkpoints only; no user workflow definitions are written to git.

Product development context exposes only workflow counts by lifecycle state. It never exports private workflow names, notes, definitions, manifests or run contents. Live proposal access was unavailable during implementation; no runtime proposal was silently approved.

## Validation and remaining work

`tests/afp-workflows.test.ts` exercises SDK/manifest ownership, persisted versions, preview/nonactivation, authenticated voice protocol, text tools, run progress, rollback, policy revocation, unknown fields, markup, malformed resources/permissions, integrity, cross-firm access and product-context exclusions. Browser proof in `scripts/check-coordinator-browser.mjs` covers voice-created definition, actual preview, saved progress, disable, second-user isolation and mobile/desktop overflow.

Future milestones include sandboxed executable feature packages, explicit case-resource capabilities, isolated preview services, separate infrastructure and update reconciliation. These remain absent. Broader private layout customization also needs a registered layout boundary; the workflow contract is not a universal editor. Unsupported requests must be described accurately, not diverted into shared deployment.
