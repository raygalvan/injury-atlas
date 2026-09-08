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
    assert.ok(session.tools.some(t => t.name === "read_afp_memory"));
    assert.match(session.instructions,/AFP direction/);
    return Response.json({ value: "synthetic-voice-secret" });
  }
  assert.equal(String(url), "https://api.openai.com/v1/responses");
  const b = JSON.parse(options.body);
  assert.match(b.instructions, /Hello Ray/);
  const lastUser=[...b.input].reverse().find(i=>i.role==='user');
  if(JSON.stringify(lastUser).includes("Make the Select Injuries button blue for me") && !b.input.some(i=>i.type === "function_call_output"))return Response.json({output:[{type:"function_call",name:"set_private_afp_presentation",call_id:"browser-lab-text",arguments:JSON.stringify({action:"set",selectInjuriesColor:"blue"})}]});
  if(JSON.stringify(lastUser).includes("Change Text Chat to My Text for me") && !b.input.some(i=>i.type === "function_call_output")) {
    return Response.json({output:[{type:"function_call",name:"set_private_afp_ui_preference",call_id:"browser-text-preference",arguments:JSON.stringify({action:"set",textTabLabel:"My Text"})}]});
  }
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
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
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
  page.setDefaultTimeout(45000);
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
  await page.getByRole("textbox",{name:"Message",exact:true}).fill("Change Text Chat to My Text for me");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await page.getByRole("button",{name:"My Text",exact:true}).waitFor();
  await page.goto("http://127.0.0.1:3198/settings?afpView=permissions#afp");
  await page.getByLabel("AFP permission preset",{exact:true}).selectOption("Safe");
  await page.waitForFunction(()=>document.querySelector('[aria-label="AFP permission preset"]').value==='Safe');
  await page.getByRole("switch",{name:"AFP Lab Mode",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="AFP permission preset"]').value==='Lab');
  assert.equal(await page.getByLabel("UI colors and styling permission",{exact:true}).inputValue(),"Allow Automatically");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:"artifacts/production/afp-lab-permissions-mobile.png",fullPage:true});
  await page.goto("http://127.0.0.1:3198/coordinator");
  await page.getByRole("textbox",{name:"Message",exact:true}).fill("Make the Select Injuries button blue for me");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await page.getByText("Private Atlas presentation applied",{exact:true}).waitFor();
  const colorPage=await context.newPage();await colorPage.setViewportSize({width:1440,height:1000});
  await colorPage.goto("http://127.0.0.1:3198/atlas");
  const colorTab=colorPage.frameLocator('iframe').getByRole('tab',{name:'Select Injuries',exact:true});
  await colorTab.waitFor();
  await colorPage.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.querySelector('.apply-tab')?.getAttribute('data-afp-color')==='blue');
  assert.equal(await colorTab.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(29, 78, 216)');
  await colorPage.screenshot({path:"artifacts/production/afp-blue-select-desktop.png",fullPage:true});
  await colorPage.setViewportSize({width:390,height:844});
  await colorPage.frameLocator('iframe').getByRole('button',{name:'Open atlas layers',exact:true}).click();
  await colorTab.waitFor();
  await colorPage.close();
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
  await page.evaluate(()=>window.__voiceEvent({type:"response.done",response:{id:"voice-pref",status:"completed",output:[{type:"function_call",status:"completed",name:"set_private_afp_ui_preference",call_id:"browser-voice-preference",arguments:JSON.stringify({action:"set",textTabLabel:"Text"})}]}}));
  await page.getByRole("button",{name:"Text",exact:true}).waitFor();
  await page.evaluate(()=>window.__voiceEvent({type:"response.done",response:{id:"lab-color",status:"completed",output:[{type:"function_call",status:"completed",name:"set_private_afp_presentation",call_id:"browser-lab-voice",arguments:JSON.stringify({action:"set",selectInjuriesColor:"blue"})}]}}));
  await page.waitForFunction(()=>window.__voiceSent.some(e=>e.item?.call_id==='browser-lab-voice'));
  assert.ok(db.prepare("SELECT body FROM afp_preference_audit").all().some(r=>{const h=JSON.parse(r.body);return h.featureId==='private-atlas-select-color'&&h.source==='voice coordinator'&&h.labAuthorized;}));

  await page.screenshot({path:"artifacts/production/afp-private-label-desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"artifacts/production/afp-private-label-mobile.png",fullPage:true});
  for(const [id,firm] of [["peer","synthetic"],["other-firm","another"]]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(id,id+"@example.test",id,"attorney",firm);
    const isolated=await browser.newContext({viewport:{width:390,height:844}});
    await isolated.addCookies([{name:"atlas_session",value:consumeLink(db,issueLink(db,id)),domain:"127.0.0.1",path:"/"}]);
    const otherPage=await isolated.newPage();await otherPage.route("**/api/assistant/realtime-session",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Voice disabled in this isolation check"})}));await otherPage.goto("http://127.0.0.1:3198/coordinator");
    await otherPage.getByRole("button",{name:"Text Chat",exact:true}).waitFor();
    assert.equal(await otherPage.getByRole("button",{name:"Text",exact:true}).count(),0);
    await otherPage.setViewportSize({width:1440,height:1000});
    await otherPage.goto("http://127.0.0.1:3198/atlas");
    const defaultTab=otherPage.frameLocator('iframe').getByRole('tab',{name:'Select Injuries',exact:true});await defaultTab.waitFor();
    assert.equal(await defaultTab.getAttribute('data-afp-color'),'default');
    assert.notEqual(await defaultTab.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(29, 78, 216)');
    await isolated.close();
  }
  assert.ok(db.prepare("SELECT body FROM afp_preference_audit").all().some(r=>JSON.parse(r.body).source === "voice coordinator"));
  await page.evaluate(() => {
    const event={type:"response.done",response:{id:"synthetic-afp",status:"completed",output:[{type:"function_call",status:"completed",name:"record_afp_note",call_id:"browser-afp",arguments:JSON.stringify({kind:"recommendation",title:"Private feature previews",content:"Preview extensions and their costs before activation."})}]}};
    window.__voiceEvent(event);window.__voiceEvent(event);
  });
  await page.getByText("AFP note saved",{exact:true}).waitFor();
  assert.equal(db.prepare("SELECT count(*) n FROM afp_entries").get().n,1);
  assert.equal(db.prepare("SELECT status FROM afp_entries").get().status,"proposed");
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
  await page.goto("http://127.0.0.1:3198/settings#afp");
  await page.getByRole("heading",{name:"AFP Management",exact:true}).waitFor();
  const tab=label=>page.getByRole("tab",{name:label,exact:true});
  for(const label of ["Overview","AFP Readiness","Extension Points","Permissions","Resources","AFP Features","Memory & Decisions"]){
    await tab(label).click();
    assert.equal(await tab(label).getAttribute("aria-selected"),"true");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await tab("Permissions").click();
  await page.getByText("Shared developer policies",{exact:true}).click();
  assert.equal(await page.getByText("Protected · locked",{exact:true}).count(),4);
  await page.getByLabel("UI additions policy",{exact:true}).selectOption("Approval Required");
  await page.getByText("AFP control-plane record saved.",{exact:true}).waitFor();
  await page.reload();
  await page.getByText("Shared developer policies",{exact:true}).click();
  assert.equal(await page.getByLabel("UI additions policy",{exact:true}).inputValue(),"Approval Required");
  await tab("AFP Readiness").click();
  await page.getByRole("button",{name:"Review Extension Point Registry",exact:true}).click();
  await page.getByLabel("Readiness status",{exact:true}).selectOption("Verified");
  await page.getByLabel("Implementation / verification reference",{exact:true}).fill("Synthetic browser registry review");
  await page.getByRole("button",{name:"Save readiness review",exact:true}).click();
  await page.getByText("AFP control-plane record saved.",{exact:true}).waitFor();
  await tab("AFP Features").click();
  await page.getByRole("heading",{name:"No additional feature definitions",exact:true}).waitFor();
  await page.locator(".afp-private-preference").getByText("Text / Text",{exact:true}).waitFor();
  await page.locator(".afp-private-preference").screenshot({path:"artifacts/production/afp-private-feature-mobile.png"});
  await page.locator(".afp-private-preference").getByRole("button",{name:"Disable private preference",exact:true}).click();
  await page.locator(".afp-private-preference").getByText("Default / Text Chat",{exact:true}).waitFor();
  await page.locator(".afp-private-preference").getByRole("button",{name:"Remove private preference",exact:true}).click();
  await page.locator(".afp-private-preference").getByRole("button",{name:"View preference history",exact:true}).click();
  await page.locator(".afp-private-preference li").first().waitFor();
  await page.locator(".afp-private-color").getByRole("button",{name:"Remove private preference",exact:true}).click();
  await page.locator(".afp-private-color").getByText("Default / default",{exact:true}).waitFor();
  const resetPage=await context.newPage();await resetPage.setViewportSize({width:1440,height:1000});await resetPage.goto("http://127.0.0.1:3198/atlas");
  const resetTab=resetPage.frameLocator('iframe').getByRole('tab',{name:'Select Injuries',exact:true});await resetTab.waitFor();assert.equal(await resetTab.getAttribute('data-afp-color'),'default');await resetPage.close();
  const checkPage=await context.newPage();await checkPage.goto("http://127.0.0.1:3198/coordinator");
  await checkPage.getByRole("button",{name:"Text Chat",exact:true}).waitFor();await checkPage.close();
  await page.getByRole("button",{name:"New manifest draft",exact:true}).click();
  await page.getByRole("button",{name:"Validate manifest",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Compatible"}).waitFor();
  const manifestText=await page.getByLabel("Manifest JSON",{exact:true}).inputValue();
  await page.getByLabel("Manifest JSON",{exact:true}).fill(JSON.stringify({...JSON.parse(manifestText),activation:true},null,2));
  await page.getByRole("button",{name:"Validate manifest",exact:true}).click();
  await page.getByText("activation_unavailable",{exact:true}).waitFor();
  await page.getByLabel("Manifest JSON",{exact:true}).fill(manifestText);
  await page.getByRole("button",{name:"Save manifest draft",exact:true}).click();
  await page.getByRole("button",{name:"Inspect manifest",exact:true}).waitFor();
  await page.reload();
  await page.getByRole("button",{name:"Inspect manifest",exact:true}).click();
  assert.equal(JSON.parse(await page.getByLabel("Manifest JSON",{exact:true}).inputValue()).schemaVersion,"injury.bot.afp/0.1");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator(".afp-manifest-inspector").screenshot({path:"artifacts/production/afp-manifest-mobile.png"});

  await tab("Overview").click();
  assert.ok(await page.locator(".afp-control-header").evaluate(el=>el.scrollHeight<=el.clientHeight+1));
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"artifacts/production/afp-control-mobile.png",fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"artifacts/production/afp-control-desktop.png",fullPage:true});
  await tab("Overview").focus();
  await page.keyboard.press("End");
  assert.equal(await tab("Memory & Decisions").getAttribute("aria-selected"),"true");
  await page.setViewportSize({width:390,height:844});

  await page.getByRole("heading",{name:"Private feature previews",exact:true}).waitFor();
  await page.getByLabel("What should we work toward next?",{exact:true}).fill("Preview before activation.");
  await page.getByRole("button",{name:"Save AFP direction",exact:true}).click();
  await page.getByText("AFP memory saved. The coordinator can read this update now.",{exact:true}).waitFor();
  assert.equal(db.prepare("SELECT priorities FROM afp_direction").get().priorities,"Preview before activation.");
  await page.getByRole("button",{name:"Review record",exact:true}).click();
  await page.getByLabel("Progress status",{exact:true}).selectOption("planned");
  await page.getByRole("button",{name:"Save AFP record",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".afp-entries")?.textContent.includes("Planned"));
  assert.equal(db.prepare("SELECT status FROM afp_entries").get().status,"planned");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator("#afp").screenshot({path:"artifacts/production/afp-mobile.png"});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator("#afp").screenshot({path:"artifacts/production/afp-desktop.png"});
  await page.getByRole("link",{name:"Discuss AFP with the coordinator",exact:true}).click();
  await page.getByText(/Hello Ray, let’s work on AFP/).waitFor();
  await page.getByText("Live",{exact:true}).waitFor();
  await page.evaluate(()=>window.__voiceEvent({type:"response.done",response:{id:"afp-read",status:"completed",output:[{type:"function_call",status:"completed",name:"read_afp_memory",call_id:"afp-fresh",arguments:"{}"}]}}));
  await page.getByText("AFP memory",{exact:true}).waitFor();
  await page.waitForFunction(()=>window.__voiceSent.some(e=>e.item?.call_id==="afp-fresh"));
  const afpRead=await page.evaluate(()=>window.__voiceSent.find(e=>e.item?.call_id==="afp-fresh").item.output);
  assert.equal(JSON.parse(afpRead).direction.priorities,"Preview before activation.");
  assert.equal(JSON.parse(afpRead).controlPlane.readiness.find(r=>r.id==="extension-registry").status,"Verified");
  assert.equal(JSON.parse(afpRead).controlPlane.runtime.provisioning,false);
  assert.equal(JSON.parse(afpRead).controlPlane.sdkBoundary.implemented,true);
  await page.screenshot({path:"artifacts/production/afp-voice-memory.png",fullPage:true});
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
