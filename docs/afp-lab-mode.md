# AFP Lab Mode

Settings → AFP Management → Permissions now controls the authenticated account's private AFP testing policy. Owners and platform super admins can enable it through the UI. The Coordinator has no permission-changing tool. Ordinary attorneys may use permitted private preferences but cannot enable Lab Mode or change permission presets. A firm owner sees only private Permissions/Features, without access to super-admin project memory, journal governance or shared policies.

## Presets and effective policy

- **Safe** requires approval for reversible private categories.
- **Standard**, the initial normal preset, automatically allows minor labels/styling/presentation/declarative preferences and rendering preflight. Other private categories require review.
- **Lab** automatically allows all listed reversible private categories. Individual Lab overrides can still block or require approval.

Selecting Lab or enabling its switch preserves the normal preset/overrides. Turning it off restores those settings. Choosing Safe/Standard resets that normal preset's overrides; choosing Lab resets its Lab overrides. No user changes another account. Global Protected policies always win; global Approval Required applies outside Lab. Locked core categories cannot be changed through this UI or API. Effective levels are shown directly, alongside implementation availability. Require Approval blocks execution; it does not create a fake approval queue. Change the private policy or enable Lab when authorized to test.

Categories cover labels, colors, typography, spacing/sizing, visibility, ordering/layout, panels, widgets, presentation, workflow preferences, declarative features, previews, rendering preflight, external services/storage/databases/GPU/runtime, executable code, activation and protected core operations. Permission is not implementation. No new executor exists for unsupported categories.

## Installed execution proof

`set_private_afp_presentation` accepts exactly:

```json
{"action":"set","selectInjuriesColor":"blue"}
```

or `{"action":"disable"}` / `{"action":"remove"}`. Its only color tokens are default, blue, green, red, amber and gray. It cannot accept CSS, selectors, markup, identities, geometry or arbitrary properties. The existing `set_private_afp_ui_preference` still changes the Coordinator text-tab label. Both modes use `createAfpSdk` with a freshly loaded authenticated user; text/voice source is supplied by the host. Voice additionally retains its expiring user/firm-bound session. Repeated tool-call IDs use existing action receipts.

`inspect_afp_capability` reads the effective permission, preset, Lab state and implementation status for a category. It cannot mutate permissions. Outcomes distinguish **Not Authorized**, **Not Implemented** and **Available**. Availability describes a bounded installed capability, never arbitrary targets. The Coordinator receives the current private policy and is instructed to execute permitted installed requests immediately, explain missing implementations accurately, and record a proposal only through the existing super-admin proposal workflow when requested. It must not invent success after a rejected receipt.

The new feature is `private-atlas-select-color`, contract `injury.bot.atlas.presentation/0.1`, extension `atlas-presentation`, permission `atlas.presentation.private.write`, under experimental manifest `injury.bot.afp/0.1`. Its Private manifest, ownership, build provenance, definition version, digest, state, value and revision are stored in the existing private preferences table. Rendering preflight separately consults its scoped permission while retaining exact-build compatibility.

The host reads the authenticated preference and sends a strict presentation message to the pinned Human Atlas viewer. The engine validates parent origin/source, protocol, contract, token and absence of extra fields. Reviewed high-contrast styles apply only to the existing Select Injuries control. The original Find/Describe application panel and all geometry remain intact. No source file is generated or modified per user. A second user or another firm receives the original token. Disable/remove clears the custom value and restores default presentation, retaining audit history. Active atlas sessions refresh the token periodically; reopening the workspace reads it again.

## Compatibility and governance

Simple label/color configuration survives unrelated application build changes. Application identity/version remain recorded as provenance; schema, SDK/contract version, supported capability, declared permissions/resources, active ownership and current policy remain validated at each use. Unsupported contracts fail. Policy revocation suspends the value without deleting it. Existing presentation manifests gain this compatibility behavior without being rewritten. Rendering recipes retain exact-build and policy-snapshot checks; no automatic renderer reconciliation was added.

Preference events retain actor, user/firm, feature/extension, action, old/new state/value, text/voice/settings source, timestamp, permission/preset, whether Lab authorized the change, result/reason and versions. Lab settings have a separate per-user audit stream and optimistic revision checks. No raw invalid styling payload, voice transcript, case/evidence content or credential is copied into these records. Disabling/removing remains possible for the authenticated owner after a permission revocation. Project knowledge and the persistent development journal stay separate; no Coordinator proposal can promote itself.

## Migration and operation

Startup additively creates `afp_lab_settings` and `afp_lab_audit`; preference/audit tables from the prior milestone are reused. A one-time `lab-tools-v1` migration adds the two installed tools without resetting Coordinator model choices, enabled state or other skills. Restarting does not re-enable a subsequently removed skill. Lab is **off by default** and is never enabled on the owner's behalf by a tool or migration. No new environment variables, cloud credentials, paid resources or database service are required. The application release pins the reviewed Human Atlas presentation adapter.

Tests cover real authenticated text dispatch, synthetic voice protocol, visible atlas color on desktop/mobile, independent accounts, disabled/removed defaults, invalid tokens/injection, ownership spoofing, unauthorized management, protected categories, preset restoration, category overrides, audit, persistence and unrelated-build compatibility. Existing manifest/SDK/rendering/memory/journal/governance and production-browser tests remain release gates. Provider speech and microphone audio are synthetic in browser automation; no invitations or live provider requests are sent.

Unimplemented: arbitrary typography/layout/widget builders, generated/executable code, MCP coding runtime, external resource provisioning, GPU execution, marketplace, feature sharing and automatic update reconciliation. Allowing their category does not provision or execute them.
