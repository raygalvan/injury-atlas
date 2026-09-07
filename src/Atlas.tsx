import React, { useEffect, useState, useRef } from "react";
import { Box } from "lucide-react";
import { api } from "./api";
import type { Case } from "./domain";
export function Atlas({ caseRecord }: { caseRecord?: Case }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false),
    [installed, setInstalled] = useState<boolean | null>(null),
    [selection, setSelection] = useState(""),
    [timeout, setTimeoutState] = useState(false);
  useEffect(() => {
    api("/health")
      .then((d) => setInstalled(d.atlasReady))
      .catch(() => setInstalled(false));
  }, []);
  useEffect(() => {
    setReady(false);
    setSelection("");
    setTimeoutState(false);
    const timer = window.setTimeout(() => setTimeoutState(true), 45000);
    function receive(e: MessageEvent) {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== window.location.origin ||
        e.data?.version !== 1
      )
        return;
      if (e.data.type === "human-atlas:ready") {
        setReady(true);
        if (caseRecord)
          frame.current?.contentWindow?.postMessage(
            {
              type: "injurybot:atlas:init",
              version: 1,
              case: {
                id: caseRecord.id,
                title: caseRecord.title,
                client: caseRecord.client,
                findings: [],
                activeReferenceGroups: [],
              },
            },
            window.location.origin,
          );
      }
      if (
        e.data.type === "human-atlas:selection" &&
        e.data.caseId === caseRecord?.id &&
        typeof e.data.label === "string"
      )
        setSelection(e.data.label);
    }
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [caseRecord?.id, installed]);
  const q = new URLSearchParams({
    embed: "injurybot",
    parentOrigin: window.location.origin,
    ...(caseRecord
      ? {
          caseId: caseRecord.id,
          caseTitle: caseRecord.title,
          caseClient: caseRecord.client,
        }
      : {}),
  });
  return (
    <section className="viewer">
      <div className="viewer-toolbar">
        <span>
          <span className="live-dot" /> REFERENCE ANATOMY
        </span>
        <span>
          {ready
            ? "Viewer connected"
            : installed
              ? "Loading anatomy"
              : "Engine setup"}
        </span>
      </div>
      {installed ? (
        <iframe
          key={caseRecord?.id || "reference"}
          ref={frame}
          title="Human Atlas anatomical viewer"
          src={"/atlas-engine/index.html?" + q}
          allow="fullscreen"
        />
      ) : (
        <div className="viewer-empty">
          <Box size={48} />
          <h2>
            {installed === null
              ? "Checking anatomy engine…"
              : "Human Atlas is not installed yet"}
          </h2>
          <p>
            The application needs its pinned anatomy build before the 3D viewer
            can open.
          </p>
        </div>
      )}
      <div className="viewer-footer">
        {selection
          ? "Selected: " + selection
          : timeout && !ready && installed
            ? "Viewer has not connected. Check engine assets and reload."
            : "Rotate · Zoom · Isolate anatomical structures"}
        <span>Reference anatomy · No case injuries rendered</span>
      </div>
    </section>
  );
}
