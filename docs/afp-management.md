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
