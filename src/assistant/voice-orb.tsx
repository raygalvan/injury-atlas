"use client";

/**
 * The orb is the voice interface. Tap to talk, tap to end.
 *
 * While live it renders the actual audio: a slowly rotating whirlpool of
 * spiral arcs and pulsing rings, green while the orchestrator speaks and gold
 * while the person speaks, breathing quietly between turns. Levels come from
 * WebAudio analysers on the real mic and remote streams, so the motion is
 * the conversation rather than a loop.
 */
import { useEffect, useRef } from "react";

import type { RealtimeState } from "./realtime-voice";

export type OrbState = RealtimeState | "idle";

const AGENT = [31, 75, 67] as const; // firm green
const PERSON = [181, 138, 62] as const; // gold

function makeAnalyser(
  context: AudioContext,
  stream: MediaStream,
): AnalyserNode {
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);
  return analyser;
}

function level(
  analyser: AnalyserNode | null,
  buffer: Uint8Array<ArrayBuffer>,
): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = ((buffer[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
}

export function VoiceOrb({
  state,
  localStream,
  remoteStream,
  onTap,
  label,
}: {
  state: OrbState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onTap: () => void;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const audioBits = useRef<{
    context: AudioContext | null;
    person: AnalyserNode | null;
    agent: AnalyserNode | null;
  }>({
    context: null,
    person: null,
    agent: null,
  });

  useEffect(() => {
    const bits = audioBits.current;
    if (state !== "live" && state !== "connecting") {
      void bits.context?.close().catch(() => undefined);
      audioBits.current = { context: null, person: null, agent: null };
      return;
    }
    try {
      const context =
        bits.context && bits.context.state !== "closed"
          ? bits.context
          : new AudioContext();
      audioBits.current = {
        context,
        person: localStream ? makeAnalyser(context, localStream) : null,
        agent: remoteStream ? makeAnalyser(context, remoteStream) : null,
      };
      void context.resume().catch(() => undefined);
    } catch {
      /* no WebAudio: the orb still breathes */
    }
  }, [state, localStream, remoteStream]);

  useEffect(
    () => () => {
      void audioBits.current.context?.close().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const buffer = new Uint8Array(new ArrayBuffer(128));
    let phase = 0;
    let smoothedPerson = 0;
    let smoothedAgent = 0;
    let liveness = 0;
    let running = true;

    const draw = () => {
      if (!running) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const live = state === "live";
      const connecting = state === "connecting";
      const personRaw = live ? level(audioBits.current.person, buffer) : 0;
      const agentRaw = live ? level(audioBits.current.agent, buffer) : 0;
      smoothedPerson += (personRaw - smoothedPerson) * 0.25;
      smoothedAgent += (agentRaw - smoothedAgent) * 0.25;
      const energy = Math.max(smoothedPerson, smoothedAgent);
      phase += reduceMotion ? 0.003 : connecting ? 0.05 : 0.012 + energy * 0.09;
      liveness += ((live || connecting ? 1 : 0) - liveness) * 0.06;

      const cx = width / 2;
      const cy = height / 2;
      const idleR = Math.min(width, height) * 0.3;
      const liveR = Math.min(width, height) / 2 - 8;
      const maxR = idleR + (liveR - idleR) * liveness;
      const breath = Math.sin(phase * 1.7) * 0.5 + 0.5;

      const mix =
        smoothedPerson + smoothedAgent > 0.02
          ? smoothedAgent / (smoothedPerson + smoothedAgent)
          : 0.5;
      const tone = (alpha: number, bias = 0): string => {
        const m = Math.min(1, Math.max(0, mix + bias));
        const r = Math.round(PERSON[0] + (AGENT[0] - PERSON[0]) * m);
        const g = Math.round(PERSON[1] + (AGENT[1] - PERSON[1]) * m);
        const b = Math.round(PERSON[2] + (AGENT[2] - PERSON[2]) * m);
        return `rgba(${r},${g},${b},${alpha})`;
      };

      for (let arm = 0; arm < 3; arm++) {
        const start = phase + (arm * Math.PI * 2) / 3;
        const radius = maxR * (0.55 + arm * 0.14) + energy * 10 + breath * 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + Math.PI * (0.9 + energy * 0.5));
        ctx.strokeStyle = tone(
          live ? 0.35 + energy * 0.45 : 0.22 + breath * 0.1,
          arm === 1 ? -0.2 : arm === 2 ? 0.2 : 0,
        );
        ctx.lineWidth = 2 + energy * 3;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      const ringSpecs: Array<[number, number, number]> = [
        [0.34, smoothedAgent, 0.4],
        [0.44, smoothedAgent * 0.7 + smoothedPerson * 0.3, 0.26],
        [0.55, smoothedPerson, 0.34],
      ];
      for (const [base, lvl, alpha] of ringSpecs) {
        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          maxR * base + breath * 3 + lvl * maxR * 0.24,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = tone(live ? alpha + lvl * 0.45 : alpha * 0.7);
        ctx.lineWidth = 1.5 + lvl * 4;
        ctx.stroke();
      }

      const coreR = maxR * 0.24 + breath * 3 + smoothedAgent * maxR * 0.16;
      const glow = ctx.createRadialGradient(
        cx,
        cy,
        coreR * 0.2,
        cx,
        cy,
        coreR * 1.9,
      );
      glow.addColorStop(0, tone(live ? 0.95 : 0.85));
      glow.addColorStop(0.55, tone(live ? 0.35 : 0.25));
      glow.addColorStop(1, tone(0));
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 1.9, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      frame.current = requestAnimationFrame(draw);
    };
    frame.current = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(frame.current);
    };
  }, [state]);

  const live = state === "live";
  const connecting = state === "connecting";

  return (
    <button
      type="button"
      className={`as-orb${live ? " is-live" : ""}${connecting ? " is-connecting" : ""}`}
      onClick={onTap}
      disabled={connecting}
      aria-pressed={live}
      aria-label={label}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </button>
  );
}
