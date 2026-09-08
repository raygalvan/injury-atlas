import {AfpPrivateManagement} from "./AfpLabPermissions";
import { AfpManagement } from "./AfpManagement";
import { UsageSettings } from "./UsageSettings";
// Settings sections and visual structure adapted from law.bot's settings page.
import React, { useEffect, useState } from "react";
import { api } from "./api";
import {
  agentRoster,
  providers,
  providerNames,
  skillLabels,
  type AiSettings,
  type AgentId,
} from "../shared/ai";
export function Settings({ platformAdmin }: { platformAdmin: boolean }) {
  const [scope, setScope] = useState(platformAdmin ? "platform" : "firm"),
    [data, setData] = useState<any>(null),
    [draft, setDraft] = useState<AiSettings | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [records, setRecords] = useState<any>(null);
  const load = async () => {
    const d = await api(`/settings?scope=${scope}`);
    setData(d);
    setDraft(d.settings);
  };
  useEffect(() => {
    setData(null);
    setDraft(null);
    let active = true;
    api(`/settings?scope=${scope}`)
      .then((d) => {
        if (active) {
          setData(d);
          setDraft(d.settings);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [scope]);
  useEffect(() => {
    if (data && location.hash)
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [data]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice("Changes saved and recorded in the audit trail.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const config = (section: string, value: unknown, agentId?: string) =>
    run(async () => {
      await api(`/settings/config?scope=${scope}`, { section, value, agentId });
    });
  const form =
    (fn: (fd: FormData) => Promise<unknown>) =>
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const element = e.currentTarget,
        fd = new FormData(element);
      void run(async () => {
        await fn(fd);
        element.reset();
      });
    };
  if (!draft || !data)
    return (
      <section className="settings-shell">
        <h2>Settings</h2>
        <p>{error || "Loading settings…"}</p>
      </section>
    );
  const changeAgent = (id: AgentId, patch: any) =>
    setDraft({
      ...draft,
      agents: { ...draft.agents, [id]: { ...draft.agents[id], ...patch } },
    });
  return (
    <section className="settings-shell">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">
            {scope === "platform" ? "Super admin" : "Firm administration"}
          </p>
          <h1>Settings</h1>
          <p>Control what injury.bot's agents may remember, use, and do.</p>
        </div>
        {platformAdmin && (
          <label>
            Settings scope
            <select
              disabled={busy}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="platform">Platform defaults</option>
              <option value="firm">My firm</option>
            </select>
          </label>
        )}
      </header>
      {error && (
        <p className="work-notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="settings-saved" role="status">
          {notice}
        </p>
      )}
      <nav className="settings-tabs" aria-label="Settings sections">
        {[
          ["instructions", "Instructions"],
          ["memory", "Memory"],
          ["afp", "AFP Management"],
          ["skills", "Agents and skills"],
          ["models", "Models"],
          ["usage", "Usage and pricing"],
          ["credentials", "Credentials"],
          ["integrations", "Integrations"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      {platformAdmin ? <AfpManagement /> : <AfpPrivateManagement/>}
      <section className="settings-card" id="instructions">
        <div className="settings-section-head">
          <div>
            <p className="eyebrow">Coordinator</p>
            <h2>Working instructions</h2>
          </div>
          <span className="settings-lock">Case boundaries preserved</span>
        </div>
        <p className="muted">
          These preferences guide the coordinator and agents. Source integrity
          and attorney review remain part of each workflow.
        </p>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void config("instructions", draft.instructions);
          }}
        >
          <label>
            Custom instructions
            <textarea
              maxLength={12000}
              value={draft.instructions}
              onChange={(e) =>
                setDraft({ ...draft, instructions: e.target.value })
              }
            />
          </label>
          <div className="settings-actions">
            <button disabled={busy} className="primary-button">
              Save instructions
            </button>
          </div>
        </form>
      </section>
      <section className="settings-card" id="memory">
        <div className="settings-section-head">
          <div>
            <p className="eyebrow">Controlled memory</p>
            <h2>What injury.bot may remember</h2>
          </div>
          <span className="settings-lock">Reviewed memory</span>
        </div>
        <p className="muted">
          Agent proposals remain inactive until approved. Case memory stays with
          the selected case.
        </p>
        <form
          className="memory-create"
          onSubmit={form((fd) =>
            api(`/settings/memory?scope=${scope}`, {
              action: "add",
              content: fd.get("content"),
              caseId: fd.get("caseId") || "",
            }),
          )}
        >
          <label>
            Scope
            <select name="caseId">
              <option value="">
                {scope === "platform" ? "Platform guidance" : "Entire firm"}
              </option>
              {scope !== "platform" &&
                data.cases.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="memory-content">
            Memory
            <textarea required name="content" maxLength={4000} />
          </label>
          <div className="settings-actions">
            <button disabled={busy} className="primary-button">
              Add approved memory
            </button>
          </div>
        </form>
        <div className="memory-list">
          {!data.memories.length && <p className="muted">No memories saved.</p>}
          {data.memories.map((m: any) => (
            <article className="memory-row" key={m.id}>
              <div>
                <div className="memory-meta">
                  <span className={`memory-state state-${m.state}`}>
                    {m.state}
                  </span>
                  <span>
                    {m.case_id
                      ? data.cases.find((c: any) => c.id === m.case_id)
                          ?.title || "Case"
                      : scope === "platform"
                        ? "Platform"
                        : "Firm"}
                  </span>
                  <span>
                    {m.source === "coordinator"
                      ? "Proposed by Coordinator"
                      : "Added by administrator"}
                  </span>
                </div>
                <p>{m.content}</p>
              </div>
              <div className="memory-actions">
                {(m.state === "proposed"
                  ? ["approve", "reject", "delete"]
                  : ["delete"]
                ).map((action) => (
                  <button
                    key={action}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`/settings/memory?scope=${scope}`, {
                          id: m.id,
                          action,
                        });
                      })
                    }
                  >
                    {action[0].toUpperCase() + action.slice(1)}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="settings-card" id="skills">
        <div className="settings-section-head">
          <div>
            <p className="eyebrow">AI staff</p>
            <h2>Agent instructions and skills</h2>
          </div>
        </div>
        <p className="muted">
          Choose who handles each task and which skills they may use.
        </p>
        <div className="agent-settings-list">
          {agentRoster.map((a) => {
            const cfg = draft.agents[a.id];
            return (
              <form
                className="agent-setting"
                id={`agent-${a.id}`}
                key={a.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  void config("agent", cfg, a.id);
                }}
              >
                <div className="agent-setting-head">
                  <div>
                    <h3>{a.name}</h3>
                    <p>{a.charge}</p>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={(e) =>
                        changeAgent(a.id, { enabled: e.target.checked })
                      }
                    />
                    Enabled
                  </label>
                </div>
                <label>
                  Additional instructions
                  <textarea
                    maxLength={8000}
                    value={cfg.instructions}
                    onChange={(e) =>
                      changeAgent(a.id, { instructions: e.target.value })
                    }
                  />
                </label>
                <label>
                  Model for this task
                  <select
                    value={`${cfg.provider}:${cfg.model}`}
                    onChange={(e) => {
                      const [provider, ...model] = e.target.value.split(":");
                      changeAgent(a.id, { provider, model: model.join(":") });
                    }}
                  >
                    {draft.models
                      .filter((m) => m.enabled)
                      .map((m, i) => (
                        <option value={`${m.provider}:${m.model}`} key={i}>
                          {providerNames[m.provider]} · {m.model}
                        </option>
                      ))}
                  </select>
                </label>
                <fieldset className="skill-fieldset">
                  <legend>Installed skills</legend>
                  {a.skills.map((skill) => (
                    <label className="skill-check" key={skill}>
                      <input
                        type="checkbox"
                        checked={cfg.skills.includes(skill)}
                        onChange={(e) =>
                          changeAgent(a.id, {
                            skills: e.target.checked
                              ? [...cfg.skills, skill]
                              : cfg.skills.filter((s) => s !== skill),
                          })
                        }
                      />
                      <span>
                        <strong>{skillLabels[skill]}</strong>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="settings-actions">
                  <button disabled={busy} className="secondary-button">
                    Save {a.name}
                  </button>
                </div>
              </form>
            );
          })}
        </div>
      </section>
      <UsageSettings data={data.costs} editable={platformAdmin && scope === "platform"} busy={busy} onSave={value=>void config("usage",value)} onRefresh={()=>void load().catch(e=>setError(e.message))}/>
      <section className="settings-card" id="models">
        <div className="settings-section-head">
          <div>
            <p className="eyebrow">Task routing</p>
            <h2>Permitted models</h2>
          </div>
          <span className="settings-lock">No automatic fallback</span>
        </div>
        <p className="muted">
          Add the exact API model IDs available to your account. Multiple models
          from one provider can be assigned to different agents above.
        </p>
        <form
          className="model-form"
          onSubmit={(e) => {
            e.preventDefault();
            void config("models", {
              models: draft.models,
              dailyRunLimit: draft.dailyRunLimit,
              researchWebEnabled: draft.researchWebEnabled,
            });
          }}
        >
          {draft.models.map((m, i) => (
            <div className="model-row" key={i}>
              <label>
                Provider
                <select
                  value={m.provider}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      models: draft.models.map((v, j) =>
                        j === i ? { ...v, provider: e.target.value as any } : v,
                      ),
                    })
                  }
                >
                  {providers.map((p) => (
                    <option value={p} key={p}>
                      {providerNames[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                API model ID
                <input
                  required
                  value={m.model}
                  maxLength={160}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      models: draft.models.map((v, j) =>
                        j === i ? { ...v, model: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      models: draft.models.map((v, j) =>
                        j === i ? { ...v, enabled: e.target.checked } : v,
                      ),
                    })
                  }
                />
                Enabled
              </label>
            </div>
          ))}
          <div className="settings-form">
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  models: [
                    ...draft.models,
                    { provider: "openai", model: "", enabled: true },
                  ],
                })
              }
            >
              Add model
            </button>
            <label>
              Daily AI run limit
              <input
                type="number"
                min={1}
                max={1000}
                required
                value={draft.dailyRunLimit}
                onChange={(e) =>
                  setDraft({ ...draft, dailyRunLimit: Number(e.target.value) })
                }
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.researchWebEnabled}
                onChange={(e) =>
                  setDraft({ ...draft, researchWebEnabled: e.target.checked })
                }
              />
              Allow medical web research
            </label>
            <p className="muted">
              OpenAI and Claude can read PDF case evidence. The installed Grok
              adapter supports text and images, but not PDF evidence.
            </p>
            <div className="settings-actions">
              <button disabled={busy} className="primary-button">
                Save model policy
              </button>
            </div>
          </div>
        </form>
        <h3>Voice coordinator</h3>
        <p className="muted">
          Live voice uses OpenAI Realtime. Its voice model is selected
          separately from the text coordinator.
        </p>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void config("voice", draft.voice);
          }}
        >
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.voice.enabled}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, enabled: e.target.checked },
                })
              }
            />
            Enable voice
          </label>
          <label>
            Realtime model
            <input
              required
              maxLength={160}
              value={draft.voice.model}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, model: e.target.value },
                })
              }
            />
          </label>
          <label>
            Voice
            <select
              value={draft.voice.voice}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, voice: e.target.value },
                })
              }
            >
              {[
                "marin",
                "cedar",
                "alloy",
                "ash",
                "ballad",
                "coral",
                "echo",
                "sage",
                "shimmer",
                "verse",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Transcription language
            <select
              value={draft.voice.language}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, language: e.target.value },
                })
              }
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          <div className="settings-actions">
            <button disabled={busy} className="primary-button">
              Save voice settings
            </button>
          </div>
        </form>
        <details>
          <summary>Recent model routing</summary>
          {data.usage.map((u: any, i: number) => (
            <p key={i}>
              {u.agent} · {u.provider} · {u.model}
            </p>
          ))}
        </details>
      </section>
      <section className="settings-card" id="credentials">
        <div className="settings-section-head">
          <div>
            <p className="eyebrow">Provider access</p>
            <h2>Credentials</h2>
          </div>
          <span className="settings-lock">Encrypted server storage</span>
        </div>
        {scope === "firm" && (
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void config("credentials", draft.credentialSource);
            }}
          >
            <label>
              Credential source
              <select
                value={draft.credentialSource}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    credentialSource: e.target.value as any,
                  })
                }
              >
                <option value="platform">Platform keys</option>
                <option value="firm">Firm keys</option>
              </select>
            </label>
            <button disabled={busy}>Save credential source</button>
          </form>
        )}
        <p className="muted">
          Keys stay on the server. Existing server environment keys remain
          available when no saved platform key overrides them.
        </p>
        <div className="work-health">
          {data.credentials.map((c: any) => (
            <article className="work-health-item" key={c.provider}>
              <h3>{providerNames[c.provider as keyof typeof providerNames]}</h3>
              <p>
                {c.saved
                  ? `Saved key ending ${c.suffix}`
                  : c.environment
                    ? "Server key configured"
                    : "No key configured in this scope"}
              </p>
              <form
                className="work-form"
                onSubmit={form((fd) =>
                  api(`/settings/credentials?scope=${scope}`, {
                    provider: c.provider,
                    key: fd.get("key"),
                  }),
                )}
              >
                <label>
                  API key
                  <input
                    type="password"
                    name="key"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={4096}
                    disabled={!data.vaultReady}
                  />
                </label>
                <button disabled={busy || !data.vaultReady}>
                  Validate and save
                </button>
              </form>
              {c.saved && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/settings/credentials?scope=${scope}`, {
                        provider: c.provider,
                        action: "remove",
                      });
                    })
                  }
                >
                  Remove saved key
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="settings-card" id="integrations">
        <div className="settings-section-head">
          <div>
            <p className="eyebrow">Firm tools</p>
            <h2>Integrations</h2>
          </div>
          <span className="settings-lock">Per-firm access</span>
        </div>
        <p className="muted">
          Authorize read access for this firm. Connections never send messages
          or import case records automatically.
        </p>
        <div className="integration-grid">
          {data.integrations.map((i: any) => (
            <article className="integration-card" key={i.id}>
              <div className="integration-card-head">
                <div>
                  <span>{i.group}</span>
                  <h3>{i.name}</h3>
                </div>
                <b>{i.auth}</b>
              </div>
              <p>{i.description}</p>
              {i.connections.map((c: any) => (
                <div className="integration-connections" key={c.id}>
                  <strong>{c.label}</strong>
                  <span>{c.status}</span>
                  {c.status === "connected" && (
                    <div className="work-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            setRecords(
                              await api(`/connections/${c.id}/records`),
                            );
                          })
                        }
                      >
                        Read records
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(`/connections/${c.id}/disconnect`, {});
                          })
                        }
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {i.callback ? (
                <>
                  <button
                    disabled={busy || !i.ready}
                    onClick={() =>
                      run(async () => {
                        const r = await api(`/connections/${i.id}/connect`, {});
                        location.assign(r.url);
                      })
                    }
                  >
                    Connect for read access
                  </button>
                  {!i.ready && (
                    <p className="muted">
                      Application setup needed. Callback:{" "}
                      <code>{i.callback}</code>
                    </p>
                  )}
                </>
              ) : (
                <p className="muted">
                  Requires licensed developer access and an installed adapter.
                </p>
              )}
            </article>
          ))}
        </div>
        {records && (
          <article className="settings-card">
            <h3>{records.title}</h3>
            {records.items.map((r: any) => (
              <p key={r.id}>
                <strong>{r.title}</strong>
                <br />
                {r.summary}
              </p>
            ))}
            <button onClick={() => setRecords(null)}>Close records</button>
          </article>
        )}
      </section>
    </section>
  );
}
