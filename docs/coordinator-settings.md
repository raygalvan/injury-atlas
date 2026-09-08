# Coordinator and model settings

The center mobile navigation button now opens the Coordinator. Desktop navigation and the control-center drawer expose the same workspace. The existing Human Atlas injury panel and pinned engine are unchanged.

## Law.bot source and adaptation

Adapted from raygalvan/law-bot at `3eea173471311b4e9dc73ade8e78d6d847d0377c`:

- Settings page and drawer: instructions, reviewed memory, agent skills, permitted models, firm/platform credentials, integrations.
- Assistant console, animated voice orb, Realtime protocol, microphone gating, talk-over detector and protocol tests.
- Provider gateway, encrypted credential storage, text tool loop and read-only OAuth patterns.

Injury.bot remains React/Vite/Express/SQLite on AWS. It does not depend on Law.bot's Next.js/Postgres installation. Existing sessions, firm permissions, EBS, private evidence storage and release activation remain authoritative.

## Use

The Coordinator greets the authenticated attorney by first name and offers client creation, injury analysis and injury demand preparation. Injury analysis branches to new client, existing client or a generic library entry. Tools create real case records and queue the existing durable injury/library worker. A generic description suffices; unknown client facts are not invented. The worker continues after the attorney leaves, saves files to Evidence and uses the existing retrying completion-email queue.

Demand preparation is a separate queued job that reads completed injury records from the selected case, supplies their source and approval context to the configured Demand Preparation Agent, and produces private PDF/Word working drafts. It cannot approve or issue exhibits.

The coordinator can read progress, propose memories for administrator approval, and read explicitly connected services. It has no publishing, approval or outbound-message tool. Case and firm access is enforced server-side for text and voice alike. Voice tool requests require a session bound to the authenticated user; tool-call IDs prevent duplicate replay of completed actions.

## Configuration

Super admins can edit platform defaults; firm owners can customize their firm. Settings choose separate provider/model combinations for Coordinator text, Injury Creation, Medical Library and Demand Preparation. Installed adapters support OpenAI Responses, Anthropic Messages and xAI Responses. Existing injury/research defaults remain unchanged for running deployments. Coordinator text defaults to `OPENAI_TEXT_MODEL` or `gpt-6-astra`; administrators must choose model IDs available to their API account. There is no automatic provider fallback.

Voice retains Law.bot's OpenAI Realtime transport and uses its own model/voice/language selection. Add an OpenAI API key through **Settings → Credentials**, then enable voice under **Models**. Selecting the Coordinator opens voice and requests microphone access when configured. Text is available independently. Browser microphone/audio permission is still required. Minimize, mode switching and navigation stop audio and release microphone tracks, including cancellation during connection.

A saved firm key is used only when that firm's credential source is set to Firm keys. Platform credentials fall back to existing environment keys if there is no saved override. Keys are validated server-side, never returned to browsers, and encrypted with AES-256-GCM using scope-bound authenticated data. The encryption key is `CREDENTIAL_ENCRYPTION_KEY` (64 hex characters), or automatically created as `DATA_DIR/ai-credential-key` (0600). **Back up that file together with the SQLite database.** It lives outside releases on persistent EBS.

Instructions, agent enablement, installed skills, approved memory, permitted models and daily invocation caps are enforced in the runtime adapters. Changing a model does not make it capable of unsupported tools or geometry. Medical web searches receive generic medical context, not client files or case memories. OpenAI/Claude evidence adapters support PDFs; the installed xAI adapter explicitly rejects PDF inputs rather than omitting them.

Gmail, Slack and Clio retain the read-only OAuth workflow. Configure the corresponding `GOOGLE_CLIENT_ID/SECRET`, `SLACK_CLIENT_ID/SECRET`, or `CLIO_CLIENT_ID/SECRET` and register the callback shown in Settings. Clio region accepts us/ca/eu/au. These optional third-party connections do not change AWS hosting. Smokeball, LexisNexis and custom APIs remain visibly unavailable until licensed access and adapters exist.

## Scope and verification

This installs settings and the coordinator before extending rendering methods. It does **not** create a new arbitrary-injury mesh-authoring agent or convert historical tests into catalogue entries. Existing geometry, review, application and notification gates remain in place.

Tests use synthetic users, provider responses and records. They cover tenant/admin boundaries, encryption, model routing, private memory, voice session isolation, text function tools, durable injury/library queues, demand artifact production, daily limits and Law.bot's greeting/interrupt protocol. CI adds browser checks for the center button, personalized text flow, voice interface, minimize, Settings persistence and mobile width. Live speech quality and real provider account access require configured credentials and a microphone; mocked tests cannot establish those.

The release tarball includes the new `shared/` runtime contract. AWS activation still checks the exact release commit, atlas assets and production-worker heartbeat and rolls back on failure.
