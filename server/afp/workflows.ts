import { randomUUID } from "node:crypto";
import type { Store, User } from "../store";
import type { PreferenceSource } from "./presentation";
import {
  workflowCommandSchema,
  workflowRunSchema,
  workflowDefinitionSchema,
  WORKFLOW_CONTRACT,
} from "../../shared/afp-workflow";
import {
  workflowManifest,
  validateManifest,
  applicationVersion,
  digest,
} from "./manifest";
import { presentationPolicies } from "./lab";

export function ensureWorkflows(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS afp_workflow_features(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,firm_id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,active_version INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS afp_workflow_versions(feature_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,manifest TEXT NOT NULL,digest TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(feature_id,version));
    CREATE TABLE IF NOT EXISTS afp_workflow_runs(id TEXT PRIMARY KEY,feature_id TEXT NOT NULL,owner_id TEXT NOT NULL,firm_id TEXT NOT NULL,version INTEGER NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS afp_workflow_audit(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,firm_id TEXT NOT NULL,feature_id TEXT,body TEXT NOT NULL,created INTEGER NOT NULL);`);
}
/** Declarative interpreter. Never accepts code, callbacks, URLs, SQL, credentials or foreign identity. */
export function workflowCapability(db: Store, actorId: string) {
  const actor = () =>
    db
      .prepare("SELECT * FROM users WHERE id=? AND active=1 AND role!='client'")
      .get(actorId) as User | undefined;
  const owned = (id: string, u: User) =>
    db
      .prepare(
        "SELECT * FROM afp_workflow_features WHERE id=? AND owner_id=? AND firm_id=?",
      )
      .get(id, u.id, u.firm_id) as any;
  const versions = (id: string) =>
    db
      .prepare(
        "SELECT * FROM afp_workflow_versions WHERE feature_id=? ORDER BY version DESC",
      )
      .all(id) as any[];
  function audit(
    u: User | undefined,
    feature: string | null,
    action: string,
    result: string,
    detail: Record<string, unknown> = {},
  ) {
    // Do not log definitions, run titles, notes, conversation content or evidence.
    db.prepare("INSERT INTO afp_workflow_audit VALUES(?,?,?,?,?,?)").run(
      randomUUID(),
      actorId,
      u?.firm_id || "",
      feature,
      JSON.stringify({
        actor: actorId,
        scope: "Private",
        firmId: u?.firm_id || null,
        action,
        result,
        ...detail,
      }),
      Date.now(),
    );
  }
  function reject(reason: string, status = 422, source = "settings") {
    audit(actor(), null, "rejected", reason, { source });
    return { status, body: { error: reason, changed: false } };
  }
  function compatibility(v: any, u: User) {
    try {
      const m = JSON.parse(v.manifest),
        d = JSON.parse(v.definition);
      if (
        digest({ manifest: m, definition: d }) !== v.digest ||
        !workflowDefinitionSchema.safeParse(d).success
      )
        return {
          result: "Incompatible",
          reasons: ["package_integrity_failed"],
        };
      return validateManifest(
        m,
        u,
        presentationPolicies(db, u.id, "workflow"),
        applicationVersion(),
        "use",
      );
    } catch {
      return { result: "Incompatible", reasons: ["invalid_package"] };
    }
  }
  function listing() {
    const u = actor();
    if (!u) return reject("actor_not_authorized", 403);
    const features = db
      .prepare(
        "SELECT * FROM afp_workflow_features WHERE owner_id=? AND firm_id=? AND state!='removed' ORDER BY updated DESC LIMIT 50",
      )
      .all(u.id, u.firm_id)
      .map((f) => ({
        ...f,
        scope: "Private",
        contract: WORKFLOW_CONTRACT,
        versions: versions(String(f.id)).map((v) => ({
          ...v,
          definition: JSON.parse(v.definition),
          manifest: JSON.parse(v.manifest),
          compatibility: compatibility(v, u).result,
        })),
      }));
    const runs = db
      .prepare(
        "SELECT * FROM afp_workflow_runs WHERE owner_id=? AND firm_id=? ORDER BY updated DESC LIMIT 100",
      )
      .all(u.id, u.firm_id)
      .map((r) => ({ ...r, body: JSON.parse(String(r.body)) }));
    return { status: 200, body: { features, runs } };
  }
  return {
    list: listing,
    history() {
      const u = actor();
      if (!u) return reject("actor_not_authorized", 403);
      return {
        status: 200,
        body: db
          .prepare(
            "SELECT feature_id,body,created FROM afp_workflow_audit WHERE owner_id=? AND firm_id=? ORDER BY rowid DESC LIMIT 100",
          )
          .all(u.id, u.firm_id)
          .map((r) => ({ ...r, body: JSON.parse(String(r.body)) })),
      };
    },
    command(input: unknown, source: PreferenceSource) {
      const p = workflowCommandSchema.safeParse(input),
        u = actor();
      if (!u) return reject("actor_not_authorized", 403, source);
      if (!p.success) return reject("invalid_workflow_request", 422, source);
      const c = p.data;
      db.exec("BEGIN IMMEDIATE");
      try {
        const f = c.id ? owned(c.id, u) : null;
        if (c.id && !f) {
          db.exec("ROLLBACK");
          return reject("feature_unavailable", 404, source);
        }
        if ((f?.revision || 0) !== c.revision || f?.state === "removed") {
          db.exec("ROLLBACK");
          return reject("stale_feature_revision", 409, source);
        }
        const now = Date.now(),
          id = f?.id || randomUUID(),
          revision = c.revision + 1;
        let state = f?.state || "preview",
          active = f?.active_version ?? null,
          version: number | undefined;
        if (c.action === "draft") {
          if (
            !f &&
            Number(
              db
                .prepare(
                  "SELECT count(*) n FROM afp_workflow_features WHERE owner_id=? AND firm_id=? AND state!='removed'",
                )
                .get(u.id, u.firm_id)?.n,
            ) >= 50
          ) {
            db.exec("ROLLBACK");
            return reject("feature_capacity_reached", 422, source);
          }
          version = Number(versions(id)[0]?.version || 0) + 1;
          const manifest = workflowManifest(
            u,
            presentationPolicies(db, u.id, "workflow"),
            id,
            version,
          );
          const v = validateManifest(
            manifest,
            u,
            presentationPolicies(db, u.id, "workflow"),
            applicationVersion(),
          );
          if (v.result !== "Compatible") {
            db.exec("ROLLBACK");
            return reject(v.reasons.join(","), 403, source);
          }
          db.prepare(
            "INSERT INTO afp_workflow_versions VALUES(?,?,?,?,?,?)",
          ).run(
            id,
            version,
            JSON.stringify(c.definition),
            JSON.stringify(manifest),
            digest({ manifest, definition: c.definition }),
            now,
          );
          if (active === null) state = "preview";
        } else if (c.action === "activate" || c.action === "rollback") {
          version = c.version;
          const v = versions(id).find((v) => v.version === version);
          if (!v) {
            db.exec("ROLLBACK");
            return reject("version_required_or_unavailable", 422, source);
          }
          const checked = compatibility(v, u);
          if (checked.result !== "Compatible") {
            db.exec("ROLLBACK");
            return reject(checked.reasons.join(","), 403, source);
          }
          state = "active";
          active = version;
        } else {
          state = c.action === "remove" ? "removed" : "disabled";
        }
        db.prepare(
          "INSERT INTO afp_workflow_features VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state,active_version=excluded.active_version,updated=excluded.updated",
        ).run(
          id,
          u.id,
          u.firm_id,
          revision,
          state,
          active,
          f?.created || now,
          now,
        );
        audit(u, id, c.action, "success", {
          source,
          revision,
          version: version ?? null,
          oldState: f?.state ?? null,
          state,
          oldActiveVersion: f?.active_version ?? null,
          activeVersion: active,
          applicationVersion: applicationVersion(),
        });
        db.exec("COMMIT");
        return {
          status: 200,
          body: {
            id,
            revision,
            state,
            version,
            activeVersion: active,
            scope: "Private",
            changed: true,
            message:
              c.action === "draft"
                ? "Private preview saved. The active version has not changed."
                : state === "active"
                  ? "Private workflow updated. Other accounts and the shared application are unchanged."
                  : "Private workflow disabled or removed. History is retained.",
          },
        };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    run(input: unknown, source: PreferenceSource) {
      const u = actor(),
        p = workflowRunSchema.safeParse(input);
      if (!u) return reject("actor_not_authorized", 403, source);
      if (!p.success) return reject("invalid_run_request", 422, source);
      const c = p.data;
      db.exec("BEGIN IMMEDIATE");
      try {
        const old =
          c.action === "update"
            ? db
                .prepare(
                  "SELECT * FROM afp_workflow_runs WHERE id=? AND owner_id=? AND firm_id=?",
                )
                .get(c.id, u.id, u.firm_id)
            : null;
        if (c.action === "update" && (!old || old.revision !== c.revision)) {
          db.exec("ROLLBACK");
          return reject("run_unavailable_or_stale", 409, source);
        }
        const f = owned(
          c.action === "start" ? c.featureId : String(old!.feature_id),
          u,
        );
        if (!f || f.state !== "active") {
          db.exec("ROLLBACK");
          return reject("feature_not_active", 409, source);
        }
        const version = c.action === "start" ? f.active_version : old!.version;
        const v = versions(f.id).find((v) => v.version === version);
        if (!v || compatibility(v, u).result !== "Compatible") {
          db.exec("ROLLBACK");
          return reject("feature_requires_review", 403, source);
        }
        const d = workflowDefinitionSchema.parse(JSON.parse(v.definition));
        const completed = c.action === "update" ? c.completed : [];
        if (
          new Set(completed).size !== completed.length ||
          completed.some(
            (id) => !d.stages.some((s) => s.items.some((i) => i.id === id)),
          )
        ) {
          db.exec("ROLLBACK");
          return reject("unknown_checklist_item", 422, source);
        }
        const firstIncomplete = d.stages.findIndex((s) =>
          s.items.some((i) => i.required && !completed.includes(i.id)),
        );
        const body = {
          title:
            c.action === "start"
              ? c.title
              : JSON.parse(String(old!.body)).title,
          completed,
          notes: c.action === "update" ? c.notes : "",
          stage:
            firstIncomplete === -1 ? "complete" : d.stages[firstIncomplete].id,
        };
        const id = c.action === "start" ? randomUUID() : c.id,
          now = Date.now(),
          revision = Number(old?.revision || 0) + 1;
        db.prepare(
          "INSERT INTO afp_workflow_runs VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body,updated=excluded.updated",
        ).run(
          id,
          f.id,
          u.id,
          u.firm_id,
          version,
          revision,
          JSON.stringify(body),
          old?.created || now,
          now,
        );
        audit(u, f.id, "run-" + c.action, "success", {
          source,
          runId: id,
          revision,
          version,
        });
        db.exec("COMMIT");
        return { status: 200, body: { id, revision, version, ...body } };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
