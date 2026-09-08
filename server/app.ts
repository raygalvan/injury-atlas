import { AiError } from "./ai/error";
import { configureVault } from "./ai/vault";
import { settingsRoutes } from "./ai/settings-routes";
import { coordinatorRoutes } from "./ai/coordinator";
import { agentReady } from "./ai/settings";
import {
  ensureProduction,
  createProduction,
  productionSchema,
  isPlatformAdmin,
} from "./production";
import { productionRoutes } from "./production-routes";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, rmSync } from "node:fs";
import {
  createEvidenceStorage,
  MAX_EVIDENCE_BYTES,
  type EvidenceStorage,
} from "./evidence-storage";
import path from "node:path";
import {
  hash,
  token,
  issueLink,
  consumeLink,
  sessionUser,
  canAccessCase,
  rateLimit,
  audit,
  type Store,
  type User,
} from "./store";
import {
  applyInjuries,
  caseInjuries,
  ensureInjuryTables,
  listLibrary,
  matchInjuries,
  queueGeneration,
} from "./injuries";
const str = z.string().trim().min(1).max(240);
const findingSchema = z.object({
  anatomicalStructure: str,
  type: z.enum(["surface", "bone", "internal", "other"]),
  laterality: z.enum(["left", "right", "bilateral", "midline", "unspecified"]),
  notes: z.string().max(4000),
  evidenceId: str,
  citation: str,
});
export function createApp(
  db: Store,
  options: {
    dataDir: string;
    origin: string;
    production?: boolean;
    evidenceStorage?: EvidenceStorage;
    send: (email: string, url: string) => Promise<void>;
  },
) {
  const app = express();
  configureVault(options.dataDir);
  ensureInjuryTables(db);
  ensureProduction(db);
  const origin = new URL(options.origin).origin;
  const files = path.resolve(options.dataDir, "evidence");
  const storage =
    options.evidenceStorage || createEvidenceStorage(options.dataDir);
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "no-store",
    });
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  const cookie = (req: express.Request, name: string) =>
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) || "";
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== origin
    )
      return res.status(403).json({ error: "Request origin is not allowed" });
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      release: existsSync("dist/release.json")
        ? JSON.parse(readFileSync("dist/release.json", "utf8")).commit
        : "development",
      atlasReady: existsSync(".atlas-build/index.html"),
      injuryAgentConfigured: !!process.env.ANTHROPIC_API_KEY,
      productionWorkerReady:
        Number(
          db.prepare("SELECT heartbeat FROM worker_health WHERE id=1").get()
            ?.heartbeat || 0,
        ) >
          Date.now() - 90000 && existsSync(".atlas-build/injury-generator.mjs"),
    }),
  );
  app.get("/api/auth/preferences", (req, res) => {
    let email = "";
    try {
      const parsed = z
        .string()
        .email()
        .max(254)
        .safeParse(decodeURIComponent(cookie(req, "injurybot_login_email")));
      if (parsed.success) email = parsed.data;
    } catch {
      /* Invalid preference cookies never affect authentication. */
    }
    res.json({ email });
  });
  app.post("/api/auth/request", async (req, res) => {
    const parsed = z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(254)
      .safeParse(req.body.email);
    if (!parsed.success)
      return res.status(400).json({ error: "Enter a valid email address" });
    if (!rateLimit(db, "login:" + req.ip))
      return res
        .status(429)
        .json({ error: "Please wait before requesting another link" });
    // "Remember me" is an explicit opt-in. It only prefills the sign-in form;
    // it never authenticates. Unchecking forgets a previously remembered address.
    const preference = {
      httpOnly: true,
      secure: !!options.production,
      sameSite: "lax" as const,
      path: "/",
    };
    if (req.body.remember === true)
      res.cookie("injurybot_login_email", parsed.data, {
        ...preference,
        maxAge: 365 * 86400000,
      });
    else res.clearCookie("injurybot_login_email", preference);
    const user = db
      .prepare("SELECT * FROM users WHERE email=? AND active=1")
      .get(parsed.data) as User | undefined;
    const portal = req.body.portal;
    const matchesPortal =
      portal === "client"
        ? user?.role === "client"
        : portal === "firm"
          ? user?.role !== "client"
          : true;
    if (user && matchesPortal) {
      const raw = issueLink(db, user.id);
      if (raw) {
        try {
          const entry = user.role === "client" ? "/client/sign-in" : "/sign-in";
          const returnTo =
            typeof req.body.returnTo === "string" &&
            /^\/injuries\?(?:case=[a-zA-Z0-9_-]+(?:&injury=[a-zA-Z0-9_-]+)?|library=[a-zA-Z0-9_-]+)$/.test(
              req.body.returnTo,
            ) &&
            user.role !== "client"
              ? req.body.returnTo
              : "";
          await options.send(
            user.email,
            `${origin}${entry}${returnTo ? "?returnTo=" + encodeURIComponent(returnTo) : ""}#token=${raw}`,
          );
        } catch {
          db.prepare("DELETE FROM links WHERE hash=?").run(hash(raw));
          console.error(
            "Sign-in email delivery failed. Check SES configuration.",
          );
        }
      }
    }
    res.json({
      message: "If your address has been invited, a secure link is on its way.",
    });
  });
  app.post("/api/auth/consume", (req, res) => {
    if (!rateLimit(db, "consume:" + req.ip, 40))
      return res.status(429).json({ error: "Please wait before trying again" });
    const raw = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .safeParse(req.body.token);
    const session = raw.success ? consumeLink(db, raw.data) : null;
    if (!session)
      return res.status(400).json({
        error: "This link has expired or was already used. Request another.",
      });
    res.cookie("atlas_session", session, {
      httpOnly: true,
      secure: !!options.production,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400000,
    });
    res.json({ ok: true });
  });
  app.use(["/api", "/atlas-engine"], (req, res, next) => {
    const user = sessionUser(db, cookie(req, "atlas_session"));
    if (!user) return res.status(401).json({ error: "Sign in to continue" });
    res.locals.user = user;
    next();
  });
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE hash=?").run(
      hash(cookie(req, "atlas_session")),
    );
    res.clearCookie("atlas_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/me", (_req, res) => {
    const { id, name, role, email } = res.locals.user as User;
    res.json({
      id,
      name,
      role,
      email,
      platformAdmin: isPlatformAdmin(db, res.locals.user),
    });
  });
  app.get("/api/cases", (_req, res) => {
    const u = res.locals.user as User;
    res.json(
      db
        .prepare(
          `SELECT id,title,client,incident,created,archived FROM cases WHERE firm_id=? AND (?!='client' OR EXISTS(SELECT 1 FROM grants WHERE case_id=cases.id AND user_id=?)) ORDER BY archived ASC, created DESC`,
        )
        .all(u.firm_id, u.role, u.id),
    );
  });
  const staff: express.RequestHandler = (_req, res, next) => {
    if (res.locals.user.role === "client")
      return res.status(403).json({ error: "Attorney access required" });
    next();
  };
  settingsRoutes(app, db, staff);
  coordinatorRoutes(app, db, staff);
  const caseSchema = z.object({
    title: z.string().trim().min(1).max(160),
    client: str,
    incident: z.string().max(4000),
  });
  app.post("/api/cases", staff, (req, res) => {
    const data = caseSchema.parse(req.body);
    const u = res.locals.user as User;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO cases(id,firm_id,title,client,incident,created) VALUES(?,?,?,?,?,?)",
    ).run(id, u.firm_id, data.title, data.client, data.incident, Date.now());
    audit(db, u.id, "case.created", id);
    res.status(201).json({ id, ...data });
  });
  app.post("/api/invitations", staff, async (req, res) => {
    const data = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        name: str,
        role: z.enum(["attorney", "client"]),
        caseId: z.string().optional(),
      })
      .parse(req.body);
    const u = res.locals.user as User;
    if (data.role === "attorney" && u.role !== "owner")
      return res
        .status(403)
        .json({ error: "Only the owner can invite attorneys" });
    if (
      data.role === "client" &&
      (!data.caseId || !canAccessCase(db, u, data.caseId))
    )
      return res.status(400).json({ error: "Choose a case for this client" });
    let invited = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(data.email) as User | undefined;
    if (
      invited &&
      (invited.firm_id !== u.firm_id || invited.role !== data.role)
    )
      return res.status(409).json({
        error: "This address cannot be invited with these permissions",
      });
    if (!invited) {
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
        randomUUID(),
        data.email,
        data.name,
        data.role,
        u.firm_id,
      );
      invited = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(data.email) as User;
    }
    if (data.role === "client")
      db.prepare("INSERT OR IGNORE INTO grants VALUES(?,?)").run(
        invited.id,
        data.caseId!,
      );
    const raw = issueLink(db, invited.id);
    if (!raw)
      return res
        .status(429)
        .json({ error: "Too many invitations. Please wait 15 minutes." });
    try {
      const entry = data.role === "client" ? "/client/sign-in" : "/sign-in";
      await options.send(data.email, `${origin}${entry}#token=${raw}`);
    } catch {
      db.prepare("DELETE FROM links WHERE hash=?").run(hash(raw));
      return res.status(503).json({
        error:
          "Access registered, but email delivery failed. Check SES and retry.",
      });
    }
    audit(db, u.id, "member.invited", data.caseId || null);
    res.status(201).json({ ok: true });
  });
  app.use("/api/cases/:caseId", (req, res, next) => {
    if (!canAccessCase(db, res.locals.user, String(req.params.caseId)))
      return res.status(404).json({ error: "Case not found" });
    next();
  });
  const caseRow = (id: string) =>
    db
      .prepare(
        "SELECT id,title,client,incident,created,archived FROM cases WHERE id=?",
      )
      .get(id) as
      | {
          id: string;
          title: string;
          client: string;
          incident: string;
          created: number;
          archived: number;
        }
      | undefined;
  app.post("/api/cases/:caseId/update", staff, (req, res) => {
    const data = caseSchema.parse(req.body);
    const id = String(req.params.caseId);
    db.prepare("UPDATE cases SET title=?,client=?,incident=? WHERE id=?").run(
      data.title,
      data.client,
      data.incident,
      id,
    );
    audit(db, res.locals.user.id, "case.updated", id);
    res.json(caseRow(id));
  });
  app.post("/api/cases/:caseId/archive", staff, (req, res) => {
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
    const id = String(req.params.caseId);
    db.prepare("UPDATE cases SET archived=? WHERE id=?").run(
      archived ? 1 : 0,
      id,
    );
    audit(
      db,
      res.locals.user.id,
      archived ? "case.archived" : "case.restored",
      id,
    );
    res.json(caseRow(id));
  });
  // Deletion is owner-only, requires the exact title, and removes the case's
  // findings, grants and evidence bytes together. The audit trail is kept.
  app.post("/api/cases/:caseId/delete", (req, res) => {
    if (res.locals.user.role !== "owner")
      return res.status(403).json({ error: "Owner access required" });
    const { confirmTitle } = z
      .object({ confirmTitle: z.string().max(160) })
      .parse(req.body);
    const id = String(req.params.caseId);
    const row = caseRow(id);
    if (!row || row.title !== confirmTitle.trim())
      return res
        .status(400)
        .json({ error: "Type the case title exactly to confirm deletion" });
    const stored = db
      .prepare("SELECT file FROM evidence WHERE case_id=?")
      .all(id) as { file: string }[];
    // The S3 runtime deliberately has no version-deletion permission. Preserve
    // references as well as bytes until a dedicated S3 deletion flow exists.
    if (stored.some(({ file }) => file.startsWith("s3:")))
      return res.status(409).json({
        error:
          "This case contains retained S3 evidence. Archive the case instead of deleting it.",
      });
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM findings WHERE case_id=?").run(id);
      db.prepare("DELETE FROM evidence WHERE case_id=?").run(id);
      db.prepare("DELETE FROM grants WHERE case_id=?").run(id);
      db.prepare("DELETE FROM cases WHERE id=?").run(id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const { file } of stored)
      rmSync(path.join(files, path.basename(file)), { force: true });
    audit(db, res.locals.user.id, "case.deleted", id);
    res.json({ ok: true });
  });
  app.get("/api/cases/:caseId/evidence", (req, res) => {
    const u = res.locals.user as User;
    res.json(
      db
        .prepare(
          `SELECT id,name,mime,bytes,sha256,created FROM evidence WHERE case_id=? AND (?!='client' OR uploader=?) ORDER BY created DESC`,
        )
        .all(String(req.params.caseId), u.role, u.id),
    );
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1 },
  }).single("file");
  app.post("/api/cases/:caseId/evidence", upload, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose a file" });
    const id = randomUUID();
    const file = await storage.put({
      file: token(),
      firmId: res.locals.user.firm_id,
      caseId: String(req.params.caseId),
      body: req.file.buffer,
    });
    const name =
      path
        .basename(req.file.originalname)
        .replace(/[\r\n\x00-\x1f]/g, "")
        .slice(0, 240) || "evidence";
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?)").run(
      id,
      String(req.params.caseId),
      name,
      file,
      req.file.mimetype,
      req.file.size,
      createFileHash(req.file.buffer),
      res.locals.user.id,
      Date.now(),
    );
    audit(
      db,
      res.locals.user.id,
      "evidence.uploaded",
      String(req.params.caseId),
    );
    res.status(201).json({ id });
  });
  app.get("/api/cases/:caseId/evidence/:id", async (req, res) => {
    const u = res.locals.user as User;
    const e = db
      .prepare(
        `SELECT * FROM evidence WHERE id=? AND case_id=? AND (?!='client' OR uploader=?)`,
      )
      .get(String(req.params.id), String(req.params.caseId), u.role, u.id) as
      { file: string; name: string; bytes: number; sha256: string } | undefined;
    if (!e) return res.status(404).json({ error: "Evidence not found" });
    const body = await storage.get(e.file);
    if (body.length !== e.bytes || createFileHash(body) !== e.sha256) {
      return res.status(409).json({
        error: "Evidence integrity check failed. Contact your administrator.",
      });
    }
    res.set("Content-Security-Policy", "sandbox; default-src 'none'");
    res.attachment(e.name);
    res.type("application/octet-stream");
    res.send(body);
  });
  app.get("/api/cases/:caseId/findings", staff, (req, res) =>
    res.json(
      db
        .prepare("SELECT body FROM findings WHERE case_id=?")
        .all(String(req.params.caseId))
        .map((r) => JSON.parse(r.body as string)),
    ),
  );
  app.post("/api/cases/:caseId/findings", staff, (req, res) => {
    const d = findingSchema.parse(req.body);
    const e = db
      .prepare("SELECT id FROM evidence WHERE id=? AND case_id=?")
      .get(d.evidenceId, String(req.params.caseId));
    if (!e)
      return res
        .status(400)
        .json({ error: "Select evidence belonging to this case" });
    const f = {
      id: randomUUID(),
      caseId: String(req.params.caseId),
      ...d,
      sourceStatus: "linked",
      attorneyReviewStatus: "pending",
      placementStatus: "not_started",
      renderStatus: "not_started",
      expertReviewStatus: "not_reviewed",
    };
    db.prepare("INSERT INTO findings VALUES(?,?,?)").run(
      f.id,
      f.caseId,
      JSON.stringify(f),
    );
    audit(db, res.locals.user.id, "finding.drafted", f.caseId);
    res.status(201).json(f);
  });
  app.post("/api/cases/:caseId/findings/:id/review", staff, (req, res) => {
    z.object({ decision: z.literal("approve-source") }).parse(req.body);
    const row = db
      .prepare("SELECT body FROM findings WHERE id=? AND case_id=?")
      .get(String(req.params.id), String(req.params.caseId));
    if (!row) return res.status(404).json({ error: "Finding not found" });
    const f = JSON.parse(row.body as string);
    f.sourceStatus = "verified";
    f.attorneyReviewStatus = "approved";
    db.prepare("UPDATE findings SET body=? WHERE id=?").run(
      JSON.stringify(f),
      f.id,
    );
    audit(
      db,
      res.locals.user.id,
      "finding.source-approved",
      String(req.params.caseId),
    );
    res.json(f);
  });
  productionRoutes(app, db, storage, staff);
  // Injury library and per-case applications feed the embedded viewer.
  const catalogueFor = (caseId: string) => {
    const privateEntries = db
      .prepare(
        "SELECT id,body FROM injury_production WHERE case_id=? AND state='complete' AND applied=0",
      )
      .all(caseId)
      .map((r) => {
        const b = JSON.parse(String(r.body));
        return {
          id: String(r.id),
          name: b.name,
          shortName: b.name,
          color: "#984b49",
          description: b.generalDefinition || b.medicalDescription,
          section: "Your injuries",
          laterality: "unspecified",
          status: "ready",
          engineId: null,
          caseId,
          generatedFrom: null,
          createdBy: null,
          created: 0,
          sourceIds: b.recipe ? [b.recipe.parentId] : [],
        };
      });
    const shared = db
      .prepare(
        "SELECT id,name,description FROM injury_publications WHERE status='approved'",
      )
      .all()
      .map((r) => ({
        id: "library-" + r.id,
        name: String(r.name),
        shortName: String(r.name),
        color: "#984b49",
        description: String(r.description),
        section: "Injury library",
        laterality: "unspecified",
        status: "approved",
        engineId: null,
        caseId: null,
        generatedFrom: null,
        createdBy: null,
        created: 0,
        sourceIds: [],
      }));
    return [...privateEntries, ...shared].slice(0, 500);
  };
  app.get("/api/injuries", staff, (_req, res) => res.json(catalogueFor("")));
  app.get("/api/cases/:caseId/injuries", staff, (req, res) => {
    const id = String(req.params.caseId),
      legacy = caseInjuries(db, id);
    const productionInjuries = db
      .prepare(
        "SELECT id,body,hidden FROM injury_production WHERE case_id=? AND applied=1 AND state='complete' AND source_review=1 AND placement_review=1 AND render_review=1",
      )
      .all(id)
      .map((r) => ({
        id: r.id,
        name: JSON.parse(String(r.body)).name,
        parentId: JSON.parse(String(r.body)).recipe.parentId,
        mode:
          JSON.parse(String(r.body)).recipe.kind === "fracture"
            ? "replacement"
            : "overlay",
        hidden: !!r.hidden,
        url: `/api/cases/${id}/production/${r.id}/geometry`,
      }));
    const generated = db
      .prepare(
        "SELECT id,body,state,stage,error FROM injury_production WHERE case_id=? AND applied=0 ORDER BY updated DESC LIMIT 200",
      )
      .all(id)
      .map((r) => ({
        id: r.id,
        name: JSON.parse(String(r.body)).name,
        status:
          r.state === "failed"
            ? "failed"
            : r.state === "complete"
              ? "ready"
              : r.state === "running"
                ? "generating"
                : "queued",
        stage:
          r.state === "failed"
            ? String(r.error)
            : r.state === "complete"
              ? JSON.parse(String(r.body)).recipe
                ? "Generated · awaiting review"
                : "Documentation ready · 3D modeling pending"
              : String(r.stage),
      }));
    res.json({
      applied: [],
      generated,
      productionInjuries,
      catalogue: catalogueFor(id),
    });
  });
  app.post("/api/cases/:caseId/injuries/apply", staff, (req, res) => {
    const { injuries } = z
      .object({
        injuries: z
          .array(z.object({ id: str, hidden: z.boolean().default(false) }))
          .max(200),
      })
      .parse(req.body);
    const id = String(req.params.caseId);
    const occupied = new Set(
      db
        .prepare(
          "SELECT json_extract(body,'$.recipe.parentId') parent FROM injury_production WHERE case_id=? AND applied=1 AND json_extract(body,'$.recipe.kind')='fracture'",
        )
        .all(id)
        .map((r) => String(r.parent)),
    );
    const requested = new Set<string>();
    // Only actual workflow records can be applied. Seed/demo IDs are rejected.
    for (const item of injuries) {
      if (item.id.startsWith("library-")) {
        const entry = db
          .prepare(
            "SELECT * FROM injury_publications WHERE id=? AND status='approved'",
          )
          .get(item.id.slice(8));
        if (!entry)
          return res
            .status(400)
            .json({ error: "This library definition is unavailable." });
        if (!agentReady(db, res.locals.user.firm_id, "injury-creation"))
          return res
            .status(503)
            .json({ error: "AI injury creation is currently unavailable." });
      } else {
        const r = db
          .prepare("SELECT * FROM injury_production WHERE id=? AND case_id=?")
          .get(item.id, id);
        if (!r)
          return res.status(400).json({
            error:
              "Only injuries created through this workflow can be applied.",
          });
        const body = JSON.parse(String(r.body));
        if (body.recipe?.kind === "fracture" && !r.applied) {
          const parent = body.recipe.parentId;
          if (occupied.has(parent) || requested.has(parent))
            return res.status(409).json({
              error:
                "This anatomy piece already has an applied fracture illustration. Remove it before applying a replacement.",
            });
          requested.add(parent);
        }
        if (
          r.state !== "complete" ||
          !r.source_review ||
          !r.placement_review ||
          !r.render_review
        )
          return res.status(409).json({
            error:
              "Review this generated injury in the Injury workspace before applying it.",
          });
      }
    }
    for (const item of injuries) {
      if (item.id.startsWith("library-")) {
        const entry = db
          .prepare("SELECT * FROM injury_publications WHERE id=?")
          .get(item.id.slice(8))!;
        const created = createProduction(
          db,
          res.locals.user,
          id,
          productionSchema.parse({
            name: String(entry.name),
            description: `Create an illustration for this case using the following general injury definition. Case facts must come from this case's evidence. General definition: ${entry.description}`,
            useAI: true,
            agentManaged: true,
          }),
        );
        db.prepare(
          "UPDATE injury_production SET state='queued',stage='Injury Creation Agent · queued' WHERE id=?",
        ).run(created.id);
      } else
        db.prepare(
          "UPDATE injury_production SET applied=1,hidden=? WHERE id=? AND case_id=?",
        ).run(item.hidden ? 1 : 0, item.id, id);
    }
    audit(db, res.locals.user.id, "injuries.applied", id);
    res.json({ ok: true });
  });
  app.post("/api/cases/:caseId/injuries/match", staff, async (req, res) => {
    const { description } = z
      .object({ description: z.string().trim().min(1).max(4000) })
      .parse(req.body);
    res.json(
      await matchInjuries(
        description,
        catalogueFor(String(req.params.caseId)) as any,
      ),
    );
  });
  app.post("/api/cases/:caseId/injuries/generate", staff, (req, res) => {
    const { name, description } = z
      .object({
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(4000),
      })
      .parse(req.body);
    const id = String(req.params.caseId);
    if (!agentReady(db, res.locals.user.firm_id, "injury-creation"))
      return res.status(503).json({
        error:
          "AI injury creation is currently unavailable. Please try again after AI service is configured.",
      });
    if (
      Number(
        db
          .prepare(
            "SELECT count(*) n FROM injury_production WHERE firm_id=? AND state IN ('queued','running')",
          )
          .get(res.locals.user.firm_id)!.n,
      ) >= 20
    )
      return res.status(429).json({
        error:
          "Your firm already has 20 queued requests. Please wait for an existing request to finish.",
      });
    const draft = createProduction(
      db,
      res.locals.user,
      id,
      productionSchema.parse({
        name,
        description: description || name,
        useAI: true,
        agentManaged: true,
      }),
    );
    db.prepare(
      "UPDATE injury_production SET state='queued',stage='Queued for AI injury description',updated=? WHERE id=?",
    ).run(Date.now(), draft.id);
    const queued = {
      id: draft.id,
      name,
      status: "queued",
      workspaceUrl: `/injuries?case=${id}&injury=${draft.id}`,
    };
    audit(db, res.locals.user.id, "injury.generation-queued", id);
    res.status(202).json(queued);
  });
  app.use(
    "/atlas-engine",
    staff,
    express.static(path.resolve(".atlas-build"), { fallthrough: false }),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) => {
    if (existsSync("dist/index.html"))
      res.sendFile(path.resolve("dist/index.html"));
    else
      res.status(503).send("Build the application before starting production.");
  });
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof AiError) return res.status(err.status).json({error:err.message});
      if (err instanceof z.ZodError)
        return res.status(400).json({ error: "Check the required fields" });
      if (err instanceof multer.MulterError)
        return res
          .status(400)
          .json({ error: "Upload one file, no larger than 25 MB" });
      console.error("Request failed");
      res.status(500).json({ error: "Request could not be completed" });
    },
  );
  return app;
}
import { createHash } from "node:crypto";
function createFileHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
