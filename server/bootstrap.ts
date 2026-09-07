import { randomUUID } from "node:crypto";
import path from "node:path";
import { openStore, issueLink, audit, type User } from "./store";
const [email, name, ...flags] = process.argv.slice(2);
if (!email || !name || !/^\S+@\S+\.\S+$/.test(email))
  throw new Error('Usage: npm run bootstrap -- EMAIL "NAME" [--local-link]');
const origin = process.env.APP_URL || "http://localhost:5173";
if (flags.includes("--local-link")) {
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
  )
    throw new Error("Local links require a localhost development environment");
}
const db = openStore(path.join(process.env.DATA_DIR || "data", "atlas.sqlite"));
db.exec("BEGIN IMMEDIATE");
try {
  const previous = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(email.trim().toLowerCase()) as User | undefined;
  db.prepare(
    `INSERT INTO users VALUES(?,?,?,?,?,1) ON CONFLICT(email)
     DO UPDATE SET name=excluded.name,role='owner',active=1`,
  ).run(randomUUID(), email.trim().toLowerCase(), name, "owner", randomUUID());
  if (previous && (previous.role !== "owner" || previous.active !== 1)) {
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(previous.id);
    db.prepare("DELETE FROM links WHERE user_id=?").run(previous.id);
  }
  const user = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email.trim().toLowerCase()) as { id: string };
  audit(db, user.id, "admin.bootstrapped");
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  db.close();
  throw error;
}
console.log(
  "Super admin registered (owner role). Request an email link from the injury.bot sign-in page. No email has been sent by this command.",
);
if (flags.includes("--local-link")) {
  const user = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email.trim().toLowerCase()) as { id: string };
  const link = issueLink(db, user.id);
  if (!link) throw new Error("Too many access links. Wait 15 minutes.");
  console.log(`${origin}/sign-in#token=${link}`);
}
db.close();
