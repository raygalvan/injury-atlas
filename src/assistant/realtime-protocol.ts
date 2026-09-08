/**
 * The data-channel half of a live voice session, with no browser APIs.
 *
 * Everything that decides *what* to send to OpenAI and *when* lives here so it
 * can be unit tested: the opening greeting and its retries, the microphone
 * gate, talk-over notices, tool calls, transcripts, and error mapping. The
 * browser glue in realtime-voice.ts owns WebRTC, the microphone, and playback.
 *
 * Greeting design. The session instructions carry the standing directive
 * ("when a note says the person just joined, greet them"). On open we send our
 * turn-detection settings, wait for the server's `session.updated` ack (or a
 * short timeout), add a system note that the person just joined, and request a
 * bare `response.create`. A bare request keeps the orchestrator's persona and
 * voice rules; a per-response `instructions` field would replace them for that
 * response. If no `response.created` follows, the request is repeated once; if
 * the greeting response fails, it is retried once; after that a notice says so
 * instead of leaving the orb silently "listening".
 */

export const TALK_OVER_NOTICE =
  "Wait until I finish talking if you're talking over me. Or minimize the background noise if you're not.";
export const GREETING_NOTE =
  "The person just opened a live voice session and has not said anything yet. Deliver the exact personalized opening greeting in your session instructions. Do not call a tool before greeting.";
export const NO_GREETING_NOTICE =
  "The orchestrator did not start talking. Say hello, or tap the orb to restart.";

const MAX_GREETING_SENDS = 2;

export interface RealtimeServerEvent {
  type?: string;
  event_id?: string;
  delta?: string;
  transcript?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  response?: {
    id?: string;
    status?: string;
    output?: Array<{ type?: string; status?: string; name?: string; call_id?: string; arguments?: string }>;
    status_details?: {
      type?: string;
      reason?: string;
      error?: { type?: string; code?: string; message?: string };
    };
  };
  error?: {
    type?: string;
    code?: string | null;
    message?: string;
    event_id?: string | null;
  };
}

export interface ProtocolHandlers {
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  /** Streaming words; an empty string means the in-progress line finished. */
  onPartialTranscript?: (role: "user" | "assistant", text: string) => void;
  onToolCall: (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) => Promise<string>;
  onNotice?: (text: string) => void;
}

export interface ProtocolIO {
  send: (event: Record<string, unknown>) => void;
  /** Open or mute the microphone track that is sent to the model. */
  setMicOpen: (open: boolean) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  log?: (direction: "in" | "out" | "note", detail: unknown) => void;
}

export interface ProtocolOptions {
  greetOnStart?: boolean;
  interruptEnabled?: boolean;
  /** How long to wait for `session.updated` before greeting anyway. */
  sessionAckTimeoutMs?: number;
  /** How long to wait for `response.created` before repeating the greeting request. */
  greetingTimeoutMs?: number;
  /** Minimum gap between two talk-over notices. */
  noticeCooldownMs?: number;
}

export interface ProtocolSnapshot {
  interruptEnabled: boolean;
  agentSpeaking: boolean;
  responseActive: boolean;
  greetingSends: number;
  greetingDone: boolean;
}

export interface RealtimeProtocol {
  onOpen: () => void;
  onServerEvent: (event: RealtimeServerEvent) => void;
  setInterrupt: (enabled: boolean) => void;
  /** Inject a note the model should acknowledge aloud. */
  notify: (text: string) => void;
  /** The local level detector heard sustained sound. Returns true when a notice was shown. */
  localSpeechDetected: () => boolean;
  dispose: () => void;
  snapshot: () => ProtocolSnapshot;
}

