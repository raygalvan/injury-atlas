import {
  ensureLab,
  labRoutes,
  presentationPolicies,
  permissionDecision,
} from "./lab";
import { ensureWorkflows, workflowCapability } from "./workflows";
import {
  ensurePresentation,
  presentationCapability,
  type PreferenceSource,
} from "./presentation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type express from "express";
import type { Store, User } from "../store";
import { recipeSchema } from "../rendering/recipe";
import { readControlPlane } from "./control-plane";
import {
  applicationVersion,
  digest,
  manifestTemplate,
  presentationManifest,
  manifestJsonSchema,
  validateManifest,
} from "./manifest";
import {
  AFP_SCHEMA,
  AFP_VERSION,
  RENDERING_CONTRACT,
  PRESENTATION_CONTRACT,
  preferenceRequestSchema,
  preflightRequestSchema,
  preflightResponseSchema,
  type AfpManifest,
  type ManifestRecord,
} from "../../shared/afp-manifest";
export function ensureSdk(db: Store) {
  ensureLab(db);
  ensurePresentation(db);
  ensureWorkflows(db);
  db.exec(`CREATE TABLE IF NOT EXISTS afp_manifests(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,firm_id TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS afp_sdk_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,manifest_id TEXT,body TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS afp_manifest_revisions(manifest_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,actor TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(manifest_id,revision));`);
}
const useRequest = z.strictObject({
  manifestId: z.string().uuid(),
  revision: z.number().int().positive(),
  request: preflightRequestSchema,
});
const saveRequest = z.strictObject({
  id: z.string().uuid().optional(),
  revision: z.number().int().nonnegative(),
  manifest: z.unknown(),
});
/** Trusted host construction only. No extension code, callbacks, paths, SQL or URLs are accepted. */
export function createAfpSdk(db: Store, actorId: string) {
  const actor = () =>
    db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(actorId) as
      User | undefined;
  const permitted = (u: User | undefined) => !!u && u.role !== "client";
  const record = (row: any): ManifestRecord => ({
    id: row.id,
    revision: row.revision,
    manifest: JSON.parse(row.body),
    digest: row.digest,
    created: row.created,
    updated: row.updated,
  });
  const owned = (row: any, u: User) =>
    row.firm_id === u.firm_id &&
    (row.scope === "Firm" || row.owner_id === u.id);
  function log(
    action: string,
    input: unknown,
    result: string,
    reasons: string[],
    manifestId: string | null = null,
    m?: AfpManifest | null,
  ) {
    const id = randomUUID();
    // Never retain input, recipe, parser messages, client identifiers or credentials.
    const body = {
      action,
      extensionPoint: m?.extensionPoints[0].id ?? null,
      extensionId: m?.extensionId ?? null,
      schemaVersion: m?.schemaVersion ?? "unrecognized",
      definitionVersion: m?.definitionVersion ?? null,
      applicationVersion: applicationVersion(),
      owner: m?.ownership.ownerId ?? null,
      scope: m?.ownership.scope ?? null,
      permissions:
        m?.requestedPermissions ??
        (Array.isArray((input as any)?.requestedPermissions)
          ? (input as any).requestedPermissions
              .slice(0, 10)
              .map((p: unknown) =>
                [
                  "rendering.recipe.inspect",
                  "authentication.change",
                  "tenant.override",
                  "evidence.write",
                  "audit.disable",
                  "database.query",
                  "shell.execute",
                  "filesystem.read",
                ].includes(String(p))
                  ? p
                  : "unrecognized",
              )
          : []),
      manifestDigest: digest(input),
      result,
      reasons,
      actor: actorId,
      time: Date.now(),
    };
    db.prepare("INSERT INTO afp_sdk_audit VALUES(?,?,?,?,?)").run(
      id,
      actorId,
      manifestId,
      JSON.stringify(body),
      body.time,
    );
    return id;
  }
  function evaluate(
    input: unknown,
    operation: "manage" | "use" = "manage",
    manifestId: string | null = null,
  ) {
    const v = validateManifest(
      input,
      actor() ?? null,
      (input as any)?.extensionPoints?.[0]?.id === "assistant-presentation"
        ? presentationPolicies(db, actorId, "labels")
        : (input as any)?.extensionPoints?.[0]?.id === "atlas-presentation"
          ? presentationPolicies(db, actorId, "styling")
          : (input as any)?.extensionPoints?.[0]?.id === "private-workspace" ? presentationPolicies(db, actorId, "workflow")
          : presentationPolicies(db, actorId, "rendering-preflight"),
      applicationVersion(),
      operation,
    );
    // Audit only parsed manifests; malformed payloads retain a digest and fixed reason codes.
    const auditId = log(
      "manifest-evaluated",
      input,
      v.result,
      v.reasons,
      manifestId,
      v.manifest,
    );
    return {
      ...v,
      auditId,
      applicationVersion: applicationVersion(),
      manifestDigest: digest(input),
      executable: false as const,
    };
  }
  function rejected(
    action: string,
    input: unknown,
    reason: string,
    status = 400,
  ) {
    const reference = z
      .string()
      .uuid()
      .safeParse((input as any)?.manifestId ?? (input as any)?.id);
    const auditId = log(
      action,
      input,
      "Incompatible",
      [reason],
      reference.success ? reference.data : null,
    );
    return {
      status,
      body: {
        result: "Incompatible",
        reasons: [reason],
        auditId,
        executable: false,
      },
    };
  }
  return Object.freeze({
    listPrivateWorkflows() {return workflowCapability(db,actorId).list();},
    privateWorkflowHistory() {return workflowCapability(db,actorId).history();},
    managePrivateWorkflow(input: unknown, source: PreferenceSource) {return workflowCapability(db,actorId).command(input,source);},
    usePrivateWorkflow(input: unknown, source: PreferenceSource) {return workflowCapability(db,actorId).run(input,source);},
    inspectPrivateCapability(category: string) {
      return permissionDecision(db, actorId, category);
    },
    setPrivateAtlasPresentation(input: unknown, source: PreferenceSource) {
      return presentationCapability(db, actorId).setAtlas(input, source);
    },
    readPrivatePresentation() {
      return presentationCapability(db, actorId).read();
    },
    privatePresentationHistory() {
      return presentationCapability(db, actorId).history();
    },
    setPrivatePresentation(input: unknown, source: PreferenceSource) {
      return presentationCapability(db, actorId).set(input, source);
    },
    describe() {
      const u = actor();
      if (!permitted(u))
        return rejected("describe", null, "actor_not_authorized", 403);
      return {
        status: 200,
        body: {
          schemaVersion: AFP_SCHEMA,
          sdkVersion: AFP_VERSION,
          contract: RENDERING_CONTRACT,
          experimental: true,
          activationAvailable: false,
          privateDeclarativeWorkflow: {contract:"injury.bot.private-workflow/0.1",preview:true,privateActivation:true,executableCode:false},
          template: manifestTemplate(u!, readControlPlane(db).policies),
          presentation: {
            contract: PRESENTATION_CONTRACT,
            template: presentationManifest(u!, readControlPlane(db).policies),
            requestSchema: z.toJSONSchema(preferenceRequestSchema),
          },
          jsonSchema: manifestJsonSchema,
          requestSchema: z.toJSONSchema(useRequest),
          responseSchema: z.toJSONSchema(preflightResponseSchema),
        },
      };
    },
    evaluateManifest(input: unknown) {
      const v = evaluate(input);
      const { manifest, ...body } = v;
      return { status: 200, body };
    },
    listManifests() {
      const u = actor();
      if (!permitted(u))
        return rejected("list", null, "actor_not_authorized", 403);
      return {
        status: 200,
        body: db
          .prepare(
            "SELECT * FROM afp_manifests WHERE firm_id=? AND (scope='Firm' OR owner_id=?) ORDER BY updated DESC LIMIT 100",
          )
          .all(u!.firm_id, u!.id)
          .map(record),
      };
    },
    auditHistory() {
      const u = actor();
      if (!permitted(u))
        return rejected("audit-read", null, "actor_not_authorized", 403);
      return {
        status: 200,
        body: db
          .prepare(
            "SELECT id,body,created FROM afp_sdk_audit WHERE actor=? ORDER BY rowid DESC LIMIT 100",
          )
          .all(actorId)
          .map((r) => ({ ...r, body: JSON.parse(String(r.body)) })),
      };
    },
    saveManifest(input: unknown) {
      const p = saveRequest.safeParse(input);
      if (!p.success) return rejected("save", input, "invalid_save_request");
      const v = evaluate(p.data.manifest);
      if (v.result !== "Compatible" || !v.manifest)
        return { status: 422, body: v };
      const m = v.manifest,
        u = actor()!,
        now = Date.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        let previous: any = null;
        if (p.data.id) {
          previous = db
            .prepare("SELECT * FROM afp_manifests WHERE id=?")
            .get(p.data.id);
          if (!previous || !owned(previous, u)) {
            db.exec("ROLLBACK");
            return rejected("save", input, "manifest_unavailable", 404);
          }
        }
        if ((previous?.revision ?? 0) !== p.data.revision) {
          db.exec("ROLLBACK");
          return rejected("save", input, "stale_manifest_revision", 409);
        }
        if (previous) {
          const old = record(previous).manifest;
          if (
            old.extensionId !== m.extensionId ||
            old.ownership.ownerId !== m.ownership.ownerId ||
            old.ownership.scope !== m.ownership.scope
          ) {
            db.exec("ROLLBACK");
            return rejected("save", input, "immutable_manifest_identity");
          }
        }
        const id = previous?.id ?? randomUUID(),
          revision = (previous?.revision ?? 0) + 1,
          hash = digest(m),
          body = JSON.stringify(m);
        db.prepare(
          "INSERT INTO afp_manifests VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest,updated=excluded.updated",
        ).run(
          id,
          m.ownership.ownerId,
          m.ownership.firmId,
          m.ownership.scope,
          revision,
          body,
          hash,
          previous?.created ?? now,
          now,
        );
        db.prepare("INSERT INTO afp_manifest_revisions VALUES(?,?,?,?,?)").run(
          id,
          revision,
          body,
          u.id,
          now,
        );
        log("manifest-saved", m, "Compatible", [], id, m);
        db.exec("COMMIT");
        return {
          status: 200,
          body: record(
            db.prepare("SELECT * FROM afp_manifests WHERE id=?").get(id),
          ),
        };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    inspectRenderingRecipe(input: unknown) {
      const p = useRequest.safeParse(input);
      if (!p.success)
        return rejected(
          "rendering-preflight",
          input,
          "invalid_preflight_request",
        );
      const u = actor();
      if (!permitted(u))
        return rejected(
          "rendering-preflight",
          input,
          "actor_not_authorized",
          403,
        );
      const row = db
        .prepare("SELECT * FROM afp_manifests WHERE id=?")
        .get(p.data.manifestId) as any;
      if (!row || !owned(row, u!))
        return rejected(
          "rendering-preflight",
          input,
          "manifest_unavailable",
          404,
        );
      if (row.revision !== p.data.revision)
        return rejected(
          "rendering-preflight",
          input,
          "stale_manifest_revision",
          409,
        );
      const m = record(row).manifest;
      if (digest(m) !== row.digest)
        return rejected(
          "rendering-preflight",
          input,
          "manifest_integrity_failed",
        );
      // The owner must still belong to this firm; revocation invalidates a definition immediately.
      const owner = db
        .prepare("SELECT * FROM users WHERE id=? AND active=1")
        .get(row.owner_id) as User | undefined;
      if (
        !owner ||
        owner.firm_id !== row.firm_id ||
        owner.role === "client" ||
        (row.scope === "Firm" && owner.role !== "owner")
      )
        return rejected(
          "rendering-preflight",
          input,
          "manifest_owner_revoked",
          403,
        );
      const v = evaluate(m, "use", row.id);
      if (v.result !== "Compatible") return { status: 422, body: v };
      if (!m.requestedResources.includes(p.data.request.resourceClass))
        return rejected("rendering-preflight", null, "undeclared_resource");
      if (
        m.extensionPoints[0].id !== "rendering-pipeline" ||
        m.requestedPermissions[0] !== "rendering.recipe.inspect"
      )
        return rejected(
          "rendering-preflight",
          null,
          "wrong_extension_contract",
        );
      const accepted = recipeSchema.safeParse(p.data.request.recipe).success;
      const output = {
        contract: RENDERING_CONTRACT,
        schemaAccepted: accepted,
        reasonCodes: accepted ? [] : ["recipe_constraints_failed"],
        rendered: false,
        enqueued: false,
        basis:
          "Production recipe schema only; geometry, anatomical placement and clinical accuracy are not verified.",
      };
      const auditId = log(
        "rendering-preflight",
        m,
        "Compatible",
        output.reasonCodes,
        row.id,
        m,
      );
      return {
        status: 200,
        body: preflightResponseSchema.parse({ ...output, auditId }),
      };
    },
  });
}
export function sdkRoutes(
  app: express.Express,
  db: Store,
  staff: express.RequestHandler,
) {
  labRoutes(app, db, staff);
  const sdk = (res: express.Response) => createAfpSdk(db, res.locals.user.id);
  const send = (res: express.Response, r: { status: number; body: unknown }) =>
    res.set("Cache-Control", "no-store").status(r.status).json(r.body);
  app.get("/api/afp/workflows",staff,(_req,res)=>send(res,sdk(res).listPrivateWorkflows()));
  app.get("/api/afp/workflows/history",staff,(_req,res)=>send(res,sdk(res).privateWorkflowHistory()));
  app.post("/api/afp/workflows",staff,(req,res)=>send(res,sdk(res).managePrivateWorkflow(req.body,"settings")));
  app.post("/api/afp/workflows/runs",staff,(req,res)=>send(res,sdk(res).usePrivateWorkflow(req.body,"settings")));
  app.get("/api/afp/preferences/presentation", staff, (_req, res) =>
    send(res, sdk(res).readPrivatePresentation()),
  );
  app.get("/api/afp/preferences/presentation/history", staff, (_req, res) =>
    send(res, sdk(res).privatePresentationHistory()),
  );
  app.post("/api/afp/preferences/presentation", staff, (req, res) =>
    send(res, sdk(res).setPrivatePresentation(req.body, "settings")),
  );
  app.post("/api/afp/preferences/atlas", staff, (req, res) =>
    send(res, sdk(res).setPrivateAtlasPresentation(req.body, "settings")),
  );
  app.get("/api/afp/contract", staff, (_req, res) =>
    send(res, sdk(res).describe()),
  );
  app.get("/api/afp/manifests", staff, (_req, res) =>
    send(res, sdk(res).listManifests()),
  );
  app.get("/api/afp/audit", staff, (_req, res) =>
    send(res, sdk(res).auditHistory()),
  );
  app.post("/api/afp/manifests/evaluate", staff, (req, res) =>
    send(res, sdk(res).evaluateManifest(req.body)),
  );
  app.post("/api/afp/manifests", staff, (req, res) =>
    send(res, sdk(res).saveManifest(req.body)),
  );
  app.post("/api/afp/rendering/preflight", staff, (req, res) =>
    send(res, sdk(res).inspectRenderingRecipe(req.body)),
  );
}
