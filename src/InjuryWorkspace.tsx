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
type Part = { id: string; name: string; system: string; bounds: number[][] };
type Publication = {
  id: string;
  name: string;
  description: string;
  medical_references: string;
  kind: string;
  status: string;
  review_note: string;
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
  useAI: false,
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
    [parts, setParts] = useState<Part[]>([]),
    [admin, setAdmin] = useState(false),
    [tab, setTab] = useState("private"),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<ProductionInput | null>(null),
    [editId, setEditId] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [submitFor, setSubmitFor] = useState(""),
    [pub, setPub] = useState({
      name: "",
      description: "",
      medicalReferences: "",
      kind: "documentation",
    });
  const placementFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== placementFrame.current?.contentWindow ||
        event.data?.type !== "human-atlas:selection" ||
        event.data?.caseId !== caseId
      )
        return;
      const { point, normal, sourceIds } = event.data;
      if (
        !Array.isArray(point) ||
        point.length !== 3 ||
        !point.every(Number.isFinite) ||
        !Array.isArray(normal) ||
        normal.length !== 3 ||
        !normal.every(Number.isFinite)
      )
        return;
      setDraft((d) =>
        d?.recipe && sourceIds?.includes(d.recipe.parentId)
          ? {
              ...d,
              recipe: {
                ...d.recipe,
                center: point as [number, number, number],
                normal: normal as [number, number, number],
              },
            }
          : d,
      );
    };
    addEventListener("message", receive);
    return () => removeEventListener("message", receive);
  }, [caseId]);
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
        setParts(d.parts);
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
  const eligible = parts.filter((p) =>
    draft?.recipe?.kind === "abrasion"
      ? p.system === "integumentary"
      : draft?.recipe?.kind === "fracture"
        ? p.system === "skeletal" && /rib/i.test(p.name)
        : p.system === "nervous" && /(gyrus|sulcus|cerebr|lobe)/i.test(p.name),
  );
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
                  Create an injury description now. Add evidence, client effects
                  and measured placement as they become available.
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
                        Edit details
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
                    onClick={() => {
                      setSubmitFor(current.id);
                      setPub({
                        name: current.body.name,
                        description: "",
                        medicalReferences: "",
                        kind: current.body.recipe?.kind || "documentation",
                      });
                    }}
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
            {admin && (
              <button
                onClick={() => {
                  setSubmitFor("admin");
                  setPub({
                    name: "",
                    description: "",
                    medicalReferences: "",
                    kind: "documentation",
                  });
                }}
              >
                Add library entry
              </button>
            )}
          </div>
          <div className="production-library">
            {catalog.map((p) => (
              <article className="card" key={p.id}>
                <span className="badge">{p.status}</span>
                <h3>{p.name}</h3>
                <p>{p.description}</p>
                <p className="fine">References: {p.medical_references}</p>
                {p.review_note && <p>Review: {p.review_note}</p>}
                {p.status === "approved" && (
                  <button
                    disabled={!caseId}
                    onClick={() => {
                      setDraft({
                        ...blank,
                        name: p.name,
                        medicalDescription: p.description,
                        medicalReferences: p.medical_references,
                      });
                      setEditId("");
                      setNotice(
                        "Add your client’s documented injury and placement. The library does not establish client facts.",
                      );
                    }}
                  >
                    Use in this case
                  </button>
                )}
                {admin && (
                  <button
                    onClick={() => {
                      setSubmitFor(`library:${p.id}`);
                      setPub({
                        name: p.name,
                        description: p.description,
                        medicalReferences: p.medical_references,
                        kind: p.kind,
                      });
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
                        disabled={busy || p.status === status}
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
      {draft && (
        <div className="modal-backdrop">
          <form
            className="modal production-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await api(
                  `/cases/${caseId}/production${editId ? `/${editId}/update` : ""}`,
                  draft,
                );
                setSelected(r.id);
                setDraft(null);
                setTab("private");
                setNotice(
                  "Draft saved. Start production when the details are ready.",
                );
              });
            }}
          >
            <div className="section-heading">
              <h2>{editId ? "Edit injury" : "Create injury"}</h2>
              <button type="button" onClick={() => setDraft(null)}>
                Close
              </button>
            </div>
            <label>
              Injury name
              <input
                required
                maxLength={160}
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <label>
              What is documented?
              <textarea
                required
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Describe the injury, including known location and uncertainty."
              />
            </label>
            <div className="production-fields">
              <label>
                Source evidence
                <select
                  value={draft.evidenceId}
                  onChange={(e) => set("evidenceId", e.target.value)}
                >
                  <option value="">Choose evidence later</option>
                  {evidence.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Page, image or timestamp citation
                <input
                  value={draft.citation}
                  onChange={(e) => set("citation", e.target.value)}
                />
              </label>
            </div>
            <label>
              Medical explanation
              <textarea
                value={draft.medicalDescription}
                onChange={(e) => set("medicalDescription", e.target.value)}
              />
            </label>
            <label>
              Medical references
              <textarea
                value={draft.medicalReferences}
                onChange={(e) => set("medicalReferences", e.target.value)}
              />
            </label>
            <div className="production-fields">
              <label>
                Effects on this client
                <textarea
                  value={draft.clientImpact}
                  onChange={(e) => set("clientImpact", e.target.value)}
                />
              </label>
              <label>
                Source supporting those effects
                <textarea
                  required={!!draft.clientImpact}
                  value={draft.impactCitation}
                  onChange={(e) => set("impactCitation", e.target.value)}
                />
              </label>
            </div>
            <label className="production-check">
              <input
                type="checkbox"
                checked={draft.useAI}
                onChange={(e) => set("useAI", e.target.checked)}
              />{" "}
              Draft medical description and demand narrative with AI from the
              supplied material
            </label>
            <label>
              Production method
              <select
                aria-label="Production method"
                value={draft.recipe?.kind || "documentation"}
                onChange={(e) =>
                  set(
                    "recipe",
                    e.target.value === "documentation"
                      ? null
                      : {
                          kind: e.target.value,
                          parentId: "",
                          center: [0, 0, 0],
                          normal: [0, 0, 1],
                          widthMm: 20,
                          heightMm: 20,
                          depthMm: e.target.value === "abrasion" ? 0 : 1,
                        },
                  )
                }
              >
                <option value="documentation">Documentation only</option>
                <option value="abrasion">Surface abrasion illustration</option>
                <option value="subarachnoid">
                  Subarachnoid surface blood layer
                </option>
                <option value="fracture">Individual rib fracture</option>
              </select>
            </label>
            {draft.recipe && (
              <fieldset>
                <legend>Measured reference anatomy placement</legend>
                <p>
                  Values are illustrative defaults until you replace and
                  document them. Atlas coordinates are in meters; injury
                  dimensions are in millimeters. These are reference anatomy
                  measurements, not patient-specific geometry.
                </p>
                <label>
                  Filter anatomy
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  Target structure
                  <select
                    aria-label="Target structure"
                    required
                    value={draft.recipe.parentId}
                    onChange={(e) => {
                      const part = parts.find((p) => p.id === e.target.value)!;
                      set("recipe", {
                        ...draft.recipe,
                        parentId: part.id,
                        center: [
                          (part.bounds[0][0] + part.bounds[1][0]) / 2,
                          (part.bounds[0][1] + part.bounds[1][1]) / 2,
                          part.bounds[1][2],
                        ],
                      });
                    }}
                  >
                    <option value="">Select a structure</option>
                    {eligible
                      .filter(
                        (p) =>
                          p.name.toLowerCase().includes(search.toLowerCase()) ||
                          p.id === draft.recipe?.parentId,
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                  </select>
                </label>
                {draft.recipe.parentId && (
                  <>
                    <p>
                      <strong>
                        Click the injury location on the anatomy below.
                      </strong>{" "}
                      Drag to rotate and scroll or pinch to zoom. Your click
                      records a surface point and direction.
                    </p>
                    <iframe
                      ref={placementFrame}
                      key={draft.recipe.parentId}
                      title="Choose injury placement on actual anatomy"
                      style={{
                        width: "100%",
                        height: 420,
                        border: "1px solid #ccd3c8",
                        borderRadius: 10,
                      }}
                      src={`/atlas-engine/index.html?embed=injurybot&parentOrigin=${encodeURIComponent(location.origin)}&caseId=${caseId}&caseTitle=Injury%20placement&placement=${draft.recipe.parentId}`}
                    />
                  </>
                )}
                <details>
                  <summary>Exact position and direction</summary>
                  <div className="production-fields">
                    {(
                      ["X coordinate", "Y coordinate", "Z coordinate"] as const
                    ).map((label, i) => (
                      <label key={label}>
                        {label}
                        <input
                          type="number"
                          step="0.0001"
                          required
                          value={draft.recipe!.center[i]}
                          onChange={(e) => {
                            const center = [...draft.recipe!.center];
                            center[i] = Number(e.target.value);
                            set("recipe", { ...draft.recipe, center });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    {draft.recipe.kind === "fracture"
                      ? "Fracture plane normal"
                      : "Surface direction"}
                    <select
                      value={draft.recipe.normal.join(",")}
                      onChange={(e) =>
                        set("recipe", {
                          ...draft.recipe,
                          normal: e.target.value.split(",").map(Number),
                        })
                      }
                    >
                      {![
                        "0,0,1",
                        "0,0,-1",
                        "1,0,0",
                        "-1,0,0",
                        "0,1,0",
                        "0,-1,0",
                      ].includes(draft.recipe.normal.join(",")) && (
                        <option value={draft.recipe.normal.join(",")}>
                          Picked surface direction
                        </option>
                      )}
                      {[
                        ["0,0,1", "Anterior"],
                        ["0,0,-1", "Posterior"],
                        ["1,0,0", "Left"],
                        ["-1,0,0", "Right"],
                        ["0,1,0", "Superior"],
                        ["0,-1,0", "Inferior"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </details>
                <div className="production-fields">
                  {(["widthMm", "heightMm", "depthMm"] as const).map((key) => (
                    <label key={key}>
                      {key === "depthMm"
                        ? draft.recipe?.kind === "fracture"
                          ? "Fracture gap (mm)"
                          : "Layer thickness (mm)"
                        : key === "widthMm"
                          ? "Width (mm)"
                          : "Height (mm)"}
                      <input
                        type="number"
                        step="0.1"
                        min={key === "depthMm" ? 0 : 0.1}
                        max={key === "depthMm" ? 10 : 250}
                        disabled={
                          key === "depthMm" && draft.recipe?.kind === "abrasion"
                        }
                        value={draft.recipe![key]}
                        onChange={(e) =>
                          set("recipe", {
                            ...draft.recipe,
                            [key]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Measurement source and illustrative assumptions
                  <textarea
                    required
                    value={draft.measurementBasis}
                    onChange={(e) => set("measurementBasis", e.target.value)}
                    placeholder="Cite documented dimensions. Identify any illustrative dimensions or placement estimates explicitly."
                  />
                </label>
              </fieldset>
            )}
            <button disabled={busy} type="submit">
              Save injury draft
            </button>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </form>
        </div>
      )}
      {!!submitFor && (
        <div className="modal-backdrop">
          <form
            className="modal production-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(
                  submitFor.startsWith("library:")
                    ? `/injury-library/${submitFor.slice(8)}/revise`
                    : submitFor === "admin"
                      ? "/injury-library"
                      : `/cases/${caseId}/production/${submitFor}/submit`,
                  pub,
                );
                setSubmitFor("");
                setTab("library");
                setNotice(
                  "Submitted for shared-library review. Your private case injury is retained.",
                );
              });
            }}
          >
            <h2>
              {submitFor === "admin"
                ? "Create library definition"
                : "Submit a reusable definition"}
            </h2>
            <p>
              Write a generic medical definition. Do not include names, case
              facts, client effects, source records or identifying images.
            </p>
            <label>
              Generic name
              <input
                required
                value={pub.name}
                onChange={(e) => setPub({ ...pub, name: e.target.value })}
              />
            </label>
            <label>
              Generic medical description
              <textarea
                required
                value={pub.description}
                onChange={(e) =>
                  setPub({ ...pub, description: e.target.value })
                }
              />
            </label>
            <label>
              Medical references
              <textarea
                required
                value={pub.medicalReferences}
                onChange={(e) =>
                  setPub({ ...pub, medicalReferences: e.target.value })
                }
              />
            </label>
            <label>
              Rendering capability
              <select
                value={pub.kind}
                onChange={(e) => setPub({ ...pub, kind: e.target.value })}
              >
                {["documentation", "abrasion", "subarachnoid", "fracture"].map(
                  (k) => (
                    <option key={k}>{k}</option>
                  ),
                )}
              </select>
            </label>
            <div className="production-actions">
              <button disabled={busy}>Submit for review</button>
              <button type="button" onClick={() => setSubmitFor("")}>
                Cancel
              </button>
            </div>
            {error && <p role="alert">{error}</p>}
          </form>
        </div>
      )}
    </section>
  );
}
