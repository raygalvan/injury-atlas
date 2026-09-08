import {
  AFP_SCHEMA,
  AFP_VERSION,
  RENDERING_CONTRACT,
} from "../../shared/afp-manifest";
import { manifestTemplate } from "./manifest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type express from "express";
import { audit, type Store } from "../store";
import { AiError } from "../ai/error";
import {
  readinessStatuses,
  policyLevels,
  type ReadinessItem,
  type AfpPolicy,
  type AfpControlPlane,
} from "../../shared/afp";
import { afpReadiness, deriveReadiness } from "./readiness";
import { extensionPoints } from "./extension-points";
import { afpPolicies } from "./policy";
import { afpResources } from "./resources";
import { ensureFeatures, listFeatures, validateFeature } from "./features";
export function ensureControlPlane(db: Store) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS afp_readiness(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS afp_policies(id TEXT PRIMARY KEY,body TEXT NOT NULL)",
  );
  ensureFeatures(db);
}
function baseVersion(): string | null {
  try {
    const v = JSON.parse(readFileSync("dist/release.json", "utf8")).commit;
    return /^[a-f0-9]{40}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
export function readControlPlane(db: Store): AfpControlPlane {
  const readiness = afpReadiness.map((def) => {
    const row = db
      .prepare("SELECT body FROM afp_readiness WHERE id=?")
      .get(def.id);
    if (!row) return { ...def };
    const saved = JSON.parse(String(row.body));
    // Release definitions retain descriptions, dependencies and implementation ceilings.
    const status =
      readinessStatuses.indexOf(saved.status) <=
      readinessStatuses.indexOf(def.ceiling)
        ? saved.status
        : def.status;
    return {
      ...def,
      ...saved,
      status,
      ceiling: def.ceiling,
      description: def.description,
      dependencies: def.dependencies,
    } as ReadinessItem;
  });
  const policies = afpPolicies.map((def) => {
    const row = db
      .prepare("SELECT body FROM afp_policies WHERE id=?")
      .get(def.id);
    return {
      ...def,
      ...(row ? JSON.parse(String(row.body)) : {}),
      ...(def.locked ? { level: "Protected", locked: true } : {}),
    } as AfpPolicy;
  });
  return {
    schemaVersion: "injury.bot.afp-control-plane/1",
    manifestSchemaVersion: AFP_SCHEMA,
    sdkBoundary: {
      version: AFP_VERSION,
      contract: RENDERING_CONTRACT,
      implemented: true,
      executable: false,
    },
    application: {
      name: "injury.bot",
      role: "Reference Implementation / Pilot",
      architecture: "Base Application + Isolated Extensions",
      architectureStatus: "Target architecture",
      baseVersion: baseVersion(),
    },
    readiness,
    extensionPoints,
    policies,
    resources: afpResources(),
    features: listFeatures(db),
    featureCount: Number(
      db.prepare("SELECT count(*) n FROM afp_features").get()!.n,
    ),
    overall: deriveReadiness(readiness),
    protectedBoundaries: {
      policyLocked: policies
        .filter((p) => p.locked)
        .every((p) => p.level === "Protected"),
      label:
        "Core policies locked; recipe-inspection SDK permissions enforced; arbitrary execution unavailable",
    },
    externalResources: {
      provisionable: false,
      label: "Existing app adapters only · AFP resource provisioning planned",
    },
    runtime: {
      mcpConnected: false,
      sdkConnected: false,
      dynamicAttachment: false,
      provisioning: false,
    },
  };
}
function saveHistory(db: Store, target: string, body: unknown, actor: string) {
  db.prepare("INSERT INTO afp_history VALUES(?,?,?,?,?)").run(
    randomUUID(),
    target,
    JSON.stringify(body),
    actor,
    Date.now(),
  );
}
export function controlPlaneRoutes(
  app: express.Express,
  db: Store,
  staff: express.RequestHandler,
  admin: express.RequestHandler,
) {
  app.get("/api/settings/afp/control-plane", staff, admin, (_req, res) =>
    res.set("Cache-Control", "no-store").json(readControlPlane(db)),
  );
  app.get("/api/settings/afp/manifest", staff, admin, (_req, res) =>
    res
      .set("Cache-Control", "no-store")
      .attachment("afp.manifest.v0.1.json")
      .json(manifestTemplate(res.locals.user, readControlPlane(db).policies)),
  );
  app.post("/api/settings/afp/readiness/:id", staff, admin, (req, res) => {
    const v = z
      .object({
        status: z.enum(readinessStatuses),
        evidence: z.string().trim().max(4000),
        nextStep: z.string().trim().min(1).max(4000),
        revision: z.number().int().positive(),
      })
      .parse(req.body);
    const current = readControlPlane(db).readiness.find(
      (r) => r.id === req.params.id,
    );
    if (!current)
      return res.status(404).json({ error: "Unknown readiness item." });
    if (v.revision !== current.revision)
      return res
        .status(409)
        .json({ error: "Readiness changed. Refresh before saving." });
    if (
      readinessStatuses.indexOf(v.status) >
      readinessStatuses.indexOf(current.ceiling)
    )
      throw new AiError(
        "This release does not implement that capability at the requested level. Record a recommendation in Memory & Decisions instead.",
      );
    if (v.status !== "Planned" && !v.evidence)
      throw new AiError("Add an implementation reference for this status.");
    const verification =
      v.status === "Verified"
        ? {
            at: Date.now(),
            by: res.locals.user.id,
            reference: v.evidence,
            release: baseVersion(),
          }
        : current.lastVerified;
    const record = {
      ...v,
      revision: current.revision + 1,
      lastVerified: verification,
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO afp_readiness VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      ).run(current.id, JSON.stringify(record));
      saveHistory(db, "readiness:" + current.id, record, res.locals.user.id);
      audit(db, res.locals.user.id, "afp.readiness-updated");
      db.exec("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.post("/api/settings/afp/policies/:id", staff, admin, (req, res) => {
    const v = z
      .object({
        level: z.enum(policyLevels),
        revision: z.number().int().positive(),
      })
      .parse(req.body);
    const current = readControlPlane(db).policies.find(
      (p) => p.id === req.params.id,
    );
    if (!current)
      return res.status(404).json({ error: "Unknown customization policy." });
    if (v.revision !== current.revision)
      return res
        .status(409)
        .json({ error: "Policy changed. Refresh before saving." });
    if (current.locked && v.level !== "Protected")
      throw new AiError(
        "This core boundary is protected and cannot be relaxed by AFP settings.",
      );
    const record = { level: v.level, revision: current.revision + 1 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO afp_policies VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      ).run(current.id, JSON.stringify(record));
      saveHistory(db, "policy:" + current.id, record, res.locals.user.id);
      audit(db, res.locals.user.id, "afp.policy-updated");
      db.exec("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.post("/api/settings/afp/features", staff, admin, (req, res) => {
    const feature = validateFeature(db, req.body, res.locals.user);
    if (db.prepare("SELECT id FROM afp_features WHERE id=?").get(feature.id))
      return res.status(409).json({ error: "That feature ID already exists." });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO afp_features VALUES(?,?,?,?,?)").run(
        feature.id,
        JSON.stringify(feature),
        feature.revision,
        feature.created,
        feature.updated,
      );
      saveHistory(db, "feature:" + feature.id, feature, res.locals.user.id);
      audit(db, res.locals.user.id, "afp.feature-registered");
      db.exec("COMMIT");
      res.status(201).json(feature);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.post("/api/settings/afp/features/:id", staff, admin, (req, res) => {
    const row = db
      .prepare("SELECT body,revision FROM afp_features WHERE id=?")
      .get(String(req.params.id));
    if (!row) return res.status(404).json({ error: "Feature unavailable." });
    if (z.number().int().positive().parse(req.body.revision) !== row.revision)
      return res
        .status(409)
        .json({ error: "Feature changed. Refresh before saving." });
    const feature = validateFeature(
      db,
      req.body,
      res.locals.user,
      JSON.parse(String(row.body)),
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE afp_features SET body=?,revision=?,updated=? WHERE id=?",
      ).run(
        JSON.stringify(feature),
        feature.revision,
        feature.updated,
        feature.id,
      );
      saveHistory(db, "feature:" + feature.id, feature, res.locals.user.id);
      audit(db, res.locals.user.id, "afp.feature-updated");
      db.exec("COMMIT");
      res.json(feature);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
}
