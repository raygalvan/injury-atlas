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
} from "lucide-react";
import "./style.css";
import { api } from "./api";
import { Field, Empty } from "./ui";
import { Atlas } from "./Atlas";
import { Login } from "./Login";
import type { Member, Case, Evidence, Finding } from "./domain";
const navigation = [
  ["atlas", "Human Atlas", Box],
  ["dashboard", "Dashboard", LayoutDashboard],
  ["cases", "Cases", FolderOpen],
  ["evidence", "Evidence", Files],
  ["injuries", "Injury findings", Activity],
  ["reconstruction", "Reconstruction", Clapperboard],
  ["exhibits", "Exhibits", FileOutput],
  ["agents", "Agents", Bot],
] as const;
function App() {
  const [member, setMember] = useState<Member | null>(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState("atlas"),
    [cases, setCases] = useState<Case[]>([]),
    [caseId, setCaseId] = useState(""),
    [evidence, setEvidence] = useState<Evidence[]>([]),
    [findings, setFindings] = useState<Finding[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dialog, setDialog] = useState(""),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false);
  const currentContext = useRef("");
  currentContext.current = `${member?.id || ""}:${caseId}`;
  const active = cases.find((c) => c.id === caseId);
  const client = member?.role === "client";
  const loadCases = async () => {
    const cs = await api("/cases");
    setCases(cs);
    setCaseId((prev) =>
      cs.some((c: Case) => c.id === prev) ? prev : cs[0]?.id || "",
    );
  };
  const loadDetails = async () => {
    if (!caseId) {
      setEvidence([]);
      setFindings([]);
      return;
    }
    const context = `${member?.id || ""}:${caseId}`;
    const [ev, fs] = await Promise.all([
      api(`/cases/${caseId}/evidence`),
      client ? Promise.resolve([]) : api(`/cases/${caseId}/findings`),
    ]);
    if (currentContext.current !== context) return;
    setEvidence(ev);
    setFindings(fs);
  };
  useEffect(() => {
    api("/me")
      .then(setMember)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (member) {
      loadCases().catch((e) => setError(e.message));
      if (member.role === "client") setView("evidence");
    }
  }, [member]);
  useEffect(() => {
    setEvidence([]);
    setFindings([]);
    loadDetails().catch((e) => setError(e.message));
  }, [caseId, member]);
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
  if (loading) return <div className="loading">Opening Injury Atlas…</div>;
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
  return (
    <div className="app">
      <aside className={mobile ? "rail open" : "rail"}>
        <div className="brand">
          <span className="brand-icon">
            <Box />
          </span>
          <div>
            injury<span>atlas</span>
            <small>INJURY EVIDENCE WORKSPACE</small>
          </div>
          <button
            className="close mobile"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <p className="rail-label">{client ? "CLIENT PORTAL" : "WORKSPACE"}</p>
        <nav>
          {(client
            ? navigation.filter((n) => n[0] === "evidence")
            : navigation
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "nav active" : "nav"}
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
              <small>{member.role}</small>
            </div>
            <button
              title="Sign out"
              onClick={() =>
                run(async () => {
                  await api("/auth/logout", {});
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
        <div className="content">
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
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <span className="subtle">
              {active?.client || "No case selected"}
            </span>
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
              <Atlas caseRecord={active} />
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
                  <b>{findings.length}</b>
                </div>
                <div className="mini-stat">
                  <span>Placement approved</span>
                  <b>0</b>
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
                  Reference anatomy is available. Injury placement and
                  reconstruction will follow source review.
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
          {view === "injuries" && (
            <>
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
            </>
          )}
          {view === "reconstruction" && (
            <Empty
              title="Incident reconstruction"
              text="This will connect incident evidence, anatomical findings, and explicit reconstruction assumptions. No reconstruction engine is active yet."
            />
          )}
          {view === "exhibits" && (
            <Empty
              title="Exhibits will begin with reviewed findings"
              text="Exhibit production and shareable presentations are planned. Nothing is published from this workspace yet."
            />
          )}
          {view === "agents" && (
            <>
              <p className="intro">
                The Coordinator will direct the specialist team. Agent execution
                is not enabled in this foundation.
              </p>
              <div className="case-grid">
                {[
                  "Case Coordinator",
                  "Medical Evidence",
                  "Anatomy Placement",
                  "Injury Rendering",
                  "Evidence Reconciliation",
                  "Reconstruction",
                  "Exhibit",
                ].map((n) => (
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
              {dialog === "case" ? (
                <>
                  <Field
                    name="title"
                    label="Case title"
                    placeholder="Homer Cortez Injury Reconstruction"
                  />
                  <Field name="client" label="Client / subject" />
                  <label>
                    Incident notes
                    <textarea name="incident" maxLength={4000} />
                  </label>
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
              <button className="primary wide" disabled={busy}>
                {busy
                  ? "Saving…"
                  : dialog === "invite"
                    ? "Send invitation"
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
