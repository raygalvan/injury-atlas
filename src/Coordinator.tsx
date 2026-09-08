import { useEffect, useState } from "react";
import { api } from "./api";
import type { Member } from "./domain";
import { AssistantConsole } from "./assistant/assistant-console";
export function Coordinator({
  member,
  caseId,
  onMinimize,
}: {
  member: Member;
  caseId?: string;
  onMinimize: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(new URLSearchParams(location.search).get("topic") === "afp" ? "/assistant?topic=afp" : "/assistant")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="coordinator-workspace">
      {!data ? (
        <div className="coordinator-loading">
          <button onClick={onMinimize}>Back to workspace</button>
          <p role="status">{error || "Opening your coordinator…"}</p>
        </div>
      ) : (
        <>
          <AssistantConsole
            firmName="injury.bot"
            viewer={member}
            configured={data.configured}
            voiceConfigured={data.voiceConfigured}
            greeting={data.greeting}
            initialMessages={data.messages}
            caseId={caseId}
            onMinimize={onMinimize}
          />
          {!data.configured && (
            <p className="coordinator-config">
              {data.enabled
                ? "Select a coordinator model and configure its provider key in"
                : "The coordinator is disabled. Enable it in"}{" "}
              {member.role === "owner" || member.platformAdmin ? (
                <a href="/settings#skills">Settings</a>
              ) : (
                "your administrator’s settings"
              )}
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
