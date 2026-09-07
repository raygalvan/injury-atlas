import express from "express";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
    send: (email: string, url: string) => Promise<void>;
  },
) {
  const app = express();
  const origin = new URL(options.origin).origin;
  const files = path.resolve(options.dataDir, "evidence");
  mkdirSync(files, { recursive: true, mode: 0o700 });
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
    res.cookie("injurybot_login_email", parsed.data, {
      httpOnly: true,
      secure: !!options.production,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 86400000,
    });
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
          await options.send(user.email, `${origin}${entry}#token=${raw}`);
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
    res.json({ id, name, role, email });
  });
  app.get("/api/cases", (_req, res) => {
    const u = res.locals.user as User;
    res.json(
      db
        .prepare(
          `SELECT id,title,client,incident,created FROM cases WHERE firm_id=? AND (?!='client' OR EXISTS(SELECT 1 FROM grants WHERE case_id=cases.id AND user_id=?)) ORDER BY created DESC`,
        )
        .all(u.firm_id, u.role, u.id),
    );
  });
  const staff: express.RequestHandler = (_req, res, next) => {
    if (res.locals.user.role === "client")
      return res.status(403).json({ error: "Attorney access required" });
    next();
  };
  app.post("/api/cases", staff, (req, res) => {
    const data = z
      .object({
        title: z.string().trim().min(1).max(160),
        client: str,
        incident: z.string().max(4000),
      })
      .parse(req.body);
    const u = res.locals.user as User;
    const id = randomUUID();
    db.prepare("INSERT INTO cases VALUES(?,?,?,?,?,?)").run(
      id,
      u.firm_id,
      data.title,
      data.client,
      data.incident,
      Date.now(),
    );
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
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  }).single("file");
  app.post("/api/cases/:caseId/evidence", upload, (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose a file" });
    const id = randomUUID(),
      file = token();
    writeFileSync(path.join(files, file), req.file.buffer, {
      mode: 0o600,
      flag: "wx",
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
  app.get("/api/cases/:caseId/evidence/:id", (req, res) => {
    const u = res.locals.user as User;
    const e = db
      .prepare(
        `SELECT * FROM evidence WHERE id=? AND case_id=? AND (?!='client' OR uploader=?)`,
      )
      .get(String(req.params.id), String(req.params.caseId), u.role, u.id) as
      { file: string; name: string } | undefined;
    if (!e) return res.status(404).json({ error: "Evidence not found" });
    res.set("Content-Security-Policy", "sandbox; default-src 'none'");
    res.download(path.join(files, e.file), e.name);
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
