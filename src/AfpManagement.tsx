import { AfpManifestInspector } from "./AfpManifestInspector";
import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import { AfpMemoryDecisions } from "./AfpMemoryDecisions";
import {
  readinessStatuses,
  policyLevels,
  type AfpControlPlane,
  type ReadinessItem,
  type AfpPolicy,
} from "../shared/afp";
const views = [
  ["overview", "Overview"],
  ["readiness", "AFP Readiness"],
  ["extensions", "Extension Points"],
  ["permissions", "Permissions"],
  ["resources", "Resources"],
  ["features", "AFP Features"],
  ["memory", "Memory & Decisions"],
] as const;
type View = (typeof views)[number][0];
const statusClass = (status: string) =>
  "afp-status afp-status-" + status.toLowerCase().replaceAll(" ", "-");
function Status({ value }: { value: string }) {
  return <span className={statusClass(value)}>{value}</span>;
}
function Reference({ value }: { value: string }) {
  return (
    <p className="afp-reference">
      {value || "No implementation reference recorded."}
    </p>
  );
}
export function AfpManagement() {
  const initial = new URLSearchParams(location.search).get("afpView");
  const [view, setView] = useState<View>(
    views.some(([id]) => id === initial) ? (initial as View) : "overview",
  );
  const [data, setData] = useState<AfpControlPlane | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReadinessItem | null>(null),
    [history, setHistory] = useState<{ title: string; rows: any[] } | null>(
      null,
    );
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const load = async () => setData(await api("/settings/afp/control-plane"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  function select(next: View) {
    setView(next);
    setNotice("");
    const url = new URL(location.href);
    url.searchParams.set("afpView", next);
    url.hash = "afp";
    window.history.replaceState(null, "", url);
  }
  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice("AFP control-plane record saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showHistory(id: string, title: string) {
    setError("");
    try {
      setHistory({
        title,
        rows: await api("/settings/afp/history/" + encodeURIComponent(id)),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const policy = (p: AfpPolicy, level: string) =>
    void mutate(() =>
      api("/settings/afp/policies/" + p.id, { level, revision: p.revision }),
    );
  return (
    <section className="settings-card afp-management" id="afp">
      <header className="afp-control-header">
        <div>
          <p className="eyebrow">
            injury.bot · Reference implementation / pilot
          </p>
          <h2>AFP Management</h2>
          <p>
            Define where personal features can fit, what they may change, and
            what still needs to be built.
          </p>
        </div>
        <span className="settings-lock">Super admin</span>
      </header>
      <div className="afp-actions">
        <a className="primary-button" href="/coordinator?topic=afp">
          Discuss AFP with the coordinator
        </a>
        <button
          disabled={busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh AFP state
        </button>
      </div>
      <div
        className="afp-subtabs"
        role="tablist"
        aria-label="AFP Management views"
      >
        {views.map(([id, label], index) => (
          <button
            key={id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            id={"afp-tab-" + id}
            role="tab"
            type="button"
            aria-selected={view === id}
            aria-controls={"afp-view-" + id}
            tabIndex={view === id ? 0 : -1}
            onClick={() => select(id)}
            onKeyDown={(e) => {
              let next = index;
              if (e.key === "ArrowRight") next = (index + 1) % views.length;
              else if (e.key === "ArrowLeft")
                next = (index + views.length - 1) % views.length;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = views.length - 1;
              else return;
              e.preventDefault();
              select(views[next][0]);
              tabs.current[next]?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="work-notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="settings-saved">
          {notice}
        </p>
      )}
      {!data && <p role="status">Loading AFP registries…</p>}
      {data && (
        <>
          <div
            role="tabpanel"
            id="afp-view-overview"
            aria-labelledby="afp-tab-overview"
            hidden={view !== "overview"}
          >
            <div className="afp-overview-hero">
              <p className="eyebrow">Customization architecture · target</p>
              <h3>{data.application.architecture}</h3>
              <p>
                Keep injury.bot as the maintained shared application. Future
                features can belong to one person or firm and use separate
                infrastructure without cloning the whole app.
              </p>
              <Status value="Foundation" />
              <p className="muted">
                The control plane is real. Isolated extension execution is not
                connected.
              </p>
            </div>
            <div className="afp-metrics">
              <article>
                <strong>{data.extensionPoints.length}</strong>
                <span>Registered candidate boundaries</span>
              </article>
              <article>
                <strong>{data.featureCount}</strong>
                <span>AFP feature records</span>
              </article>
              <article>
                <Status
                  value={data.readiness.find((r) => r.id === "mcp")!.status}
                />
                <span>
                  AFP MCP ·{" "}
                  {data.runtime.mcpConnected ? "Connected" : "Not connected"}
                </span>
              </article>
              <article>
                <Status
                  value={data.readiness.find((r) => r.id === "sdk")!.status}
                />
                <span>
                  AFP SDK Boundary · Implemented v{data.sdkBoundary.version}
                </span>
              </article>
            </div>
            <div className="afp-overview-grid">
              <article>
                <h3>Overall AFP readiness</h3>
                <p>{data.overall.label}</p>
                <p className="muted">
                  An isolated pilot requires every listed gate to be verified.
                  Strong configuration controls cannot substitute for an
                  execution boundary.
                </p>
                <button onClick={() => select("readiness")}>
                  Review pilot criteria
                </button>
              </article>
              <article>
                <h3>Protected boundaries</h3>
                <p>{data.protectedBoundaries.label}</p>
                <button onClick={() => select("permissions")}>
                  Review permissions
                </button>
              </article>
              <article>
                <h3>External resources</h3>
                <p>{data.externalResources.label}</p>
                <button onClick={() => select("resources")}>
                  Inspect resources
                </button>
              </article>
              <article>
                <h3>AFP Manifest · Implemented v0.1</h3>
                <p>
                  The experimental injury.bot-specific schema, validator and one
                  SDK contract are implemented. Executable Runtime: Not
                  implemented.
                </p>
                <a href="/api/settings/afp/manifest" download>
                  Download manifest v0.1
                </a>
              </article>
            </div>
            <p className="afp-reference">
              Base application version ·{" "}
              {data.application.baseVersion ||
                "Not available in this development build"}
            </p>
          </div>
          <div
            role="tabpanel"
            id="afp-view-readiness"
            aria-labelledby="afp-tab-readiness"
            hidden={view !== "readiness"}
          >
            <h3>AFP Readiness</h3>
            <p>{data.overall.label}</p>
            <details className="afp-criteria" open>
              <summary>Required isolated-pilot criteria</summary>
              <ul>
                {data.overall.criteria.map((c) => (
                  <li key={c.id}>
                    <span aria-label={c.met ? "Met" : "Not yet met"}>
                      {c.met ? "✓" : "○"}
                    </span>{" "}
                    {c.label}{" "}
                    <span className="muted">
                      {c.met ? "Verified" : "Verification required"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
            <p className="muted">
              Planned means not built. Foundation means supporting code or
              definitions exist. Partial means some AFP behavior works.
              Implemented means the described capability works. Verified adds a
              recorded admin verification reference. Status changes cannot
              exceed what this release implements.
            </p>
            <div className="afp-registry">
              {data.readiness.map((r) => (
                <article key={r.id}>
                  <div className="afp-row-head">
                    <h4>{r.name}</h4>
                    <Status value={r.status} />
                  </div>
                  <p>{r.description}</p>
                  <Reference value={r.evidence} />
                  <p>
                    <strong>Next step</strong> {r.nextStep}
                  </p>
                  {r.dependencies.length > 0 && (
                    <p className="muted">
                      Dependencies ·{" "}
                      {r.dependencies
                        .map(
                          (id) =>
                            data.readiness.find((d) => d.id === id)?.name || id,
                        )
                        .join(", ")}
                    </p>
                  )}
                  {r.lastVerified && (
                    <p className="afp-reference">
                      Last verification recorded{" "}
                      {new Date(r.lastVerified.at).toLocaleString()} ·{" "}
                      {r.lastVerified.reference}
                      {r.status !== "Verified"
                        ? " · Current status is no longer Verified."
                        : ""}
                    </p>
                  )}
                  <div className="afp-actions">
                    <button onClick={() => setReview(r)}>
                      Review {r.name}
                    </button>
                    <button
                      onClick={() =>
                        void showHistory("readiness:" + r.id, r.name)
                      }
                    >
                      Verification history
                    </button>
                  </div>
                  {review?.id === r.id && (
                    <form
                      className="settings-form afp-inline-review"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mutate(async () => {
                          await api("/settings/afp/readiness/" + r.id, {
                            status: review.status,
                            evidence: review.evidence,
                            nextStep: review.nextStep,
                            revision: review.revision,
                          });
                          setReview(null);
                        });
                      }}
                    >
                      <label>
                        Status
                        <select
                          aria-label="Readiness status"
                          value={review.status}
                          onChange={(e) =>
                            setReview({
                              ...review,
                              status: e.target.value as ReadinessItem["status"],
                            })
                          }
                        >
                          {readinessStatuses.map((s, i) => (
                            <option
                              key={s}
                              disabled={
                                i > readinessStatuses.indexOf(r.ceiling)
                              }
                            >
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Implementation / verification reference
                        <textarea
                          aria-label="Implementation / verification reference"
                          required={review.status !== "Planned"}
                          maxLength={4000}
                          value={review.evidence}
                          onChange={(e) =>
                            setReview({ ...review, evidence: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Recommendation / next step
                        <textarea
                          required
                          maxLength={4000}
                          value={review.nextStep}
                          onChange={(e) =>
                            setReview({ ...review, nextStep: e.target.value })
                          }
                        />
                      </label>
                      <div className="afp-actions">
                        <button disabled={busy}>Save readiness review</button>
                        <button type="button" onClick={() => setReview(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              ))}
            </div>
          </div>
          <div
            role="tabpanel"
            id="afp-view-extensions"
            aria-labelledby="afp-tab-extensions"
            hidden={view !== "extensions"}
          >
            <h3>Extension Points</h3>
            <p>
              These registered candidates describe real application boundaries.
              Dynamic code attachment is not installed.
            </p>
            <div className="afp-registry afp-two-columns">
              {data.extensionPoints.map((p) => (
                <article key={p.id}>
                  <div className="afp-row-head">
                    <h4>{p.name}</h4>
                    <Status value={p.status} />
                  </div>
                  <p className="eyebrow">{p.type}</p>
                  <p>{p.description}</p>
                  <p>{p.customizationAllowed}</p>
                  <p className="afp-reference">
                    {p.sdkContract
                      ? `Trusted SDK contract · ${p.sdkContract}`
                      : "Candidate only · no SDK contract"}
                  </p>
                  <dl>
                    <dt>Stable ID</dt>
                    <dd>{p.id}</dd>
                    <dt>Permitted extension types</dt>
                    <dd>{p.extensionTypes.join(", ")}</dd>
                    <dt>Protected behavior and data</dt>
                    <dd>{p.protected.join(", ")}</dd>
                    <dt>Resource escalation</dt>
                    <dd>
                      {p.resourceEscalation
                        ? "May be proposed, subject to " +
                          p.resourcePolicy
                            .map((id) => {
                              const p = data.policies.find((p) => p.id === id);
                              return (
                                (p?.name || id) +
                                " (" +
                                (p?.level || "unavailable") +
                                ")"
                              );
                            })
                            .join(", ")
                        : "Not declared for this boundary"}
                    </dd>
                  </dl>
                  <Reference value={p.reference} />
                </article>
              ))}
            </div>
          </div>
          <div
            role="tabpanel"
            id="afp-view-permissions"
            aria-labelledby="afp-tab-permissions"
            hidden={view !== "permissions"}
          >
            <h3>Permissions</h3>
            <p>
              These developer rules are consulted by the manifest validator and
              SDK. The only allowed SDK permission is rendering.recipe.inspect.
              Authentication, tenant boundaries, provenance, audit, database,
              shell and filesystem access are unreachable. Saving an Allowed
              policy does not install code, grant credentials or provision a
              resource. Core locks are enforced on this policy API.
            </p>
            <div className="afp-registry">
              {data.policies.map((p) => (
                <article key={p.id}>
                  <div className="afp-row-head">
                    <div>
                      <h4>{p.name}</h4>
                      <p>{p.description}</p>
                    </div>
                    {p.locked ? (
                      <span className="afp-status afp-status-protected">
                        Protected · locked
                      </span>
                    ) : (
                      <label>
                        Policy level
                        <select
                          aria-label={p.name + " policy"}
                          value={p.level}
                          disabled={busy}
                          onChange={(e) => policy(p, e.target.value)}
                        >
                          {policyLevels.map((level) => (
                            <option key={level}>{level}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <Reference value={p.reference} />
                  <button
                    onClick={() => void showHistory("policy:" + p.id, p.name)}
                  >
                    Policy history
                  </button>
                </article>
              ))}
            </div>
          </div>
          <div
            role="tabpanel"
            id="afp-view-resources"
            aria-labelledby="afp-tab-resources"
            hidden={view !== "resources"}
          >
            <h3>Resources</h3>
            <p>
              Existing application resources and future AFP resources are
              separate. No paid resource is provisioned from this page.
            </p>
            {(
              ["Databases", "Compute", "Storage", "External services"] as const
            ).map((group) => (
              <section key={group}>
                <h4 className="afp-group-heading">{group}</h4>
                <div className="afp-registry afp-two-columns">
                  {data.resources
                    .filter((r) => r.category === group)
                    .map((r) => (
                      <article key={r.id}>
                        <div className="afp-row-head">
                          <h4>{r.name}</h4>
                          <Status value={r.status} />
                        </div>
                        <p className="eyebrow">{r.availability}</p>
                        <p>{r.description}</p>
                        <p>{r.isolation}</p>
                        <Reference value={r.reference} />
                      </article>
                    ))}
                </div>
              </section>
            ))}
          </div>
          <div
            role="tabpanel"
            id="afp-view-features"
            aria-labelledby="afp-tab-features"
            hidden={view !== "features"}
          >
            <h3>AFP Features</h3>
            <AfpManifestInspector />
            {!data.featureCount ? (
              <div className="afp-empty">
                <p className="eyebrow">
                  Ready to catalogue · runtime not connected
                </p>
                <h4>No AFP-created features yet</h4>
                <p>
                  Individual customizations will appear here once the
                  customization runtime and MCP are connected. Each feature can
                  declare its owner, scope, base version, extension points,
                  resources, cost, tests, security and rollback plan.
                </p>
                <p>
                  The registry can retain draft definitions now. Registration
                  does not create a renderer, launch compute, share a feature or
                  change another user's application.
                </p>
                <button onClick={() => select("extensions")}>
                  Explore extension points
                </button>
              </div>
            ) : (
              <>
                <p>
                  {data.featureCount} registered records. Showing up to 100 most
                  recently updated. Scope labels describe intended ownership,
                  not active sharing.
                </p>
                <div className="afp-registry">
                  {data.features.map((f) => (
                    <article key={f.id}>
                      <div className="afp-row-head">
                        <h4>{f.name}</h4>
                        <Status value={f.status} />
                      </div>
                      <dl>
                        <dt>Feature / version</dt>
                        <dd>
                          {f.id} · {f.version}
                        </dd>
                        <dt>Owner / scope</dt>
                        <dd>
                          {f.owner} · {f.scope}
                        </dd>
                        <dt>Creator</dt>
                        <dd>{f.creator}</dd>
                        <dt>Base application version</dt>
                        <dd>{f.baseVersion}</dd>
                        <dt>Extension points</dt>
                        <dd>
                          {f.extensionPoints
                            .map(
                              (id) =>
                                data.extensionPoints.find((p) => p.id === id)
                                  ?.name || id,
                            )
                            .join(", ")}
                        </dd>
                        <dt>Resources</dt>
                        <dd>
                          {f.resources
                            .map(
                              (id) =>
                                data.resources.find((r) => r.id === id)?.name ||
                                id,
                            )
                            .join(", ") || "None declared"}
                        </dd>
                        <dt>Compute / cost</dt>
                        <dd>
                          {f.compute.description || "Not specified"} · Monthly
                          estimate{" "}
                          {f.compute.estimatedMonthlyUsd === null
                            ? "unknown"
                            : "$" + f.compute.estimatedMonthlyUsd}{" "}
                          · Recorded cost{" "}
                          {f.compute.actualUsd === null
                            ? "unknown"
                            : "$" + f.compute.actualUsd}
                        </dd>
                        <dt>Tests</dt>
                        <dd>
                          {f.tests.status} ·{" "}
                          {f.tests.reference || "No result recorded"}
                        </dd>
                        <dt>Security</dt>
                        <dd>
                          {f.security.status} ·{" "}
                          {f.security.reference || "No result recorded"}
                        </dd>
                        <dt>Rollback</dt>
                        <dd>
                          {f.rollback.status} ·{" "}
                          {f.rollback.reference || "No implementation recorded"}
                        </dd>
                      </dl>
                      <button
                        onClick={() =>
                          void showHistory("feature:" + f.id, f.name)
                        }
                      >
                        Feature history
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
      <div
        role="tabpanel"
        id="afp-view-memory"
        aria-labelledby="afp-tab-memory"
        hidden={view !== "memory"}
      >
        <AfpMemoryDecisions />
      </div>
      {history && (
        <aside className="afp-history" aria-label="AFP registry history">
          <h3>{history.title} history</h3>
          {history.rows.length === 0 && <p>No edits recorded.</p>}
          {history.rows.map((r, i) => {
            const b = JSON.parse(r.body);
            return (
              <article key={i}>
                <p>
                  {new Date(r.created).toLocaleString()} · Revision {b.revision}
                </p>
                <p>{b.status || b.level || b.name}</p>
                <p>
                  {b.nextStep || b.evidence || b.lastVerified?.reference || ""}
                </p>
              </article>
            );
          })}
          <button onClick={() => setHistory(null)}>
            Close registry history
          </button>
        </aside>
      )}
    </section>
  );
}
