import { randomUUID } from "node:crypto";
import type express from "express";
import { z } from "zod";
import { audit, type Store, type User } from "../store";
import { afpAdmin } from "./management";
import { credentialFor } from "../ai/settings";
import { verifyExecutorToken } from "./executor-auth";
export function ensureDevelopment(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS afp_development_jobs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,firm_id TEXT NOT NULL,request TEXT NOT NULL,delivery TEXT NOT NULL,source TEXT NOT NULL,state TEXT NOT NULL,run_id TEXT,pr_url TEXT,commit_sha TEXT,result TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS afp_development_control(actor TEXT PRIMARY KEY,enabled INTEGER NOT NULL);`);
}
export function developmentAllowed(db: Store, u: User) {
  ensureDevelopment(db);
  const fresh = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(u.id) as User | undefined;
  return !!fresh && afpAdmin(db, fresh) && db.prepare("SELECT enabled FROM afp_development_control WHERE actor=?").get(u.id)?.enabled !== 0;
}
export const developmentRequest = z.strictObject({ request: z.string().trim().min(5).max(12000), delivery: z.enum(["deploy", "pull_request"]).default("deploy") });
export function queueDevelopment(db: Store, u: User, input: unknown, source: string) {
  ensureDevelopment(db);
  if (!developmentAllowed(db, u)) throw Error("Application-owner development access required");
  const p = developmentRequest.parse(input);
  if (!credentialFor(db, u.firm_id, "openai")) throw Error("Connect an OpenAI API key in Settings before starting the coding worker.");
  const id = randomUUID(), now = Date.now();
  db.prepare("INSERT INTO afp_development_jobs(id,actor,firm_id,request,delivery,source,state,created,updated) VALUES(?,?,?,?,?,?,'queued',?,?)").run(id,u.id,u.firm_id,p.request,p.delivery,source,now,now);
  audit(db,u.id,`afp.development.queued:${id}:${p.delivery}`);
  return { id, state: "queued", delivery: p.delivery, message: "Coding task queued. The GitHub worker normally checks every five minutes; GitHub scheduling can take longer. Queued does not mean changed or deployed." };
}
export function developmentStatus(db: Store,u: User,id?: string) {
  ensureDevelopment(db);
  if (!developmentAllowed(db,u)) throw Error("Application-owner development access required");
  return id ? db.prepare("SELECT * FROM afp_development_jobs WHERE id=? AND actor=? AND firm_id=?").get(id,u.id,u.firm_id) || null : db.prepare("SELECT * FROM afp_development_jobs WHERE actor=? AND firm_id=? ORDER BY created DESC LIMIT 30").all(u.id,u.firm_id);
}
export function developmentRoutes(app: express.Express,db: Store,staff: express.RequestHandler) {
  ensureDevelopment(db);
  // One-time handoff of the owner's explicit, previously blocked button request.
  // No synthetic case or evidence data is created and no job is seeded for other accounts.
  const handoff="owner-mobile-evidence-alignment-v1";
  if (!db.prepare("SELECT id FROM afp_migrations WHERE id=?").get(handoff)) {
    const owner=db.prepare("SELECT * FROM users WHERE email='raygalvan@gmail.com' AND active=1").get() as User | undefined;
    if(owner && developmentAllowed(db,owner) && credentialFor(db,owner.firm_id,"openai")) {
      db.exec("BEGIN IMMEDIATE");
      try {
        queueDevelopment(db,owner,{request:"Implement my previously requested change: left-align the content inside all four numbered buttons on the Evidence page on mobile, starting with #1, rather than centering it. Preserve desktop layout and existing actions. This is an application-owner UI change. Verify the actual mobile result. Do not change unrelated features.",delivery:"deploy"},"owner request handoff");
        db.prepare("INSERT INTO afp_migrations VALUES(?)").run(handoff);
        db.exec("COMMIT");
      } catch(e) {db.exec("ROLLBACK");throw e;}
    }
  }
  app.get("/api/afp/development",staff,(req,res)=> {
    if (!afpAdmin(db,res.locals.user)) return res.status(403).json({error:"Application owner required"});
    res.json({ enabled: developmentAllowed(db,res.locals.user), keyConfigured: !!credentialFor(db,res.locals.user.firm_id,"openai"), jobs: db.prepare("SELECT * FROM afp_development_jobs WHERE actor=? AND firm_id=? ORDER BY created DESC LIMIT 30").all(res.locals.user.id,res.locals.user.firm_id) });
  });
  app.post("/api/afp/development/control",staff,(req,res)=> {
    if (!afpAdmin(db,res.locals.user)) return res.status(403).json({error:"Application owner required"});
    const p=z.strictObject({enabled:z.boolean()}).parse(req.body);
    db.prepare("INSERT INTO afp_development_control VALUES(?,?) ON CONFLICT(actor) DO UPDATE SET enabled=excluded.enabled").run(res.locals.user.id,p.enabled?1:0);
    audit(db,res.locals.user.id,`afp.development.control:${p.enabled}`);
    res.json({ok:true});
  });
}
/** Mounted before browser Origin middleware; each request instead requires signed runner identity. */
export function executorRoutes(app: express.Express,db: Store,authenticate=verifyExecutorToken) {
  ensureDevelopment(db);
  app.post("/api/afp/executor/:operation",async(req,res)=> {
    let runId: string;
    try { runId=await authenticate((req.headers.authorization||"").replace(/^Bearer /,"")); }
    catch { return res.status(401).json({error:"Verified development runner required"}); }
    res.set("Cache-Control","no-store");
    if (req.params.operation === "claim") {
      const expired=db.prepare("UPDATE afp_development_jobs SET state='failed',result='Worker exceeded its lease or stopped. Submit a new task to retry.',updated=? WHERE state='running' AND updated<? RETURNING id,actor").all(Date.now(),Date.now()-125*60000);
      for(const job of expired) audit(db,String(job.actor),`afp.development.expired:${job.id}`);
      const job=db.prepare("SELECT * FROM afp_development_jobs WHERE state='queued' ORDER BY created LIMIT 1").get();
      if (!job) return res.json({job:null});
      const u=db.prepare("SELECT * FROM users WHERE id=? AND firm_id=? AND active=1").get(job.actor,job.firm_id) as User | undefined;
      if (!u || !developmentAllowed(db,u)) {
        db.prepare("UPDATE afp_development_jobs SET state='cancelled',result='Owner access revoked',updated=? WHERE id=?").run(Date.now(),job.id);
        return res.json({job:null});
      }
      const key=credentialFor(db,u.firm_id,"openai");
      if (!key) return res.status(503).json({error:"Coding provider is not configured"});
      const claimed=db.prepare("UPDATE afp_development_jobs SET state='running',run_id=?,updated=? WHERE id=? AND state='queued' RETURNING id").get(runId,Date.now(),job.id);
      if (!claimed) return res.json({job:null});
      audit(db,u.id,`afp.development.claimed:${job.id}:${runId}`);
      return res.json({job:{id:job.id,request:job.request,delivery:job.delivery},openaiKey:key});
    }
    if (req.params.operation === "authorize") {
      const p=z.strictObject({id:z.string().uuid()}).parse(req.body);
      const job=db.prepare("SELECT * FROM afp_development_jobs WHERE id=? AND run_id=? AND state='running'").get(p.id,runId);
      const u=job&&db.prepare("SELECT * FROM users WHERE id=? AND firm_id=? AND active=1").get(job.actor,job.firm_id) as User | undefined;
      if(!u||!developmentAllowed(db,u))return res.status(403).json({error:"Owner development access is no longer active"});
      return res.json({ok:true});
    }
    if (req.params.operation === "complete") {
      const p=z.strictObject({id:z.string().uuid(),state:z.enum(["failed","no_changes","pull_request","merged"]),prUrl:z.string().regex(/^https:\/\/github\.com\/raygalvan\/injury-atlas\/pull\/\d+$/).optional(),commit:z.string().regex(/^[0-9a-f]{40}$/).optional(),result:z.string().max(1000)}).parse(req.body);
      const row=db.prepare("UPDATE afp_development_jobs SET state=?,pr_url=?,commit_sha=?,result=?,updated=? WHERE id=? AND run_id=? AND state='running' RETURNING actor").get(p.state,p.prUrl||null,p.commit||null,p.result,Date.now(),p.id,runId);
      if (!row) return res.status(409).json({error:"Task is not owned by this run or already completed"});
      audit(db,String(row.actor),`afp.development.${p.state}:${p.id}:${runId}`);
      return res.json({ok:true});
    }
    return res.status(404).json({error:"Unknown operation"});
  });
}
