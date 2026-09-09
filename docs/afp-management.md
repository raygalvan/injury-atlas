> Current compatibility refinement: simple presentation preferences now use contract/schema, current permissions and ownership rather than Git revision. Rendering preflight remains exact-build. See [AFP Lab Mode](afp-lab-mode.md) for current policy and tooling.

# AFP Management

Current lifecycle milestone: see `docs/afp-private-workflows.md`. The shared coding executor is suspended. Private declarative workflow packages now provide preview, activation, saved runs, disable/remove and rollback through the trusted SDK, without changing shared source. General executable runtimes and external provisioning remain future work.

AFP Management is a super-admin workspace under Settings. It tracks injury.bot's progress toward personal application customization and gives the existing text and voice coordinator product context for recommendations. It does not implement a coding agent, MCP server, isolated fork runtime, provisioning or update reconciliation.

## Memory and continuity

The versioned development memory is server/afp/memory.json, packaged with each release. It contains the vision, principles, implementation-backed foundations and known gaps. Architecture changes should maintain that file and follow the AFP continuity guidance in AGENTS.md.

Editable direction, priorities, progress notes and revision history live in the existing persistent SQLite database on EBS. Release startup initializes missing state without replacing saved direction or notes. The release file and runtime records are combined when the coordinator reads memory and when the super admin downloads injury-bot-afp-memory.md. Updating direction or reviewing a note uses an expected revision to prevent an older page from silently overwriting newer work.

Release foundations are developer-maintained. New conversation records are saved only when requested, remain proposed and are attributed to the coordinator. They do not automatically prove that a feature shipped. The super admin can review a record, mark it planned/in progress/deferred, or verify it with an implementation reference. Every edit retains history. There is no background repository crawler or compatibility certification.

## Discussion

“Discuss AFP with the coordinator” opens the existing console in AFP context, including an AFP greeting for voice and a suggested text question. The ordinary center button and injury greeting are preserved. Super admins can also discuss AFP from an ordinary coordinator session.

The coordinator receives current direction and priorities in its text-turn or voice-session instructions. The read_afp_memory tool retrieves current foundations, gaps and notes, with pagination for older entries. This refreshes information during an already-open voice session. The agent is instructed to reason about user experience, isolation, maintenance, costs, tradeoffs and concrete next steps instead of reciting notes. The record_afp_note tool saves a requested idea, decision, progress report or recommendation and returns a visible receipt. The same server implementation serves text and Realtime function calls.

Example prompts:

- What is the smallest change that would make personal injury workflows easier to customize?
- Compare a private feature preview with modifying the shared app. What would users notice?
- Remember this AFP idea: show the estimated compute cost before activating an extension.
- Read our latest AFP priorities and recommend the next step. What is already implemented and what remains a proposal?

The existing model selection controls continue to apply. No new provider credentials or EC2 configuration are required. The one-time additive settings migration registers the two AFP tools for existing coordinators without changing enabled state, model choices, or other skills. Subsequent skill toggles remain respected.

## Boundaries and checks

All AFP settings, downloads, revision endpoints and coordinator tools require an active platform administrator. Ordinary firm administrators, attorneys and clients receive no AFP memory in their prompts and cannot call its tools. Voice calls also require the existing authenticated, unexpired user-bound voice session. The memory is platform product context; do not put case facts, evidence, credentials or private firm information in it.

Tests cover access denial, stale-revision conflicts, proposed versus verified state, edit history, persistent startup behavior, idempotent coordinator notes, current memory in Realtime requests and tool responses, revoked access and settings migration. Browser proof exercises a synthetic voice function call through the real authenticated endpoint into persistent memory, settings edits, the AFP discussion link and mobile/desktop layout. No live provider speech or email is used in testing.

## Control plane and persistence (version 2)

The seven subviews are Overview, AFP Readiness, Extension Points, Permissions, Resources, AFP Features, and Memory & Decisions. Existing direction, foundations, principles, gaps, journal and history remain in Memory & Decisions. Tabs support keyboard navigation and narrow mobile screens.

Persistence/governance follows the design separation in law.bot PR #31, using injury.bot's existing SQLite/EBS deployment and platform super-admin authorization rather than copying law.bot's PostgreSQL/firm-owner scope.

