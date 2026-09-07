import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createEvidenceStorage,
  s3ConfigFromEnv,
} from "../server/evidence-storage";
import { fakeS3, s3Config } from "./s3-fixture";
import { createApp } from "../server/app";
import { openStore, issueLink, consumeLink } from "../server/store";

test("S3 pins version and checksum, retains legacy files and fails closed on bucket mismatch", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "s3-adapter-"));
  try {
    const body = Buffer.from("synthetic evidence");
    const local = createEvidenceStorage(dir);
    const legacy = await local.put({
      file: "legacy",
      firmId: "firm",
      caseId: "case",
      body,
    });
    const fake = fakeS3();
    const storage = createEvidenceStorage(dir, s3Config, fake.transport);
    assert.deepEqual(await storage.get(legacy), body);
    const ref = await storage.put({
      file: "new",
      firmId: "firm",
      caseId: "case",
      body,
    });
    assert.equal(existsSync(path.join(dir, "evidence", "new")), false);
    assert.equal(fake.puts[0].Key, "evidence/firm/case/new");
    assert.equal(fake.puts[0].IfNoneMatch, "*");
    assert.equal(fake.puts[0].ExpectedBucketOwner, s3Config.owner);
    assert.equal(fake.puts[0].ServerSideEncryption, "AES256");
    assert.equal(
      fake.puts[0].ChecksumSHA256,
      createHash("sha256").update(body).digest("base64"),
    );
    fake.objects.set("evidence/firm/case/new:v2", Buffer.from("replacement"));
    assert.deepEqual(await storage.get(ref), body);
    assert.equal(fake.gets[0].VersionId, "v1");
    await assert.rejects(
      storage.get(ref.replace(s3Config.bucket, "wrong-bucket")),
    );
    assert.equal(fake.gets.length, 1);
    await assert.rejects(storage.get("../../etc/passwd"));
    await assert.rejects(local.get(ref), /S3 must remain configured/);
    const unversioned = createEvidenceStorage(dir, s3Config, {
      ...fake.transport,
      put: async () => ({}),
    });
    await assert.rejects(
      unversioned.put({ file: "bad", firmId: "firm", caseId: "case", body }),
      /versioning/,
    );
    assert.equal(s3ConfigFromEnv({}), undefined);
    assert.throws(
      () => s3ConfigFromEnv({ S3_BUCKET: "test-bucket" }),
      /S3_EXPECTED_BUCKET_OWNER/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed S3 upload creates no evidence record; corrupt bytes are blocked before download", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "s3-routes-"));
  const db = openStore(":memory:");
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
    "owner",
    "owner@example.test",
    "Owner",
    "owner",
    "firm",
  );
  db.prepare("INSERT INTO cases VALUES(?,?,?,?,?,?)").run(
    "case",
    "firm",
    "Synthetic case",
    "Client",
    "",
    Date.now(),
  );
  const cookie = "atlas_session=" + consumeLink(db, issueLink(db, "owner")!);
  const fake = fakeS3();
  let fail = true;
  const storage = createEvidenceStorage(dir, s3Config, {
    ...fake.transport,
    put: async (input) => {
      if (fail) throw new Error("Synthetic AccessDenied");
      return fake.transport.put(input);
    },
  });
  const server = createApp(db, {
    dataDir: dir,
    origin: "http://localhost",
    send: async () => {},
    evidenceStorage: storage,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const upload = () => {
    const body = new FormData();
    body.append("file", new Blob(["source"]), "source.txt");
    return fetch(base + "/api/cases/case/evidence", {
      method: "POST",
      headers: { origin: "http://localhost", cookie },
      body,
    });
  };
  try {
    assert.equal((await upload()).status, 500);
    assert.equal(db.prepare("SELECT count(*) AS n FROM evidence").get()?.n, 0);
    fail = false;
    const ok = await upload();
    assert.equal(ok.status, 201);
    const { id } = (await ok.json()) as { id: string };
    const url = base + `/api/cases/case/evidence/${id}`;
    const good = await fetch(url, { headers: { cookie } });
    assert.equal(await good.text(), "source");
    assert.match(good.headers.get("content-disposition")!, /^attachment/);
    fake.objects.set(`${fake.puts[0].Key}:v1`, Buffer.from("broken"));
    const corrupted = await fetch(url, { headers: { cookie } });
    assert.equal(corrupted.status, 409);
    assert.equal((await fetch(url)).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
