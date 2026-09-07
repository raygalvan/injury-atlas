import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  openStore,
  issueLink,
  consumeLink,
  sessionUser,
  type User,
} from "../server/store";

test("administrator bootstrap creates, promotes and preserves case ownership; elevation requires fresh login", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "injury-owner-"));
  const db = openStore(path.join(dir, "atlas.sqlite"));
  const bootstrap = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "server/bootstrap.ts",
        "Admin@Example.test",
        "Test Admin",
      ],
      {
        env: {
          ...process.env,
          DATA_DIR: dir,
          NODE_ENV: "production",
          APP_URL: "https://example.test",
        },
        encoding: "utf8",
      },
    );
  try {
    assert.match(bootstrap(), /Super admin registered/);
    const first = db.prepare("SELECT * FROM users").get() as User;
    assert.equal(first.email, "admin@example.test");
    assert.equal(first.role, "owner");
    db.prepare("INSERT INTO cases VALUES(?,?,?,?,?,?)").run(
      "case",
      first.firm_id,
      "Test case",
      "Test client",
      "",
      Date.now(),
    );
    const oldSession = consumeLink(db, issueLink(db, first.id)!)!;
    const oldLink = issueLink(db, first.id)!;
    db.prepare("UPDATE users SET role='client',active=0 WHERE id=?").run(
      first.id,
    );
    bootstrap();
    const promoted = db.prepare("SELECT * FROM users").get() as User;
    assert.equal(promoted.role, "owner");
    assert.equal(promoted.active, 1);
    assert.equal(promoted.id, first.id);
    assert.equal(promoted.firm_id, first.firm_id);
    assert.equal(sessionUser(db, oldSession), undefined);
    assert.equal(consumeLink(db, oldLink), null);
    const fresh = consumeLink(db, issueLink(db, first.id)!)!;
    assert.equal(sessionUser(db, fresh)?.role, "owner");
    bootstrap();
    assert.equal(sessionUser(db, fresh)?.id, first.id);
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get()?.n, 1);
    assert.equal(
      db.prepare("SELECT firm_id FROM cases").get()?.firm_id,
      first.firm_id,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