| Layer | Source and persistence | Governance |
| --- | --- | --- |
| Project knowledge | Committed `server/afp/memory.json`: vision, principles, architecture decisions, protocol assumptions, foundations, gaps | Release/code review; never overwritten by a conversation or settings edit |
| Development journal | Persistent `afp_entries`, `afp_direction`, `afp_history` in `DATA_DIR/atlas.sqlite` | Super-admin review, optimistic revisions, source/actor/timestamps, implementation references and audit; coordinator entries always proposed |
| Registry definitions | `shared/afp.ts`, `server/afp/readiness.ts`, `extension-points.ts`, `policy.ts`, `resources.ts`, `features.ts` | Versioned definitions and implementation ceilings; no executable extension loader |
| Mutable registry state | Persistent `afp_readiness`, `afp_policies`, `afp_features`; edits use existing history/audit tables | Super-admin API; expected revision, protected policy locks, validated feature references |
| Manifest draft | Authenticated `/api/settings/afp/manifest` export from structured definitions/current policies | Local schema `injury.bot.afp-draft/1`, `productionExecutable: false`; not an official protocol implementation |

Journal types now include idea, proposal, decision, experiment, implementation result, progress and recommendation. Statuses remain proposed, planned, in progress, verified and deferred. Verified requires a reference; it is a human review assertion, not automatic test certification. New non-proposed human reviews record reviewer/time. Legacy records keep their source/status/history with unknown reviewer fields left null. Coordinator duplicate content is deduplicated per actor in addition to existing tool-call receipts. The full memory download includes committed knowledge, persistent direction, complete journal records, revision history and a registry snapshot.

There are 19 readiness capabilities, 11 real candidate extension boundaries, 13 policy categories and 11 resource definitions. Overall isolated-pilot readiness requires **all** explicit gates to be Verified: manifest, protected core, extension registry, user isolation, preview, automated testing, security validation, rollback, SDK and MCP. No percentage is calculated. A release ceiling prevents an admin from marking an unsupported capability Implemented/Verified. Dependencies are planning relationships. Verification records retain actor, time, evidence and release SHA where available.

Authentication, tenant boundaries, evidence provenance and disabling audit controls cannot be relaxed by the policy API. Other policies describe prospective customization rules; Allowed does not grant credentials or execute code. Resource definitions distinguish existing application SQLite, Node worker and local/optional S3 storage from future extension databases, graph/vector databases, dedicated CPU/GPU/runtime, extension storage and managed sidecars. S3 environment presence is configuration evidence, not a live infrastructure health check.

Feature records support identity, owner/firm/scope, base version, extension points/resources, version/status, creator, manual compute estimates/costs, test/security references and rollback metadata. The initial UI is an empty registry; the authenticated API can retain draft/review/retired definitions. Preview/activation is explicitly rejected until a runtime exists. Scope is metadata, not installed per-user isolation or sharing. Cost fields are recorded estimates, not automatic infrastructure billing.

Text and voice read the same current structured registry and journal. The coordinator can recommend a private renderer through `rendering-pipeline`, discuss GPU/runtime policies and preservation of tenant/evidence boundaries, but must explain that isolated execution and GPU provisioning remain unimplemented. No new tools can modify readiness, approve proposals, launch services or bypass review.

### Migration and rollout

Startup performs an additive, repeatable SQLite migration: create the three registry tables; create the companion `afp_entry_governance` table for reviewer/time/deduplication metadata plus its partial unique index. Existing journal rows, history, direction, agent/model choices and data remain intact. No manual content migration, paid resource, secret or separate service is needed. Normal database backups should include these tables. The original journal table layout stays unchanged so prior releases can still write notes during a code rollback. New governance metadata is in a companion table; legacy records and notes created by old code have no invented reviewer details. The release rollback script does not reverse database state.

The v0.1 manifest/SDK and private declarative presentation proof are implemented below. Next add a disposable isolated preview runtime and authenticated artifact boundary before any GPU provisioning or feature activation. MCP, coding agent, resource provisioning, marketplace/sharing and update reconciliation remain future engineering.

## Experimental SDK and manifest v0.1

`injury.bot.afp/0.1` is the internal manifest schema, with protocol/SDK version `0.1.0` and JSON Schema ID `urn:injury.bot:afp:manifest:0.1`. It is experimental and injury.bot-specific. The earlier draft export has been promoted to a valid, actor-scoped manifest template. `/api/afp/contract` publishes the manifest JSON Schema plus the exact request/response schemas. Existing draft registry metadata and development records remain intact; old `injury.bot.afp-draft/1` manifests are not silently upgraded or accepted.

