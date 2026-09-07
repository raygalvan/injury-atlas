import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export type User = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "attorney" | "client";
  firm_id: string;
  active: number;
};
export function openStore(file: string) {
  if (file !== ":memory:")
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,firm_id TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS links(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,used INTEGER,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,firm_id TEXT NOT NULL,title TEXT NOT NULL,client TEXT NOT NULL,incident TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS grants(user_id TEXT NOT NULL REFERENCES users(id),case_id TEXT NOT NULL REFERENCES cases(id),PRIMARY KEY(user_id,case_id));
 CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),name TEXT NOT NULL,file TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,uploader TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS findings(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,case_id TEXT,actor TEXT NOT NULL,action TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS throttle(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
  // Additive migrations for databases created before a column existed.
  const caseColumns = (
    db.prepare("PRAGMA table_info(cases)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!caseColumns.includes("archived"))
    db.exec(
      "ALTER TABLE cases ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    );
  return db;
}
export type Store = ReturnType<typeof openStore>;
export function audit(
  db: Store,
  actor: string,
  action: string,
  caseId: string | null = null,
) {
  db.prepare("INSERT INTO audit VALUES(?,?,?,?,?)").run(
    randomUUID(),
    caseId,
    actor,
    action,
    Date.now(),
  );
}
export function issueLink(db: Store, userId: string, now = Date.now()) {
  const n = db
    .prepare("SELECT count(*) AS n FROM links WHERE user_id=? AND created>?")
    .get(userId, now - 900000) as { n: number };
  if (n.n >= 5) return null;
  const raw = token();
  db.prepare("INSERT INTO links VALUES(?,?,?,NULL,?)").run(
    hash(raw),
    userId,
    now + 900000,
    now,
  );
  return raw;
}
export function consumeLink(db: Store, raw: string, now = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "UPDATE links SET used=? WHERE hash=? AND used IS NULL AND expires>? AND EXISTS(SELECT 1 FROM users WHERE users.id=links.user_id AND active=1) RETURNING user_id",
      )
      .get(now, hash(raw), now) as { user_id: string } | undefined;
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    const session = token();
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(session),
      row.user_id,
      now + 30 * 86400000,
    );
    audit(db, row.user_id, "session.created");
    db.exec("COMMIT");
    return session;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function sessionUser(db: Store, raw: string) {
  return db
    .prepare(
      "SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE sessions.hash=? AND expires>? AND active=1",
    )
    .get(hash(raw), Date.now()) as User | undefined;
}
export function canAccessCase(db: Store, user: User, id: string) {
  return !!db
    .prepare(
      `SELECT id FROM cases WHERE id=? AND firm_id=? AND (?!='client' OR EXISTS(SELECT 1 FROM grants WHERE case_id=cases.id AND user_id=?))`,
    )
    .get(id, user.firm_id, user.role, user.id);
}
export function rateLimit(db: Store, key: string, max = 20) {
  const now = Date.now();
  db.prepare("DELETE FROM throttle WHERE reset<?").run(now);
  db.prepare(
    "INSERT INTO throttle VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
  ).run(hash(key), now + 900000);
  return (
    (
      db.prepare("SELECT count FROM throttle WHERE key=?").get(hash(key)) as {
        count: number;
      }
    ).count <= max
  );
}
