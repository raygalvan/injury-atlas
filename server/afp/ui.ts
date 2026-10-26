import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Store, User } from "../store";
import {
  uiCommandSchema,
  uiInspectSchema,
  uiObservationSchema,
  UI_FEATURE,
  UI_POINT,
  type UiTarget,
} from "../../shared/afp-ui";
import {
  applicationVersion,
  digest,
  uiManifest,
  validateManifest,
} from "./manifest";
import { presentationPolicies } from "./lab";
import type { PreferenceSource } from "./presentation";
export const uiTargets: UiTarget[] = JSON.parse(
  readFileSync(
    new URL("../../shared/afp-ui-catalog.json", import.meta.url),
    "utf8",
  ),
);
export function ensureUi(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS afp_ui_edits(user_id TEXT,firm_id TEXT,target_id TEXT,revision INTEGER,body TEXT,manifest TEXT,digest TEXT,PRIMARY KEY(user_id,firm_id,target_id));
  CREATE TABLE IF NOT EXISTS afp_ui_history(id TEXT PRIMARY KEY,user_id TEXT,firm_id TEXT,target_id TEXT,body TEXT,created INTEGER);
  CREATE TABLE IF NOT EXISTS afp_ui_observations(user_id TEXT,firm_id TEXT,target_id TEXT,viewport TEXT,body TEXT,created INTEGER,PRIMARY KEY(user_id,firm_id,target_id,viewport));`);
}
export function uiCapability(db: Store, actorId: string) {
  const actor = () =>
    db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(actorId) as
      User | undefined;
  const row = (u: User, id: string) =>
    db
      .prepare(
        "SELECT * FROM afp_ui_edits WHERE user_id=? AND firm_id=? AND target_id=?",
      )
      .get(u.id, u.firm_id, id) as any;
  const permitted = (u: User | undefined) => !!u && u.role !== "client";
  const policies = () => presentationPolicies(db, actorId, "ui-editing");
  function readRow(r: any, u: User) {
    if (!r) return null;
    const body = JSON.parse(r.body),
      manifest = JSON.parse(r.manifest);
    const validation = validateManifest(
      manifest,
      u,
      policies(),
      applicationVersion(),
      "use",
    );
    const compatible =
      uiTargets.some(t=>t.id===r.target_id) &&
      digest({ body, manifest }) === r.digest &&
      validation.result === "Compatible" &&
      manifest.extensionId === UI_FEATURE;
    return {
      targetId: r.target_id,
      revision: r.revision,
      body,
      manifest,
      compatibility: compatible
        ? "Compatible"
        : validation.result === "Requires Review"
          ? "Requires Review"
          : "Incompatible",
      effective: compatible && body.enabled,
    };
  }
  function inspect(input: unknown = {}) {
    const u = actor(),
      p = uiInspectSchema.safeParse(input);
    if (!permitted(u))
      return { status: 403, body: { error: "actor_not_authorized" } };
    if (!p.success)
      return { status: 422, body: { error: "invalid_inspection" } };
    const words = (p.data.query || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const targets = uiTargets.filter(
      (t) =>
        (!p.data.targetId || t.id === p.data.targetId) &&
        words.every((w) =>
          `${t.label} ${t.className} ${t.file} ${t.tag}`
            .toLowerCase()
            .includes(w),
        ),
    );
    return {
      status: 200,
      body: {
        contract: "injury.bot.application.presentation/0.1",
        featureId: UI_FEATURE,
        scope: "Private",
        owner: u!.id,
        permission: validateManifest(
          uiManifest(u!, policies()),
          u!,
          policies(),
          applicationVersion(),
        ).result,
        total: targets.length,
        targets: targets.slice(0, 60).map((t) => ({
          ...t,
          edit: readRow(row(u!, t.id), u!),
          observations: db
            .prepare(
              "SELECT body,created FROM afp_ui_observations WHERE user_id=? AND firm_id=? AND target_id=?",
            )
            .all(u!.id, u!.firm_id, t.id)
            .map((r) => ({
              ...JSON.parse(String(r.body)),
              observedAt: r.created,
              verification:
                "Browser-reported, not an independent screenshot review",
            })),
        })),
        edits: db
          .prepare("SELECT * FROM afp_ui_edits WHERE user_id=? AND firm_id=?")
          .all(u!.id, u!.firm_id)
          .map((r) => readRow(r, u!)),
      },
    };
  }
  function command(input: unknown, source: PreferenceSource) {
    const u = actor(),
      p = uiCommandSchema.safeParse(input),
      now = Date.now();
    if (!permitted(u))
      return { status: 403, body: { error: "actor_not_authorized" } };
    const target = p.success
      ? uiTargets.find((t) => t.id === p.data.targetId)
      : null;
    const previous = target ? row(u!, target.id) : null;
    const oldBody = previous
      ? JSON.parse(previous.body)
      : { enabled: false, variants: {} };
    const manifest = uiManifest(u!, policies()),
      validation = validateManifest(
        manifest,
        u!,
        policies(),
        applicationVersion(),
      );
    let reason = !p.success
      ? "invalid_ui_request"
      : !target
        ? "unknown_ui_target"
        : !["settings", "text coordinator", "voice coordinator"].includes(
              source,
            )
          ? "invalid_source"
          : p.data.revision !== (previous?.revision ?? 0)
            ? "stale_revision"
            : null;
    if (
      !reason &&
      p.success &&
      ["set", "undo"].includes(p.data.action) &&
      validation.result !== "Compatible"
    )
      reason = validation.reasons.join(",");
    let next = structuredClone(oldBody);
    if (!reason && p.success) {
      const d = p.data;
      if (d.action === "set") {
        if ((!d.styles || !Object.keys(d.styles).length) && !d.text)
          reason = "empty_edit";
        if (d.text && !target!.textEditable)
          reason = "dynamic_content_protected";
        const viewport = d.viewport ?? "all";
        next.enabled = true;
        next.variants[viewport] = {
          ...next.variants[viewport],
          styles: { ...next.variants[viewport]?.styles, ...d.styles },
          ...(d.text ? { text: d.text } : {}),
        };
      } else if (d.action === "undo") {
        const event = db
          .prepare(
            "SELECT body FROM afp_ui_history WHERE user_id=? AND firm_id=? AND target_id=? ORDER BY rowid DESC",
          )
          .all(u!.id, u!.firm_id, target!.id)
          .map((r) => JSON.parse(String(r.body)))
          .find((e) => e.result === "success");
        if (!event) reason = "nothing_to_undo";
        else next = event.oldValue;
      } else
        next = {
          ...next,
          enabled: false,
          ...(d.action === "remove" ? { variants: {} } : {}),
        };
      if (d.action !== "set" && (d.styles || d.text || d.viewport))
        reason = "unexpected_edit_fields";
    }
    const id = randomUUID(),
      revision = (previous?.revision ?? 0) + 1;
    const event = {
      id,
      actor: u!.id,
      firmId: u!.firm_id,
      scope: "Private",
      featureId: UI_FEATURE,
      targetId: target?.id ?? null,
      source,
      timestamp: now,
      action: p.success ? p.data.action : "invalid",
      oldValue: oldBody,
      newValue: reason ? null : next,
      result: reason ? "rejected" : "success",
      reason,
      revision: reason ? (previous?.revision ?? 0) : revision,
      manifestVersion: manifest.schemaVersion,
      applicationVersion: applicationVersion(),
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!reason)
        db.prepare(
          "INSERT INTO afp_ui_edits VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,firm_id,target_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,manifest=excluded.manifest,digest=excluded.digest",
        ).run(
          u!.id,
          u!.firm_id,
          target!.id,
          revision,
          JSON.stringify(next),
          JSON.stringify(manifest),
          digest({ body: next, manifest }),
        );
      db.prepare("INSERT INTO afp_ui_history VALUES(?,?,?,?,?,?)").run(
        id,
        u!.id,
        u!.firm_id,
        target?.id ?? null,
        JSON.stringify(event),
        now,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return {
      status: reason === "stale_revision" ? 409 : reason ? 422 : 200,
      body: reason
        ? { saved: false, reason, auditId: id }
        : {
            saved: true,
            targetId: target!.id,
            revision,
            auditId: id,
            scope: "Private",
            visualVerification:
              "Pending browser observation. Do not claim visual verification until an observation for this revision is returned.",
          },
    };
  }
  function observe(input: unknown) {
    const u = actor(),
      p = uiObservationSchema.safeParse(input);
    if (!permitted(u))
      return { status: 403, body: { error: "actor_not_authorized" } };
    if (
      !p.success ||
      p.data.observations.some(
        (o) => !uiTargets.some((t) => t.id === o.targetId),
      )
    )
      return { status: 422, body: { error: "invalid_observation" } };
    for (const o of p.data.observations) {
      if (o.revision !== (row(u!, o.targetId)?.revision ?? 0)) continue;
      db.prepare(
        "INSERT INTO afp_ui_observations VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,firm_id,target_id,viewport) DO UPDATE SET body=excluded.body,created=excluded.created",
      ).run(
        u!.id,
        u!.firm_id,
        o.targetId,
        o.viewport,
        JSON.stringify(o),
        Date.now(),
      );
    }
    return { status: 200, body: { observed: true } };
  }
  return {
    inspect,
    command,
    observe,
    history() {
      const u = actor();
      return !permitted(u)
        ? { status: 403, body: { error: "actor_not_authorized" } }
        : {
            status: 200,
            body: db
              .prepare(
                "SELECT body FROM afp_ui_history WHERE user_id=? AND firm_id=? ORDER BY rowid DESC LIMIT 100",
              )
              .all(u!.id, u!.firm_id)
              .map((r) => JSON.parse(String(r.body))),
          };
    },
  };
}
