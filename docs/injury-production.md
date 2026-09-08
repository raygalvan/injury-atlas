# Injury workspace and background production

## User workflow

Open Injury workspace for a case. Create a private injury; describe the documented injury separately from general medical explanation and client effects. Link evidence and citations. Choose documentation only or a supported rendering method. For geometry, choose the anatomy, click its actual surface to anchor placement, enter millimeter dimensions, and record measurement sources or illustrative assumptions. Save and start production. Leaving the page or signing out does not stop the worker.

Completed files are saved as generated artifacts in the case Evidence library: registered 3D JSON, reproducible source geometry, anterior/oblique/posterior PNG views, reference PNG, a PDF, and editable Word demand material. Optional AI drafting produces a separately retained draft. Completion email uses SES and a sign-in-protected deep link. A failure to send does not discard the outputs; notification delivery retries with backoff. In rare process crashes after SES accepts a message but before its receipt is recorded, duplicate delivery is possible.

Source, placement, and illustration approvals are independent. Only reviewed completed geometry is applied to the atlas. The attorney can issue a reviewed exhibit version from retained images, create a revision without overwriting prior artifacts, and hide/remove atlas applications. Generated outputs are demonstrative reference-anatomy illustrations, not patient scans. Medical content and draft advocacy require attorney review. There is no automatic monetary valuation.

## Library ownership

Case injury production records remain firm-private. Submitting a shared definition creates a separate publication record with deliberately entered generic description and medical references. Case evidence, client impact, raw description, geometry and images are not automatically promoted. The submitting attorney keeps the original regardless of approval or retirement. Only approved generic definitions are visible to other firms. New case applications require their own findings and measurements.

Platform administrators can author, approve, reject and retire library definitions. A separate platform_admins grant avoids treating every firm owner as platform administrator. The previously authorized raygalvan@gmail.com owner receives that grant. Clients cannot access internal production, atlas geometry or generated case exhibits by default.

## Operations

The web service starts one isolated Node child worker with a 512 MB heap cap. SQLite stores durable jobs, artifacts and a notification outbox. Processing does not depend on browser polling. Interrupted running jobs become actionable failures after 20 minutes; a per-job watchdog terminates computation after 18 minutes and the parent restarts the worker. Stages and email state are shown separately. Retry preserves previously stored artifacts and frozen geometry/AI results. Deployment remains EC2/systemd with EBS for metadata and the configured private S3/local evidence adapter for generated files.

The health check now verifies worker heartbeat and bundled geometry generator availability. No new service installation or IAM privilege is needed beyond the existing storage and SES permissions. Non-production completion email is disabled.

ANTHROPIC_API_KEY enables optional AI drafting. INJURY_AI_MODEL overrides the model; the default follows the existing application's Claude model. Without a key, user-authored descriptions and geometric/document production remain available. AI currently consumes the supplied text and citations; it does not automatically extract a diagnosis or measurements from an uploaded photograph or report. Users must supply/review the injury description and placement.

## Current rendering capabilities and limits

- Surface abrasion on the actual skin triangles; no extra layer thickness.
- Subarachnoid surface blood layer on a selected cerebral surface structure. This is not a volumetric reconstruction of patient-specific bleeding.
- Measured individual-rib fracture plane/gap with illustrative cut faces. One replacement per source anatomy piece; compound/multiple fractures require a future composite generator.
- Other injuries remain documented requests; the system does not fabricate an unsupported mesh.

Engine code remains in human-atlas and is pinned/bundled at release time. Geometry stores the engine commit. An engine mismatch blocks applying old geometry and requires an explicitly reviewed revision. Published library metadata loads at runtime without rebuilding the application.

Synthetic validations use no real case data and send no email. The browser proof exercises desktop/mobile layouts, actual three-method geometry production, generated image delivery, placement UI and atlas applications. Screenshots are retained as CI artifacts.

## Saved anatomy and appearance compatibility

New geometry records carry a SHA-256 signature of the atlas catalogue and every raw geometry chunk. Code-only engine updates retain compatibility; changed anatomy requires a reviewed revision. The initial production pin (`5968f08031e185df3830637e961a2d0f3d47caad`) has an explicit, byte-verified signature mapping for its existing records. Unknown legacy pins are rejected. Appearance version 0 is preserved; new abrasion and blood layers use reference-coordinate variation (version 1), which is illustrative and does not encode severity or wound age. Existing evidence images and documents are never regenerated by a viewer update.
