import { z } from "zod";
import type { Store } from "../store";

const rate = z.number().min(0).max(100000);
export const usagePolicySchema = z.object({
  testingEnabled: z.boolean(),
  testingMaxTokens: z.number().int().min(16384).max(131072),
  targetMargin: z.number().min(0).max(99),
  processingHourlyUsd: rate,
  overheadPerJobUsd: rate,
  customerPriceUsd: rate,
  rates: z
    .array(
      z.object({
        provider: z.enum(["openai", "anthropic", "xai"]),
        model: z.string().trim().min(1).max(160),
        input: rate,
        output: rate,
        cachedInput: rate,
        cacheWrite: rate,
        searchPerThousand: rate,
      }),
    )
    .max(50),
});
export type UsagePolicy = z.infer<typeof usagePolicySchema>;
export const defaultUsagePolicy: UsagePolicy = {
  testingEnabled: true,
  testingMaxTokens: 32768,
  targetMargin: 70,
  processingHourlyUsd: 0,
  overheadPerJobUsd: 0,
  customerPriceUsd: 0,
  // Standard short-context reference rates checked 2026-09-08. Editable estimates.
  rates: [
    {
      provider: "anthropic",
      model: "claude-opus-5",
      input: 5,
      output: 25,
      cachedInput: 0.5,
      cacheWrite: 6.25,
      searchPerThousand: 10,
    },
    {
      provider: "openai",
      model: "gpt-6-astra",
      input: 10,
      output: 50,
      cachedInput: 1,
      cacheWrite: 12.5,
      searchPerThousand: 10,
    },
  ],
};
export function ensureUsage(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_cost_policy(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_call_usage(id INTEGER PRIMARY KEY,firm_id TEXT NOT NULL,user_id TEXT NOT NULL,agent TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,job_id TEXT,created INTEGER NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cached_tokens INTEGER NOT NULL,cache_write_tokens INTEGER NOT NULL,searches INTEGER NOT NULL,reported INTEGER NOT NULL,status TEXT NOT NULL,response_id TEXT,estimated_usd REAL,duration_ms INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_call_usage_job ON ai_call_usage(job_id);
    CREATE TABLE IF NOT EXISTS injury_processing_usage(id INTEGER PRIMARY KEY,job_id TEXT NOT NULL,firm_id TEXT NOT NULL,duration_ms INTEGER NOT NULL,created INTEGER NOT NULL);`);
}
export function usagePolicy(db: Store): UsagePolicy {
  const row = db.prepare("SELECT body FROM ai_cost_policy WHERE id=1").get();
  return row
    ? usagePolicySchema.parse(JSON.parse(String(row.body)))
    : structuredClone(defaultUsagePolicy);
}
export function testingUser(db: Store, userId: string) {
  return (
    usagePolicy(db).testingEnabled &&
    !!db
      .prepare(
        "SELECT p.user_id FROM platform_admins p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND u.active=1",
      )
      .get(userId)
  );
}
const count = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
export type UsageContext = {
  db: Store;
  firmId: string;
  userId: string;
  agent: string;
  jobId?: string;
};
export function recordUsage(
  c: UsageContext,
  provider: string,
  model: string,
  body: any,
  status: string,
  durationMs: number,
) {
  const u = body?.usage;
  const reported =
    !!u &&
    Number.isFinite(u.input_tokens ?? u.prompt_tokens) &&
    Number.isFinite(u.output_tokens ?? u.completion_tokens);
  const cached = count(u?.cache_read_input_tokens ?? u?.input_tokens_details?.cached_tokens);
  const write = count(u?.cache_creation_input_tokens);
  const input = count(u?.input_tokens ?? u?.prompt_tokens);
  const output = count(u?.output_tokens ?? u?.completion_tokens);
  const searches = count(
    u?.server_tool_use?.web_search_requests ??
      body?.output?.filter((x: any) => x.type === "web_search_call").length,
  );
  const rates = usagePolicy(c.db).rates.find((r) => r.provider === provider && r.model === model);
  // Anthropic separates cached input; Responses includes cached tokens in input_tokens.
  const uncached = provider === "anthropic" ? input : Math.max(0, input - cached);
  const estimated =
    rates && reported && uncached + cached + write <= 200000
      ? (uncached * rates.input +
          output * rates.output +
          cached * rates.cachedInput +
          write * rates.cacheWrite) /
          1e6 +
        (searches * rates.searchPerThousand) / 1000
      : null;
  c.db
    .prepare(
      `INSERT INTO ai_call_usage(firm_id,user_id,agent,provider,model,job_id,created,input_tokens,output_tokens,cached_tokens,cache_write_tokens,searches,reported,status,response_id,estimated_usd,duration_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      c.firmId,
      c.userId,
      c.agent,
      provider,
      model,
      c.jobId || null,
      Date.now(),
      uncached,
      output,
      cached,
      write,
      searches,
      reported ? 1 : 0,
      status,
      body?.id || null,
      estimated,
      Math.max(0, Math.round(durationMs)),
    );
}
export function usageSummary(db: Store, firmId: string | null) {
  const since = Date.now() - 30 * 86400000;
  const where = "created>=? AND (? IS NULL OR firm_id=?)";
  const args = [since, firmId, firmId];
  const totals = db
    .prepare(
      `SELECT count(*) calls,COALESCE(sum(input_tokens),0) inputTokens,COALESCE(sum(output_tokens),0) outputTokens,COALESCE(sum(cached_tokens),0) cachedTokens,COALESCE(sum(cache_write_tokens),0) cacheWriteTokens,COALESCE(sum(searches),0) searches,COALESCE(sum(estimated_usd),0) knownCostUsd,COALESCE(sum(estimated_usd IS NULL),0) unpricedCalls,COALESCE(sum(reported=0),0) unreportedCalls FROM ai_call_usage WHERE ${where}`,
    )
    .get(...args);
  const models = db
    .prepare(
      `SELECT agent,provider,model,count(*) calls,sum(input_tokens+output_tokens+cached_tokens+cache_write_tokens) tokens,sum(estimated_usd) costUsd,sum(estimated_usd IS NULL) unpricedCalls FROM ai_call_usage WHERE ${where} GROUP BY agent,provider,model`,
    )
    .all(...args);
  const jobs = db
    .prepare(`SELECT j.job_id id,COALESCE(p.firm_id,l.firm_id) firmId,COALESCE(json_extract(p.body,'$.name'),l.name,j.job_id) name,COALESCE(p.state,l.status,'unknown') state,
    (SELECT COALESCE(sum(input_tokens+output_tokens+cached_tokens+cache_write_tokens),0) FROM ai_call_usage a WHERE a.job_id=j.job_id) tokens,
    (SELECT sum(estimated_usd) FROM ai_call_usage a WHERE a.job_id=j.job_id) costUsd,
    (SELECT count(*) FROM ai_call_usage a WHERE a.job_id=j.job_id AND estimated_usd IS NULL) unpricedCalls,
    (SELECT COALESCE(sum(duration_ms),0) FROM injury_processing_usage r WHERE r.job_id=j.job_id)/60000.0 minutes
    FROM (SELECT job_id,max(created) created FROM (SELECT job_id,created FROM ai_call_usage WHERE job_id IS NOT NULL UNION ALL SELECT job_id,created FROM injury_processing_usage) GROUP BY job_id) j
    LEFT JOIN injury_production p ON p.id=j.job_id LEFT JOIN injury_publications l ON l.id=j.job_id
    WHERE j.created>=? AND (? IS NULL OR COALESCE(p.firm_id,l.firm_id)=?) ORDER BY j.created DESC LIMIT 50`)
    .all(...args);
  return { policy: usagePolicy(db), totals, models, jobs };
}
