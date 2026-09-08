# AFP Management

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

Next milestone: implement a small versioned SDK contract and manifest validator for one non-executable extension contribution, with per-user ownership, permission checking and tests. Then add a disposable isolated preview runtime and authenticated artifact boundary before any GPU provisioning or feature activation. MCP, coding agent, resource provisioning, marketplace/sharing and update reconciliation remain future engineering.
