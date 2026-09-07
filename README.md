# Injury Atlas

Private injury-evidence and anatomy workspace for an invitation-only pilot. AWS deployment target: EC2 + encrypted EBS + SES, behind Nginx HTTPS. No Google account or Google runtime service is required.

## Architecture decisions

Human Atlas remains a separate engine, pinned by full commit in `atlas.lock.json`. Its static build ships with this application at the authenticated `/atlas-engine/` route. There is one origin and one release on EC2, no external iframe hosting configuration, and no fork of the anatomy source to drift independently. Update the pin deliberately when the engine is validated.

Law.bot's invited-member workflow informed this implementation: 15-minute single-use hashed email tokens, server-side sessions, HttpOnly cookies, SES delivery, and a POST confirmation to prevent mail scanners from consuming links. The reference source was `raygalvan/law-bot@3eea173471311b4e9dc73ade8e78d6d847d0377c`, especially its auth database module, sign-in actions, and SES helper. Law.bot's broad CRM, provider orchestration, and owner shortcuts were not copied.

React/TypeScript with an Express API. Node 24's built-in SQLite stores users, cases, access grants, evidence metadata, findings, sessions and audit records. Original evidence bytes live outside the release directory on encrypted EBS. This is a single-instance pilot; do not run multiple independent instances against copies of this database. RDS PostgreSQL and S3 are the intended scale-up path.

## Working in this foundation

- Owner bootstrap and invited attorney/client email sign-in.
- Case creation and persistent case selection during the session.
- Real 2,234-mesh Human Atlas, with rotation, isolation and zoom from the existing engine.
- Case evidence upload/download, original byte hashing, 25 MB limit per file.
- Manually drafted findings linked to source evidence and page/image/timestamp citations.
- Attorney approval of documented source findings, separately from placement/rendering.
- Client access to assigned cases and their own uploaded files only.
- Engine, finding and case authorization on the server, not localStorage.

## Deliberately unfinished

No automated medical extraction, atlas injury placement editor, incident simulation, agent execution or exhibit publishing is claimed. The atlas currently receives case identity and no findings: source approval alone never permits placement. The engine's synthetic test controls are disabled in embedded mode. There are no preloaded Homer injuries. Create **Homer Cortez Injury Reconstruction** as the first case and upload the actual source documents.

Human Atlas may show healthy-anatomy reference group names from its existing Homer research UI. These are engine reference groups, not approved case findings. Engine selection is temporary working context and does not mutate case records.

## Local development

Requires Node 24 and Git access to the pinned Human Atlas repository.

```bash
npm ci
npm run build:atlas
npm run build
npm run bootstrap -- owner@example.test "Pilot owner" --local-link
npm run server
# In a second terminal:
npm run dev
```

The bootstrap link is available only when the application origin is localhost and NODE_ENV is not production. It is a one-time development login issued by a CLI, never an HTTP backdoor. Use synthetic evidence locally. No test accounts or passwords are seeded.

Set environment variables from `.env.example` in your shell, or use Node's `--env-file` flag. The app does not silently load `.env` files. Production uses `/etc/injury-atlas.env` through systemd.

```bash
npm test
npm run build
npm run build:atlas
```

## AWS setup and deployment

See [deploy/README.md](deploy/README.md). The application has not been deployed to AWS yet. Build verification does not prove that your EC2 instance, SES sender, domain, or IAM role is configured. The manual Deploy AWS workflow requires those values and deploys only main. Pull requests never modify production.

## Evidence and access limitations

Client photos and documents download as attachments; browser execution is not permitted. MIME type is descriptive, not a security classification. Malware scanning, upload quotas, account revocation UI, evidence removal policy and full audit UI remain pre-production work. Disable a user by setting `users.active=0` through a controlled administrator database operation; session lookups enforce this immediately. Memberships are one firm per email in this pilot. Never expose the SQLite file or evidence directory through Nginx. Take encrypted EBS snapshots and consistent SQLite backups before storing real case records.
