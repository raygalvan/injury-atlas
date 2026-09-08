"use client";

import { DEFAULT_TEXT_LABEL } from "../../shared/afp-manifest";
import type { AssistantCard } from "../../shared/ai";
import { useCallback, useEffect, useRef, useState } from "react";

import { AssistantCardView } from "./cards";
import {
  startRealtimeSession,
  type RealtimeSession,
  type RealtimeState,
} from "./realtime-voice";
import { VoiceOrb, type OrbState } from "./voice-orb";

export interface ConsoleMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  modality: "text" | "voice";
  content: string;
  card?: AssistantCard | null;
}

interface Props {
  firmName: string;
  viewer: { name: string; role: string };
  configured: boolean;
  initialMessages: ConsoleMessage[];
  voiceConfigured: boolean;
  greeting: string;
  caseId?: string;
  onMinimize: () => void;
}

type ConsoleMode = "voice" | "text";
let localCounter = 0;
const localId = () => `local-${Date.now()}-${localCounter++}`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export function AssistantConsole({
  firmName,
  viewer,
  configured,
  initialMessages,
  voiceConfigured,
  greeting,
  caseId,
  onMinimize,
}: Props) {
  const [textTabLabel, setTextTabLabel] = useState(DEFAULT_TEXT_LABEL);
  const refreshPresentation = useCallback(async () => {
    try {
      const res = await fetch("/api/afp/preferences/presentation", {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setTextTabLabel(data.textTabLabel);
    } catch {
      /* Preserve the last host-confirmed presentation during network interruption. */
    }
  }, []);
  useEffect(() => {
    void refreshPresentation();
  }, [refreshPresentation]);
  const [mode, setMode] = useState<ConsoleMode>(
    voiceConfigured ? "voice" : "text",
  );
  const [messages, setMessages] = useState<ConsoleMessage[]>([
    ...initialMessages,
    { id: "greeting", role: "assistant", modality: "text", content: greeting },
  ]);
  const topic =
    new URLSearchParams(location.search).get("topic") === "afp"
      ? "afp"
      : undefined;
  const [draft, setDraft] = useState(
    topic
      ? "What should we improve next to make injury.bot more AFP friendly?"
      : "",
  );
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<OrbState>("idle");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [currentLine, setCurrentLine] = useState<string>("");
  const [interrupt, setInterrupt] = useState(false);
  const [streams, setStreams] = useState<{
    local: MediaStream | null;
    remote: MediaStream | null;
  }>({ local: null, remote: null });
  const sessionRef = useRef<RealtimeSession | null>(null);
  const voiceAttemptRef = useRef(0);
  const voiceSessionId = useRef("");
  const voiceAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const interruptRef = useRef(false);
  const threadRef = useRef<HTMLOListElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const append = useCallback(
    (message: ConsoleMessage) =>
      setMessages((current) => [...current, message]),
    [],
  );

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, currentLine]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      voiceAttemptRef.current++;
      voiceAbort.current?.abort();
      sessionRef.current?.stop();
    };
  }, []);

  const persistTranscript = useCallback(
    (role: "user" | "assistant", text: string) => {
      void postJson("/api/assistant/transcripts", {
        role,
        text,
        sessionId: voiceSessionId.current,
      }).catch(() => undefined);
    },
    [],
  );

  const stopVoice = useCallback(() => {
    voiceAttemptRef.current += 1;
    voiceAbort.current?.abort();
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStreams({ local: null, remote: null });
    setCurrentLine("");
    setVoiceNote(null);
    setVoiceState("idle");
  }, []);

  const selectMode = useCallback(
    (nextMode: ConsoleMode) => {
      if (nextMode === "text") stopVoice();
      setMode(nextMode);
      if (nextMode === "text")
        window.setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [stopVoice],
  );

  const startVoice = useCallback(async () => {
    if (!voiceConfigured) {
      setVoiceNote(
        "Enable voice and add an OpenAI key in Settings → Credentials.",
      );
      return;
    }
    setVoiceNote(null);
    const attempt = ++voiceAttemptRef.current;
    voiceAbort.current?.abort();
    const controller = new AbortController();
    voiceAbort.current = controller;
    try {
      const session = await startRealtimeSession(
        {
          onSession: (id) => {
            voiceSessionId.current = id;
          },
          onStateChange: (state: RealtimeState, detail) => {
            if (!mounted.current || attempt !== voiceAttemptRef.current) return;
            setVoiceState(state);
            if (state === "error" && detail) setVoiceNote(detail);
            if (state === "closed") {
              setVoiceState("idle");
              setStreams({ local: null, remote: null });
            }
          },
          onStreams: (local, remote) => setStreams({ local, remote }),
          onNotice: (notice) => setVoiceNote(notice),
          onPartialTranscript: (_role, text) => setCurrentLine(text),
          onUserTranscript: (text) => {
            append({
              id: localId(),
              role: "user",
              modality: "voice",
              content: text,
            });
            persistTranscript("user", text);
          },
          onAssistantTranscript: (text) => {
            append({
              id: localId(),
              role: "assistant",
              modality: "voice",
              content: text,
            });
            persistTranscript("assistant", text);
          },
          onToolCall: async (name, args, callId) => {
            const result = await postJson<{
              output: string;
              card?: AssistantCard | null;
            }>(`/api/assistant/tools/${encodeURIComponent(name)}`, {
              args,
              callId,
              sessionId: voiceSessionId.current,
            });
            if (["set_private_afp_ui_preference","set_private_afp_presentation"].includes(name))
              await refreshPresentation();
            if (result.card)
              append({
                id: localId(),
                role: "tool",
                modality: "voice",
                content: result.output,
                card: result.card,
              });
            return result.output;
          },
        },
        {
          greetOnStart: true,
          interruptEnabled: interruptRef.current,
          caseId,
          topic,
          signal: controller.signal,
        },
      );
      if (attempt !== voiceAttemptRef.current) {
        session.stop();
        return;
      }
      sessionRef.current = session;
      session.setInterrupt(interruptRef.current);
    } catch (error) {
      if (attempt !== voiceAttemptRef.current) return;
      setVoiceState("idle");
      setVoiceNote(
        error instanceof Error ? error.message : "Live voice could not start.",
      );
    }
  }, [append, voiceConfigured, persistTranscript, caseId, topic]);

  useEffect(() => {
    if (voiceConfigured) void startVoice();
  }, []);

  const toggleVoice = useCallback(() => {
    if (
      sessionRef.current ||
      voiceState === "live" ||
      voiceState === "connecting"
    )
      stopVoice();
    else if (voiceState === "idle" || voiceState === "error") void startVoice();
  }, [startVoice, stopVoice, voiceState]);

  const toggleInterrupt = useCallback(() => {
    setInterrupt((current) => {
      const next = !current;
      interruptRef.current = next;
      sessionRef.current?.setInterrupt(next);
      return next;
    });
  }, []);

  const sendText = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    append({ id: localId(), role: "user", modality: "text", content: text });
    try {
      const result = await postJson<{
        assistant: { id: string; content: string };
        tools: { id: string; content: string; card: AssistantCard | null }[];
      }>("/api/assistant/messages", { text, caseId, topic });
      await refreshPresentation();
      for (const tool of result.tools) {
        if (tool.card)
          append({
            id: tool.id,
            role: "tool",
            modality: "text",
            content: tool.content,
            card: tool.card,
          });
      }
      append({
        id: result.assistant.id,
        role: "assistant",
        modality: "text",
        content: result.assistant.content,
      });
    } catch (error) {
      append({
        id: localId(),
        role: "assistant",
        modality: "text",
        content:
          error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [append, draft, sending, caseId]);

  const live = voiceState === "live";
  const connecting = voiceState === "connecting";
  const orbLabel = live
    ? "End the live conversation"
    : connecting
      ? "Connecting"
      : "Start a live conversation";
  const status = connecting
    ? "Connecting…"
    : live
      ? currentLine || "Listening. Tap the orb to end."
      : voiceConfigured
        ? "Tap the orb to talk."
        : "Enable voice in Settings → Credentials.";

  return (
    <div className={`as-shell is-${mode}-mode`}>
      <header className="as-head">
        <button
          type="button"
          className="as-minimize as-back"
          onClick={() => {
            stopVoice();
            onMinimize();
          }}
          aria-label="Minimize coordinator"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M5 12h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span className="as-firm">{firmName}</span>
        <span className="as-viewer">{viewer.name}</span>
      </header>

      <div
        className="as-mode-toggle"
        role="group"
        aria-label="Coordinator mode"
      >
        <button
          type="button"
          className={mode === "text" ? "is-active" : ""}
          onClick={() => selectMode("text")}
          aria-pressed={mode === "text"}
        >
          {textTabLabel}
        </button>
        <button
          type="button"
          className={mode === "voice" ? "is-active" : ""}
          onClick={() => selectMode("voice")}
          aria-pressed={mode === "voice"}
        >
          Voice
        </button>
      </div>

      {mode === "voice" && (
        <section
          className={`as-stage${live ? " is-live" : ""}`}
          aria-live="polite"
        >
          <VoiceOrb
            state={voiceState}
            localStream={streams.local}
            remoteStream={streams.remote}
            onTap={toggleVoice}
            label={orbLabel}
          />
          <p
            className={`as-status${live && currentLine ? " is-speaking" : ""}`}
          >
            {status}
          </p>
          <div className="as-stage-tools">
            {live && (
              <button
                type="button"
                className={`as-chip${interrupt ? " is-on" : ""}`}
                onClick={toggleInterrupt}
                role="switch"
                aria-checked={interrupt}
              >
                Interrupt {interrupt ? "on" : "off"}
              </button>
            )}
            {live && (
              <span className="as-chip as-chip-live">
                <span className="as-live-dot" aria-hidden="true" /> Live
              </span>
            )}
          </div>
          {voiceNote && <p className="as-note">{voiceNote}</p>}
        </section>
      )}

      <ol className="as-thread" ref={threadRef}>
        {messages.length === 0 && <li className="as-empty">{greeting}</li>}
        {messages.map((message) =>
          message.role === "tool" ? (
            <li key={message.id} className="as-msg as-msg-tool">
              {message.card ? (
                <AssistantCardView card={message.card} />
              ) : (
                <p>{message.content}</p>
              )}
            </li>
          ) : (
            <li key={message.id} className={`as-msg as-msg-${message.role}`}>
              <p className="as-msg-text">{message.content}</p>
              <span className="as-msg-meta">
                {message.role === "user"
                  ? viewer.name.split(" ")[0]
                  : "Coordinator"}
                {message.modality === "voice" ? " · voice" : ""}
              </span>
            </li>
          ),
        )}
      </ol>

      {mode === "text" && (
        <form
          className="as-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendText();
          }}
        >
          <button
            type="button"
            className="as-mic"
            onClick={() => selectMode("voice")}
            aria-label="Switch to voice"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Z"
                fill="currentColor"
              />
              <path
                d="M5 11a7 7 0 0 0 14 0M12 18v3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            className="as-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendText();
              }
            }}
            rows={1}
            enterKeyHint="send"
            placeholder={
              configured ? "Message the coordinator" : "Chat is not configured"
            }
            disabled={!configured || sending}
            aria-label="Message"
          />
          <button
            type="submit"
            className="as-send"
            disabled={!configured || sending || !draft.trim()}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M4 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        </form>
      )}
    </div>
  );
}
