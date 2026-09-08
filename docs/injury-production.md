# Injury workspace and background production

## User workflow

Use the restored Apply Injuries panel or Injury workspace. Describe an injury in ordinary language, such as “broken kneecap.” The Injury Creation Agent is assigned automatically. It reads available supported case evidence, resolves clinical terminology against the actual anatomy catalogue, prepares general medical documentation separately from client effects, and constructs a registered illustrative geometry plan. No renderer choice, mesh ID, coordinates or medical authoring fields are required. Leaving the page or signing out does not stop the worker.

Completed files are saved as generated artifacts in the case Evidence library: registered 3D JSON, reproducible source geometry, anterior/oblique/posterior PNG views, reference PNG, a PDF, and editable Word demand material. Optional AI drafting produces a separately retained draft. Completion email uses SES and a sign-in-protected deep link. A failure to send does not discard the outputs; notification delivery retries with backoff. In rare process crashes after SES accepts a message but before its receipt is recorded, duplicate delivery is possible.

Source, placement, and illustration approvals are independent. Only reviewed completed geometry is applied to the atlas. The attorney can issue a reviewed exhibit version from retained images, create a revision without overwriting prior artifacts, and hide/remove atlas applications. Generated outputs are demonstrative reference-anatomy illustrations, not patient scans. Medical content and draft advocacy require attorney review. There is no automatic monetary valuation.

## Library ownership

Case injury production records remain firm-private. Submitting a shared definition creates a separate publication record with deliberately entered generic description and medical references. Case evidence, client impact, raw description, geometry and images are not automatically promoted. The submitting attorney keeps the original regardless of approval or retirement. Only approved generic definitions are visible to other firms. New case applications require their own findings and measurements.

Platform administrators can author, approve, reject and retire library definitions. A separate platform_admins grant avoids treating every firm owner as platform administrator. The previously authorized raygalvan@gmail.com owner receives that grant. Clients cannot access internal production, atlas geometry or generated case exhibits by default.

## Operations

The web service starts one isolated Node child worker with a 512 MB heap cap. SQLite stores durable jobs, artifacts and a notification outbox. Processing does not depend on browser polling. Interrupted running jobs become actionable failures after 20 minutes; a per-job watchdog terminates computation after 18 minutes and the parent restarts the worker. Stages and email state are shown separately. Retry preserves previously stored artifacts and frozen geometry/AI results. Deployment remains EC2/systemd with EBS for metadata and the configured private S3/local evidence adapter for generated files.

The health check now verifies worker heartbeat and bundled geometry generator availability. No new service installation or IAM privilege is needed beyond the existing storage and SES permissions. Non-production completion email is disabled.

ANTHROPIC_API_KEY enables the Injury Creation Agent; INJURY_AI_MODEL overrides its Claude Opus 5 default. Missing configuration is reported before an AI request is queued. Health reports the non-secret injuryAgentConfigured flag. The agent reads up to six supported original case files per pass with a combined 12 MB bound: PDF, JPEG, PNG, WebP, GIF and plain text. It records the source IDs and hashes it read and discloses skipped files. General medical research uses the provider's web-search tool restricted to medical reference domains; only an anatomy/classification topic is sent to that research step, never case documents or client identity. References are taken from actual tool results.

The retained agent plan includes clinical wording, general library wording, source linkage, geometric choices and uncertainties. Retries reuse it. Unspecified side and geometric dimensions remain explicitly illustrative reference choices; they do not become verified client measurements. Source, placement and rendering approvals remain independent. Unknown or unsupported injury morphology is marked for additional modeling rather than replaced with an unrelated injury.
## Geometry mechanics are not an injury catalogue

The agent selects internal geometry operations against actual reference structures. A fracture operation now accepts any appropriate individual bone, including the patella, rather than being restricted to the rib test. Surface operations create a registered superficial abrasion or cerebral surface blood layer where appropriate. Complex morphology that cannot be accurately represented by these operations is explicitly identified for further modeling. No hard-coded test injury becomes a selectable app entry.

Find contains workflow-created private injuries and approved shared definitions. The old seed table is no longer populated, listed, matched or accepted by application endpoints. The hosted viewer no longer falls back to the Homer test catalogue. Standalone engineering proofs remain isolated from application cases.

Engine code remains in human-atlas and is pinned/bundled at release time. Geometry stores the engine commit. An anatomy-signature mismatch blocks applying old geometry and requires an explicitly reviewed revision. Published library metadata loads at runtime without rebuilding the application.

Synthetic validations use no real case data and send no email. The browser proof exercises desktop/mobile layouts, actual three-method geometry production, generated image delivery, placement UI and atlas applications. Screenshots are retained as CI artifacts.

## Saved anatomy and appearance compatibility

New geometry records carry a SHA-256 signature of the atlas catalogue and every raw geometry chunk. Code-only engine updates retain compatibility; changed anatomy requires a reviewed revision. The initial production pin (`5968f08031e185df3830637e961a2d0f3d47caad`) has an explicit, byte-verified signature mapping for its existing records. Unknown legacy pins are rejected. Appearance version 0 is preserved; new abrasion and blood layers use reference-coordinate variation (version 1), which is illustrative and does not encode severity or wound age. Existing evidence images and documents are never regenerated by a viewer update.

## Panel restoration

The original Client Injuries / Apply Injuries layout and CSS from the pre-production panel are restored. Find/Describe, the catalogue checklist, missing-injury card, queued rows, isolation and mobile controls remain. The panel receives actual catalogue records and durable job stages from the host. Server acknowledgements and failures are shown in place without a redirect into a technical form.

## AI library authoring and unknown client facts

All staff can start a private library definition with one generic injury name. The same Injury Creation Agent researches the definition and medical references in a separate case-free context. Revisions create new private entries; case submissions queue only the generic name and keep the private case record intact. No description, bibliography, geometry type or clinical form is required. Platform administrators still review and approve shared publication.

`injury_library_jobs` persists the research queue and notification outbox independently of browser sessions. Entries show queued/running, failed/retry, or ready-for-review status. A definition cannot be approved while generation is incomplete. Only actual provider web-search citations to permitted medical sources populate its references; missing citations cause a retryable research failure, never a request for the attorney to write a bibliography. Completion emails link to the authorized library entry. Existing library records remain intact. No EC2 configuration change is required.

The case agent accepts null/omitted unknown client effects, impact citations, evidence IDs, source citations and measurement citations as empty values. Required anatomy and medical output remain validated. A regression fixture mirrors the null response observed in the live patellar-fracture request, and the geometry/browser proof uses that response shape end to end. Tests use a synthetic provider and never send email.
