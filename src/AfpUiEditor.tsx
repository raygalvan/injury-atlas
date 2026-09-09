import { useEffect, useState } from "react";
export function AfpUiEditor() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [history, setHistory] = useState<any[]>([]);
  const load = async () => {
    const r = await fetch("/api/afp/ui", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  };
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("afp-ui-updated", refresh);
    return () => window.removeEventListener("afp-ui-updated", refresh);
  }, []);
  async function change(edit: any, action: string) {
    setError("");
    try {
      const r = await fetch("/api/afp/ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          targetId: edit.targetId,
          revision: edit.revision,
        }),
      });
      if (!r.ok) throw Error((await r.json()).reason);
      window.dispatchEvent(new Event("afp-ui-refresh"));
      await load();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="afp-card" data-afp-protected="true">
      <h3>My private UI edits</h3>
      <p>
        Ask the text or voice Coordinator to change a control or layout. One
        standing UI-editing permission covers presentation across discovered
        host surfaces. Changes affect only your account.
      </p>
      <p>
        The Atlas viewer uses its separate presentation bridge. New behavior or
        executable components are not presentation edits.
      </p>
      <p>Owner {data?.owner || 'current account'} · Private · application-presentation</p>
      {error && <p role="alert">{error}</p>}
      {!data?.edits?.length && <p>No private UI overrides yet.</p>}
      {data?.edits?.map((e: any) => (
        <article key={e.targetId}>
          <h4>{e.targetId}</h4>
          <p>
            Private · {e.body.enabled ? "Enabled" : "Disabled"} ·{" "}
            {e.compatibility} · Revision {e.revision}
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(e.body.variants, null, 2)}
          </pre>
          <div className="afp-actions">
            <button onClick={() => void change(e, "undo")}>
              Undo last change
            </button>
            <button onClick={() => void change(e, "disable")}>Disable</button>
            <button onClick={() => void change(e, "remove")}>Remove</button>
          </div>
        </article>
      ))}
      <button
        onClick={() =>
          void fetch("/api/afp/ui/history")
            .then((r) => r.json())
            .then(setHistory)
        }
      >
        View my UI edit history
      </button>
      {history.length > 0 && (
        <details open>
          <summary>Private history</summary>
          {history.map((e) => (
            <p key={e.id}>
              {new Date(e.timestamp).toLocaleString()} · {e.action} · {e.result}{" "}
              · {e.source}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
