/**
 * Live speech-to-speech with the orchestrator over WebRTC.
 *
 * The server mints a short-lived client secret with the instructions and
 * tools baked in; the browser never holds the API key. This module owns the
 * browser half: microphone, peer connection, remote audio, and the level
 * monitor. What to send over the data channel, and when, is decided by
 * realtime-protocol.ts, which has no browser dependencies and is unit tested.
 *
 * Two tracks come from one microphone. A clone goes to the model and is muted
 * while the agent speaks (unless Interrupt is on), so echo and room noise can
 * never cut the agent off. The original stays open for the orb and for the
 * talk-over detector, which is how the "wait until I finish" notice can fire
 * even though the model hears silence at that moment.
 *
 * Debugging: add `?voiceDebug=1` to the URL (or set localStorage
 * `injurybot.voiceDebug` to "1") and every data-channel event, timer decision,
 * and playback result is written to the browser console.
 */

import {
  createRealtimeProtocol,
  type ProtocolHandlers,
  type RealtimeServerEvent,
} from "./realtime-protocol";
import { createTalkOverDetector } from "./talk-over-detector";

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const LEVEL_SAMPLE_MS = 50;

export type RealtimeState = "connecting" | "live" | "closed" | "error";

export interface RealtimeHandlers extends ProtocolHandlers {
  onStateChange: (state: RealtimeState, detail?: string) => void;
  onSession?: (id: string) => void;
  onStreams?: (local: MediaStream, remote: MediaStream | null) => void;
}

export interface RealtimeSession {
  stop: () => void;
  /** Inject a note the model should acknowledge aloud. */
  notify: (text: string) => void;
  /** Barge-in. Off by default: the outbound mic is muted while the agent speaks. */
  setInterrupt: (enabled: boolean) => void;
}

export interface RealtimeOptions {
  caseId?: string;
  signal?: AbortSignal;
  greetOnStart?: boolean;
  interruptEnabled?: boolean;
}

export function voiceDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).has("voiceDebug"))
      return true;
    return window.localStorage.getItem("injurybot.voiceDebug") === "1";
  } catch {
    return false;
  }
}

export async function mintSession(
  caseId?: string,
  signal?: AbortSignal,
): Promise<{ clientSecret: string; model: string; sessionId: string }> {
  const response = await fetch("/api/assistant/realtime-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId }),
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as {
    clientSecret?: string;
    model?: string;
    sessionId?: string;
    error?: string;
  };
  if (!response.ok || !body.clientSecret || !body.model || !body.sessionId) {
    throw new Error(
      body.error || `Live voice could not start (${response.status}).`,
    );
  }
  return {
    clientSecret: body.clientSecret,
    model: body.model,
    sessionId: body.sessionId,
  };
}

async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "This browser cannot open the microphone here. Live voice needs a secure (https) connection.",
    );
  }
  try {
    // Echo cancellation matters twice over: it keeps the agent's own voice out of
    // what the model hears, and out of what the talk-over detector measures.
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    const name = String((error as { name?: string })?.name ?? "");
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error(
        "Microphone access was blocked. Allow the microphone for this site and tap again.",
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new Error("No microphone was found on this device.");
    }
    throw new Error(
      `The microphone could not start (${(error as Error)?.message || name || "unknown error"}).`,
    );
  }
}

