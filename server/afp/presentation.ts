import { randomUUID } from "node:crypto";
import type { Store, User } from "../store";
import { readControlPlane } from "./control-plane";
import {
  applicationVersion,
  digest,
  presentationManifest,
  validateManifest,
} from "./manifest";
import {
  DEFAULT_TEXT_LABEL,
  PRESENTATION_FEATURE,
  preferenceRequestSchema,
  textTabLabelSchema,
} from "../../shared/afp-manifest";

export type PreferenceSource =
  "text coordinator" | "voice coordinator" | "settings";
export function ensurePresentation(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS afp_private_preferences(user_id TEXT NOT NULL,firm_id TEXT NOT NULL,feature_id TEXT NOT NULL,state TEXT NOT NULL,value TEXT,revision INTEGER NOT NULL,manifest TEXT NOT NULL,digest TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user_id,firm_id,feature_id));
    CREATE TABLE IF NOT EXISTS afp_preference_audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,firm_id TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL);`);
}
/** Host-only capability. The caller supplies an authenticated actor, never model identity. */
export function presentationCapability(db: Store, actorId: string) {
  const actor = () =>
    db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(actorId) as
      User | undefined;
  const rowFor = (u: User) =>
    db
      .prepare(
        "SELECT * FROM afp_private_preferences WHERE user_id=? AND firm_id=? AND feature_id=?",
      )
      .get(u.id, u.firm_id, PRESENTATION_FEATURE) as any;
  const check = (row: any, u: User) => {
    try {
      const m = JSON.parse(row.manifest);
      if (
        digest(m) !== row.digest ||
        m.extensionId !== PRESENTATION_FEATURE ||
        m.ownership.scope !== "Private" ||
        !textTabLabelSchema.safeParse(row.value).success
      )
        return {
          result: "Incompatible",
          reasons: ["preference_integrity_failed"],
        };
      return validateManifest(
        m,
        u,
        readControlPlane(db).policies,
        applicationVersion(),
        "use",
      );
    } catch {
      return {
        result: "Incompatible",
        reasons: ["preference_integrity_failed"],
      };
    }
  };
  return Object.freeze({
    read() {
      const u = actor();
      if (!u || u.role === "client")
        return { status: 403, body: { error: "Preference unavailable." } };
      const row = rowFor(u);
      const validation = row ? check(row, u) : null;
      const enabled =
        row?.state === "enabled" && validation?.result === "Compatible";
      return {
        status: 200,
        body: {
          textTabLabel: enabled ? row.value : DEFAULT_TEXT_LABEL,
          feature: row
            ? {
                id: PRESENTATION_FEATURE,
                owner: u.id,
                firmId: u.firm_id,
                scope: "Private",
                extensionPoint: "assistant-presentation",
                status: row.state,
                revision: row.revision,
                currentValue: row.value,
                effectiveValue: enabled ? row.value : DEFAULT_TEXT_LABEL,
                compatibility: validation?.result,
                reasons: validation?.reasons,
                manifest: JSON.parse(row.manifest),
                updated: row.updated,
                declarative: true,
                executable: false,
              }
            : null,
        },
      };
    },
    history() {
      const u = actor();
      if (!u || u.role === "client")
        return { status: 403, body: { error: "Preference unavailable." } };
      return {
        status: 200,
        body: db
          .prepare(
            "SELECT body FROM afp_preference_audit WHERE user_id=? AND firm_id=? ORDER BY rowid DESC LIMIT 100",
          )
          .all(u.id, u.firm_id)
          .map((r) => JSON.parse(String(r.body))),
      };
    },
    set(input: unknown, source: PreferenceSource) {
      const u = actor(),
        p = preferenceRequestSchema.safeParse(input);
      const previous = u ? rowFor(u) : null;
      const now = Date.now(),
        auditId = randomUUID();
      const oldValue = textTabLabelSchema.safeParse(previous?.value).success
        ? previous.value
        : null;
      const manifest = u
        ? presentationManifest(u, readControlPlane(db).policies)
        : null;
      const validation = validateManifest(
        manifest,
        u ?? null,
        readControlPlane(db).policies,
        applicationVersion(),
      );
      let reason =
        !u || u.role === "client"
          ? "actor_not_authorized"
          : !p.success
            ? "invalid_preference_request"
            : null;
      if (
        !["text coordinator", "voice coordinator", "settings"].includes(source)
      )
        reason = "invalid_source";
      // Removing a preference is always allowed for its owner, even after policy/version revocation.
      if (
        !reason &&
        p.success &&
        p.data.action === "set" &&
        validation.result !== "Compatible"
      )
        reason = validation.reasons.join(",");
      const newValue =
        p.success && p.data.action === "set" ? p.data.textTabLabel : null;
      const event = {
        action: p.success ? p.data.action : "unrecognized",
        schemaVersion: manifest?.schemaVersion ?? null,
        applicationVersion: applicationVersion(),
        featureVersion: manifest?.definitionVersion ?? null,
        requestedPermission: "assistant.presentation.private.write",
        compatibility: validation.result,
        id: auditId,
        actor: actorId,
        owner: u?.id ?? null,
        firmId: u?.firm_id ?? null,
        scope: "Private",
        featureId: PRESENTATION_FEATURE,
        preferenceId: "textTabLabel",
        oldValue,
        newValue: reason ? null : newValue,
        source: ["text coordinator", "voice coordinator", "settings"].includes(
          source,
        )
          ? source
          : "unrecognized",
        timestamp: now,
        result: reason ? "rejected" : "success",
        reason,
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!reason && p.success && u && manifest) {
          const state =
            p.data.action === "set"
              ? "enabled"
              : p.data.action === "disable"
                ? "disabled"
                : "removed";
          db.prepare(
            "INSERT INTO afp_private_preferences VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,firm_id,feature_id) DO UPDATE SET state=excluded.state,value=excluded.value,revision=excluded.revision,manifest=excluded.manifest,digest=excluded.digest,updated=excluded.updated",
          ).run(
            u.id,
            u.firm_id,
            PRESENTATION_FEATURE,
            state,
            newValue,
            (previous?.revision ?? 0) + 1,
            JSON.stringify(manifest),
            digest(manifest),
            now,
          );
        }
        db.prepare("INSERT INTO afp_preference_audit VALUES(?,?,?,?,?)").run(
          auditId,
          actorId,
          u?.firm_id ?? "",
          JSON.stringify(event),
          now,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return reason
        ? {
            status: !u || u.role === "client" ? 403 : 422,
            body: {
              error: "Private preference was not applied.",
              reasons: [reason],
              auditId,
            },
          }
        : {
            status: 200,
            body: {
              applied: true,
              textTabLabel: newValue ?? DEFAULT_TEXT_LABEL,
              featureId: PRESENTATION_FEATURE,
              auditId,
            },
          };
    },
  });
}
