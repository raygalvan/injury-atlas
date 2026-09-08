import { usageSummary, usagePolicySchema } from "./usage";
import { AiError } from "./error";
import type express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { audit, canAccessCase, type Store, type User } from "../store";
import { isPlatformAdmin } from "../production";
import { providers, agentRoster, type AiSettings } from "../../shared/ai";
import {
  readSettings,
  saveSettings,
  firmScope,
  credentialSummaries,
  saveCredential,
} from "./settings";
import { validateProviderKey } from "./providers";
import { credentialVaultReady } from "./vault";
import { integrationStatus, connectionRoutes } from "./connections";
export function settingsRoutes(
  app: express.Express,
  db: Store,
  staff: express.RequestHandler,
) {
  const admin: express.RequestHandler = (_req, res, next) => {
    if (
      _req.query.scope === "platform" &&
      !isPlatformAdmin(db, res.locals.user)
    )
      return res
        .status(403)
        .json({ error: "Platform administrator access required." });
    if (
      res.locals.user.role !== "owner" &&
      !isPlatformAdmin(db, res.locals.user)
    )
      return res.status(403).json({ error: "Administrator access required" });
    next();
  };
  function scope(req: express.Request, u: User) {
    if (req.query.scope === "platform") {
      if (!isPlatformAdmin(db, u))
        throw new AiError("Platform administrator access required.");
      return "platform";
    }
    return firmScope(u.firm_id);
  }
  app.get("/api/settings", staff, admin, (req, res) => {
    const u = res.locals.user as User,
      s = scope(req, u);
    res.json({
      scope: s === "platform" ? "platform" : "firm",
      platformAdmin: isPlatformAdmin(db, u),
      settings: readSettings(db, s),
      costs: usageSummary(db, s === "platform" ? null : u.firm_id),
      credentials: credentialSummaries(db, s),
      vaultReady: credentialVaultReady(),
      memories: db
        .prepare(
          "SELECT id,case_id,content,state,source FROM ai_memories WHERE scope=? ORDER BY created DESC",
        )
        .all(s),
      cases: db
        .prepare("SELECT id,title FROM cases WHERE firm_id=? AND archived=0")
        .all(u.firm_id),
      integrations: integrationStatus(db, u),
      usage: db
        .prepare(
          "SELECT agent,provider,model,created FROM ai_usage WHERE firm_id=? ORDER BY created DESC LIMIT 30",
        )
        .all(u.firm_id),
    });
  });
  app.post("/api/settings/config", staff, admin, (req, res) => {
    const u = res.locals.user as User,
      s = scope(req, u),
      current = readSettings(db, s);
    const section = z
      .enum(["instructions", "models", "credentials", "agent", "voice", "usage"])
      .parse(req.body.section);
    const v = req.body.value;
    if (section === "usage") {
      if (s !== "platform" || !isPlatformAdmin(db,u)) return res.status(403).json({error:"Only the super admin can change testing and cost policy."});
      const policy = usagePolicySchema.parse(v);
      db.prepare("INSERT INTO ai_cost_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(policy));
      // Backfill only previously unpriced, provider-reported calls. Never rewrite recorded estimates.
      for (const r of policy.rates) db.prepare(`UPDATE ai_call_usage SET estimated_usd=(input_tokens*?+output_tokens*?+cached_tokens*?+cache_write_tokens*?)/1000000.0+searches*?/1000.0 WHERE provider=? AND model=? AND reported=1 AND input_tokens+cached_tokens+cache_write_tokens<=200000 AND estimated_usd IS NULL`).run(r.input,r.output,r.cachedInput,r.cacheWrite,r.searchPerThousand,r.provider,r.model);
      audit(db,u.id,"settings.usage-updated");
      return res.json({ok:true});
    }
    if (section === "instructions") current.instructions = v;
    if (section === "models") {
      current.models = v.models;
      current.dailyRunLimit = v.dailyRunLimit;
      current.researchWebEnabled = v.researchWebEnabled;
    }
    if (section === "credentials") current.credentialSource = v;
    if (section === "voice") current.voice = v;
    if (section === "agent") {
      if (!agentRoster.some((a) => a.id === req.body.agentId))
        throw new AiError("Unknown agent.");
      current.agents[req.body.agentId as keyof AiSettings["agents"]] = v;
    }
    saveSettings(db, s, current, u);
    res.json({ ok: true });
  });
  app.post("/api/settings/credentials", staff, admin, async (req, res) => {
    const u = res.locals.user as User,
      s = scope(req, u),
      provider = z.enum(providers).parse(req.body.provider);
    if (req.body.action === "remove") {
      db.prepare("DELETE FROM ai_credentials WHERE scope=? AND provider=?").run(
        s,
        provider,
      );
      audit(db, u.id, "settings.credential-removed");
    } else {
      const key = z.string().trim().min(12).max(4096).parse(req.body.key);
      await validateProviderKey(provider, key);
      saveCredential(db, s, provider, key, u);
    }
    res.json({ ok: true });
  });
  app.post("/api/settings/memory", staff, admin, (req, res) => {
    const u = res.locals.user as User,
      s = scope(req, u),
      action = z
        .enum(["add", "approve", "reject", "delete"])
        .parse(req.body.action);
    if (action === "add") {
      const content = z
          .string()
          .trim()
          .min(1)
          .max(4000)
          .parse(req.body.content),
        caseId = z.string().max(120).optional().parse(req.body.caseId) || null;
      if (caseId && (s === "platform" || !canAccessCase(db, u, caseId)))
        return res.status(400).json({ error: "Choose a case from this firm." });
      db.prepare("INSERT INTO ai_memories VALUES(?,?,?,?,?,?,?,?)").run(
        randomUUID(),
        s,
        caseId,
        content,
        "approved",
        "admin",
        u.id,
        Date.now(),
      );
    } else {
      const id = z.string().max(120).parse(req.body.id);
      const r =
        action === "delete"
          ? db
              .prepare("DELETE FROM ai_memories WHERE id=? AND scope=?")
              .run(id, s)
          : db
              .prepare("UPDATE ai_memories SET state=? WHERE id=? AND scope=?")
              .run(action === "approve" ? "approved" : "rejected", id, s);
      if (!r.changes)
        return res.status(404).json({ error: "Memory unavailable." });
    }
    audit(db, u.id, "settings.memory-" + action);
    res.json({ ok: true });
  });
  connectionRoutes(app, db, staff, admin);
}
