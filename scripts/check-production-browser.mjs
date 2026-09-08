// Synthetic local fixture only. No SES calls, production credentials or case data.
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { openStore, issueLink, consumeLink } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import {
  createProduction,
  productionSchema,
  productionRecord,
} from "../server/production.ts";
import { processProduction } from "../server/injury-worker.ts";
import { createEvidenceStorage } from "../server/evidence-storage.ts";
const require = createRequire(
  path.join(process.env.BROWSER_TOOLS || process.cwd(), "package.json"),
);
const { chromium } = require("playwright");
const dir = mkdtempSync(path.join(tmpdir(), "injury-browser-")),
  db = openStore(path.join(dir, "db.sqlite"));
const u = {
  id: "test-reviewer",
  name: "Synthetic reviewer",
  email: "reviewer@example.test",
  role: "owner",
  firm_id: "test-firm",
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
  origin: "http://127.0.0.1:3197",
  send: async () => {
    throw new Error("No test emails");
  },
}).listen(3197, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const storage = createEvidenceStorage(dir);
db.prepare(
  "INSERT INTO cases(id,firm_id,title,client,incident,created) VALUES(?,?,?,?,?,?)",
).run(
  "synthetic-case",
  u.firm_id,
  "Synthetic rendering proof",
  "Fictional test subject",
  "No real case evidence",
  Date.now(),
);
const fixtures = [
  {
    kind: "abrasion",
    parentId: "FJ2810",
    center: [0.172, 1.397, -0.1],
    normal: [0, 0, -1],
    widthMm: 70,
    heightMm: 58,
    depthMm: 0,
  },
  {
    kind: "subarachnoid",
    parentId: "FJ1833",
    center: [0.028, 1.693, 0.006],
    normal: [0, 1, 0],
    widthMm: 60,
    heightMm: 68,
    depthMm: 0.5,
  },
  {
    kind: "fracture",
    parentId: "FJ3229",
    center: [0.083, 1.387, 0.01],
    normal: [0, 0, 1],
    widthMm: 20,
    heightMm: 20,
    depthMm: 1.2,
  },
];
let browser;
try {
  for (const recipe of fixtures) {
    const r = createProduction(
      db,
      u,
      "synthetic-case",
      productionSchema.parse({
        name: `Synthetic ${recipe.kind} proof`,
        description: "Synthetic geometry, not a case finding.",
        measurementBasis:
          "Synthetic illustrative dimensions for validation only.",
        recipe,
      }),
    );
    await processProduction(db, storage, r.id);
    const result = productionRecord(db, r.id);
    assert.equal(result.state, "complete", result.error);
    assert.equal(
      result.assets.filter((a) => a.kind.startsWith("image-")).length,
      4,
    );
    db.prepare(
      "UPDATE injury_production SET applied=1,source_review=1,placement_review=1,render_review=1 WHERE id=?",
    ).run(r.id);
  }
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
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
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  mkdirSync("artifacts/production", { recursive: true });
  await page.goto("http://127.0.0.1:3197/injuries?case=synthetic-case");
  await page.getByRole("heading", { name: "Your injury workspace" }).waitFor();
  await page.locator(".production-row").first().click();
  await page.locator(".production-assets img").first().waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".production-assets img")].every(
      (img) => img.complete && img.naturalWidth === 2400,
    ),
  );
  await page.screenshot({
    path: "artifacts/production/desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create injury", exact: true })
    .click();
  await page
    .getByLabel("Injury name", { exact: true })
    .fill("Synthetic placement test");
  await page
    .getByLabel("Production method", { exact: true })
    .selectOption("fracture");
  await page
    .getByLabel("Target structure", { exact: true })
    .selectOption("FJ3229");
  const placement = page.frameLocator(
    'iframe[title="Choose injury placement on actual anatomy"]',
  );
  await placement.locator(".loading").waitFor({ state: "hidden" });
  await page.screenshot({
    path: "artifacts/production/placement.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/production/mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:3197/atlas?case=synthetic-case");
  const frame = page.frameLocator("iframe");
  await frame.locator('[data-production-count="3"]').waitFor();
  await frame
    .getByRole("button", { name: "Left second rib", exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/production/fracture-applied.png",
    fullPage: true,
  });
  await frame
    .getByRole("button", { name: "Left superior frontal gyrus", exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/production/brain-applied.png",
    fullPage: true,
  });
  await frame.getByRole("button", { name: "Skin", exact: true }).click();
  await frame.getByRole("button", { name: "back view", exact: true }).click();
  await page.screenshot({
    path: "artifacts/production/abrasion-applied.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Verified desktop/mobile production, all three actual rendered outputs, placement viewer, and registered atlas applications.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
