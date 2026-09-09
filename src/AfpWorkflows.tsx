import { useEffect, useState } from "react";
import type { WorkflowDefinition } from "../shared/afp-workflow";
import { api } from "./api";
import "./afp-workflows.css";

function WorkflowPanel({
  definition,
  initial,
  preview,
  save,
}: {
  definition: WorkflowDefinition;
  initial?: any;
  preview?: boolean;
  save?: (body: any) => Promise<void>;
}) {
  const [completed, setCompleted] = useState<string[]>(
      initial?.completed || [],
    ),
    [notes, setNotes] = useState(initial?.notes || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const remaining = definition.stages.find((s) =>
    s.items.some((i) => i.required && !completed.includes(i.id)),
  );
  return (
    <form
      className="afp-workflow-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          await save?.({ completed, notes });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="afp-workflow-progress" role="status">
        {preview ? "Preview only · " : ""}
        {remaining ? `Next stage · ${remaining.title}` : "Checklist complete"}
      </p>
      {definition.stages.map((stage) => (
        <fieldset key={stage.id}>
          <legend>{stage.title}</legend>
          {stage.items.map((item) => (
            <label className="afp-workflow-check" key={item.id}>
              <input
                type="checkbox"
                checked={completed.includes(item.id)}
                onChange={(e) =>
                  setCompleted(
                    e.target.checked
                      ? [...completed, item.id]
                      : completed.filter((id) => id !== item.id),
                  )
                }
              />
              <span>
                {item.label}
                {item.required && (
                  <small>Required to complete this stage</small>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      <label>
        Private run notes
        <textarea
          aria-label="Private run notes"
          maxLength={8000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <p className="muted">
        Checklist progress does not approve injuries, alter evidence, or
        generate documents.
      </p>
      {error && <p role="alert">{error}</p>}
      {preview ? (
        <p>No preview entries are saved.</p>
      ) : (
        <button className="primary" disabled={busy}>
          Save progress
        </button>
      )}
    </form>
  );
}
export function AfpWorkflows() {
  const [data, setData] = useState<any>({ features: [], runs: [] }),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{ id: string; version: number } | null>(
      null,
    ),
    [history, setHistory] = useState<any[] | null>(null);
  const load = async () => {
    const next = await api("/afp/workflows");
    setData(next);
    setLoaded(true);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const focus = () => void load().catch((e) => setError(e.message));
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  async function command(body: any) {
    setBusy(true);
    setError("");
    try {
      await api("/afp/workflows", body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="afp-workflows" aria-label="My AFP workflows">
      <div className="afp-workflow-intro">
        <p className="eyebrow">BASE APPLICATION + YOUR PRIVATE FEATURES</p>
        <h2>My AFP Workspace</h2>
        <p>
          Build a workflow with the Coordinator. Preview it, use it for your own
          work, and return to a previous version without changing anyone else's
          application.
        </p>
        <p>
          Try “Create and activate a private injury review workflow with stages
          for gathering records, checking missing information, and preparing my
          review. Give each stage a checklist and let me save notes.”
        </p>
        <div className="afp-actions">
          <a className="primary" href="/coordinator">
            Ask the Coordinator
          </a>
          <button
            disabled={busy}
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Refresh features
          </button>
          <button
            onClick={() =>
              void api("/afp/workflows/history")
                .then(setHistory)
                .catch((e) => setError(e.message))
            }
          >
            Feature history
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!loaded && !error && <p>Loading your private features…</p>}
      {loaded && !data.features.length && (
        <p className="afp-empty">
          No private workflows yet. Describe the workflow you want to the text
          or voice Coordinator. You do not need to configure fields yourself.
        </p>
      )}
      {data.features.map((f: any) => {
        const latest = f.versions[0],
          active = f.versions.find((v: any) => v.version === f.active_version),
          shown =
            preview?.id === f.id
              ? f.versions.find((v: any) => v.version === preview?.version)
              : null;
        return (
          <article className="afp-workflow-feature" key={f.id}>
            <div className="afp-row-head">
              <h3>{latest.definition.title}</h3>
              <span className="afp-status">Private · {f.state}</span>
            </div>
            <p>{latest.definition.description}</p>
            <p className="afp-reference">
              {f.contract} · Latest v{latest.version}
              {active ? ` · Active v${active.version}` : ""} ·{" "}
              {latest.compatibility}
            </p>
            <details>
              <summary>Manifest and ownership</summary>
              <p>
                Owner {f.owner_id} · Firm scope {f.firm_id} · Feature {f.id}
              </p>
              <p>
                Base version {latest.manifest.application.version}.
                Compatibility follows the workflow contract and current
                permissions. No external resources or generated code.
              </p>
              <pre>{JSON.stringify(latest.manifest, null, 2)}</pre>
            </details>
            <div className="afp-actions">
              {f.versions.map((v: any) => (
                <button
                  key={v.version}
                  disabled={busy}
                  onClick={() => setPreview({ id: f.id, version: v.version })}
                >
                  Preview v{v.version}
                </button>
              ))}
              <button
                disabled={busy || latest.compatibility !== "Compatible"}
                onClick={() =>
                  void command({
                    action: "activate",
                    id: f.id,
                    revision: f.revision,
                    version: latest.version,
                  })
                }
              >
                Use latest for me
              </button>
              {f.state === "active" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void command({
                      action: "disable",
                      id: f.id,
                      revision: f.revision,
                    })
                  }
                >
                  Disable
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void command({
                    action: "remove",
                    id: f.id,
                    revision: f.revision,
                  })
                }
              >
                Remove feature
              </button>
            </div>
            {shown && (
              <div className="afp-workflow-preview">
                <h4>Private preview · v{shown.version}</h4>
                <WorkflowPanel
                  key={`${f.id}:${shown.version}`}
                  definition={shown.definition}
                  preview
                />
                <div className="afp-actions">
                  <button
                    disabled={busy || shown.compatibility !== "Compatible"}
                    onClick={() =>
                      void command({
                        action:
                          shown.version === latest.version
                            ? "activate"
                            : "rollback",
                        id: f.id,
                        revision: f.revision,
                        version: shown.version,
                      })
                    }
                  >
                    {shown.version === latest.version
                      ? "Use this version"
                      : "Restore this version"}
                  </button>
                  <button onClick={() => setPreview(null)}>
                    Close preview
                  </button>
                </div>
              </div>
            )}
            {f.state === "active" && active?.compatibility === "Compatible" && (
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/afp/workflows/runs", {
                      action: "start",
                      featureId: f.id,
                      title: `${active.definition.title} · ${new Date().toLocaleDateString()}`,
                    });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Start a workflow run
              </button>
            )}
            {f.state === "active" &&
              data.runs
                .filter((r: any) => r.feature_id === f.id)
                .map((r: any) => {
                  const v = f.versions.find(
                    (v: any) => v.version === r.version,
                  );
                  return (
                    <details className="afp-workflow-run" key={r.id}>
                      <summary>
                        {r.body.title} · v{r.version} ·{" "}
                        {r.body.stage === "complete"
                          ? "Complete"
                          : "In progress"}
                      </summary>
                      {v?.compatibility === "Compatible" ? (
                        <WorkflowPanel
                          key={`${r.id}:${r.revision}`}
                          definition={v.definition}
                          initial={r.body}
                          save={async (body) => {
                            await api("/afp/workflows/runs", {
                              action: "update",
                              id: r.id,
                              revision: r.revision,
                              ...body,
                            });
                            await load();
                          }}
                        />
                      ) : (
                        <p>
                          This version needs compatibility or policy review
                          before use.
                        </p>
                      )}
                    </details>
                  );
                })}
          </article>
        );
      })}
      {history && (
        <aside aria-label="Private workflow history">
          <h3>Feature history</h3>
          <p>
            Lifecycle metadata only. Notes and conversations are not copied to
            the AFP audit.
          </p>
          {history.length === 0 && <p>No changes recorded.</p>}
          {history.map((h: any, i) => (
            <p key={i}>
              {new Date(h.created).toLocaleString()} · {h.body.action} ·{" "}
              {h.body.result} · {h.body.source}{" "}
              {h.body.version ? `· v${h.body.version}` : ""}
            </p>
          ))}
          <button onClick={() => setHistory(null)}>Close history</button>
        </aside>
      )}
    </section>
  );
}
