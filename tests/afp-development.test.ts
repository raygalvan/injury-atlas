import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import express from "express";
import { openStore, type User } from "../server/store";
import { ensureAi } from "../server/ai/settings";
import { executeCoordinatorTool, enabledTools } from "../server/ai/coordinator";
import { ensureDevelopment, executorRoutes, developmentAllowed } from "../server/afp/development";
import { verifyExecutorToken } from "../server/afp/executor-auth";
test("development OIDC rejects wrong repository, ref, workflow, audience, expiry and signatures",async()=>{
 const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
 const jwk={...publicKey.export({format:"jwk"}),kid:"development-test"};
 const fetcher=(async()=>Response.json({keys:[jwk]})) as typeof fetch;
 const now=Math.floor(Date.now()/1000), claims={iss:"https://token.actions.githubusercontent.com",aud:"injury.bot/afp-development",repository:"raygalvan/injury-atlas",ref:"refs/heads/main",workflow_ref:"raygalvan/injury-atlas/.github/workflows/afp-development.yml@refs/heads/main",event_name:"schedule",exp:now+300,nbf:now-1,run_id:"123"};
 const jwt=(extra={})=>{const parts=[{alg:"RS256",kid:jwk.kid},{...claims,...extra}].map(o=>Buffer.from(JSON.stringify(o)).toString("base64url")).join(".");return parts+"."+sign("RSA-SHA256",Buffer.from(parts),privateKey).toString("base64url")};
 assert.equal(await verifyExecutorToken(jwt(),fetcher),"123");
 for(const bad of [{repository:"evil/repo"},{ref:"refs/heads/other"},{workflow_ref:"raygalvan/injury-atlas/.github/workflows/ci.yml@refs/heads/main"},{aud:"other"},{exp:now-1},{event_name:"pull_request"},{run_id:"x"}])await assert.rejects(verifyExecutorToken(jwt(bad),fetcher));
 await assert.rejects(verifyExecutorToken(jwt().slice(0,-20)+"bad",fetcher));
});
test("owner text/voice coding tasks persist, resist spoofing, lease to one runner and preserve permission revocation",async()=>{
 const db=openStore(":memory:");ensureAi(db);ensureDevelopment(db);db.exec("CREATE TABLE platform_admins(user_id TEXT PRIMARY KEY)");
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="synthetic-development-key";
 const users:Record<string,User>={};
 for(const [id,role,firm] of [["owner","owner","a"],["peer","owner","b"]]){db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1)").run(id,id+"@example.test",id,role,firm);users[id]=db.prepare("SELECT * FROM users WHERE id=?").get(id) as User;}
 db.prepare("INSERT INTO platform_admins VALUES('owner')").run();
 const app=express();app.use(express.json());executorRoutes(app,db,async token=>{if(token!=="runner-1"&&token!=="runner-2")throw Error("bad");return token});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));const url=`http://127.0.0.1:${(server.address() as any).port}/api/afp/executor/`;
 const call=(operation:string,body={},token="runner-1")=>fetch(url+operation,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)});
 try{
  assert(!enabledTools(db,users.peer).some(t=>t.name==="execute_development_task"));
  await assert.rejects(executeCoordinatorTool(db,users.peer,"execute_development_task",{request:"Change a button"},"denied"));
  await assert.rejects(executeCoordinatorTool(db,users.owner,"execute_development_task",{request:"Change a button",actor:"peer"},"spoof"));
  const input={request:"Left-align the four Evidence action buttons on mobile",delivery:"pull_request"};
  await executeCoordinatorTool(db,users.owner,"execute_development_task",input,"text-1","text coordinator");
  await executeCoordinatorTool(db,users.owner,"execute_development_task",input,"text-1","text coordinator");
  await executeCoordinatorTool(db,users.owner,"execute_development_task",{request:"Add a new reusable workspace layout"},"voice-1","voice coordinator");
  assert.equal(db.prepare("SELECT count(*) n FROM afp_development_jobs").get()?.n,2);
  assert.deepEqual(db.prepare("SELECT source FROM afp_development_jobs ORDER BY created").all().map(r=>r.source),["text coordinator","voice coordinator"]);
  assert.equal((await call("claim",{},"bad")).status,401);
  const first=await (await call("claim")).json() as any;assert.equal(first.openaiKey,"synthetic-development-key");assert.equal(first.job.request,input.request);
  assert.equal((await call("complete",{id:first.job.id,state:"pull_request",result:"tested"},"runner-2")).status,409);
  assert.equal((await call("authorize",{id:first.job.id})).status,200);
  db.prepare("INSERT INTO afp_development_control VALUES('owner',0)").run();
  assert.equal(developmentAllowed(db,users.owner),false);
  assert.equal((await call("authorize",{id:first.job.id})).status,403);
  assert.equal((await (await call("claim")).json() as any).job,null);
  assert.equal((await call("complete",{id:first.job.id,state:"failed",result:"Owner disabled development"})).status,200);
  const audit=JSON.stringify(db.prepare("SELECT * FROM audit").all());assert(!audit.includes("synthetic-development-key"));assert.match(audit,/afp.development/);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old}
});
