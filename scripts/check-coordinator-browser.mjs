// Synthetic accounts and provider responses; no mail, live keys or real case data.
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { openStore, issueLink, consumeLink } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import {
  defaults,
  saveSettings,
  saveCredential,
} from "../server/ai/settings.ts";
const require = createRequire(
  path.join(process.env.BROWSER_TOOLS || process.cwd(), "package.json"),
);
const { chromium } = require("playwright"),
  dir = mkdtempSync(path.join(tmpdir(), "coordinator-browser-")),
  db = openStore(path.join(dir, "db.sqlite"));
const u = {
  id: "synthetic",
  name: "Ray Example",
  role: "owner",
  firm_id: "synthetic",
  email: "fake@example.test",
  active: 1,
};
db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(
  u.id,
  u.email,
  u.name,
  u.role,
  u.firm_id,
);
const server = createApp(db, {
  dataDir: dir,
  origin: "http://127.0.0.1:3198",
  send: async () => {
    throw new Error("No mail in tests");
  },
}).listen(3198, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
db.prepare("INSERT INTO platform_admins VALUES(?)").run(u.id);
const config = defaults();
config.voice.enabled = false;
saveSettings(db, "platform", config, u);
saveCredential(db, "platform", "openai", "synthetic-browser-key", u);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://api.openai.com/v1/responses");
  const b = JSON.parse(options.body);
  assert.match(b.instructions, /Hello Ray/);
  return Response.json({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Great. Is the analysis for a new or existing client, or would you like to add an injury to your library?",
          },
        ],
      },
    ],
  });
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies([
    {
      name: "atlas_session",
      value: consumeLink(db, issueLink(db, u.id)),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  mkdirSync("artifacts/production", { recursive: true });
  await page.goto("http://127.0.0.1:3198/");
  const center = page.locator(".mobile-nav button").nth(2);
  assert.equal((await center.innerText()).trim(), "Coordinator");
  await center.click();
  await page.locator(".as-shell").waitFor();
  await page.getByText(/^Hello Ray, what would you like/).waitFor();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Start an injury analysis");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByText(/^Great. Is the analysis for a new or existing client/)
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "artifacts/production/coordinator-mobile-text.png",
  });
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.locator(".as-orb").waitFor();
  await page.screenshot({
    path: "artifacts/production/coordinator-mobile-voice.png",
  });
  await page.getByRole("button", { name: "Minimize coordinator" }).click();
  await center.waitFor();
  await page.goto("http://127.0.0.1:3198/settings");
  await page.getByRole("heading", { name: "Working instructions" }).waitFor();
  for (const name of [
    "What injury.bot may remember",
    "Agent instructions and skills",
    "Permitted models",
    "Credentials",
    "Integrations",
  ])
    await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/production/settings-mobile.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("main *")]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 20)
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        width: el.getBoundingClientRect().width,
        text: el.textContent?.slice(0, 60),
      })),
  }));
  assert.ok(overflow.scroll <= overflow.width, JSON.stringify(overflow));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "artifacts/production/settings-desktop.png",
    fullPage: true,
  });
  await page
    .locator("#instructions textarea")
    .fill("Ask one short question at a time.");
  await page.getByRole("button", { name: "Save instructions" }).click();
  await page.getByText(/Changes saved and recorded/).waitFor();
  assert.equal(
    JSON.parse(
      db.prepare("SELECT body FROM ai_settings WHERE scope='platform'").get()
        .body,
    ).instructions,
    "Ask one short question at a time.",
  );
  await page.goto("http://127.0.0.1:3198/coordinator");
  await page.locator(".as-shell").waitFor();
  await page.screenshot({
    path: "artifacts/production/coordinator-desktop.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Center button, personalized text turn, voice interface, minimize, settings save, mobile layout: passed. Live audio requires configured provider and microphone.",
  );
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
