import { AiError } from "./error";
// Law.bot's read-only OAuth connection flow, adapted to the existing SQLite store.
import type express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { hash, audit, type Store, type User } from "../store";
import { sealCredential, openCredential, credentialVaultReady } from "./vault";
const oauthProviders = ["gmail", "slack", "clio"] as const;
type OAuthProvider = (typeof oauthProviders)[number];
const clioHosts = {
  us: "app.clio.com",
  ca: "ca.app.clio.com",
  eu: "eu.app.clio.com",
  au: "au.app.clio.com",
};
export const integrationCatalog = [
  {
    id: "gmail",
    name: "Gmail",
    group: "Communication",
    auth: "OAuth 2.0",
    description:
      "Read message headers and snippets from the authorized mailbox.",
  },
  {
    id: "slack",
    name: "Slack",
    group: "Communication",
    auth: "OAuth 2.0",
    description:
      "Read public channels and messages available to the connected app.",
  },
  {
    id: "clio",
    name: "Clio",
    group: "Practice management",
    auth: "OAuth 2.0",
    description: "Read matter numbers, descriptions, and status.",
  },
  {
    id: "smokeball",
    name: "Smokeball",
    group: "Practice management",
    auth: "OAuth 2.0",
    description:
      "Requires licensed developer access and regional API configuration.",
  },
  {
    id: "lexisnexis",
    name: "LexisNexis",
    group: "Legal research",
    auth: "Licensed API",
    description:
      "Requires a licensed API subscription and account-specific documentation.",
  },
  {
    id: "custom",
    name: "Other API",
    group: "Developer",
    auth: "API key or OAuth 2.0",
    description: "Requires an installed adapter for the chosen service.",
  },
];
function config(provider: OAuthProvider) {
  const prefix = provider === "gmail" ? "GOOGLE" : provider.toUpperCase();
  const clientId = process.env[prefix + "_CLIENT_ID"],
    clientSecret = process.env[prefix + "_CLIENT_SECRET"],
    origin = process.env.APP_URL || "http://localhost:5173";
  const clio =
    clioHosts[(process.env.CLIO_REGION || "us") as keyof typeof clioHosts];
  if (!clio) throw new AiError("Unsupported Clio region.");
  const p = {
    gmail: {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    },
    slack: {
      authorize: "https://slack.com/oauth/v2/authorize",
      token: "https://slack.com/api/oauth.v2.access",
      scope: "channels:read,channels:history",
    },
    clio: {
      authorize: `https://${clio}/oauth/authorize`,
      token: `https://${clio}/oauth/token`,
      scope: "",
    },
  }[provider];
  return {
    ...p,
    clientId,
    clientSecret,
    clio,
    redirectUri: `${origin.replace(/\/$/, "")}/api/connections/${provider}/callback`,
    ready: !!(clientId && clientSecret && credentialVaultReady()),
  };
}
function ensure(db: Store) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ai_connections(id TEXT PRIMARY KEY,firm_id TEXT NOT NULL,provider TEXT NOT NULL,label TEXT NOT NULL,encrypted BLOB,status TEXT NOT NULL,region TEXT,UNIQUE(firm_id,provider));CREATE TABLE IF NOT EXISTS ai_oauth_states(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,firm_id TEXT NOT NULL,provider TEXT NOT NULL,expires INTEGER NOT NULL);`,
  );
}
export function integrationStatus(db: Store, u: User) {
  ensure(db);
  const rows = db
    .prepare(
      "SELECT id,provider,label,status FROM ai_connections WHERE firm_id=?",
    )
    .all(u.firm_id);
  return integrationCatalog.map((item) => ({
    ...item,
    ...(oauthProviders.includes(item.id as OAuthProvider)
      ? {
          ready: config(item.id as OAuthProvider).ready,
          callback: config(item.id as OAuthProvider).redirectUri,
        }
      : { ready: false }),
    connections: rows.filter((r) => r.provider === item.id),
  }));
}
async function exchange(
  provider: OAuthProvider,
  params: Record<string, string>,
) {
  const c = config(provider);
  if (!c.ready)
    throw new AiError("Configure the OAuth application on the server.");
  const r = await fetch(c.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: c.clientId!,
      client_secret: c.clientSecret!,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const b = (await r.json()) as any;
  if (!r.ok || b.ok === false || !b.access_token)
    throw new AiError(
      "The provider did not authorize this connection. Reconnect the account.",
    );
  return b;
}
export function connectionRoutes(
  app: express.Express,
  db: Store,
  staff: express.RequestHandler,
  admin: express.RequestHandler,
) {
  ensure(db);
  app.post("/api/connections/:provider/connect", staff, admin, (req, res) => {
    const p = z.enum(oauthProviders).parse(req.params.provider),
      c = config(p),
      u = res.locals.user as User;
    if (!c.ready)
      return res.status(409).json({
        error:
          "This service needs its OAuth application credentials on the server.",
      });
    const state = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM ai_oauth_states WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO ai_oauth_states VALUES(?,?,?,?,?)").run(
      hash(state),
      u.id,
      u.firm_id,
      p,
      Date.now() + 600000,
    );
    const url = new URL(c.authorize);
    url.search = new URLSearchParams({
      client_id: c.clientId!,
      redirect_uri: c.redirectUri,
      response_type: "code",
      state,
      ...(c.scope ? { scope: c.scope } : {}),
      ...(p === "gmail" ? { access_type: "offline", prompt: "consent" } : {}),
    }).toString();
    res.json({ url: url.href });
  });
  app.get(
    "/api/connections/:provider/callback",
    staff,
    admin,
    async (req, res) => {
      const p = z.enum(oauthProviders).parse(req.params.provider),
        u = res.locals.user as User,
        c = config(p);
      const state = z.string().max(200).parse(req.query.state),
        code = z.string().max(4000).parse(req.query.code);
      const result = db
        .prepare(
          "DELETE FROM ai_oauth_states WHERE hash=? AND user_id=? AND firm_id=? AND provider=? AND expires>?",
        )
        .run(hash(state), u.id, u.firm_id, p, Date.now());
      if (!result.changes)
        return res
          .status(400)
          .send(
            "The connection request expired or was already used. Start it again in Settings.",
          );
      const body = await exchange(p, {
        code,
        grant_type: "authorization_code",
        redirect_uri: c.redirectUri,
      });
      const token = {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: body.expires_in
          ? Date.now() + body.expires_in * 1000
          : undefined,
      };
      const sealed = sealCredential(
        JSON.stringify(token),
        `connection:${u.firm_id}:${p}`,
      );
      db.prepare(
        "INSERT INTO ai_connections VALUES(?,?,?,?,?,'connected',?) ON CONFLICT(firm_id,provider) DO UPDATE SET label=excluded.label,encrypted=excluded.encrypted,status='connected',region=excluded.region",
      ).run(
        randomUUID(),
        u.firm_id,
        p,
        body.team?.name || p,
        sealed.encrypted,
        process.env.CLIO_REGION || "us",
      );
      audit(db, u.id, "connection.connected");
      res.redirect("/settings#integrations");
    },
  );
  app.post("/api/connections/:id/disconnect", staff, admin, (req, res) => {
    const r = db
      .prepare(
        "UPDATE ai_connections SET encrypted=NULL,status='revoked' WHERE id=? AND firm_id=?",
      )
      .run(String(req.params.id), res.locals.user.firm_id);
    if (!r.changes)
      return res.status(404).json({ error: "Connection unavailable." });
    audit(db, res.locals.user.id, "connection.disconnected");
    res.json({ ok: true });
  });
  app.get("/api/connections/:id/records", staff, async (req, res) =>
    res.json(
      await readConnection(
        db,
        res.locals.user,
        String(req.params.id),
        String(req.query.query || ""),
        String(req.query.resourceId || ""),
      ),
    ),
  );
}
export async function readConnection(
  db: Store,
  u: User,
  id: string,
  query = "",
  resourceId = "",
) {
  const row = db
    .prepare(
      "SELECT * FROM ai_connections WHERE id=? AND firm_id=? AND status='connected'",
    )
    .get(id, u.firm_id) as any;
  if (!row || !oauthProviders.includes(row.provider))
    throw new AiError("This connection is unavailable.");
  const c = config(row.provider);
  if (
    row.provider === "clio" &&
    row.region !== (process.env.CLIO_REGION || "us")
  )
    throw new AiError("Reconnect Clio after changing regions.");
  let token = JSON.parse(
    openCredential(
      row.encrypted,
      { version: 1 },
      `connection:${u.firm_id}:${row.provider}`,
    ),
  );
  if (token.expires_at && token.expires_at < Date.now() + 60000) {
    if (!token.refresh_token)
      throw new AiError("The connection expired. Reconnect the account.");
    const b = await exchange(row.provider, {
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    token = {
      ...token,
      access_token: b.access_token,
      refresh_token: b.refresh_token || token.refresh_token,
      expires_at: Date.now() + (b.expires_in || 3600) * 1000,
    };
    const sealed = sealCredential(
      JSON.stringify(token),
      `connection:${u.firm_id}:${row.provider}`,
    );
    db.prepare(
      "UPDATE ai_connections SET encrypted=? WHERE id=? AND firm_id=? AND status='connected'",
    ).run(sealed.encrypted, id, u.firm_id);
  }
  const get = async (url: string) => {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const b = (await r.json()) as any;
    if (!r.ok || b.ok === false)
      throw new AiError(
        "The connected service could not return these records.",
      );
    return b;
  };
  let items: any[] = [];
  if (row.provider === "gmail") {
    const b = await get(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
        new URLSearchParams({ maxResults: "10", q: query.slice(0, 300) }),
    );
    items = await Promise.all(
      (b.messages || []).map(async (m: any) => {
        const d = await get(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        );
        return {
          id: m.id,
          title:
            d.payload?.headers?.find(
              (h: any) => h.name.toLowerCase() === "subject",
            )?.value || "(No subject)",
          summary: d.snippet || "",
        };
      }),
    );
  } else if (row.provider === "slack") {
    if (resourceId && !/^[A-Z0-9]{6,30}$/.test(resourceId))
      throw new AiError("Choose a valid Slack channel.");
    const b = await get(
      resourceId
        ? "https://slack.com/api/conversations.history?" +
            new URLSearchParams({ channel: resourceId, limit: "20" })
        : "https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=100",
    );
    items = resourceId
      ? (b.messages || []).map((m: any) => ({
          id: String(m.ts),
          title: m.user || "Message",
          summary: String(m.text || "").slice(0, 4000),
        }))
      : (b.channels || [])
          .filter((ch: any) => !query || ch.name.includes(query))
          .map((ch: any) => ({
            id: ch.id,
            title: ch.name,
            summary: ch.purpose?.value || "",
          }));
  } else {
    const b = await get(
      `https://${c.clio}/api/v4/matters.json?` +
        new URLSearchParams({
          fields: "id,display_number,description,status",
          limit: "20",
          query: query.slice(0, 300),
        }),
    );
    items = (b.data || []).map((m: any) => ({
      id: String(m.id),
      title: m.display_number || "Matter",
      summary: [m.description, m.status].filter(Boolean).join(" · "),
    }));
  }
  audit(db, u.id, "connection.read");
  return { title: row.label, items };
}
