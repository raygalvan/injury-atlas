/**
 * Decides when sustained sound on the open microphone counts as talking over
 * the agent. Pure arithmetic so it can be unit tested; the browser feeds it one
 * RMS level (0..1) every few tens of milliseconds.
 *
 * Why this exists: while Interrupt is off, the track sent to OpenAI is muted
 * whenever the agent speaks, so the server's voice detector can never report
 * speech during agent audio. The notice therefore has to come from a local
 * reading of the ungated microphone.
 */

export interface TalkOverDetectorOptions {
  /** Sound must stay above the threshold this long before it counts. */
  sustainMs?: number;
  /** The threshold never drops below this level, whatever the room's noise floor. */
  minLevel?: number;
  /** The threshold never rises above this level, so a loud room still triggers. */
  maxLevel?: number;
  /** Threshold as a multiple of the tracked noise floor. */
  floorRatio?: number;
  initialFloor?: number;
}

export interface TalkOverDetector {
  /**
   * Feed one level sample. `monitoring` is true while the agent is speaking with
   * the outbound mic muted. Returns true once per sustained burst.
   */
  push: (level: number, now: number, monitoring: boolean) => boolean;
  threshold: () => number;
  floor: () => number;
}

export function createTalkOverDetector(
  options: TalkOverDetectorOptions = {},
): TalkOverDetector {
  const sustainMs = options.sustainMs ?? 450;
  const minLevel = options.minLevel ?? 0.04;
  const maxLevel = options.maxLevel ?? 0.2;
  const floorRatio = options.floorRatio ?? 4;
  let floor = options.initialFloor ?? 0.01;
  let aboveSince: number | null = null;
  let latched = false;

  const threshold = () =>
    Math.min(maxLevel, Math.max(minLevel, floor * floorRatio));

  const push = (level: number, now: number, monitoring: boolean): boolean => {
    const clean = Number.isFinite(level) ? Math.max(0, level) : 0;
    // The floor falls quickly and rises slowly, and only on samples below the
    // threshold, so speech never drags it up but steady room noise does.
    if (clean < floor) floor += (clean - floor) * 0.2;
    else if (clean < threshold()) floor += (clean - floor) * 0.01;

    if (!monitoring || clean < threshold()) {
      aboveSince = null;
      latched = false;
      return false;
    }
    if (latched) return false;
    if (aboveSince === null) {
      aboveSince = now;
      return false;
    }
    if (now - aboveSince < sustainMs) return false;
    // Latch until the sound drops again, so one long burst is one notice.
    latched = true;
    return true;
  };

  return { push, threshold, floor: () => floor };
}
