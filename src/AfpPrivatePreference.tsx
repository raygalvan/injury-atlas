import { useEffect, useState } from "react";
import { api } from "./api";
export function AfpPrivatePreference({
  kind = "coordinator",
}: {
  kind?: "coordinator" | "atlas";
}) {
  const atlas = kind === "atlas";
  const [data, setData] = useState<any>(null),
    [history, setHistory] = useState<any[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/afp/preferences/presentation")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const change = async (action: "disable" | "remove") => {
    setBusy(true);
    setError("");
    try {
      await api(
        atlas ? "/afp/preferences/atlas" : "/afp/preferences/presentation",
        { action },
      );
      await load();
      if (history)
        setHistory(await api("/afp/preferences/presentation/history"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const f = atlas
    ? data?.features?.find(
        (f: any) => f.extensionPoint === "atlas-presentation",
      )
    : data?.feature;
  return (
    <article className={atlas ? "afp-private-color" : "afp-private-preference"}>
      <h4>
        {atlas ? "My Select Injuries color" : "My Coordinator presentation"}
      </h4>
      <p>
        A private declarative AFP configuration. Ask the text or voice
        Coordinator:{" "}
        {atlas
          ? "“Make the Select Injuries button blue for me.”"
          : "“Change Text Chat to Text for me.”"}
      </p>
      {error && <p role="alert">{error}</p>}
      {data && !f && (
        <p>
          No private preference registered. Current value is{" "}
          {atlas ? data.selectInjuriesColor : data.textTabLabel}.
        </p>
      )}
      {f && (
        <>
          <dl>
            <dt>Feature / version</dt>
            <dd>
              {f.id} · {f.manifest?.definitionVersion} · revision {f.revision}
            </dd>
            <dt>Owner / scope</dt>
            <dd>
              {f.owner} (you) · {f.scope}
            </dd>
            <dt>Status / compatibility</dt>
            <dd>
              {f.status} · {f.compatibility}
            </dd>
            <dt>Extension point</dt>
            <dd>{f.extensionPoint}</dd>
            <dt>Application version</dt>
            <dd>{f.manifest?.application.version}</dd>
            <dt>Requested permission</dt>
            <dd>{f.manifest?.requestedPermissions.join(", ")}</dd>
            <dt>Current / effective value</dt>
            <dd>
              {f.currentValue ?? "Default"} / {f.effectiveValue}
            </dd>
          </dl>
          {f.compatibility !== "Compatible" && f.status === "enabled" && (
            <p>
              The default is in use. Ask the Coordinator to set your preference
              again to validate it against the current contract and policy.
            </p>
          )}
          <div className="actions">
            <button
              disabled={busy || f.status !== "enabled"}
              onClick={() => void change("disable")}
            >
              Disable private preference
            </button>
            <button
              disabled={busy || f.status === "removed"}
              onClick={() => void change("remove")}
            >
              Remove private preference
            </button>
          </div>
          <p>
            Disable or remove restores the default. Removal clears the value;
            required audit history remains.
          </p>
          <button
            onClick={() => {
              if (history) setHistory(null);
              else
                void api("/afp/preferences/presentation/history")
                  .then(setHistory)
                  .catch((e) => setError(e.message));
            }}
          >
            {history ? "Hide preference history" : "View preference history"}
          </button>
          {history && (
            <ol>
              {history.map((h) => (
                <li key={h.id}>
                  {new Date(h.timestamp).toLocaleString()} · {h.source} ·{" "}
                  {h.result}: {h.oldValue ?? "Default"} →{" "}
                  {h.newValue ?? "Default"}
                  {h.reason ? ` (${h.reason})` : ""}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </article>
  );
}
