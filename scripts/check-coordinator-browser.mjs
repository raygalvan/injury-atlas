import { recordUsage } from "../server/ai/usage.ts";
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
  if (String(url) === "https://api.openai.com/v1/realtime/client_secrets") {
    const session = JSON.parse(options.body).session;
    assert.ok(session.tools.some(t => t.name === "add_library_injury"));
    return Response.json({ value: "synthetic-voice-secret" });
  }
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
  // Exercise the real browser voice transport and authenticated action endpoint.
  // Only microphone, provider SDP and server events are synthetic; no email is sent.
  config.voice.enabled = true;
  config.agents["library-research"].provider = "openai";
  config.agents["library-research"].model = config.agents.coordinator.model;
  saveSettings(db, "platform", config, u);
  await context.addInitScript(() => {
    const audio = new AudioContext();
    navigator.mediaDevices.getUserMedia = async () => audio.createMediaStreamDestination().stream;
    window.__voiceSent = [];
    window.RTCPeerConnection = class {
      connectionState = "new";
      createDataChannel() {
        this.channel = { readyState: "connecting", send: raw => {
          const e = JSON.parse(raw); window.__voiceSent.push(e);
          if (e.type === "session.update") queueMicrotask(() => window.__voiceEvent({type:"session.updated"}));
          if (e.type === "response.create") queueMicrotask(() => {
            window.__voiceEvent({type:"response.created",response:{id:"synthetic-reply"}});
            window.__voiceEvent({type:"response.done",response:{id:"synthetic-reply",status:"completed",output:[]}});
          });
        }};
        window.__voiceEvent = e => this.channel.onmessage({data:JSON.stringify(e)});
        return this.channel;
      }
      addTrack() {}
      async createOffer() { return {type:"offer",sdp:"synthetic-offer"}; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = "connected"; this.onconnectionstatechange();
        this.channel.readyState = "open"; this.channel.onopen();
      }
      close() { this.connectionState = "closed"; this.channel.readyState = "closed"; }
    };
  });
  await page.route("https://api.openai.com/v1/realtime/calls**", route => route.fulfill({status:200,contentType:"application/sdp",body:"synthetic-answer"}));
  await page.reload();
  await page.getByText("Live", {exact:true}).waitFor();
  await page.evaluate(() => {
    window.__voiceEvent({type:"conversation.item.input_audio_transcription.completed",transcript:"Add a broken kneecap to my injury library"});
    const event = {type:"response.done",response:{id:"synthetic-action",status:"completed",output:[{type:"function_call",status:"completed",name:"add_library_injury",call_id:"browser-library",arguments:JSON.stringify({name:"Synthetic kneecap injury"})}]}};
    window.__voiceEvent(event); window.__voiceEvent(event);
  });
  await page.getByText("Library injury queued",{exact:true}).waitFor();
  const record = db.prepare("SELECT p.id FROM injury_publications p JOIN injury_library_jobs j ON j.publication_id=p.id WHERE p.firm_id=? AND j.state='queued'").all(u.firm_id);
  assert.equal(record.length, 1);
  await page.waitForFunction(() => window.__voiceSent.some(e => e.item?.type === "function_call_output"));
  const results = await page.evaluate(() => window.__voiceSent.filter(e => e.item?.type === "function_call_output"));
  assert.equal(results.length,1);
  assert.equal(JSON.parse(results[0].item.output).id, record[0].id);
  await page.screenshot({path:"artifacts/production/coordinator-voice-library-receipt.png",fullPage:true});
  await page.goto(`http://127.0.0.1:3198/injuries?library=${record[0].id}`);
  await page.locator(`#library-${record[0].id}`).waitFor();
  recordUsage({db,firmId:u.firm_id,userId:u.id,agent:"library-research",jobId:record[0].id},"anthropic","claude-opus-5",{usage:{input_tokens:1000,output_tokens:200}},"end_turn",100);
  await page.goto("http://127.0.0.1:3198/settings#usage");
  await page.getByRole("heading",{name:"Usage and pricing",exact:true}).waitFor();
  assert.equal(await page.getByLabel("Super-admin testing mode",{exact:true}).isChecked(),true);
  await page.getByLabel("Storage, review and support allowance per job, USD",{exact:true}).fill("2");
  await page.getByRole("button",{name:"Save usage and pricing",exact:true}).click();
  await page.getByText(/Changes saved and recorded/).waitFor();
  await page.getByLabel("Inspect a job",{exact:true}).selectOption(record[0].id);
  await page.getByText(/Price at 70% gross margin/).waitFor();
  assert.match(await page.locator(".usage-quote").innerText(),/\$6\.7000/);
  await page.locator("#usage").screenshot({path:"artifacts/production/usage-pricing-desktop.png"});
  await page.setViewportSize({width:390,height:844});
  await page.locator("#usage").scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator("#usage").screenshot({path:"artifacts/production/usage-pricing-mobile.png"});
  assert.deepEqual(errors, []);
  console.log(
    "Center button, personalized text turn, voice interface, minimize, settings save, mobile layout: passed. Voice event to saved library job and visible receipt passed with a synthetic WebRTC provider; live microphone/provider speech is not tested.",
  );
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
