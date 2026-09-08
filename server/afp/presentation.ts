import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store, User } from "../store";
import {
  applicationVersion,
  digest,
  presentationManifest,
  atlasPresentationManifest,
  validateManifest,
} from "./manifest";
import { presentationPolicies, permissionDecision } from "./lab";
import { colorTokens } from "../../shared/afp-lab";
import {
  DEFAULT_TEXT_LABEL,
  PRESENTATION_FEATURE,
  ATLAS_PRESENTATION_FEATURE,
  preferenceRequestSchema,
  atlasPreferenceRequestSchema,
  textTabLabelSchema,
} from "../../shared/afp-manifest";
export type PreferenceSource =
  "text coordinator" | "voice coordinator" | "settings";
export function ensurePresentation(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS afp_private_preferences(user_id TEXT NOT NULL,firm_id TEXT NOT NULL,feature_id TEXT NOT NULL,state TEXT NOT NULL,value TEXT,revision INTEGER NOT NULL,manifest TEXT NOT NULL,digest TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user_id,firm_id,feature_id));
 CREATE TABLE IF NOT EXISTS afp_preference_audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,firm_id TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL);`);
}
const definitions = {
  labels: {
    id: PRESENTATION_FEATURE,
    point: "assistant-presentation",
    key: "textTabLabel",
    fallback: DEFAULT_TEXT_LABEL,
    schema: textTabLabelSchema,
    request: preferenceRequestSchema,
    manifest: presentationManifest,
  },
  styling: {
    id: ATLAS_PRESENTATION_FEATURE,
    point: "atlas-presentation",
    key: "selectInjuriesColor",
    fallback: "default",
    schema: z.enum(colorTokens),
    request: atlasPreferenceRequestSchema,
    manifest: atlasPresentationManifest,
  },
};
export function presentationCapability(db: Store, actorId: string) {
  const actor = () =>
    db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(actorId) as
      User | undefined;
  const rowFor = (u: User, id: string) =>
    db
      .prepare(
        "SELECT * FROM afp_private_preferences WHERE user_id=? AND firm_id=? AND feature_id=?",
      )
      .get(u.id, u.firm_id, id) as any;
  function describe(u: User, category: keyof typeof definitions) {
    const d = definitions[category],
      row = rowFor(u, d.id);
    if (!row) return { value: d.fallback, feature: null };
    let manifest: any = null,
      validation: { result: string; reasons: string[] } = {
        result: "Incompatible",
        reasons: ["preference_integrity_failed"],
      };
    try {
      manifest = JSON.parse(row.manifest);
      if (
        digest(manifest) === row.digest &&
        manifest.extensionId === d.id &&
        manifest.extensionPoints[0].id === d.point &&
        manifest.ownership.scope === "Private" &&
        (row.state !== "enabled" || d.schema.safeParse(row.value).success)
      )
        validation = validateManifest(
          manifest,
          u,
          presentationPolicies(db, actorId, category),
          applicationVersion(),
          "use",
        );
    } catch {}
    const value =
      row.state === "enabled" && validation.result === "Compatible"
        ? row.value
        : d.fallback;
    return {
      value,
      feature: {
        id: d.id,
        owner: u.id,
        firmId: u.firm_id,
        scope: "Private",
        extensionPoint: d.point,
        status: row.state,
        revision: row.revision,
        currentValue: row.value,
        effectiveValue: value,
        compatibility: validation.result,
        reasons: validation.reasons,
        manifest,
        updated: row.updated,
        declarative: true,
        executable: false,
      },
    };
  }
  function change(
    input: unknown,
    source: PreferenceSource,
    category: keyof typeof definitions,
  ) {
    const d = definitions[category],
      u = actor(),
      p = d.request.safeParse(input),
      previous = u ? rowFor(u, d.id) : null;
    const permission = permissionDecision(db, actorId, category),
      now = Date.now(),
      auditId = randomUUID();
    const manifest = u
      ? d.manifest(u, presentationPolicies(db, actorId, category))
      : null;
    const validation = validateManifest(
      manifest,
      u ?? null,
      presentationPolicies(db, actorId, category),
      applicationVersion(),
    );
    let reason =
      !u || u.role === "client"
        ? "actor_not_authorized"
        : !p.success
          ? "invalid_preference_request"
          : null;
    if (!["text coordinator", "voice coordinator", "settings"].includes(source))
      reason = "invalid_source";
    if (
      !reason &&
      p.success &&
      p.data.action === "set" &&
      validation.result !== "Compatible"
    )
      reason = validation.reasons.join(",");
    const oldValue = d.schema.safeParse(previous?.value).success
      ? previous.value
      : null;
    const newValue =
      p.success && p.data.action === "set" ? (p.data as any)[d.key] : null;
    const state = p.success
      ? p.data.action === "set"
        ? "enabled"
        : p.data.action === "disable"
          ? "disabled"
          : "removed"
      : (previous?.state ?? null);
    const event = {
      id: auditId,
      actor: actorId,
      owner: u?.id ?? null,
      firmId: u?.firm_id ?? null,
      scope: "Private",
      featureId: d.id,
      extensionPoint: d.point,
      preferenceId: d.key,
      action: p.success ? p.data.action : "unrecognized",
      oldState: previous?.state ?? null,
      newState: reason ? (previous?.state ?? null) : state,
      oldValue,
      newValue: reason ? null : newValue,
      source: ["text coordinator", "voice coordinator", "settings"].includes(
        source,
      )
        ? source
        : "unrecognized",
      timestamp: now,
      permission,
      labAuthorized:
        !reason &&
        p.success &&
        p.data.action === "set" &&
        permission.labAuthorized,
      preset: permission.preset,
      result: reason ? "rejected" : "success",
      reason,
      schemaVersion: manifest?.schemaVersion ?? null,
      applicationVersion: applicationVersion(),
      featureVersion: manifest?.definitionVersion ?? null,
      requestedPermission: manifest?.requestedPermissions[0] ?? null,
      compatibility: validation.result,
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!reason && p.success && u && manifest)
        db.prepare(
          "INSERT INTO afp_private_preferences VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,firm_id,feature_id) DO UPDATE SET state=excluded.state,value=excluded.value,revision=excluded.revision,manifest=excluded.manifest,digest=excluded.digest,updated=excluded.updated",
        ).run(
          u.id,
          u.firm_id,
          d.id,
          state,
          newValue,
          (previous?.revision ?? 0) + 1,
          JSON.stringify(manifest),
          digest(manifest),
          now,
        );
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
            applied: false,
            outcome:
              reason === "invalid_preference_request"
                ? "Invalid Request"
                : "Not Authorized",
            error: "Private preference was not applied.",
            reasons: [reason],
            auditId,
          },
        }
      : {
          status: 200,
          body: {
            applied: true,
            outcome: "Applied",
            [d.key]: newValue ?? d.fallback,
            featureId: d.id,
            auditId,
          },
        };
  }
  return Object.freeze({
    read() {
      const u = actor();
      if (!u || u.role === "client")
        return { status: 403, body: { error: "Preference unavailable." } };
      const label = describe(u, "labels"),
        style = describe(u, "styling");
      return {
        status: 200,
        body: {
          textTabLabel: label.value,
          selectInjuriesColor: style.value,
          feature: label.feature,
          features: [label.feature, style.feature].filter(Boolean),
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
    set: (input: unknown, source: PreferenceSource) =>
      change(input, source, "labels"),
    setAtlas: (input: unknown, source: PreferenceSource) =>
      change(input, source, "styling"),
  });
}
