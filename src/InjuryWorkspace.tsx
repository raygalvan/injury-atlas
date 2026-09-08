import React, { useEffect, useState, useRef } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  Clock,
  Copy,
  FileText,
  Library,
  Plus,
  RefreshCw,
  Send,
} from "lucide-react";
import { api } from "./api";
import type { Evidence } from "./domain";
import type { ProductionInput, ProductionRecord } from "../server/production";
type Publication = {
  id: string;
  name: string;
  description: string;
  medical_references: string;
  kind: string;
  status: string;
  review_note: string;
  generation_state?: string;
  stage?: string;
  error?: string;
  notification?: string;
  can_manage: number;
};
const blank: ProductionInput = {
  name: "",
  description: "",
  medicalDescription: "",
  medicalReferences: "",
  clientImpact: "",
  impactCitation: "",
  evidenceId: "",
  citation: "",
  measurementBasis: "",
  recipe: null,
  useAI: true,
};
export function InjuryWorkspace({
  caseId,
  evidence,
  onRefresh,
  onAtlas,
}: {
  caseId: string;
  evidence: Evidence[];
  onRefresh: () => void;
  onAtlas: () => void;
}) {
  const [records, setRecords] = useState<ProductionRecord[]>([]),
    [catalog, setCatalog] = useState<Publication[]>([]),
    [admin, setAdmin] = useState(false),
    [tab, setTab] = useState(
      new URLSearchParams(location.search).has("library")
        ? "library"
        : "private",
    ),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<ProductionInput | null>(null),
    [editId, setEditId] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [submitFor, setSubmitFor] = useState(""),
    [pub, setPub] = useState({ name: "" });
  useEffect(() => {
    if (draft)
      document
        .querySelector('[aria-label="AI case injury request"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    else if (submitFor)
      document
        .querySelector('[aria-label="AI library request"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [!!draft, submitFor]);
  const focusedLibrary = useRef("");
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("library");
    if (tab !== "library" || !id || focusedLibrary.current === id) return;
    const entry = document.getElementById(`library-${id}`);
    if (entry) {
      entry.scrollIntoView({ block: "start" });
      focusedLibrary.current = id;
    }
  }, [tab, catalog]);
  const load = async () => {
    const [rs, ls] = await Promise.all([
      caseId ? api(`/cases/${caseId}/production`) : Promise.resolve([]),
      api("/injury-library"),
    ]);
    setRecords(rs);
    setCatalog(ls);
  };
  useEffect(() => {
    let active = true;
    setRecords([]);
    setSelected(new URLSearchParams(location.search).get("injury") || "");
    const refresh = async () => {
      try {
        const [rs, ls] = await Promise.all([
          caseId ? api(`/cases/${caseId}/production`) : Promise.resolve([]),
          api("/injury-library"),
        ]);
        if (active) {
          setRecords(rs);
          setCatalog(ls);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [caseId]);
  useEffect(() => {
    api("/production-capabilities")
      .then((d) => {
        setAdmin(d.platformAdmin);
      })
      .catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const current = records.find((r) => r.id === selected);
  const action = (r: ProductionRecord, decision: string) =>
    run(async () => {
      await api(`/cases/${caseId}/production/${r.id}/review`, { decision });
    });
  const set = (key: keyof ProductionInput, value: any) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  return (
    <section className="injury-workspace">
      <div className="section-heading">
        <div>
          <span className="eyebrow">INJURY PRODUCTION</span>
          <h2>Your injury workspace</h2>
          <p>
            Describe, model, document and manage injuries. Your work stays with
            your firm.
          </p>
        </div>
        <button
          disabled={!caseId}
          onClick={() => {
            setDraft({ ...blank });
            setEditId("");
          }}
        >
          <Plus size={16} /> Create injury
        </button>
      </div>
      <div className="production-expectation">
        <Clock size={22} />
        <div>
          <strong>You can leave while we work.</strong>
          <p>
            3D rendering requires precise measurements and geometric modeling on
            the reference anatomy. Timing varies with complexity and queue
            length. Files are saved in Evidence, and we email you a private link
            when production is complete.
          </p>
        </div>
      </div>
      {draft && (
        <div>
          <form
            className="card production-form"
            aria-label="AI case injury request"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await api(`/cases/${caseId}/injuries/generate`, {
                  name: draft.description.trim().slice(0, 160),
                  description: draft.description,
                });
                setSelected(r.id);
                setDraft(null);
                setTab("private");
                setNotice(
                  "Injury Creation Agent assigned. Results will appear in Evidence and you will be notified by email.",
                );
              });
            }}
          >
            <div className="section-heading">
              <h2>{editId ? "Revise injury request" : "Create injury"}</h2>
              <button type="button" onClick={() => setDraft(null)}>
                Close
              </button>
            </div>
            <label>
              Describe the injury
              <textarea
                required
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="For example: broken kneecap"
              />
            </label>
            <p>
              The Injury Creation Agent reads available case evidence, prepares
              the medical explanation, and builds the anatomical illustration.
              You review the result. You can leave while it works.
            </p>
            <button disabled={busy} type="submit">
              Send to Injury Creation Agent
            </button>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </form>
        </div>
      )}

      <div className="production-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "private"}
          onClick={() => setTab("private")}
        >
          Case injuries <span>{records.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "library"}
          onClick={() => setTab("library")}
        >
          <Library size={16} /> Injury library
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {tab === "private" && (
        <div className="production-columns">
          <div className="production-list">
            {!records.length && (
              <div className="card">
                <h3>Start with a documented injury</h3>
                <p>
                  Give the agent an injury name or a short description. It reads
                  available evidence and prepares the details for your review.
                </p>
              </div>
            )}
            {records.map((r) => (
              <button
                className={`production-row ${selected === r.id ? "selected" : ""}`}
                key={r.id}
                onClick={() => {
                  setSelected(r.id);
                  history.replaceState(
                    null,
                    "",
                    `/injuries?case=${caseId}&injury=${r.id}`,
                  );
                }}
              >
                <span
                  className={`badge ${r.state === "failed" ? "failed" : ""}`}
                >
                  {r.state === "complete" ? "Ready for review" : r.state}
                </span>
                <strong>{r.body.name}</strong>
                <small>{r.stage}</small>
                <span>
                  {r.body.recipe ? "3D + images + documents" : "Documents"} ·{" "}
                  {r.assets.length} files
                </span>
              </button>
            ))}
          </div>
          <div>
            {current ? (
              <article className="card production-detail">
                <span className="eyebrow">PRIVATE CASE RECORD</span>
                <h2>{current.body.name}</h2>
                <div className="production-progress">
                  <Activity size={18} />
                  <strong>{current.stage}</strong>
                  <span>
                    {current.notification === "sent"
                      ? "Email sent"
                      : current.notification === "retrying"
                        ? "Email delivery retrying"
                        : current.state === "complete"
                          ? "Email pending"
                          : ""}
                  </span>
                </div>
                {current.error && (
                  <p className="error" role="alert">
                    {current.error}
                  </p>
                )}
                <p>{current.body.description}</p>
                <dl>
                  {current.body.agentNotes && (
                    <>
                      <dt>Agent review notes</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>
                        {current.body.agentNotes}
                      </dd>
                    </>
                  )}
                  <dt>Medical explanation</dt>
                  <dd>{current.body.medicalDescription || "Not supplied"}</dd>
                  <dt>Medical references</dt>
                  <dd>{current.body.medicalReferences || "Not supplied"}</dd>
                  <dt>Client effects</dt>
                  <dd>{current.body.clientImpact || "Not documented"}</dd>
                  <dt>Source citations</dt>
                  <dd>
                    {current.body.citation || "No injury source linked"}
                    <br />
                    {current.body.impactCitation}
                  </dd>
                  <dt>Measurement and illustration basis</dt>
                  <dd>
                    {current.body.measurementBasis || "Documentation only"}
                  </dd>
                </dl>
                <div className="production-actions">
                  {["draft", "failed"].includes(current.state) &&
                    !current.assets.length && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setDraft(structuredClone(current.body));
                          setEditId(current.id);
                        }}
                      >
                        Revise request
                      </button>
                    )}
                  {["draft", "failed"].includes(current.state) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/cases/${caseId}/production/${current.id}/queue`,
                            {},
                          );
                          setNotice(
                            "Queued. You can close this page; we will email you when the files are ready.",
                          );
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      {current.state === "failed"
                        ? "Retry production"
                        : "Start production"}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      setDraft({
                        ...structuredClone(current.body),
                        name: current.body.name + " — revision",
                      });
                      setEditId("");
                    }}
                  >
                    <Copy size={15} /> Create revision
                  </button>
                </div>
                {!!current.assets.length && (
                  <>
                    <h3>Generated files in Evidence</h3>
                    <div className="production-assets">
                      {current.assets
                        .filter((a) => a.kind.startsWith("image"))
                        .map((a) => (
                          <figure key={a.id}>
                            <img
                              src={`/api/cases/${caseId}/production/${current.id}/preview/${a.id}`}
                              alt={`${current.body.name}: ${a.kind.replace("image-", "")} anatomical illustration`}
                            />
                            <figcaption>
                              {a.kind.replace("image-", "")} · Draft
                              illustration
                            </figcaption>
                          </figure>
                        ))}
                    </div>
                    {current.assets.map((a) => (
                      <a
                        className="production-download"
                        key={a.id}
                        href={`/api/cases/${caseId}/evidence/${a.id}`}
                      >
                        <FileText size={16} />
                        {a.name}
                        <ArrowRight size={15} />
                      </a>
                    ))}
                  </>
                )}
                <div className="production-actions">
                  <button
                    disabled={
                      busy ||
                      current.state !== "complete" ||
                      !current.source_review ||
                      (!!current.body.recipe &&
                        (!current.placement_review || !current.render_review))
                    }
                    onClick={() =>
                      run(async () => {
                        await api(
                          `/cases/${caseId}/production/${current.id}/export`,
                          {},
                        );
                        setNotice(
                          "Reviewed exhibit and demand material saved in Evidence.",
                        );
                      })
                    }
                  >
                    Issue reviewed exhibit
                  </button>
                </div>
                <h3>Independent review decisions</h3>
                <div className="production-actions">
                  {(["source", "placement", "render"] as const).map((k) => (
                    <button
                      key={k}
                      disabled={
                        busy ||
                        !!current[`${k}_review`] ||
                        (k !== "source" && current.state !== "complete")
                      }
                      onClick={() => action(current, k)}
                    >
                      {!!current[`${k}_review`] && <Check size={15} />}{" "}
                      {k === "source"
                        ? "Confirm source"
                        : k === "placement"
                          ? "Approve placement"
                          : "Approve illustration"}
                    </button>
                  ))}
                </div>
                <p className="fine">
                  Source approval confirms the cited finding. Placement and
                  visual appearance require separate review. Draft files remain
                  labeled for review.
                </p>
                <div className="production-actions">
                  <button
                    disabled={
                      busy ||
                      !current.source_review ||
                      !current.placement_review ||
                      !current.render_review
                    }
                    onClick={() =>
                      action(current, current.applied ? "remove" : "apply")
                    }
                  >
                    {current.applied ? "Remove from atlas" : "Apply to atlas"}
                  </button>
                  {!!current.applied && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          action(current, current.hidden ? "show" : "hide")
                        }
                      >
                        {current.hidden ? "Show injury" : "Hide injury"}
                      </button>
                      <button onClick={onAtlas}>Open atlas</button>
                    </>
                  )}
                  <button
                    disabled={busy || current.state !== "complete"}
                    onClick={() =>
                      run(async () => {
                        await api(
                          `/cases/${caseId}/production/${current.id}/submit`,
                          { name: current.body.name },
                        );
                        setTab("library");
                        setNotice(
                          "The agent is preparing a separate generic definition and medical references. Your private case injury is retained.",
                        );
                      })
                    }
                  >
                    <Send size={15} /> Submit generic template
                  </button>
                </div>
                <p className="fine">
                  Submitting a generic version never removes your private
                  injury. Client descriptions, evidence, impact and rendered
                  case assets are not copied into the shared library.
                </p>
              </article>
            ) : (
              <div className="card">
                <h3>Select an injury</h3>
                <p>Review its progress, files and approvals here.</p>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === "library" && (
        <>
          <div className="section-heading">
            <div>
              <h3>Reusable medical knowledge</h3>
              <p>
                Approved entries are shared. Submitted entries remain private
                until review. Each application gets its own case measurements.
              </p>
            </div>
            <button
              onClick={() => {
                setSubmitFor("new");
                setPub({ name: "" });
              }}
            >
              Add library entry
            </button>
          </div>
          {!!submitFor && (
            <form
              className="card production-form"
              aria-label="AI library request"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api(
                    submitFor.startsWith("library:")
                      ? `/injury-library/${submitFor.slice(8)}/revise`
                      : "/injury-library",
                    { name: pub.name },
                  );
                  setSubmitFor("");
                  setNotice(
                    "Injury Creation Agent assigned. You can leave; we will email you when the definition and references are ready for review.",
                  );
                });
              }}
            >
              <h3>
                {submitFor.startsWith("library:")
                  ? "Revise with AI"
                  : "Add an injury to the library"}
              </h3>
              <label>
                Injury name
                <input
                  required
                  maxLength={160}
                  value={pub.name}
                  onChange={(e) => setPub({ name: e.target.value })}
                  placeholder="For example: broken left femur"
                />
              </label>
              <p>
                The Injury Creation Agent writes the medical definition and
                researches cited references. You review the finished result. No
                client information is needed.
              </p>
              <div className="production-actions">
                <button disabled={busy} type="submit">
                  {busy ? "Assigning agent…" : "Generate with AI"}
                </button>
                <button type="button" onClick={() => setSubmitFor("")}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="production-library">
            {catalog.map((p) => (
              <article className="card" key={p.id} id={`library-${p.id}`}>
                <span className="badge">
                  {p.status === "submitted" ? "Ready for review" : p.status}
                </span>
                <h3>{p.name}</h3>
                {p.stage && <p role="status">{p.stage}</p>}
                {p.error && (
                  <p className="error" role="alert">
                    {p.error}
                  </p>
                )}
                {p.description && (
                  <p style={{ whiteSpace: "pre-wrap" }}>{p.description}</p>
                )}
                {p.medical_references && (
                  <p className="fine" style={{ whiteSpace: "pre-wrap" }}>
                    References: {p.medical_references}
                  </p>
                )}
                {p.notification === "sent" && (
                  <p className="fine">Completion email sent</p>
                )}
                {p.generation_state === "failed" && !!p.can_manage && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`/injury-library/${p.id}/retry`, {});
                      })
                    }
                  >
                    Retry research
                  </button>
                )}
                {p.review_note && <p>Review: {p.review_note}</p>}
                {p.status === "approved" && (
                  <button
                    disabled={!caseId}
                    onClick={() => {
                      setDraft({
                        ...blank,
                        name: p.name,
                        description: p.name,
                        medicalDescription: p.description,
                        medicalReferences: p.medical_references,
                      });
                      setEditId("");
                      setNotice(
                        "The agent will read the case evidence for this injury. Add a short description only if you want to clarify the request.",
                      );
                    }}
                  >
                    Use in this case
                  </button>
                )}
                {!!p.can_manage && (
                  <button
                    onClick={() => {
                      setSubmitFor(`library:${p.id}`);
                      setPub({ name: p.name });
                    }}
                  >
                    Revise definition
                  </button>
                )}
                {admin && (
                  <div className="production-actions">
                    {["approved", "rejected", "retired"].map((status) => (
                      <button
                        key={status}
                        disabled={
                          busy ||
                          p.status === status ||
                          ["generating", "failed"].includes(p.status)
                        }
                        onClick={() =>
                          run(async () => {
                            await api(`/injury-library/${p.id}/review`, {
                              status,
                              note:
                                status === "approved"
                                  ? "Reviewed for generic library publication."
                                  : "Removed from publication by administrator.",
                            });
                          })
                        }
                      >
                        {status === "approved"
                          ? "Approve"
                          : status === "rejected"
                            ? "Reject"
                            : "Retire"}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
          {!catalog.length && (
            <p>
              No published injury definitions yet. Your private case records
              remain available in Case injuries.
            </p>
          )}
        </>
      )}
    </section>
  );
}
