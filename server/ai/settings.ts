import { AiError } from "./error";
// Adapted from law-bot settings, credentials and memory boundaries.
import { z } from "zod";
import { audit, type Store, type User } from "../store";
import {
  agentRoster,
  providers,
  type AiSettings,
  type AgentId,
  type Provider,
} from "../../shared/ai";
import { openCredential, sealCredential } from "./vault";
export { providerNames } from "../../shared/ai";
export const providerEnvNames = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
};
export function ensureAi(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_settings(scope TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_credentials(scope TEXT NOT NULL,provider TEXT NOT NULL,encrypted BLOB NOT NULL,suffix TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(scope,provider));
    CREATE TABLE IF NOT EXISTS ai_memories(id TEXT PRIMARY KEY,scope TEXT NOT NULL,case_id TEXT,content TEXT NOT NULL,state TEXT NOT NULL,source TEXT NOT NULL,creator TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_usage(id INTEGER PRIMARY KEY,firm_id TEXT NOT NULL,user_id TEXT NOT NULL,agent TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assistant_messages(id TEXT PRIMARY KEY,firm_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,modality TEXT NOT NULL,content TEXT NOT NULL,card TEXT,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assistant_actions(user_id TEXT NOT NULL,call_id TEXT NOT NULL,name TEXT NOT NULL,output TEXT NOT NULL,PRIMARY KEY(user_id,call_id));
    CREATE TABLE IF NOT EXISTS assistant_voice_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,firm_id TEXT NOT NULL,case_id TEXT,expires INTEGER NOT NULL);`);
}
export function defaults(): AiSettings {
  const anthropic = process.env.INJURY_AI_MODEL || "claude-opus-5";
  const openai = process.env.OPENAI_TEXT_MODEL || "gpt-6-astra";
  const xai = process.env.XAI_MODEL || "grok-4.6";
  return {
    instructions: "",
    credentialSource: "platform",
    dailyRunLimit: 100,
    researchWebEnabled: true,
    models: [
      { provider: "openai", model: openai, enabled: true },
      { provider: "anthropic", model: anthropic, enabled: true },
      { provider: "xai", model: xai, enabled: true },
    ],
    agents: Object.fromEntries(
      agentRoster.map((a) => [
        a.id,
        {
          enabled: true,
          instructions: "",
          provider: a.id === "coordinator" ? "openai" : "anthropic",
          model: a.id === "coordinator" ? openai : anthropic,
          skills: [...a.skills],
        },
      ]),
    ) as AiSettings["agents"],
    voice: {
      enabled: true,
      model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime",
      voice: process.env.OPENAI_REALTIME_VOICE || "marin",
      language: process.env.OPENAI_TRANSCRIPTION_LANGUAGE || "en",
    },
  };
}
export const settingsSchema = z.object({
  instructions: z.string().max(12000),
  credentialSource: z.enum(["platform", "firm"]),
  dailyRunLimit: z.number().int().min(1).max(1000),
  researchWebEnabled: z.boolean(),
  models: z
    .array(
      z.object({
        provider: z.enum(providers),
        model: z.string().trim().min(1).max(160),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(30),
  agents: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      instructions: z.string().max(8000),
      provider: z.enum(providers),
      model: z.string().trim().min(1).max(160),
      skills: z.array(z.string()).max(20),
    }),
  ),
  voice: z.object({
    enabled: z.boolean(),
    model: z.string().trim().min(1).max(160),
    voice: z.enum([
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "sage",
      "shimmer",
      "verse",
      "marin",
      "cedar",
    ]),
    language: z.string().regex(/^[a-z]{2}$/),
  }),
});
export const firmScope = (firmId: string) => `firm:${firmId}`;
export function readSettings(db: Store, scope: string): AiSettings {
  const platform = db
    .prepare("SELECT body FROM ai_settings WHERE scope='platform'")
    .get();
  const baseline = platform ? JSON.parse(String(platform.body)) : defaults();
  const row =
    scope === "platform"
      ? null
      : db.prepare("SELECT body FROM ai_settings WHERE scope=?").get(scope);
  return row ? JSON.parse(String(row.body)) : baseline;
}
export function effectiveSettings(db: Store, firmId: string) {
  return readSettings(db, firmScope(firmId));
}
export function saveSettings(
  db: Store,
  scope: string,
  input: unknown,
  user: User,
) {
  const data = settingsSchema.parse(input);
  for (const a of agentRoster) {
    const cfg = data.agents[a.id];
    if (!cfg || cfg.skills.some((s) => !a.skills.includes(s as never)))
      throw new AiError("Choose registered agents and skills.");
    if (
      cfg.enabled &&
      !data.models.some(
        (m) =>
          m.enabled && m.provider === cfg.provider && m.model === cfg.model,
      )
    )
      throw new AiError(`Enable the selected model for ${a.name}.`);
  }
  if (Object.keys(data.agents).length !== agentRoster.length)
    throw new AiError("Unknown agent setting.");
  if (scope === "platform") data.credentialSource = "platform";
  db.prepare(
    "INSERT INTO ai_settings VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET body=excluded.body,updated=excluded.updated",
  ).run(scope, JSON.stringify(data), Date.now());
  audit(db, user.id, "settings.ai-updated");
}
export function credentialFor(
  db: Store,
  firmId: string,
  provider: Provider,
): string {
  const settings = effectiveSettings(db, firmId);
  const scope =
    settings.credentialSource === "firm" ? firmScope(firmId) : "platform";
  const row = db
    .prepare(
      "SELECT encrypted FROM ai_credentials WHERE scope=? AND provider=?",
    )
    .get(scope, provider);
  if (row)
    return openCredential(
      row.encrypted as Uint8Array,
      { version: 1 },
      `provider:${scope}:${provider}`,
    );
  return scope === "platform"
    ? process.env[providerEnvNames[provider]]?.trim() || ""
    : "";
}
export function credentialSummaries(db: Store, scope: string) {
  return providers.map((provider) => {
    const row = db
      .prepare(
        "SELECT suffix,updated FROM ai_credentials WHERE scope=? AND provider=?",
      )
      .get(scope, provider);
    return {
      provider,
      saved: !!row,
      suffix: row?.suffix || "",
      updated: row?.updated || null,
      environment:
        scope === "platform" && !!process.env[providerEnvNames[provider]],
    };
  });
}
export function saveCredential(
  db: Store,
  scope: string,
  provider: Provider,
  key: string,
  user: User,
) {
  const sealed = sealCredential(key, `provider:${scope}:${provider}`);
  db.prepare(
    "INSERT INTO ai_credentials VALUES(?,?,?,?,?) ON CONFLICT(scope,provider) DO UPDATE SET encrypted=excluded.encrypted,suffix=excluded.suffix,updated=excluded.updated",
  ).run(scope, provider, sealed.encrypted, key.slice(-4), Date.now());
  audit(db, user.id, "settings.credential-saved");
}
export function agentConfig(db: Store, firmId: string, id: AgentId) {
  const s = effectiveSettings(db, firmId),
    a = s.agents[id];
  if (!a?.enabled) throw new AiError("This agent is disabled in Settings.");
  if (
    !s.models.some(
      (m) => m.enabled && m.provider === a.provider && m.model === a.model,
    )
  )
    throw new AiError("The selected agent model is disabled in Settings.");
  const apiKey = credentialFor(db, firmId, a.provider);
  if (!apiKey)
    throw new AiError(
      `Add a ${a.provider === "openai" ? "OpenAI" : a.provider === "anthropic" ? "Claude" : "Grok"} key for the selected credential source in Settings.`,
    );
  return { provider: a.provider, model: a.model, apiKey };
}
export function agentReady(db: Store, firmId: string, id: AgentId) {
  try {
    agentConfig(db, firmId, id);
    return true;
  } catch {
    return false;
  }
}
export function reserveRun(
  db: Store,
  user: Pick<User, "id" | "firm_id">,
  agent: AgentId | "voice",
  config: { provider: Provider; model: string },
) {
  const settings = effectiveSettings(db, user.firm_id),
    since = new Date().setUTCHours(0, 0, 0, 0);
  const r = db
    .prepare(
      "INSERT INTO ai_usage(firm_id,user_id,agent,provider,model,created) SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM ai_usage WHERE firm_id=? AND created>=?)<?",
    )
    .run(
      user.firm_id,
      user.id,
      agent,
      config.provider,
      config.model,
      Date.now(),
      user.firm_id,
      since,
      settings.dailyRunLimit,
    );
  if (!r.changes)
    throw new AiError(
      "The daily AI run limit has been reached. Adjust it in Settings or try tomorrow.",
    );
}
export function memoryContext(db: Store, firmId: string, caseId?: string) {
  return db
    .prepare(
      "SELECT content FROM ai_memories WHERE state='approved' AND ((scope='platform' AND case_id IS NULL) OR (scope=? AND (case_id IS NULL OR case_id=?))) ORDER BY created DESC LIMIT 30",
    )
    .all(firmScope(firmId), caseId || "")
    .map((r) => String(r.content));
}
export function agentGuidance(
  db: Store,
  firmId: string,
  id: AgentId,
  caseId?: string,
) {
  const s = effectiveSettings(db, firmId);
  return [
    s.instructions,
    s.agents[id]?.instructions,
    ...memoryContext(db, firmId, caseId),
  ]
    .filter(Boolean)
    .join("\n");
}
