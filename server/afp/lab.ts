import { randomUUID } from "node:crypto";
import { z } from "zod";
import type express from "express";
import type { Store, User } from "../store";
import {
  labCategories,
  permissionLevels,
  presets,
  presetLevel,
  type PermissionPreset,
  type PermissionLevel,
} from "../../shared/afp-lab";
import { readControlPlane } from "./control-plane";
export function ensureLab(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS afp_lab_settings(user_id TEXT NOT NULL,firm_id TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user_id,firm_id));
 CREATE TABLE IF NOT EXISTS afp_lab_audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,firm_id TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL);`);
}
function currentUser(db: Store, id: string) {
  return db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(id) as
    User | undefined;
}
export function mayManageLab(db: Store, u: User | undefined) {
  return (
    !!u &&
    u.role !== "client" &&
    (u.role === "owner" ||
      !!db
        .prepare("SELECT user_id FROM platform_admins WHERE user_id=?")
        .get(u.id))
  );
}
export function labState(db: Store, id: string) {
  const u = currentUser(db, id),
    row =
      u &&
      db
        .prepare("SELECT * FROM afp_lab_settings WHERE user_id=? AND firm_id=?")
        .get(id, u.firm_id);
  const saved = row
    ? JSON.parse(String(row.body))
    : {
        enabled: false,
        normalPreset: "Standard",
        overrides: {},
        labOverrides: {},
      };
  const enabled = mayManageLab(db, u) && saved.enabled === true;
  const preset: PermissionPreset = enabled ? "Lab" : saved.normalPreset;
  const overrides = enabled ? saved.labOverrides : saved.overrides;
  const policies = readControlPlane(db).policies;
  const effectiveCategories = labCategories.map((c) => {
    let level: PermissionLevel = c.locked
      ? "Blocked"
      : (overrides[c.id] ?? presetLevel(preset, c.id));
    const policyId = (
      {
        labels: "assistant-presentation",
        styling: "atlas-presentation",
        workflow: "private-workspace",
        "rendering-preflight": "rendering-preflight",
      } as Record<string, string>
    )[c.id];
    const global = policyId ? policies.find((p) => p.id === policyId) : null;
    if (global?.level === "Protected") level = "Blocked";
    if (
      global?.level === "Approval Required" &&
      !enabled &&
      level !== "Blocked"
    )
      level = "Require Approval";
    return { ...c, level, hostRestriction: global?.level === "Protected" };
  });
  return {
    enabled,
    preset,
    normalPreset: saved.normalPreset,
    revision: Number(row?.revision ?? 0),
    manageable: mayManageLab(db, u),
    categories: effectiveCategories,
    saved,
  };
}
export function permissionDecision(db: Store, id: string, category: string) {
  const u = currentUser(db, id),
    state = labState(db, id),
    c = state.categories.find((c) => c.id === category);
  const level: PermissionLevel =
    !u || u.role === "client" || !c || c.locked ? "Blocked" : c.level;
  return {
    category,
    level,
    preset: state.preset,
    labMode: state.enabled,
    labAuthorized:
      state.enabled && c?.risk === "private" && level === "Allow Automatically",
    implemented: !!c?.implemented,
    outcome:
      !u || u.role === "client" || level !== "Allow Automatically"
        ? "Not Authorized"
        : !c?.implemented
          ? "Not Implemented"
          : "Available",
  };
}
/** Apply only scoped allowlisted policy decisions; a global Protected rule still wins. */
export function presentationPolicies(
  db: Store,
  id: string,
  category: "labels" | "styling" | "rendering-preflight" | "workflow",
) {
  const decisions = [category].map((c) => permissionDecision(db, id, c));
  const level = decisions.some((d) => d.level === "Blocked")
    ? "Protected"
    : decisions.some((d) => d.level === "Require Approval")
      ? "Approval Required"
      : "Allowed";
  return readControlPlane(db).policies.map((p) =>
    p.id ===
      (category === "labels"
        ? "assistant-presentation"
        : category === "styling"
          ? "atlas-presentation"
          : category === "workflow" ? "private-workspace"
          : "rendering-preflight") && p.level !== "Protected"
      ? { ...p, level: level as typeof p.level }
      : p,
  );
}
const patchSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("toggle"),
    enabled: z.boolean(),
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    action: z.literal("preset"),
    preset: z.enum(presets),
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    action: z.literal("category"),
    category: z.string().max(50),
    level: z.enum(permissionLevels),
    revision: z.number().int().nonnegative(),
  }),
]);
export function labRoutes(
  app: express.Express,
  db: Store,
  staff: express.RequestHandler,
) {
  app.get("/api/afp/lab", staff, (_req, res) => {
    const s = labState(db, res.locals.user.id);
    const { saved, ...publicState } = s;
    res.set("Cache-Control", "no-store").json(publicState);
  });
  app.get("/api/afp/lab/history", staff, (_req, res) => {
    const u = res.locals.user as User;
    res.set("Cache-Control", "no-store").json(
      db
        .prepare(
          "SELECT body FROM afp_lab_audit WHERE user_id=? AND firm_id=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(u.id, u.firm_id)
        .map((r) => JSON.parse(String(r.body))),
    );
  });
  app.post("/api/afp/lab", staff, (req, res) => {
    const u = currentUser(db, res.locals.user.id),
      p = patchSchema.safeParse(req.body);
    if (!mayManageLab(db, u)) {
      if (u) {
        const state = labState(db, u.id).saved, now = Date.now();
        db.prepare("INSERT INTO afp_lab_audit VALUES(?,?,?,?,?)").run(
          randomUUID(), u.id, u.firm_id,
          JSON.stringify({ actor: u.id, firmId: u.firm_id, scope: "Private", source: "settings", timestamp: now, oldState: state, newState: state, result: "rejected", reason: "not_authorized" }), now,
        );
      }
      return res.status(403).json({ error: "Only an authenticated owner or super admin may manage private AFP Lab permissions." });
    }
    const old = labState(db, u!.id),
      now = Date.now(),
      id = randomUUID();
    const category =
      p.success && p.data.action === "category"
        ? labCategories.find((c) => c.id === (p.data as any).category)
        : null;
    const reason = !p.success
      ? "invalid_request"
      : p.data.revision !== old.revision
        ? "stale_revision"
        : p.data.action === "category" && (!category || category.locked)
          ? "protected_category"
          : null;
    const next = structuredClone(old.saved);
    if (!reason && p.success) {
      if (p.data.action === "toggle") next.enabled = p.data.enabled;
      if (p.data.action === "preset") {
        next.enabled = p.data.preset === "Lab";
        if (next.enabled) next.labOverrides = {};
        else {
          next.normalPreset = p.data.preset;
          next.overrides = {};
        }
      }
      if (p.data.action === "category")
        (old.enabled ? next.labOverrides : next.overrides)[p.data.category] =
          p.data.level;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!reason)
        db.prepare(
          "INSERT INTO afp_lab_settings VALUES(?,?,?,?,?) ON CONFLICT(user_id,firm_id) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated=excluded.updated",
        ).run(u!.id, u!.firm_id, JSON.stringify(next), old.revision + 1, now);
      db.prepare("INSERT INTO afp_lab_audit VALUES(?,?,?,?,?)").run(
        id,
        u!.id,
        u!.firm_id,
        JSON.stringify({
          actor: u!.id,
          firmId: u!.firm_id,
          scope: "Private",
          source: "settings",
          timestamp: now,
          oldState: old.saved,
          newState: reason ? old.saved : next,
          result: reason ? "rejected" : "success",
          reason,
        }),
        now,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res
      .status(reason === "stale_revision" ? 409 : reason ? 422 : 200)
      .json(reason ? { error: reason } : { saved: true });
  });
}
