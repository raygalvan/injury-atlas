import assert from "node:assert/strict";
import { test } from "node:test";

import { createTalkOverDetector } from "../src/assistant/talk-over-detector";

const STEP = 50;

function feed(detector: ReturnType<typeof createTalkOverDetector>, level: number, ms: number, monitoring: boolean, start = 0): { fired: number; end: number } {
  let fired = 0;
  let now = start;
  for (; now < start + ms; now += STEP) {
    if (detector.push(level, now, monitoring)) fired += 1;
  }
  return { fired, end: now };
}

test("quiet room, then speech while the agent talks: fires once the sound is sustained", () => {
  const detector = createTalkOverDetector({ sustainMs: 450 });
  const quiet = feed(detector, 0.004, 3_000, false);
  assert.equal(quiet.fired, 0);
  assert.ok(detector.threshold() <= 0.04, `threshold ${detector.threshold()} should sit at the floor minimum`);

  const blip = feed(detector, 0.12, 300, true, quiet.end);
  assert.equal(blip.fired, 0, "a burst shorter than the sustain window is ignored");
  const settle = feed(detector, 0.004, 500, true, blip.end);
  assert.equal(settle.fired, 0);

  const speech = feed(detector, 0.12, 1_000, true, settle.end);
  assert.equal(speech.fired, 1, "one notice per sustained burst");
});

test("never fires while not monitoring, even for loud speech", () => {
  const detector = createTalkOverDetector();
  assert.equal(feed(detector, 0.3, 5_000, false).fired, 0);
});

test("the person's own turns do not raise the threshold", () => {
  const detector = createTalkOverDetector();
  const before = detector.threshold();
  const talk = feed(detector, 0.15, 10_000, false);
  assert.equal(talk.fired, 0);
  assert.equal(detector.threshold(), before, "speech above the threshold leaves the floor alone");
  const over = feed(detector, 0.15, 600, true, talk.end);
  assert.equal(over.fired, 1, "talking over the agent right after a long turn still counts");
});

test("steady moderate room noise raises the threshold slowly and does not fire", () => {
  const detector = createTalkOverDetector();
  const noisy = feed(detector, 0.03, 20_000, true);
  assert.equal(noisy.fired, 0);
  assert.ok(detector.floor() > 0.02, `floor ${detector.floor()} adapts toward the noise`);
  assert.ok(detector.threshold() > 0.08, `threshold ${detector.threshold()} sits well above the noise`);
});

test("a loud room still triggers because the threshold is capped", () => {
  const detector = createTalkOverDetector({ maxLevel: 0.2 });
  const loud = feed(detector, 0.25, 2_000, true);
  assert.ok(loud.fired >= 1);
  assert.ok(detector.threshold() <= 0.2);
});

test("garbage samples are treated as silence", () => {
  const detector = createTalkOverDetector();
  assert.equal(detector.push(Number.NaN, 0, true), false);
  assert.equal(detector.push(-1, 50, true), false);
  assert.ok(detector.floor() >= 0);
});
