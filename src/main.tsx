import type { ProductionRecord } from "../server/production";
import { InjuryWorkspace } from "./InjuryWorkspace";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Box,
  FolderOpen,
  Files,
  Activity,
  Clapperboard,
  FileOutput,
  Bot,
  LayoutDashboard,
  LogOut,
  Plus,
  ArrowUpRight,
  Upload,
  Menu,
  X,
  ShieldCheck,
  SlidersHorizontal,
  Archive,
  ArchiveRestore,
  Trash2,
  Settings as SettingsIcon,
} from "lucide-react";
import "./style.css";
import "./portal-entry.css";
import { api } from "./api";
import { Field, Empty } from "./ui";
import { Atlas } from "./Atlas";
import { Coordinator } from "./Coordinator";
import { Settings } from "./Settings";
import { SettingsDrawer } from "./SettingsDrawer";
import "./settings.css";
import "./coordinator.css";
import { Login } from "./Login";
import type { Member, Case, Evidence, Finding } from "./domain";
const navigation = [
  ["dashboard", "Command center", LayoutDashboard],
  ["coordinator", "Coordinator", Bot],
  ["atlas", "Human Atlas", Box],
  ["cases", "Cases", FolderOpen],
  ["evidence", "Evidence", Files],
  ["injuries", "Injury workspace", Activity],
  ["reconstruction", "Reconstruction", Clapperboard],
  ["exhibits", "Exhibits", FileOutput],
  ["agents", "Agents", Bot],
  ["settings", "Settings", SettingsIcon],
] as const;
const viewPath = (view: string) => (view === "dashboard" ? "/" : `/${view}`);
const pathView = () =>
  navigation.find(([id]) => viewPath(id) === location.pathname)?.[0] ||
  "dashboard";