export function createRealtimeProtocol(
  handlers: ProtocolHandlers,
  io: ProtocolIO,
  options: ProtocolOptions = {},
): RealtimeProtocol {
  const greetOnStart = options.greetOnStart ?? false;
  const sessionAckTimeoutMs = options.sessionAckTimeoutMs ?? 1_200;
  const greetingTimeoutMs = options.greetingTimeoutMs ?? 3_000;
  const noticeCooldownMs = options.noticeCooldownMs ?? 3_500;

  let interruptEnabled = Boolean(options.interruptEnabled);
  let sentInterrupt: boolean | null = null;
  let opened = false;
  let disposed = false;
  let agentSpeaking = false;
  let responseActive = false;
  let greetingSends = 0;
  let greetingDone = false;
  let greetingResponseId: string | null = null;
  let ackTimer: unknown = null;
  let greetingTimer: unknown = null;
  let lastNoticeAt = Number.NEGATIVE_INFINITY;
  /** After a repeated greeting request, a late first response makes the repeat collide; that collision is ours, not a talk-over. */
  let expectOwnConflictUntil = Number.NEGATIVE_INFINITY;
  let partialAssistant = "";
  const handledCalls = new Set<string>();
  let pendingTools = 0;
  let toolResponsePending = false;

  const note = (text: string) => io.log?.("note", text);
  const send = (event: Record<string, unknown>) => {
    if (disposed) return;
    io.log?.("out", event);
    io.send(event);
  };
  const clearTimer = (id: unknown) => {
    if (id !== null && id !== undefined) io.clearTimer(id);
  };
  const applyMicGate = () => io.setMicOpen(interruptEnabled || !agentSpeaking);

  const showTalkOverNotice = (): boolean => {
    const now = io.now();
    if (now - lastNoticeAt < noticeCooldownMs) return false;
    lastNoticeAt = now;
    handlers.onNotice?.(TALK_OVER_NOTICE);
    return true;
  };

  const sendTurnDetection = () => {
    sentInterrupt = interruptEnabled;
    send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.6,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
              create_response: true,
              interrupt_response: interruptEnabled,
            },
          },
        },
      },
    });
  };

  const sendGreeting = (why: string) => {
    if (disposed || !greetOnStart || greetingDone) return;
    if (responseActive) {
      greetingDone = true;
      note(`greeting skipped (${why}): a response is already active`);
      return;
    }
    if (greetingSends >= MAX_GREETING_SENDS) {
      greetingDone = true;
      note(`greeting gave up (${why})`);
      handlers.onNotice?.(NO_GREETING_NOTICE);
      return;
    }
    greetingSends += 1;
    if (greetingSends > 1)
      expectOwnConflictUntil = io.now() + greetingTimeoutMs;
    note(`greeting request ${greetingSends}: ${why}`);
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: GREETING_NOTE }],
      },
    });
    send({ type: "response.create" });
    clearTimer(greetingTimer);
    greetingTimer = io.setTimer(() => {
      greetingTimer = null;
      if (!greetingDone)
        sendGreeting("no response.created after the previous request");
    }, greetingTimeoutMs);
  };

  const onOpen = () => {
    if (opened || disposed) return;
    opened = true;
    applyMicGate();
    sendTurnDetection();
    if (greetOnStart) {
      ackTimer = io.setTimer(() => {
        ackTimer = null;
        sendGreeting("no session.updated within the wait");
      }, sessionAckTimeoutMs);
    }
  };

  const continueAfterTools = () => {
    if (disposed || responseActive || pendingTools || !toolResponsePending) return;
    toolResponsePending = false;
    // Reserve the response immediately: multiple results must not race the ack.
    responseActive = true;
    send({ type: "response.create" });
  };

  const runCompletedTools = (output: NonNullable<RealtimeServerEvent["response"]>["output"]) => {
    for (const item of output ?? []) {
      if (item.type !== "function_call" || item.status !== "completed") continue;
      const callId = item.call_id;
      if (!callId || handledCalls.has(callId)) continue;
      handledCalls.add(callId);
      pendingTools++;
      handlers.onNotice?.("Carrying out your request…");
      void Promise.resolve().then(async () => {
        if (!item.name) throw new Error("The coordinator omitted the action name. Please repeat your request.");
        let args: unknown;
        try { args = JSON.parse(item.arguments || "{}"); }
        catch { throw new Error("The coordinator sent an incomplete action. Please repeat your request."); }
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new Error("The coordinator sent invalid action details. Please repeat your request.");
        const result = await handlers.onToolCall(item.name, args as Record<string, unknown>, callId);
        if (!result) throw new Error("No action receipt was returned. Check the injury workspace before retrying.");
        handlers.onNotice?.("Request processed. See the result below.");
        return result;
      }).catch((error: unknown) => {
        const message = String((error as Error)?.message ?? error).slice(0, 300);
        handlers.onNotice?.(`Action could not be confirmed: ${message}`);
        return JSON.stringify({ ok: false, error: message, instruction: "Explain this failure. Do not claim that work was created or completed." });
      }).then((result) => {
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: result } });
        pendingTools--;
        toolResponsePending = true;
        continueAfterTools();
      });
    }
  };

  const onServerEvent = (event: RealtimeServerEvent) => {
    if (disposed) return;
    switch (event.type) {
      case "session.updated":
        if (ackTimer !== null) {
          clearTimer(ackTimer);
          ackTimer = null;
          sendGreeting("session.updated");
        }
        break;
      case "response.created":
        responseActive = true;
        if (greetOnStart && !greetingDone) {
          greetingDone = true;
          greetingResponseId = event.response?.id ?? null;
          clearTimer(greetingTimer);
          greetingTimer = null;
          clearTimer(ackTimer);
          ackTimer = null;
        }
        break;
      case "response.done": {
        responseActive = false;
        const response = event.response;
        const status = response?.status;
        // response.done carries complete named calls. Argument-done events also
        // occur for cancelled/incomplete responses and must not trigger writes.
        if (status === "completed") runCompletedTools(response?.output);
        continueAfterTools();
        if (status === "failed") {
          const message = response?.status_details?.error?.message ?? "";
          if (
            greetOnStart &&
            response?.id &&
            response.id === greetingResponseId &&
            greetingSends < MAX_GREETING_SENDS
          ) {
            greetingDone = false;
            greetingResponseId = null;
            sendGreeting(
              `greeting response failed${message ? `: ${message}` : ""}`,
            );
          } else {
            handlers.onNotice?.(
              `The orchestrator could not respond${message ? `: ${message}` : "."}`,
            );
          }
        } else if (status && status !== "completed") {
          note(
            `response ${response?.id ?? "?"} ended ${status} (${response?.status_details?.reason ?? "no reason"})`,
          );
        }
        break;
      }
      case "response.cancelled":
        responseActive = false;
        break;
      case "output_audio_buffer.started":
        agentSpeaking = true;
        applyMicGate();
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        agentSpeaking = false;
        applyMicGate();
        break;
      case "input_audio_buffer.speech_started":
        if (responseActive || agentSpeaking) showTalkOverNotice();
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        partialAssistant += String(event.delta ?? "");
        handlers.onPartialTranscript?.("assistant", partialAssistant);
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(event.transcript ?? "").trim();
        if (text) handlers.onUserTranscript(text);
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        partialAssistant = "";
        handlers.onPartialTranscript?.("assistant", "");
        const text = String(event.transcript ?? "").trim();
        if (text) handlers.onAssistantTranscript(text);
        break;
      }
      case "error": {
        const code = event.error?.code ?? "";
        if (code === "conversation_already_has_active_response") {
          if (io.now() < expectOwnConflictUntil) {
            note(
              "ignored active-response conflict caused by the repeated greeting request",
            );
            break;
          }
          // Server VAD tried to answer while the agent was still talking: the person spoke over it.
          showTalkOverNotice();
          break;
        }
        const detail = [event.error?.type, code, event.error?.message]
          .filter(Boolean)
          .join(" ");
        note(`server error: ${detail}`);
        handlers.onNotice?.(`Live session error: ${detail || "unknown error"}`);
        break;
      }
      default:
        break;
    }
  };

  const setInterrupt = (enabled: boolean) => {
    interruptEnabled = Boolean(enabled);
    applyMicGate();
    if (opened && sentInterrupt !== interruptEnabled) sendTurnDetection();
  };

  const notify = (text: string) => {
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [
          { type: "input_text", text: String(text ?? "").slice(0, 1000) },
        ],
      },
    });
    send({ type: "response.create" });
  };

  const localSpeechDetected = (): boolean => {
    if (disposed || !agentSpeaking || interruptEnabled) return false;
    return showTalkOverNotice();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimer(ackTimer);
    clearTimer(greetingTimer);
    ackTimer = null;
    greetingTimer = null;
  };

  const snapshot = (): ProtocolSnapshot => ({
    interruptEnabled,
    agentSpeaking,
    responseActive,
    greetingSends,
    greetingDone,
  });

  return {
    onOpen,
    onServerEvent,
    setInterrupt,
    notify,
    localSpeechDetected,
    dispose,
    snapshot,
  };
}
