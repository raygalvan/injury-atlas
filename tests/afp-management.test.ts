import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, consumeLink, issueLink, type User } from "../server/store";
import { createApp } from "../server/app";
import { ensureAi, defaults, saveSettings, saveCredential, readSettings } from "../server/ai/settings";
import { afpMarkdown, readAfp } from "../server/afp/management";
import { coordinatorInstructions, enabledTools, executeCoordinatorTool } from "../server/ai/coordinator";

test("AFP memory persists, guards all routes and tools, keeps revisions and reaches voice sessions", async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"afp-")),db=openStore(path.join(dir,"test.sqlite"));
  const users:Record<string,User>={};
  for (const [id,role,firm] of [["admin","owner","a"],["owner","owner","b"],["atty","attorney","a"],["client","client","a"]]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(id,id+"@example.test",id,role,firm);
    users[id]=db.prepare("SELECT * FROM users WHERE id=?").get(id) as User;
  }
  const server=createApp(db,{dataDir:dir,origin:"http://localhost",send:async()=>{throw new Error("No mail in tests");}}).listen(0,"127.0.0.1");
  await new Promise<void>(r=>server.once("listening",r));
  db.prepare("INSERT INTO platform_admins VALUES('admin')").run();
  const base="http://127.0.0.1:"+(server.address() as any).port;
  const sessions=Object.fromEntries(Object.keys(users).map(id=>[id,consumeLink(db,issueLink(db,id)!)]));
  const originalFetch=globalThis.fetch;
  const call=(who:string,url:string,body?:unknown)=>originalFetch(base+"/api"+url,{method:body===undefined?"GET":"POST",headers:{cookie:"atlas_session="+sessions[who],origin:"http://localhost","content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    const initial=await (await call("admin","/settings/afp")).json();
    assert.match(initial.direction.vision,/AFP/);
    assert.ok(initial.baseline.gaps.some((v:string)=>v.includes("isolated")));
    for(const who of ["owner","atty","client"]) {
      for(const route of ["/settings/afp","/settings/afp/memory.md","/settings/afp/history/direction"]) assert.equal((await call(who,route)).status,403);
      for(const route of ["/settings/afp/direction","/settings/afp/entries","/settings/afp/entries/anything"]) assert.equal((await call(who,route,{})).status,403);
      assert.ok(!enabledTools(db,users[who]).some(t=>["read_afp_memory","record_afp_note"].includes(t.name)));
      assert.ok(!coordinatorInstructions(db,users[who],undefined).includes("AFP direction"));
      await assert.rejects(executeCoordinatorTool(db,users[who],"read_afp_memory",{},"forbidden"));
    }
    assert.equal((await call("admin","/settings/afp/direction",{vision:"Personal variations with protected evidence",priorities:"Inspect a feature before activating it",revision:initial.direction.revision})).status,200);
    assert.equal((await call("admin","/settings/afp/direction",{vision:"Stale overwrite",priorities:"",revision:initial.direction.revision})).status,409);
    assert.match(coordinatorInstructions(db,users.admin,undefined,true),/Inspect a feature before activating it/);
    assert.match(coordinatorInstructions(db,users.admin,undefined,true,true),/let’s work on AFP/);
    const note={kind:"recommendation",title:"Preview personal extensions",content:"Show a private preview with cost before activation."};
    const first=await executeCoordinatorTool(db,users.admin,"record_afp_note",note,"afp-note-1");
    const duplicate=await executeCoordinatorTool(db,users.admin,"record_afp_note",note,"afp-note-1");
    assert.deepEqual(first,duplicate);
    const saved=JSON.parse(first.speech);
    assert.equal(saved.status,"proposed");
    assert.equal(readAfp(db,users.admin).total,1);
    assert.match(afpMarkdown(db,users.admin),/Preview personal extensions/);
    assert.equal((await call("admin","/settings/afp/entries/"+saved.id,{...note,status:"verified",evidence:"",revision:1})).status,400);
    assert.equal((await call("admin","/settings/afp/entries/"+saved.id,{...note,status:"verified",evidence:"Synthetic PR and preview check",revision:1})).status,200);
    assert.equal((await call("admin","/settings/afp/entries/"+saved.id,{...note,status:"deferred",revision:1})).status,409);
    const revisions=await(await call("admin","/settings/afp/history/"+saved.id)).json();
    assert.equal(revisions.length,2);
    assert.equal(JSON.parse(revisions[1].body).status,"proposed");
    ensureAi(db);
    assert.equal(readAfp(db,users.admin).direction.vision,"Personal variations with protected evidence");
    assert.equal(readAfp(db,users.admin).entries[0].status,"verified");
    const exportResponse=await call("admin","/settings/afp/memory.md");
    assert.match(exportResponse.headers.get("content-disposition")!,/injury-bot-afp-memory.md/);
    assert.match(await exportResponse.text(),/Synthetic PR and preview check/);
    // Realtime uses the same current memory and actual AFP tools, with no live provider call.
    saveCredential(db,"platform","openai","synthetic-afp-provider-key",users.admin);
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),"https://api.openai.com/v1/realtime/client_secrets");
      const session=JSON.parse(String(options!.body)).session;
      assert.match(session.instructions,/Personal variations with protected evidence/);
      assert.match(session.instructions,/let’s work on AFP/);
      assert.match(session.instructions,/Do not merely recite/);
      assert.ok(session.tools.some((t:any)=>t.name==="read_afp_memory"));
      assert.ok(session.tools.some((t:any)=>t.name==="record_afp_note"));
      return Response.json({value:"synthetic-ephemeral-value"});
    };
    const voice=await(await call("admin","/assistant/realtime-session",{topic:"afp"})).json();
    assert.ok(voice.sessionId);
    const voiceArgs={sessionId:voice.sessionId,callId:"voice-afp-read",args:{}};
    const voiceResult=await(await call("admin","/assistant/tools/read_afp_memory",voiceArgs)).json();
    assert.equal(JSON.parse(voiceResult.output).entries[0].status,"verified");
    assert.equal((await call("owner","/assistant/tools/read_afp_memory",voiceArgs)).status,403);
    assert.equal((await call("admin","/assistant/tools/read_afp_memory",{...voiceArgs,sessionId:"invalid"})).status,403);
    const cfg=defaults();cfg.agents.coordinator.skills=cfg.agents.coordinator.skills.filter(s=>s!=="record_afp_note");
    saveSettings(db,"platform",cfg,users.admin);ensureAi(db);
    assert.ok(!enabledTools(db,users.admin).some(t=>t.name==="record_afp_note"));
    db.prepare("DELETE FROM platform_admins WHERE user_id='admin'").run();
    await assert.rejects(executeCoordinatorTool(db,users.admin,"record_afp_note",note,"afp-note-1"));
    assert.equal((await call("admin","/settings/afp")).status,403);
  } finally {globalThis.fetch=originalFetch;await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});}
});

test("existing agent configuration gains AFP tools once without resetting model choices or disabled skills",()=>{
  const db=openStore(":memory:");
  try {
    ensureAi(db);
    db.prepare("DELETE FROM afp_migrations").run();
    const s=defaults();s.agents.coordinator.enabled=false;s.agents.coordinator.model="chosen-model";s.agents.coordinator.skills=["find_cases"];
    db.prepare("INSERT INTO ai_settings VALUES('platform',?,0)").run(JSON.stringify(s));
    ensureAi(db);
    const migrated=readSettings(db,"platform");
    assert.equal(migrated.agents.coordinator.enabled,false);
    assert.equal(migrated.agents.coordinator.model,"chosen-model");
    assert.deepEqual(migrated.agents.coordinator.skills,["find_cases","read_afp_memory","record_afp_note","set_private_afp_ui_preference","set_private_afp_presentation","inspect_afp_capability"]);
    ensureAi(db);
    assert.deepEqual(readSettings(db,"platform"),migrated);
  } finally{db.close();}
});
