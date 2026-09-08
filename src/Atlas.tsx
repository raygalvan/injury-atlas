import React, { useEffect, useState, useRef } from "react";
import { Box, Maximize2, Minimize2, Menu } from "lucide-react";
import { api } from "./api";
import type { Case } from "./domain";
const PROTOCOL = 1;
export function Atlas({
  caseRecord,
  expanded,
  onToggleExpand,
  onOpenNav,
}: {
  caseRecord?: Case;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenNav?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false),
    [installed, setInstalled] = useState<boolean | null>(null),
    [selection, setSelection] = useState(""),
    [appliedCount, setAppliedCount] = useState(0),
    [timeout, setTimeoutState] = useState(false);
  useEffect(() => {
    api("/health")
      .then((d) => setInstalled(d.atlasReady))
      .catch(() => setInstalled(false));
  }, []);
  useEffect(() => {
    setReady(false);
    setSelection("");
    setAppliedCount(0);
    setTimeoutState(false);
    const timer = window.setTimeout(() => setTimeoutState(true), 45000);
    const post = (message: Record<string, unknown>) =>
      frame.current?.contentWindow?.postMessage(
        { version: PROTOCOL, ...message },
        window.location.origin,
      );
    let active = true,
      viewerReady = false,
      refreshing = false;
    async function refresh() {
      if (!active || !viewerReady || !caseRecord || refreshing) return;
      refreshing = true;
      try {
        const injuries = await api(`/cases/${caseRecord.id}/injuries`);
        if (!active) return;
        setAppliedCount(injuries.productionInjuries.length);
        post({
          type: "injurybot:atlas:init",
          case: {
            id: caseRecord.id,
            title: caseRecord.title,
            client: caseRecord.client,
            findings: [],
            activeReferenceGroups: [],
            appliedInjuries: injuries.applied,
            generatedInjuries: injuries.generated,
            productionInjuries: injuries.productionInjuries,
            catalogue: injuries.catalogue,
          },
        });
      } catch {
        /* Preserve the last confirmed case context on transient failure. */
      } finally {
        refreshing = false;
      }
    }
    async function refreshPresentation() {
      if (!active || !viewerReady) return;
      try {
        const prefs = await api("/afp/preferences/presentation");
        if (active)
          post({
            type: "injurybot:atlas:presentation",
            contract: "injury.bot.atlas.presentation/0.1",
            selectInjuriesColor: prefs.selectInjuriesColor ?? "default",
          });
      } catch {}
    }
    const refreshTimer = window.setInterval(() => {
      void refresh();
      void refreshPresentation();
    }, 5000);
    async function receive(e: MessageEvent) {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== window.location.origin ||
        e.data?.version !== PROTOCOL
      )
        return;
      const d = e.data;
      if (d.type === "human-atlas:ready") {
        setReady(true);
        viewerReady = true;
        await refreshPresentation();
        if (!caseRecord) return;
        await refresh();
      }
      if (d.caseId !== caseRecord?.id) return;
      if (d.type === "human-atlas:open-injury-workspace" && caseRecord)
        window.location.assign(`/injuries?case=${caseRecord.id}`);
      if (
        d.type === "human-atlas:production-visibility" &&
        caseRecord &&
        typeof d.id === "string" &&
        typeof d.hidden === "boolean"
      ) {
        api(
          `/cases/${caseRecord.id}/production/${encodeURIComponent(d.id)}/review`,
          { decision: d.hidden ? "hide" : "show" },
        ).catch(() =>
          setSelection(
            "Visibility could not be saved. Reload the atlas to restore saved state.",
          ),
        );
      }
      if (d.type === "human-atlas:production-clear" && caseRecord) {
        try {
          const state = await api(`/cases/${caseRecord.id}/injuries`);
          for (const p of state.productionInjuries)
            await api(
              `/cases/${caseRecord.id}/production/${encodeURIComponent(p.id)}/review`,
              { decision: "remove" },
            );
          await refresh();
        } catch {
          setSelection(
            "Clearing injuries could not be saved. Please reload and try again.",
          );
        }
      }
      if (d.type === "human-atlas:selection" && typeof d.label === "string")
        setSelection(d.label);
      if (
        d.type === "human-atlas:injuries-applied" &&
        Array.isArray(d.injuries)
      ) {
        setAppliedCount(d.injuries.length);
        api(`/cases/${caseRecord!.id}/injuries/apply`, {
          injuries: d.injuries,
        })
          .then(refresh)
          .catch((e) => setSelection(e.message));
      }
      if (
        d.type === "human-atlas:match-request" &&
        typeof d.description === "string"
      ) {
        try {
          const result = await api(`/cases/${caseRecord!.id}/injuries/match`, {
            description: d.description,
          });
          post({
            type: "injurybot:atlas:match-result",
            requestId: d.requestId,
            matches: result.matches,
            unmatched: result.unmatched,
          });
        } catch {
          /* The viewer falls back to its own matcher after a timeout. */
        }
      }
      if (
        d.type === "human-atlas:generate-request" &&
        typeof d.name === "string"
      ) {
        try {
          const queued = await api(
            `/cases/${caseRecord!.id}/injuries/generate`,
            {
              name: d.name,
              description: String(d.description ?? ""),
            },
          );
          post({
            type: "injurybot:atlas:generation",
            caseId: caseRecord!.id,
            injury: queued,
          });
          await refresh();
        } catch (error) {
          post({
            type: "injurybot:atlas:generation",
            caseId: caseRecord!.id,
            injury: {
              id: `request-${Date.now()}`,
              name: d.name,
              status: "failed",
              stage: (error as Error).message,
            },
          });
        }
      }
    }
    window.addEventListener("message", receive);
    return () => {
      active = false;
      clearInterval(refreshTimer);
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
    <section className={`viewer ${expanded ? "expanded" : ""}`}>
      <div className="viewer-toolbar">
        <span>
          <span className="live-dot" /> REFERENCE ANATOMY
        </span>
        <span className="viewer-status">
          {ready
            ? "Viewer connected"
            : installed
              ? "Loading anatomy"
              : "Engine setup"}
          <button
            className="viewer-expand"
            onClick={onToggleExpand}
            aria-label={expanded ? "Exit expanded view" : "Expand atlas"}
            title={expanded ? "Exit expanded view" : "Expand atlas"}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </span>
      </div>
      <div className="viewer-stage">
        {onOpenNav && (
          <button
            className="viewer-nav mobile"
            onClick={onOpenNav}
            aria-label="Open workspace"
          >
            <Menu size={20} />
          </button>
        )}
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
              The application needs its pinned anatomy build before the 3D
              viewer can open.
            </p>
          </div>
        )}
      </div>
      <div className="viewer-footer">
        {selection
          ? "Selected: " + selection
          : timeout && !ready && installed
            ? "Viewer has not connected. Check engine assets and reload."
            : "Rotate · Zoom · Isolate anatomical structures"}
        <span>
          {appliedCount
            ? `${appliedCount} ${appliedCount === 1 ? "injury" : "injuries"} applied · reviewed illustration`
            : "Reference anatomy · No case injuries rendered"}
        </span>
      </div>
    </section>
  );
}
