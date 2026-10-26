import { useEffect, useState } from "react";
import { api } from "./api";
import { permissionLevels, presets } from "../shared/afp-lab";
import { AfpPrivatePreference } from "./AfpPrivatePreference";
import { AfpUiEditor } from './AfpUiEditor';
export function AfpLabPermissions() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any[] | null>(null);
  const load = () => api("/afp/lab").then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const update = async (patch: unknown) => {
    setBusy(true);
    setError("");
    try {
      await api("/afp/lab", { ...(patch as any), revision: data.revision });
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return <p role="status">{error || "Loading private AFP permissions…"}</p>;
  return (
    <div className="afp-lab-permissions">
      <div className={`afp-lab-banner ${data.enabled ? "on" : ""}`}>
        <div>
          <h4>AFP Lab Mode · {data.enabled ? "ON" : "OFF"}</h4>
          <p>
            Allow my Coordinator to make ordinary AFP test customizations
            without separate approval.
          </p>
          <p>Private to your account. Protected core controls stay locked.</p>
        </div>
        <label className="afp-lab-toggle">
          <input
            type="checkbox"
            role="switch"
            aria-label="AFP Lab Mode"
            checked={data.enabled}
            disabled={busy || !data.manageable}
            onChange={(e) =>
              void update({ action: "toggle", enabled: e.target.checked })
            }
          />
          {data.enabled ? "On" : "Off"}
        </label>
      </div>
      {!data.manageable && (
        <p>
          Only an owner or super admin can change these private permissions.
        </p>
      )}
      <label>
        Permission preset
        <select
          aria-label="AFP permission preset"
          value={data.preset}
          disabled={busy || !data.manageable}
          onChange={(e) =>
            void update({ action: "preset", preset: e.target.value })
          }
        >
          {presets.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <p>
        Safe requires review. Standard allows private UI presentation edits. Lab
        allows broad reversible private testing. Turning Lab off restores your
        previous normal preset and its individual settings.
      </p>
      <p>
        All private UI presentation edits is the single permission for padding,
        spacing, sizing, typography, colors, visibility and layout across discovered
        host surfaces. No per-button approval is required. Legacy Coordinator label
        and embedded Atlas color controls retain their existing permissions.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="afp-lab-categories">
        {data.categories.filter((c:any)=>!['typography','spacing','visibility','layout'].includes(c.id)).map((c: any) => (
          <article key={c.id}>
            <div>
              <h5>{c.name}</h5>
              <small>
                {c.locked
                  ? "Protected core"
                  : c.implemented
                    ? "Installed bounded capability"
                    : "Not Implemented"}
              </small>
            </div>
            {c.hostRestriction && <small>Blocked by shared application policy</small>}
            {c.locked ? (
              <span className="afp-status">Protected · Blocked</span>
            ) : (
              <select
                aria-label={`${c.name} permission`}
                value={c.level}
                disabled={busy || !data.manageable}
                onChange={(e) =>
                  void update({
                    action: "category",
                    category: c.id,
                    level: e.target.value,
                  })
                }
              >
                {permissionLevels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            )}
          </article>
        ))}
      </div>
      <button
        onClick={() => {
          if (history) setHistory(null);
          else
            void api("/afp/lab/history")
              .then(setHistory)
              .catch((e) => setError(e.message));
        }}
      >
        {history ? "Hide permission history" : "View permission history"}
      </button>
      {history && (
        <ol>
          {history.map((h) => (
            <li key={h.timestamp}>
              {new Date(h.timestamp).toLocaleString()} · {h.result} · Lab{" "}
              {h.newState.enabled ? "on" : "off"} · {h.newState.normalPreset}
              {h.reason ? ` · ${h.reason}` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
export function AfpPrivateManagement() {
  const [view, setView] = useState("permissions");
  return (
    <section id="afp" className="settings-card">
      <h2>AFP Management</h2>
      <nav className="afp-tabs" aria-label="AFP private management">
        <button onClick={() => setView("permissions")}>Permissions</button>
        <button onClick={() => setView("features")}>AFP Features</button>
      </nav>
      {view === "permissions" ? (
        <AfpLabPermissions />
      ) : (
        <>
          <AfpPrivatePreference />
          <AfpUiEditor />
          <AfpPrivatePreference kind="atlas" />
        </>
      )}
    </section>
  );
}