export async function startRealtimeSession(
  handlers: RealtimeHandlers,
  options: RealtimeOptions = {},
): Promise<RealtimeSession> {
  const debug = voiceDebugEnabled();
  const log = debug
    ? (direction: "in" | "out" | "note", detail: unknown) =>
        console.info(`[voice ${direction}]`, detail)
    : undefined;

  handlers.onStateChange("connecting");
  const { clientSecret, model, sessionId } = await mintSession(
    options.caseId,
    options.signal,
  );
  handlers.onSession?.(sessionId);
  const mic = await openMicrophone();
  if (options.signal?.aborted) {
    mic.getTracks().forEach((t) => t.stop());
    throw new Error("Voice connection cancelled.");
  }
  const monitorTrack = mic.getAudioTracks()[0];
  if (!monitorTrack) {
    for (const track of mic.getTracks()) track.stop();
    throw new Error("No microphone was found on this device.");
  }
  const outboundTrack = monitorTrack.clone();
  const outbound = new MediaStream([outboundTrack]);

  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel("oai-events");
  const audio = document.createElement("audio");
  audio.autoplay = true;
  let closed = false;
  let levelTimer: number | null = null;
  let levelContext: AudioContext | null = null;

  const protocol = createRealtimeProtocol(
    handlers,
    {
      send: (event) => {
        if (channel.readyState === "open") channel.send(JSON.stringify(event));
        else
          log?.(
            "note",
            `dropped ${String(event.type)}: data channel is ${channel.readyState}`,
          );
      },
      setMicOpen: (open) => {
        if (outboundTrack.enabled !== open)
          log?.(
            "note",
            open
              ? "outbound mic open"
              : "outbound mic muted while the agent speaks",
          );
        outboundTrack.enabled = open;
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id as number),
      log,
    },
    {
      greetOnStart: options.greetOnStart,
      interruptEnabled: options.interruptEnabled,
    },
  );

  const stop = () => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", stop);
    protocol.dispose();
    if (levelTimer !== null) window.clearInterval(levelTimer);
    void levelContext?.close().catch(() => undefined);
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    outboundTrack.stop();
    for (const track of mic.getTracks()) track.stop();
    audio.srcObject = null;
    audio.remove();
    handlers.onStateChange("closed");
  };

  options.signal?.addEventListener("abort", stop, { once: true });

  const startPlayback = () => {
    void audio
      .play()
      .then(() => log?.("note", "remote audio playing"))
      .catch((error: unknown) => {
        const name = String((error as { name?: string })?.name ?? error);
        log?.("note", `remote audio play() rejected: ${name}`);
        if (name !== "NotAllowedError") return;
        handlers.onNotice?.(
          "Sound is blocked by the browser. Tap anywhere to hear the orchestrator.",
        );
        const resume = () => void audio.play().catch(() => undefined);
        document.addEventListener("pointerdown", resume, { once: true });
      });
  };

  const startLevelMonitor = () => {
    try {
      const context = new AudioContext();
      levelContext = context;
      const source = context.createMediaStreamSource(mic);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      const buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      const detector = createTalkOverDetector();
      void context.resume().catch(() => undefined);
      if (context.state !== "running") {
        // Some browsers only start audio processing inside a gesture; the next tap will do.
        document.addEventListener(
          "pointerdown",
          () => void context.resume().catch(() => undefined),
          { once: true },
        );
      }
      levelTimer = window.setInterval(() => {
        if (closed) return;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = buffer[i] ?? 0;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const { agentSpeaking, interruptEnabled } = protocol.snapshot();
        if (
          detector.push(rms, Date.now(), agentSpeaking && !interruptEnabled)
        ) {
          log?.(
            "note",
            `talk-over: mic level ${rms.toFixed(3)} stayed above ${detector.threshold().toFixed(3)} while the agent spoke`,
          );
          protocol.localSpeechDetected();
        }
      }, LEVEL_SAMPLE_MS);
      log?.("note", `level monitor running (audio context ${context.state})`);
    } catch (error) {
      log?.(
        "note",
        `level monitor unavailable: ${String((error as Error)?.message ?? error)}`,
      );
    }
  };

  try {
    pc.addTrack(outboundTrack, outbound);
    handlers.onStreams?.(mic, null);
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? null;
      audio.srcObject = stream;
      startPlayback();
      handlers.onStreams?.(mic, stream);
    };
    pc.onconnectionstatechange = () => {
      if (closed) return;
      log?.("note", `peer connection ${pc.connectionState}`);
      if (pc.connectionState === "connected") handlers.onStateChange("live");
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        handlers.onStateChange("error", "The live connection dropped.");
        stop();
      }
    };

    channel.onopen = () => {
      log?.("note", "data channel open");
      protocol.onOpen();
    };
    channel.onclose = () => log?.("note", "data channel closed");
    channel.onmessage = (message) => {
      let event: RealtimeServerEvent;
      try {
        event = JSON.parse(message.data as string) as RealtimeServerEvent;
      } catch {
        return;
      }
      if (log && !String(event.type ?? "").endsWith(".delta")) log("in", event);
      protocol.onServerEvent(event);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answer = await fetch(
      `${CALLS_URL}?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      },
    );
    if (!answer.ok) {
      const detail = (await answer.text().catch(() => "")).slice(0, 200);
      throw new Error(
        `Live voice could not connect (${answer.status}). ${detail}`,
      );
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    startLevelMonitor();

    return {
      stop,
      notify: protocol.notify,
      setInterrupt: protocol.setInterrupt,
    };
  } catch (error) {
    stop();
    throw error;
  }
}
