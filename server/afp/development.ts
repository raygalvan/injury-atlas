import type express from "express";
import { audit, type Store, type User } from "../store";
import { afpAdmin } from "./management";
import { verifyExecutorToken } from "./executor-auth";
/** Retain history. Shared repository delivery is not AFP customization. */
export function ensureDevelopment(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS afp_development_jobs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,firm_id TEXT NOT NULL,request TEXT NOT NULL,delivery TEXT NOT NULL,source TEXT NOT NULL,state TEXT NOT NULL,run_id TEXT,pr_url TEXT,commit_sha TEXT,result TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS afp_development_control(actor TEXT PRIMARY KEY,enabled INTEGER NOT NULL);`);
  const cancelled = db
    .prepare(
      "UPDATE afp_development_jobs SET state='cancelled',result='Shared coding suspended. AFP requests use private versioned features.',updated=? WHERE state IN ('queued','running') RETURNING id,actor",
    )
    .all(Date.now());
  for (const j of cancelled)
    audit(db, String(j.actor), `afp.development.suspended:${j.id}`);
  db.exec("UPDATE afp_development_control SET enabled=0");
}
export function developmentAllowed(_db: Store, _u: User) {
  return false;
}
export function queueDevelopment(
  _db: Store,
  _u: User,
  _input: unknown,
  _source: string,
): never {
  throw Error("Shared coding is suspended. Use the private AFP workflow SDK.");
}
export function developmentStatus(db: Store, u: User, id?: string) {
  if (!afpAdmin(db, u)) throw Error("Application owner required");
  return id
    ? db
        .prepare(
          "SELECT * FROM afp_development_jobs WHERE id=? AND actor=? AND firm_id=?",
        )
        .get(id, u.id, u.firm_id)
    : db
        .prepare(
          "SELECT * FROM afp_development_jobs WHERE actor=? AND firm_id=? ORDER BY created DESC LIMIT 30",
        )
        .all(u.id, u.firm_id);
}
export function developmentRoutes(
  app: express.Express,
  db: Store,
  staff: express.RequestHandler,
) {
  ensureDevelopment(db);
  app.get("/api/afp/development", staff, (_req, res) => {
    if (!afpAdmin(db, res.locals.user))
      return res.status(403).json({ error: "Application owner required" });
    res
      .set("Cache-Control", "no-store")
      .json({
        enabled: false,
        suspended: true,
        jobs: developmentStatus(db, res.locals.user),
      });
  });
  app.post("/api/afp/development/control", staff, (_req, res) =>
    res
      .status(403)
      .json({
        error:
          "Shared coding cannot be enabled through AFP. Use private features.",
      }),
  );
}
export function executorRoutes(
  app: express.Express,
  db: Store,
  authenticate = verifyExecutorToken,
) {
  ensureDevelopment(db);
  app.post("/api/afp/executor/:operation", async (req, res) => {
    try {
      await authenticate(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
    } catch {
      return res
        .status(401)
        .json({ error: "Verified development runner required" });
    }
    return res
      .status(410)
      .json({
        error:
          "Shared coding executor suspended. No tasks may be claimed or published.",
      });
  });
}
