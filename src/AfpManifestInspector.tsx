import { useEffect, useState } from "react";
import { api } from "./api";
import type { ManifestRecord } from "../shared/afp-manifest";
export function AfpManifestInspector() {
  const [text, setText] = useState(""),
    [records, setRecords] = useState<ManifestRecord[]>([]),
    [selected, setSelected] = useState<ManifestRecord | null>(null),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any[]>([]);
  const load = async () => {
    setRecords(await api("/afp/manifests"));
    setHistory(await api("/afp/audit"));
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="afp-manifest-inspector">
      <h4>Experimental manifest inspector · v0.1</h4>
      <p>
        Inspect and retain a Private or Firm definition. Validation does not
        activate a feature. Only read-only rendering recipe inspection is
        available through the SDK. No case evidence belongs in a manifest.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const c = await api("/afp/contract");
            setText(JSON.stringify(c.template, null, 2));
            setSelected(null);
            setResult(null);
          })
        }
      >
        New manifest draft
      </button>
      {error && <p role="alert">{error}</p>}
      {!!text && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () =>
              setResult(await api("/afp/manifests/evaluate", JSON.parse(text))),
            );
          }}
        >
          <label>
            Manifest JSON
            <textarea
              aria-label="Manifest JSON"
              rows={14}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setResult(null);
              }}
              spellCheck={false}
            />
          </label>
          <div className="afp-actions">
            <button disabled={busy}>Validate manifest</button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const saved = await api("/afp/manifests", {
                    id: selected?.id,
                    revision: selected?.revision ?? 0,
                    manifest: JSON.parse(text),
                  });
                  setSelected(saved);
                  setResult({
                    result: "Compatible",
                    reasons: [],
                    auditId: "Saved revision " + saved.revision,
                  });
                })
              }
            >
              Save manifest draft
            </button>
          </div>
        </form>
      )}
      {result && (
        <div role="status">
          <strong>{result.result}</strong>
          <p>
            {result.reasons.join(", ") ||
              "The declared contract is permitted. Execution remains unavailable."}
          </p>
          <p className="afp-reference">{result.auditId}</p>
        </div>
      )}
      {records.length > 0 && (
        <div className="afp-registry">
          {records.map((r) => (
            <article key={r.id}>
              <h4>{r.manifest.extensionId}</h4>
              <p>
                {r.manifest.ownership.scope} · definition{" "}
                {r.manifest.definitionVersion} · revision {r.revision}
              </p>
              <p className="afp-reference">
                Base {r.manifest.application.version}
              </p>
              <button
                onClick={() => {
                  setSelected(r);
                  setText(JSON.stringify(r.manifest, null, 2));
                  setResult(null);
                }}
              >
                Inspect manifest
              </button>
            </article>
          ))}
        </div>
      )}
      <details>
        <summary>Your SDK evaluation history</summary>
        {!history.length && <p>No evaluations yet.</p>}
        {history.map((h) => (
          <article key={h.id}>
            <p>
              {h.body.action} · {h.body.result} ·{" "}
              {new Date(h.created).toLocaleString()}
            </p>
            <p>{h.body.reasons.join(", ") || "Permitted"}</p>
            <p className="afp-reference">{h.id}</p>
          </article>
        ))}
      </details>
    </div>
  );
}
