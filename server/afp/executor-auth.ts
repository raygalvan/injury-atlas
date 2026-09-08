import { createPublicKey, verify } from "node:crypto";
const issuer = "https://token.actions.githubusercontent.com";
const workflow = "raygalvan/injury-atlas/.github/workflows/afp-development.yml@refs/heads/main";
let cached: { until: number; keys: any[] } | undefined;
/** GitHub signs runner identity. No browser cookie, shared password, or model-supplied actor is accepted. */
export async function verifyExecutorToken(token: string, fetcher: typeof fetch = fetch) {
  if (token.length > 16000) throw Error("Invalid runner identity");
  const parts = token.split(".");
  if (parts.length !== 3) throw Error("Invalid runner identity");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  const now = Date.now() / 1000;
  if (header.alg !== "RS256" || typeof header.kid !== "string" || claims.iss !== issuer ||
      claims.aud !== "injury.bot/afp-development" || claims.repository !== "raygalvan/injury-atlas" ||
      claims.ref !== "refs/heads/main" || claims.workflow_ref !== workflow ||
      !["schedule", "workflow_dispatch"].includes(claims.event_name) ||
      !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.nbf) || claims.nbf > now + 30 ||
      !/^\d+$/.test(String(claims.run_id))) throw Error("Invalid runner identity");
  if (!cached || cached.until < Date.now() || !cached.keys.some(k => k.kid === header.kid)) {
    const response = await fetcher(`${issuer}/.well-known/jwks`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("Runner identity unavailable");
    const data = await response.json() as any;
    if (!Array.isArray(data.keys)) throw Error("Runner identity unavailable");
    cached = { keys: data.keys, until: Date.now() + 3600000 };
  }
  const key = cached.keys.find(k => k.kid === header.kid);
  if (!key || !verify("RSA-SHA256", Buffer.from(parts.slice(0, 2).join(".")), createPublicKey({ key, format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw Error("Invalid runner identity");
  return String(claims.run_id);
}
