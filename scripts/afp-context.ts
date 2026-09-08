import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { developmentContext } from "../server/afp/development-context";

class ContextAccessError extends Error {}

// Operator CLI, never a Coordinator tool. Remote mode uses an existing admin session.
// No session is minted, no database initialized/migrated, and no write is performed.
try {
  if (process.env.AFP_CONTEXT_URL) {
    const url = new URL(
      "/api/settings/afp/development-context",
      process.env.AFP_CONTEXT_URL,
    );
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      throw new ContextAccessError("Use HTTPS for remote AFP context.");
    if (!process.env.AFP_CONTEXT_COOKIE)
      throw new ContextAccessError(
        "Remote context requires an existing super-admin session in AFP_CONTEXT_COOKIE.",
      );
    const res = await fetch(url, {
      headers: { cookie: process.env.AFP_CONTEXT_COOKIE },
      redirect: "error",
    });
    if (!res.ok)
      throw new ContextAccessError(
        `AFP context access failed (${res.status}). No runtime proposals were loaded.`,
      );
    const body = await res.json();
    if (body.schemaVersion !== "injury.bot.afp-development-context/1")
      throw new ContextAccessError("Unexpected context schema.");
    process.stdout.write(JSON.stringify(body, null, 2) + "\n");
  } else {
    if (!process.env.DATA_DIR)
      throw new ContextAccessError(
        "Set DATA_DIR on the application host for read-only context, or AFP_CONTEXT_URL and AFP_CONTEXT_COOKIE for an authenticated super-admin export. No runtime proposals were loaded.",
      );
    const db = new DatabaseSync(
      path.join(process.env.DATA_DIR, "atlas.sqlite"),
      { readOnly: true },
    );
    try {
      process.stdout.write(
        JSON.stringify(developmentContext(db), null, 2) + "\n",
      );
    } finally {
      db.close();
    }
  }
} catch (e) {
  process.stderr.write(
    (e instanceof ContextAccessError
      ? e.message
      : "AFP context unavailable. Check authorized access and the existing database; no runtime proposals were loaded.") +
      "\n",
  );
  process.exitCode = 1;
}
