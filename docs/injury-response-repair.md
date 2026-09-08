# Injury agent response repair

The reported screenshot corresponds to a catch-all for JSON parsing or Zod validation failures. Before this repair the rejected response and field diagnostics were not retained, so its exact malformed field cannot be established retrospectively from that message.

The code did have an incomplete provider contract: a prose-only list of output keys without a JSON response schema, a conflicting `GenericDefinition` spelling, and geometric defaults that accepted omission but rejected null. A syntactically valid response with a missing definition, non-enumerated rendering method or null geometric choice could fail before any artifacts were saved. Existing tests supplied already-conforming responses.

The Injury Creation Agent now derives a provider schema from the same Zod contract used for validation. Claude receives `output_config.format`; OpenAI and xAI Responses receive `text.format` with strict JSON schema. Unsupported numeric/string constraints are represented in descriptions and still enforced locally. There is no provider/model fallback. Only illustration orientation/surface nulls normalize to the previously documented illustrative defaults; unknown clinical facts remain unknown. Required medical content, structure validation and review gates are preserved.

Malformed or missing fields trigger at most two corrective calls to the same configured agent using the original request/evidence context and validation paths. Terminal errors identify the response contract problem instead of falsely requiring attorney medical input. `injury_agent_diagnostics` retains provider/model, response ID, stop reason, attempt number and validation paths/codes. It stores neither provider response text nor clinical source content.

Existing failed, agent-managed injury jobs with the exact old catch-all message are requeued once on their original IDs. Recovery excludes completed, reviewed, archived, inactive-owner, client-role, unrelated failures, demand jobs and jobs with artifacts. `injury_response_recovery` prevents replay on subsequent worker ticks or deployments. Requests are not duplicated and approvals are not granted.

Validation includes null geometry choices, malformed response correction, bounded terminal failure, native request payloads for all three providers, and recovery exclusions/idempotence. The browser production proof now starts with a malformed model answer and verifies automatic correction through real patella geometry, images and documents. It still verifies the existing Atlas injury application panel.

These are synthetic provider fixtures; they do not prove that a particular live model response or queued client request completed. Production jobs retain their ordinary background progress and failure reporting.