function App() {
  const [member, setMember] = useState<Member | null>(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState<string>(pathView),
    [cases, setCases] = useState<Case[]>([]),
    [caseId, setCaseId] = useState(""),
    [evidence, setEvidence] = useState<Evidence[]>([]),
    [findings, setFindings] = useState<Finding[]>([]),
    [productions, setProductions] = useState<ProductionRecord[]>([]),
    [injuryAgentReady, setInjuryAgentReady] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dialog, setDialog] = useState(""),
    [mobile, setMobile] = useState(false),
    [railOpen, setRailOpen] = useState(true),
    [atlasExpanded, setAtlasExpanded] = useState(false),
    [busy, setBusy] = useState(false);
  const currentContext = useRef("");
  currentContext.current = `${member?.id || ""}:${caseId}`;
  const active = cases.find((c) => c.id === caseId);
  const client = member?.role === "client";
  const loadCases = async () => {
    const cs = await api("/cases");
    setCases(cs);
    setCaseId((prev) =>
      cs.some((c: Case) => c.id === prev)
        ? prev
        : cs.find(
            (c: Case) =>
              c.id === new URLSearchParams(location.search).get("case"),
          )?.id ||
          cs[0]?.id ||
          "",
    );
  };
  const loadDetails = async () => {
    if (!caseId) {
      setEvidence([]);
      setFindings([]);
      setProductions([]);
      return;
    }
    const context = `${member?.id || ""}:${caseId}`;
    const [ev, fs, ps] = await Promise.all([
      api(`/cases/${caseId}/evidence`),
      client ? Promise.resolve([]) : api(`/cases/${caseId}/findings`),
      client ? Promise.resolve([]) : api(`/cases/${caseId}/production`),
    ]);
    if (currentContext.current !== context) return;
    setEvidence(ev);
    setFindings(fs);
    setProductions(ps);
  };
  useEffect(() => {
    api("/me")
      .then(setMember)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (member) {
      setView(pathView());
      loadCases().catch((e) => setError(e.message));
      if (member.role === "client") {
        setView("evidence");
        history.replaceState(null, "", "/client");
      } else if (
        location.pathname.includes("sign-in") ||
        location.pathname === "/client"
      ) {
        setView("dashboard");
        history.replaceState(null, "", "/");
      }
    }
  }, [member]);
  useEffect(() => {
    setEvidence([]);
    setFindings([]);
    setProductions([]);
    loadDetails().catch((e) => setError(e.message));
  }, [caseId, member]);
  useEffect(() => {
    if (view === "agents")
      api("/production-capabilities")
        .then((d) => setInjuryAgentReady(d.injuryAgentConfigured))
        .catch(() => setInjuryAgentReady(false));
    if (member && caseId) loadDetails().catch((e) => setError(e.message));
  }, [view]);
  useEffect(() => {
    const back = () => {
      setView(member?.role === "client" ? "evidence" : pathView());
      setMobile(false);
    };
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, [member]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="loading">Opening injury.bot…</div>;
  if (!member)
    return (
      <Login
        onSuccess={async () => {
          setMember(await api("/me"));
        }}
      />
    );
  const go = (v: string) => {
    setView(v);
    history.pushState(null, "", client ? "/client" : viewPath(v));
    setMobile(false);
    setError("");
    setNotice("");
  };
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    await api(`/cases/${caseId}/evidence`, fd);
    await loadDetails();
    setNotice("Evidence saved. Original file retained.");
  };
  if (view === "coordinator" && !client)
    return (
      <Coordinator
        member={member}
        caseId={active?.archived ? undefined : caseId || undefined}
        onMinimize={() => {
          go("dashboard");
          void loadCases();
        }}
      />
    );
  return (
    <div
      className={`app ${railOpen ? "" : "rail-closed"} ${view === "atlas" ? "view-atlas" : ""} ${atlasExpanded ? "atlas-expanded" : ""}`}
    >
      <header className="site-header">
        {!client && (
          <SettingsDrawer
            firmName="injury.bot"
            userName={member.name}
            canCustomize={member.role === "owner" || !!member.platformAdmin}
            platformRole={member.platformAdmin ? "super_admin" : "user"}
            pathname={view}
          />
        )}
        <button
          className="rail-toggle desktop"
          onClick={() => setRailOpen((open) => !open)}
          aria-label="Toggle workspace"
          aria-expanded={railOpen}
        >
          <Menu size={18} />
        </button>
        <a className="site-brand" href={client ? "/client" : "/"}>
          injury<span>.bot</span>
        </a>
        <div className="site-header-side">
          <span className="pilot-badge">Private pilot</span>
          <span>{client ? "Client portal" : "Injury command center"}</span>
        </div>
      </header>
      {mobile && (
        <div
          className="scrim"
          onClick={() => setMobile(false)}
          aria-hidden="true"
        />
      )}
      <aside className={mobile ? "rail open" : "rail"}>
        <div className="brand">
          <div>
            {client ? "Your case workspace" : "Injury workspace"}
            <small>PRIVATE PILOT</small>
          </div>
          <button
            className="close"
            onClick={() => {
              setMobile(false);
              setRailOpen(false);
            }}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <p className="rail-label">{client ? "CLIENT PORTAL" : "WORKSPACE"}</p>
        <nav>
          {(client
            ? navigation.filter((n) => n[0] === "evidence")
            : navigation.filter(
                ([id]) =>
                  id !== "settings" ||
                  member.role === "owner" ||
                  member.platformAdmin,
              )
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "nav active" : "nav"}
              aria-current={view === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              {label}
              {id === "atlas" && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <p className="pilot">PILOT WORKSPACE</p>
          <p>
            Evidence first.
            <br />
            Anatomy in context.
          </p>
          <div className="profile">
            <span>{member.name.slice(0, 1)}</span>
            <div>
              <b>{member.name}</b>
              <small>
                {member.platformAdmin
                  ? "Super admin"
                  : member.role === "owner"
                    ? "Firm owner"
                    : member.role}
              </small>
            </div>
            <button
              title="Sign out"
              onClick={() =>
                run(async () => {
                  await api("/auth/logout", {});
                  history.replaceState(
                    null,
                    "",
                    client ? "/client/sign-in" : "/sign-in",
                  );
                  setView("dashboard");
                  setMember(null);
                  setCases([]);
                  setEvidence([]);
                  setFindings([]);
                })
              }
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {!client && (
        <nav className="mobile-nav" aria-label="Quick navigation">
          {[
            ["dashboard", "Home", LayoutDashboard],
            ["injuries", "Review", ShieldCheck],
            ["coordinator", "Coordinator", Bot],
            ["cases", "Cases", FolderOpen],
            ["evidence", "Evidence", Files],
          ].map(([id, label, Icon]) => {
            const Symbol = Icon as typeof Box;
            return (
              <button
                key={String(id)}
                className={`mobile-tab ${view === id ? "active" : ""} ${id === "coordinator" ? "mobile-tab-orchestrator" : ""}`}
                aria-current={view === id ? "page" : undefined}
                onClick={() => go(String(id))}
              >
                {id === "coordinator" ? (
                  <span className="mobile-tab-icon mobile-tab-icon-primary">
                    <svg
                      viewBox="0 0 24 24"
                      width="25"
                      height="25"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 3a9 9 0 0 0-7.6 13.8L3 21l4.4-1.3A9 9 0 1 0 12 3zM8.5 12h.01M12 12h.01M15.5 12h.01"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : (
                  <Symbol size={22} />
                )}
                <span>{String(label)}</span>
              </button>
            );
          })}
        </nav>
      )}
      <main>
        <header>
          <button
            className="mobile"
            onClick={() => setMobile(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            {client ? "Client portal" : "Workspace"} <span>/</span>{" "}
            <b>{navigation.find((n) => n[0] === view)?.[1]}</b>
          </div>
          <div className="header-actions">
            {!client && (
              <button onClick={() => setDialog("invite")}>
                Invite member <Plus size={15} />
              </button>
            )}
            <span className="secure">
              <ShieldCheck size={15} /> Private workspace
            </span>
          </div>
        </header>
        <div
          className={`content ${view === "settings" ? "view-settings" : ""}`}
        >
          {!client && view === "settings" && (
            <Settings platformAdmin={!!member.platformAdmin} />
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {client
                  ? "CONTRIBUTE EVIDENCE"
                  : "FROM SOURCE EVIDENCE TO ANATOMY"}
              </p>
              <h1>
                {client
                  ? "Your case evidence"
                  : view === "dashboard"
                    ? `Welcome, ${member.name.split(" ")[0]}.`
                    : navigation.find((n) => n[0] === view)?.[1]}
              </h1>
            </div>
            {!client && (
              <button className="primary" onClick={() => setDialog("case")}>
                <Plus size={17} /> New case
              </button>
            )}
          </div>
          <div className="case-strip">
            <span>ACTIVE CASE</span>
            <select
              aria-label="Active case"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
            >
              <option value="">Select a case</option>
              {cases
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              {cases.some((c) => c.archived) && (
                <optgroup label="Archived">
                  {cases
                    .filter((c) => c.archived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            {active?.archived ? <span className="tag">Archived</span> : null}
            <span className="subtle">
              {active?.client || "No case selected"}
            </span>
            {!client && active && (
              <button
                className="manage-case"
                onClick={() => setDialog("managecase")}
                aria-label="Manage case"
              >
                <SlidersHorizontal size={15} /> <span>Manage</span>
              </button>
            )}
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {view === "atlas" && (
            <div className="atlas-layout">
              <Atlas
                caseRecord={active}
                expanded={atlasExpanded}
                onToggleExpand={() => setAtlasExpanded((v) => !v)}
                onOpenNav={() => setMobile(true)}
              />
              <aside className="context-panel">
                <p className="eyebrow">CASE CONTEXT</p>
                <h2>{active?.title || "Begin with a case"}</h2>
                <p>
                  {active?.incident ||
                    "Create a case to organize evidence and begin examining the reference anatomy."}
                </p>
                <div className="mini-stat">
                  <span>Evidence files</span>
                  <b>{evidence.length}</b>
                </div>
                <div className="mini-stat">
                  <span>Injury findings</span>
                  <b>{findings.length + productions.length}</b>
                </div>
                <div className="mini-stat">
                  <span>Placement approved</span>
                  <b>{productions.filter((p) => p.placement_review).length}</b>
                </div>
                <hr />
                <p className="eyebrow">REVIEW SEQUENCE</p>
                {[
                  "Source evidence",
                  "Injury finding",
                  "Anatomical placement",
                  "Visual representation",
                ].map((v, i) => (
                  <div className="sequence" key={v}>
                    <span>0{i + 1}</span>
                    {v}
                  </div>
                ))}
                <button className="wide" onClick={() => go("evidence")}>
                  Open evidence <ArrowUpRight size={16} />
                </button>
                <p className="fine">
                  Reviewed injury illustrations are available through the Injury
                  workspace. Incident reconstruction remains separate.
                </p>
              </aside>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="hero">
                <div>
                  <p className="eyebrow">THE ANATOMY OF YOUR CASE</p>
                  <h2>
                    Every injury starts
                    <br />
                    with its evidence.
                  </h2>
                  <p>
                    Examine reference anatomy. Organize source material.
                    <br />
                    Build a reviewable account of the injuries.
                  </p>
                  <button className="primary" onClick={() => go("atlas")}>
                    Open Human Atlas <ArrowUpRight size={18} />
                  </button>
                </div>
                <div className="hero-number">
                  {String(cases.length).padStart(2, "0")}
                  <span>ACTIVE CASES</span>
                </div>
              </div>
              <div className="stats">
                {[
                  ["Evidence in selected case", evidence.length],
                  [
                    "Findings awaiting review",
                    findings.filter((f) => f.attorneyReviewStatus === "pending")
                      .length,
                  ],
                  [
                    "Approved source findings",
                    findings.filter((f) => f.sourceStatus === "verified")
                      .length,
                  ],
                ].map(([label, value]) => (
                  <div className="card" key={label}>
                    <p>{label}</p>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <section className="card command-review">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">LAWYER REVIEW</p>
                    <h2>Decisions waiting</h2>
                  </div>
                  <button onClick={() => go("injuries")}>
                    Open review queue
                  </button>
                </div>
                <p>
                  {active
                    ? `Source findings for ${active.title}. Source approval does not approve anatomical placement or rendering.`
                    : "Select or create a case to begin reviewing documented injuries."}
                </p>
                {findings
                  .filter((f) => f.attorneyReviewStatus === "pending")
                  .map((f) => (
                    <div className="command-row" key={f.id}>
                      <div>
                        <strong>{f.anatomicalStructure}</strong>
                        <p>{f.citation}</p>
                      </div>
                      <button onClick={() => go("injuries")}>Review</button>
                    </div>
                  ))}
                {active &&
                  !findings.some(
                    (f) => f.attorneyReviewStatus === "pending",
                  ) && (
                    <p>No source findings are awaiting review in this case.</p>
                  )}
              </section>
              <section className="card command-review">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">CASE WORKSPACE</p>
                    <h2>Active cases</h2>
                  </div>
                  <button onClick={() => go("cases")}>All cases</button>
                </div>
                {cases.map((c) => (
                  <div className="command-row" key={c.id}>
                    <div>
                      <strong>{c.title}</strong>
                      <p>{c.client}</p>
                    </div>
                    <button
                      onClick={() => {
                        setCaseId(c.id);
                        go("atlas");
                      }}
                    >
                      Open atlas
                    </button>
                  </div>
                ))}
                {!cases.length && (
                  <p>
                    Create your first case, then upload evidence and open Human
                    Atlas.
                  </p>
                )}
              </section>
            </>
          )}
          {view === "cases" && (
            <div className="case-grid">
              {cases.map((c) => (
                <button
                  className="card case-card"
                  key={c.id}
                  onClick={() => {
                    setCaseId(c.id);
                    go("atlas");
                  }}
                >
                  <FolderOpen size={24} />
                  <h2>{c.title}</h2>
                  <p>{c.client}</p>
                  <small>Open case workspace ↗</small>
                </button>
              ))}
              {!cases.length && (
                <Empty
                  title="Create your first case"
                  text="Start with Homer Cortez or add another case. No sample injuries or evidence have been preloaded."
                  action={() => setDialog("case")}
                  label="New case"
                />
              )}
            </div>
          )}
          {view === "evidence" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>{client ? "Photos and documents" : "Source evidence"}</h2>
                  <p>
                    {client
                      ? "Upload injury photos, records, bills, or accident photos. You can see your own submissions here."
                      : "Original files retained with a SHA-256 fingerprint. Maximum 25 MB per file."}
                  </p>
                </div>
                <label
                  className={"primary " + (!caseId || busy ? "disabled" : "")}
                >
                  <Upload size={17} />
                  Upload evidence
                  <input
                    aria-label="Upload evidence"
                    type="file"
                    disabled={!caseId || busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) run(() => upload(f));
                      e.target.value = "";
                    }}
                    hidden
                  />
                </label>
              </div>
              {!evidence.length ? (
                <Empty
                  title={
                    caseId ? "No evidence uploaded" : "Select a case to begin"
                  }
                  text="Your source materials will appear here after upload."
                />
              ) : (
                <div className="file-list">
                  {evidence.map((e) => (
                    <div className="file-row" key={e.id}>
                      <Files />
                      <div>
                        <a href={`/api/cases/${caseId}/evidence/${e.id}`}>
                          {e.name}
                        </a>
                        <p>
                          {(e.bytes / 1024).toFixed(1)} KB ·{" "}
                          {new Date(e.created).toLocaleDateString()}
                        </p>
                        <code title={e.sha256}>
                          SHA-256 {e.sha256.slice(0, 16)}…
                        </code>
                      </div>
                      {!client && (
                        <button onClick={() => setDialog("finding")}>
                          Draft finding <ArrowUpRight size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {view === "injuries" && !client && (
            <InjuryWorkspace
              key={caseId}
              caseId={caseId}
              evidence={evidence}
              onRefresh={() => {
                void loadDetails();
              }}
              onAtlas={() => go("atlas")}
            />
          )}
          {view === "injuries" && (
            <details className="card">
              <summary>Existing evidence findings</summary>
              <div className="section-heading">
                <div>
                  <h2>Documented injury findings</h2>
                  <p>
                    Source approval does not approve anatomical placement or
                    rendering.
                  </p>
                </div>
                <button
                  disabled={!evidence.length}
                  onClick={() => setDialog("finding")}
                >
                  <Plus size={16} /> Draft finding
                </button>
              </div>
              {findings.map((f) => (
                <article className="card finding" key={f.id}>
                  <div>
                    <span className="badge">
                      {f.type} · {f.laterality}
                    </span>
                    <h2>{f.anatomicalStructure}</h2>
                    <p>{f.notes}</p>
                    <p className="fine">
                      Source:{" "}
                      {evidence.find((e) => e.id === f.evidenceId)?.name} ·{" "}
                      {f.citation}
                    </p>
                  </div>
                  <div className="review-grid">
                    <span>
                      Evidence <b>{f.sourceStatus}</b>
                    </span>
                    <span>
                      Attorney review <b>{f.attorneyReviewStatus}</b>
                    </span>
                    <span>
                      Placement <b>Not started</b>
                    </span>
                    <span>
                      Rendering <b>Not started</b>
                    </span>
                  </div>
                  {f.attorneyReviewStatus === "pending" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/cases/${caseId}/findings/${f.id}/review`,
                            { decision: "approve-source" },
                          );
                          await loadDetails();
                        })
                      }
                    >
                      Approve documented finding <ShieldCheck size={15} />
                    </button>
                  )}
                </article>
              ))}
              {!findings.length && (
                <Empty
                  title="No findings yet"
                  text="Upload evidence, then draft a finding with a specific page, image, or timestamp citation."
                />
              )}
            </details>
          )}
          {view === "reconstruction" && (
            <Empty
              title="Incident reconstruction"
              text="This will connect incident evidence, anatomical findings, and explicit reconstruction assumptions. No reconstruction engine is active yet."
            />
          )}
          {view === "exhibits" && (
            <section>
              <div className="section-heading">
                <div>
                  <h2>Exhibits and demand material</h2>
                  <p>
                    Saved documents from your injury production records.
                    Reviewed exports retain the approved case version.
                  </p>
                </div>
                <button onClick={() => go("injuries")}>
                  Open injury workspace
                </button>
              </div>
              {productions
                .filter((p) =>
                  p.assets.some((a) =>
                    [
                      "document",
                      "demand",
                      "exhibit",
                      "demand-reviewed",
                    ].includes(a.kind),
                  ),
                )
                .map((p) => (
                  <article className="card" key={p.id}>
                    <h3>{p.body.name}</h3>
                    <p>
                      {p.source_review
                        ? "Source reviewed"
                        : "Source review pending"}{" "}
                      ·{" "}
                      {p.body.recipe
                        ? p.render_review
                          ? "Illustration reviewed"
                          : "Illustration review pending"
                        : "Documentation only"}
                    </p>
                    {p.assets
                      .filter((a) =>
                        [
                          "document",
                          "demand",
                          "exhibit",
                          "demand-reviewed",
                        ].includes(a.kind),
                      )
                      .map((a) => (
                        <a
                          className="production-download"
                          href={`/api/cases/${caseId}/evidence/${a.id}`}
                          key={a.id}
                        >
                          {a.name}
                          <ArrowUpRight size={16} />
                        </a>
                      ))}
                  </article>
                ))}
              {!productions.some((p) =>
                p.assets.some((a) =>
                  ["document", "demand", "exhibit", "demand-reviewed"].includes(
                    a.kind,
                  ),
                ),
              ) && (
                <Empty
                  title="No generated documents yet"
                  text="Create an injury in the Injury workspace and start production. Completed PDFs and Word drafts will appear here and in Evidence."
                />
              )}
            </section>
          )}
          {view === "agents" && (
            <>
              <p className="intro">
                Describe the injury in ordinary language. The Injury Creation
                Agent handles evidence reading, medical documentation, anatomy
                selection and geometric production in the background.
              </p>
              <article className="card">
                <Bot />
                <h2>Injury Creation Agent</h2>
                <span className="badge">
                  {injuryAgentReady === null
                    ? "Checking connection"
                    : injuryAgentReady
                      ? "Assigned to injury creation"
                      : "AI connection required"}
                </span>
                <p>
                  Reads available case evidence, prepares the injury
                  explanation, builds a registered illustration and delivers the
                  files to Evidence. You review and apply the result.
                </p>
                <button onClick={() => go("atlas")}>
                  Open injury application panel
                </button>
              </article>
              <article className="card">
                <Bot />
                <h2>Coordinator</h2>
                <p>
                  Start a client file, ask for an injury analysis, or assemble
                  your demand material by text or voice.
                </p>
                <button className="primary" onClick={() => go("coordinator")}>
                  Open coordinator
                </button>
              </article>
              <div className="case-grid">
                {["Evidence Reconciliation", "Reconstruction"].map((n) => (
                  <article className="card" key={n}>
                    <Bot />
                    <h2>{n}</h2>
                    <span className="badge">Planned</span>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
      {dialog && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            className="modal"
          >
            <button
              className="close"
              onClick={() => setDialog("")}
              aria-label="Close dialog"
            >
              <X />
            </button>
            <h2 id="dialog-title">
              {dialog === "case"
                ? "Create a case"
                : dialog === "managecase"
                  ? "Manage case"
                  : dialog === "deletecase"
                    ? "Delete this case?"
                    : dialog === "invite"
                      ? "Invite a member"
                      : "Draft an injury finding"}
            </h2>
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                run(async () => {
                  const d = Object.fromEntries(form);
                  if (dialog === "case") {
                    const c = await api("/cases", d);
                    await loadCases();
                    setCaseId(c.id);
                    go("atlas");
                  } else if (dialog === "managecase") {
                    await api(`/cases/${caseId}/update`, d);
                    await loadCases();
                    setNotice("Case updated.");
                  } else if (dialog === "deletecase") {
                    await api(`/cases/${caseId}/delete`, d);
                    setCaseId("");
                    await loadCases();
                    setNotice("Case deleted.");
                  } else if (dialog === "invite") {
                    await api("/invitations", {
                      ...d,
                      caseId: caseId || undefined,
                    });
                    setNotice("Invitation sent.");
                  } else {
                    await api(`/cases/${caseId}/findings`, d);
                    await loadDetails();
                    go("injuries");
                  }
                  setDialog("");
                });
              }}
            >
              {dialog === "case" || dialog === "managecase" ? (
                <>
                  <Field
                    name="title"
                    label="Case title"
                    placeholder="Homer Cortez Injury Reconstruction"
                    defaultValue={
                      dialog === "managecase" ? active?.title : undefined
                    }
                  />
                  <Field
                    name="client"
                    label="Client / subject"
                    defaultValue={
                      dialog === "managecase" ? active?.client : undefined
                    }
                  />
                  <label>
                    Incident notes
                    <textarea
                      name="incident"
                      maxLength={4000}
                      defaultValue={
                        dialog === "managecase" ? active?.incident : undefined
                      }
                    />
                  </label>
                  {dialog === "managecase" && active && (
                    <div className="dialog-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(`/cases/${caseId}/archive`, {
                              archived: !active.archived,
                            });
                            await loadCases();
                            setNotice(
                              active.archived
                                ? "Case restored."
                                : "Case archived.",
                            );
                            setDialog("");
                          })
                        }
                      >
                        {active.archived ? (
                          <ArchiveRestore size={15} />
                        ) : (
                          <Archive size={15} />
                        )}{" "}
                        {active.archived ? "Restore case" : "Archive case"}
                      </button>
                      {member.role === "owner" && (
                        <button
                          type="button"
                          className="danger"
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setDialog("deletecase");
                          }}
                        >
                          <Trash2 size={15} /> Delete case
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : dialog === "deletecase" ? (
                <>
                  <p>
                    This permanently removes <b>{active?.title}</b>, its
                    findings, member access, and every uploaded evidence file.
                    Archive the case instead if you may need it again.
                  </p>
                  <Field
                    name="confirmTitle"
                    label="Type the case title to confirm"
                    placeholder={active?.title}
                  />
                </>
              ) : dialog === "invite" ? (
                <>
                  <Field name="email" label="Email address" type="email" />
                  <Field name="name" label="Name" />
                  <label>
                    Access
                    <select name="role">
                      <option value="client">Client — current case only</option>
                      {member.role === "owner" && (
                        <option value="attorney">
                          Attorney — firm workspace
                        </option>
                      )}
                    </select>
                  </label>
                  <p className="fine">
                    Client invitation for {active?.title || "no selected case"}.
                    Sending this form sends an email.
                  </p>
                </>
              ) : (
                <>
                  <Field
                    name="anatomicalStructure"
                    label="Injury / anatomical structure"
                  />
                  <div className="form-grid">
                    <label>
                      Type
                      <select name="type">
                        {["surface", "bone", "internal", "other"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Laterality
                      <select name="laterality">
                        {[
                          "unspecified",
                          "left",
                          "right",
                          "bilateral",
                          "midline",
                        ].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Source evidence
                    <select name="evidenceId">
                      {evidence.map((x) => (
                        <option value={x.id} key={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    name="citation"
                    label="Page, photograph, or timestamp citation"
                  />
                  <label>
                    Notes
                    <textarea name="notes" maxLength={4000} />
                  </label>
                </>
              )}
              <button
                className={`primary wide ${dialog === "deletecase" ? "danger" : ""}`}
                disabled={busy}
              >
                {busy
                  ? "Saving…"
                  : dialog === "invite"
                    ? "Send invitation"
                    : dialog === "deletecase"
                      ? "Delete permanently"
                      : "Save"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
