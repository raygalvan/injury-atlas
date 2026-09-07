import { randomUUID } from "node:crypto";
import path from "node:path";
import { openStore, issueLink } from "./store";
const [email, name, ...flags] = process.argv.slice(2);
if (!email || !name || !/^\S+@\S+\.\S+$/.test(email))
  throw new Error('Usage: npm run bootstrap -- EMAIL "NAME" [--local-link]');
const db = openStore(path.join(process.env.DATA_DIR || "data", "atlas.sqlite"));
db.prepare(
  "INSERT INTO users VALUES(?,?,?,?,?,1) ON CONFLICT(email) DO NOTHING",
).run(randomUUID(), email.toLowerCase(), name, "owner", randomUUID());
console.log("Owner registered. Request an email link from the sign-in page.");
if (flags.includes("--local-link")) {
  const origin = process.env.APP_URL || "http://localhost:5173";
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
  )
    throw new Error("Local links require a localhost development environment");
  const user = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email.toLowerCase()) as { id: string };
  console.log(`${origin}/sign-in#token=${issueLink(db, user.id)}`);
}
db.close();
