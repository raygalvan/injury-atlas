import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { openStore, issueLink, consumeLink } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { createAfpSdk } from "../server/afp/sdk.ts";
import {
  defaults,
  saveSettings,
  saveCredential,
} from "../server/ai/settings.ts";
import { uiTargets } from "../server/afp/ui.ts";
const require = createRequire(
    path.join(process.env.BROWSER_TOOLS || process.cwd(), "package.json"),
  ),
  { chromium } = require("playwright");
const dir = mkdtempSync(path.join(tmpdir(), "afp-ui-browser-")),
  db = openStore(path.join(dir, "db.sqlite"));
for (const id of ["a", "b"])
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
    id,
    id + "@example.test",
    "Ray Example",
    "owner",
    id === "a" ? "one" : "two",
  );
const base = "http://127.0.0.1:3197",
  server = createApp(db, {
    dataDir: dir,
    origin: base,
    send: async () => {
      throw Error("No mail");
    },
  }).listen(3197, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
for (const id of ["a", "b"])
  db.prepare("INSERT INTO platform_admins VALUES(?)").run(id);
const u = db.prepare("SELECT * FROM users WHERE id='a'").get(),
  config = defaults();
config.voice.enabled = false;
saveSettings(db, "platform", config, u);
saveCredential(db, "platform", "openai", "synthetic-ui-key", u);
const target = uiTargets.find(
    (t) => t.label === "Discuss AFP with the coordinator",
  ),
  sdk = createAfpSdk(db, "a");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) !== "https://api.openai.com/v1/responses")
    return originalFetch(url, options);
  const body = JSON.parse(options.body);
  assert(body.tools.some((t) => t.name === "edit_private_afp_ui"));
  if (!body.input.some((i) => i.type === "function_call_output"))
    return Response.json({
      output: [
        {
          type: "function_call",
          name: "edit_private_afp_ui",
          call_id: "ui-browser-text",
          arguments: JSON.stringify({
            action: "set",
            targetId: target.id,
            revision: 0,
            styles: {
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 20,
              paddingRight: 20,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
            },
          }),
        },
      ],
    });
  return Response.json({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Saved privately. Open AFP Management to see the change.",
          },
        ],
      },
    ],
  });
};
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const contexts = [];
  for (const id of ["a", "b"]) {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await c.addCookies([
      {
        name: "atlas_session",
        value: consumeLink(db, issueLink(db, id)),
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    contexts.push(c);
  }
  const page = await contexts[0].newPage(),
    peer = await contexts[1].newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await peer.goto(base + "/settings#afp");
  const selector = `[data-afp-ui="${target.id}"]`;
  await peer.locator(selector).waitFor();
  const original = await peer
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).paddingTop);
  await page.goto(base + "/coordinator");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Fix Discuss AFP button padding for me");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByText("Saved privately. Open AFP Management to see the change.")
    .waitFor();
  await page.goto(base + "/settings#afp");
  await page.locator(selector).waitFor();
  await page.waitForFunction(
    (s) => getComputedStyle(document.querySelector(s)).paddingTop === "12px",
    selector,
  );
  await peer.reload();
  await peer.locator(selector).waitFor();
  assert.equal(
    await peer
      .locator(selector)
      .evaluate((el) => getComputedStyle(el).paddingTop),
    original,
  );
  await page.reload();
  await page.waitForFunction(
    (s) => getComputedStyle(document.querySelector(s)).paddingTop === "12px",
    selector,
  );
  db.prepare("INSERT INTO assistant_voice_sessions VALUES(?,?,?,?,?)").run(
    "synthetic-voice",
    "a",
    "one",
    null,
    Date.now() + 60000,
  );
  const response = await page.evaluate(
    async ({ id }) => {
      const r = await fetch("/api/assistant/tools/edit_private_afp_ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "synthetic-voice",
          callId: "ui-browser-voice",
          args: {
            action: "set",
            targetId: id,
            revision: 1,
            viewport: "mobile",
            styles: { paddingTop: 24 },
          },
        }),
      });
      return { status: r.status, body: await r.json() };
    },
    { id: target.id },
  );
  assert.equal(response.status, 200);
  assert.match(response.body.output, /saved/);
  await page.waitForFunction(
    (s) => getComputedStyle(document.querySelector(s)).paddingTop === "24px",
    selector,
  );
  mkdirSync("artifacts/production", { recursive: true });
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/production/afp-ui-mobile.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(
    (s) => getComputedStyle(document.querySelector(s)).paddingTop === "12px",
    selector,
  );
  await page.screenshot({
    path: "artifacts/production/afp-ui-desktop.png",
    fullPage: false,
  });
  // Another discovered surface, no new named-button tool or permission entry.
  const another = uiTargets.find(
    (t) => t.tag === "button" && t.label === "Refresh AFP state",
  );
  assert(another);
  assert.equal(
    sdk.editPrivateUi(
      {
        action: "set",
        targetId: another.id,
        revision: 0,
        styles: { borderRadius: 18, paddingLeft: 30 },
      },
      "settings",
    ).status,
    200,
  );
  await page.waitForFunction(
    (id) =>
      getComputedStyle(document.querySelector(`[data-afp-ui="${id}"]`))
        .paddingLeft === "30px",
    another.id,
  );
  assert.equal(
    sdk.editPrivateUi(
      { action: "disable", targetId: target.id, revision: 2 },
      "settings",
    ).status,
    200,
  );
  await page.waitForFunction(
    ({ s, v }) => getComputedStyle(document.querySelector(s)).paddingTop === v,
    { s: selector, v: original },
  );
  assert.equal(
    sdk.editPrivateUi(
      { action: "undo", targetId: target.id, revision: 3 },
      "settings",
    ).status,
    200,
  );
  await page.waitForFunction(
    (s) => getComputedStyle(document.querySelector(s)).paddingTop === "12px",
    selector,
  );
  const inspection = sdk.inspectPrivateUi({ targetId: target.id }).body;
  assert(inspection.targets[0].observations.length > 0);
  assert.equal(
    (
      await contexts[0].request.post(base + "/api/afp/ui", {
        headers: { Origin: base },
        data: {
          action: "set",
          targetId: target.id,
          revision: 4,
          ownerId: "b",
          styles: { paddingTop: 1 },
        },
      })
    ).status(),
    422,
  );
  assert.equal(
    (
      await browser
        .newContext()
        .then((c) => c.request.get(base + "/api/afp/ui"))
    ).status(),
    401,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real text route, voice tool route, mobile/desktop CSS, reload, peer isolation, disable/undo, observations and invalid/anonymous requests",
  );
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
