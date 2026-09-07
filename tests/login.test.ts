import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { openStore } from "../server/store";

test("portal email routing, remembered email and delivery failure preserve private login semantics", async () => {
  const db = openStore(":memory:");
  const dataDir = mkdtempSync(path.join(tmpdir(), "injury-login-"));
  for (const role of ["owner", "client"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
      role,
      `${role}@example.test`,
      role,
      role,
      "firm",
    );
  const sent: { email: string; url: string }[] = [];
  let fail = false;
  const app = createApp(db, {
    dataDir,
    origin: "https://example.test",
    production: true,
    send: async (email, url) => {
      if (fail) throw new Error("synthetic SES failure");
      sent.push({ email, url });
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (email: string, portal: string, remember?: boolean) =>
    fetch(`${base}/api/auth/request`, {
      method: "POST",
      headers: {
        origin: "https://example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, portal, remember }),
    });
  try {
    const unknown = await request("unknown@example.test", "firm", true);
    const owner = await request(" OWNER@example.test ", "firm", true);
    assert.deepEqual(await unknown.json(), await owner.json());
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /^https:\/\/example.test\/sign-in#token=/);
    const cookie = owner.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=31536000/);
    const prefs = await fetch(`${base}/api/auth/preferences`, {
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.deepEqual(await prefs.json(), { email: "owner@example.test" });
    // Without the opt-in nothing is remembered, and unchecking forgets.
    const silent = await request("owner@example.test", "firm");
    assert.doesNotMatch(
      silent.headers.get("set-cookie") ?? "",
      /injurybot_login_email=[^;]/,
    );
    const forget = await request("owner@example.test", "firm", false);
    assert.match(
      forget.headers.get("set-cookie")!,
      /injurybot_login_email=;.*Expires=Thu, 01 Jan 1970/,
    );
    assert.equal(sent.length, 3);
    const me = await fetch(`${base}/api/me`, {
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.equal(me.status, 401);
    await request("client@example.test", "firm");
    assert.equal(sent.length, 3);
    await request("client@example.test", "client");
    assert.equal(sent.length, 4);
    assert.match(
      sent[3].url,
      /^https:\/\/example.test\/client\/sign-in#token=/,
    );
    const before = db.prepare("SELECT count(*) AS n FROM links").get()?.n;
    fail = true;
    const failed = await request("owner@example.test", "firm");
    assert.equal(failed.status, 200);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM links").get()?.n,
      before,
    );
    const malformed = await fetch(`${base}/api/auth/preferences`, {
      headers: { cookie: "injurybot_login_email=%" },
    });
    assert.deepEqual(await malformed.json(), { email: "" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
