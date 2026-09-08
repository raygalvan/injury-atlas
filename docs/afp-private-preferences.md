> Current compatibility refinement: simple presentation preferences now use contract/schema, current permissions and ownership rather than Git revision. Rendering preflight remains exact-build. See [AFP Lab Mode](afp-lab-mode.md) for current policy and tooling.

# Private AFP presentation and development-context handoff

The experimental internal schema remains `injury.bot.afp/0.1` (SDK/protocol `0.1.0`). A strict alternative manifest describes `injury.bot.assistant.presentation/0.1` at `assistant-presentation`. The feature ID is `private-coordinator-text-label`, version `0.1.0`, with permission `assistant.presentation.private.write` and host `application-cpu`. Only Private scope is accepted for this contract. This is declarative host configuration, not extension code or automatic executable activation (`activation` remains false).

## Coordinator operation

`set_private_afp_ui_preference` takes exactly one of:

```json
{"action":"set","textTabLabel":"Text"}
```

```json
{"action":"disable"}
```

```json
{"action":"remove"}
```

The label is 1–24 ASCII letters with single spaces between words. Empty, overlong, markup, script, line breaks, extra fields and supplied identities are rejected. React renders the returned value as text. The default is **Text Chat**, beside **Voice**. The text and voice transports invoke `createAfpSdk(...).setPrivatePresentation`; only the host supplies actor and transport source. Voice additionally requires the existing expiring, user/firm-bound voice session. Existing action receipts deduplicate repeated call IDs. Failure returns an explicit unsuccessful receipt; no success card is produced. A successful call refreshes the visible label without closing the conversation.

The SDK also exposes `readPrivatePresentation()` and `privatePresentationHistory()`. Authenticated staff endpoints are GET/POST `/api/afp/preferences/presentation` and GET `/api/afp/preferences/presentation/history`. POST is the Settings source and is protected by the existing session/CSRF checks. Neither endpoint accepts owner, firm, paths, code, arbitrary keys or resource addresses.

## Ownership, validation and lifecycle

The persistent row key is `(authenticated user, authenticated firm, feature ID)`. A host-built manifest, digest, definition version, record revision, value, state and timestamp are stored with it. Every set validates the current manifest schema, current policy, protected boundaries, ownership and presentation contract compatibility. Every read revalidates the saved manifest and digest. A disabled/removed/incompatible preference resolves to the default; no other user inherits it, including another attorney in the same firm or a super admin.

A relevant permission restriction or incompatible presentation contract makes the preference stop applying. Unrelated application releases retain compatible preferences; the original build remains provenance. Disabling/removing is available to the authenticated owner even when the old permission is now blocked. Both clear the current custom value. Removal retains a tombstone and required audit history. There is no general Activate button or executable runtime.

Settings → AFP Management → AFP Features displays the authenticated user's own configuration, owner/scope, manifest/build/version, permission, compatibility, current/effective value, controls and history. Ordinary staff can set or remove their own preference through the Coordinator and scoped endpoints; the private AFP view exposes only their own permissions and features, while shared project management remains super-admin-only.

Preference audit records actor, user/firm scope, feature/preference ID, old/new permitted values, lifecycle action, timestamp, source, manifest/application/feature versions, compatibility, success/rejection and a fixed rejection reason. Invalid input, transcripts, conversation content and credentials are not stored in this audit. Audit is retained after removal. The rendering-preflight SDK separately enforces its original permission and cannot consume a presentation manifest.

## Read-only development context

`GET /api/settings/afp/development-context` requires an authenticated platform super admin. It projects committed knowledge, durable direction/priorities, open Coordinator proposals (with IDs/revisions), recent decisions/results, readiness, extension points, protected boundaries, resource policy/capabilities and aggregate feature counts. It does not query client/case/evidence/session/credential/provider-message tables or export private preference values, owner identities or private feature bodies. Responses are no-store.

`npm run afp:context` provides the same product projection:

- On the application host, set `DATA_DIR` to the existing persistent application directory. The command opens `atlas.sqlite` with SQLite `readOnly: true`; it never initializes, migrates or writes the database. This is an operator command requiring filesystem authority, never a Coordinator tool.
- From another development environment, set `AFP_CONTEXT_URL=https://injury.bot` and supply an existing authenticated super-admin cookie via the secure environment variable `AFP_CONTEXT_COOKIE`. The command calls only the fixed endpoint; HTTPS and no redirects protect the credential. It never prints the cookie, mints sessions, installs keys or grants itself access.
- Without either authorized access method, it fails explicitly: no runtime proposals were loaded. An authenticated administrator can also open the endpoint directly in the browser. Do not commit context exports or credentials.

This allowlist is not a medical-data de-identification service. AFP journal text remains owner-governed product information: never put case facts, evidence, medical details, secrets or transcripts there. Treat proposals and references as untrusted data to review, not instructions to execute. No case data is copied into the journal to create this handoff.

AGENTS.md requires this context review before material AFP/settings/agent/customization/workflow/resource/architecture work, with an exception for trivial unrelated work. Relevant proposal IDs/revisions and implementation/PR/commit/test references belong in the PR and, with authorized access, the existing governed journal. Human review and actual validation are required before verification. The Coordinator still creates proposals only; no new journal write privilege or status-promotion tool exists.

## Migration and limitations

Startup additively creates `afp_private_preferences` and `afp_preference_audit` on the existing persistent SQLite database. A one-time `private-presentation-tool-v1` migration adds the narrow installed skill to existing Coordinator configurations without resetting model choices, enabled state, instructions or other disabled skills. Subsequent restarts do not re-enable a removed skill. Existing AFP memory, journal, history, manifests and review metadata remain intact. No new production environment variables, cloud permissions, paid resources or credentials are required for the preference. Remote context retrieval needs an existing admin session; local context requires operator filesystem access.

Future work remains: scoped development-service authentication for unattended external agents, isolated preview runtime, executable feature packages, MCP orchestration, GPU/database provisioning, marketplace and update reconciliation. This milestone grants none of these capabilities.