The trusted host constructs `createAfpSdk(db, authenticatedActorId)` in `server/afp/sdk.ts`. Its returned interface exposes only `describe`, `evaluateManifest`, `saveManifest`, `listManifests`, `auditHistory` and `inspectRenderingRecipe`. The database remains inside the trusted host closure; consumers receive data only. The HTTP adapter derives identity from the authenticated session, never from manifest claims. No callbacks, scripts, URLs, paths, SQL or arbitrary operations are accepted. This is an application boundary, not a sandbox for code imported into the Node process.

The first real extension contract is `injury.bot.rendering.preflight/0.1` on `rendering-pipeline`. It requires `rendering.recipe.inspect` and the declared `application-cpu` resource class. Input is a saved manifest ID/revision and a strictly shaped recipe. Output reports `schemaAccepted`, fixed reason codes, contract ID, audit ID, `rendered: false`, `enqueued: false`, and the limitation that geometry, anatomical placement and clinical correctness are not verified. It calls the **same production recipe schema** extracted to `server/rendering/recipe.ts`; the normal worker retains its existing export and behavior. The renderer's existing kinds are capability constraints, not new library fixtures or a new attorney form. No job, geometry, case, evidence or atlas application is created by preflight.

Private definitions require the requesting owner and matching firm. Firm definitions require the declaring firm owner to create/update them; active staff in that firm may use the read-only contract. The owner must remain active, in that firm and (for Firm definitions) an owner. Community/Official are recognized scope names but are rejected as unimplemented. Platform-admin status never bypasses these SDK ownership checks. Existing AFP Management remains super-admin only; the scoped authenticated SDK endpoints independently enforce user/firm ownership.

Compatibility is deliberately exact. Both application version declarations must match the current release SHA (or `0.1.0+development` in an unversioned development build; a missing production release version fails closed), and SDK/contract versions must be `0.1.0`. Unknown schemas, extension contracts, protected alterations, permissions, resources, ownership or activation are Incompatible. Changed policy snapshots or Approval Required yield Requires Review and deny SDK use. Compatible permits only the non-executable preflight. No approval token or activation mechanism exists. After an application update, retained definitions remain inspectable but must be explicitly revised against current compatibility requirements. This is not automatic reconciliation.

The new `rendering-preflight` policy governs this permission at each evaluation/use. Protected blocks it; Approval Required blocks use pending future governance support; Allowed permits only the hard-coded read-only operation. Other policies, including Allowed external services, cannot expand the SDK allowlist. Authentication, tenancy, provenance, audit, filesystem, shell and unrestricted database access stay unreachable.

Persistence adds `afp_manifests`, `afp_manifest_revisions`, and `afp_sdk_audit`. Draft updates use an expected revision inside a transaction and preserve every revision. Use checks the saved digest, current ownership, release and policy each time. Audit records retain actor/time, extension identity/contract point, schema/application version, owner/scope, known requested permission names, manifest digest, outcome and fixed rejection reasons. Raw recipes, malformed input, source evidence, credentials and provider messages are excluded. Unrecognized requested permission strings are recorded as `unrecognized`. Authenticated users can inspect their own evaluation history; the SDK has no audit-delete operation. These are application audit records, not a claim of tamper-proof external logging.

Readiness advances Manifest and SDK Boundary to Implemented for this narrow contract. Protected Core remains Partial and isolated execution remains unready. Overview, Extension Points, Permissions and Features distinguish the implemented SDK from candidates and absent runtime. The Features inspector validates and saves definitions, shows rejection reasons and revisions, and offers no Activate button. Text and voice receive the same distinction; their tools cannot approve or activate manifests.

Before isolated preview, implement a capability-token handoff to a disposable process/container, resource budgets and termination, per-user artifact storage, an authenticated artifact-return contract, hostile-extension tests, preview UI and explicit reviewed activation/rollback. No MCP, coding agent, isolated runtime, GPU/database provisioner, marketplace or update reconciliation is delivered here. Startup migrations are additive; no new resource, environment setting or manual migration is required.

## Private presentation and proposal handoff

The second contract, `injury.bot.assistant.presentation/0.1`, adds only a private plain-text Coordinator label through the same manifest/policy/compatibility boundary. `set_private_afp_ui_preference` is available to text and voice. `npm run afp:context` and the super-admin development-context endpoint expose product-only persistent proposals for future coding agents. See [the contract, governance, migration and access details](afp-private-preferences.md). No executable AFP runtime exists.
