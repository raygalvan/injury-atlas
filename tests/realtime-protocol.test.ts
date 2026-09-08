import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GREETING_NOTE,
  NO_GREETING_NOTICE,
  TALK_OVER_NOTICE,
  createRealtimeProtocol,
  type ProtocolIO,
  type ProtocolOptions,
} from "../src/assistant/realtime-protocol";

function harness(options: ProtocolOptions = {}) {
  const sent: Record<string, unknown>[] = [];
  const notices: string[] = [];
  const mic: boolean[] = [];
  const user: string[] = [];
  const assistant: string[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const io: ProtocolIO = {
    send: (event) => sent.push(event),
    setMicOpen: (open) => mic.push(open),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  };
  const protocol = createRealtimeProtocol(
    {
      onUserTranscript: (text) => user.push(text),
      onAssistantTranscript: (text) => assistant.push(text),
      onToolCall: async (name, args) => {
        calls.push({ name, args });
        return "tool ok";
      },
      onNotice: (text) => notices.push(text),
    },
    io,
    options,
  );
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = target;
  };
  const types = () => sent.map((event) => event.type);
  return { protocol, sent, notices, mic, user, assistant, calls, advance, types, pendingTimers: () => timers.size };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("greeting: after the session ack, a system note and a bare response.create are sent", () => {
  const h = harness({ greetOnStart: true });
  h.protocol.onOpen();
  assert.deepEqual(h.types(), ["session.update"]);
  const update = h.sent[0] as { session: { audio: { input: { turn_detection: { interrupt_response: boolean } } } } };
  assert.equal(update.session.audio.input.turn_detection.interrupt_response, false);

  h.protocol.onServerEvent({ type: "session.created" });
  assert.deepEqual(h.types(), ["session.update"], "session.created alone does not greet; we wait for our update's ack");

  h.protocol.onServerEvent({ type: "session.updated" });
  assert.deepEqual(h.types(), ["session.update", "conversation.item.create", "response.create"]);
  const item = h.sent[1] as { item: { role: string; content: { text: string }[] } };
  assert.equal(item.item.role, "system");
  assert.equal(item.item.content[0]?.text, GREETING_NOTE);
  assert.deepEqual(h.sent[2], { type: "response.create" }, "no per-response instructions, so the orchestrator persona applies");

  h.protocol.onServerEvent({ type: "response.created", response: { id: "resp_1" } });
  h.advance(10_000);
  assert.deepEqual(h.types().slice(3), [], "nothing is re-sent once the greeting response exists");
  assert.deepEqual(h.notices, []);
  assert.equal(h.pendingTimers(), 0);
});

test("greeting: sent anyway when session.updated never arrives", () => {
  const h = harness({ greetOnStart: true, sessionAckTimeoutMs: 1_000 });
  h.protocol.onOpen();
  h.advance(999);
  assert.deepEqual(h.types(), ["session.update"]);
  h.advance(1);
  assert.deepEqual(h.types(), ["session.update", "conversation.item.create", "response.create"]);
});

test("greeting: repeated once when no response.created follows, then a notice", () => {
  const h = harness({ greetOnStart: true, greetingTimeoutMs: 2_000 });
  h.protocol.onOpen();
  h.protocol.onServerEvent({ type: "session.updated" });
  h.advance(2_000);
  assert.deepEqual(h.types(), ["session.update", "conversation.item.create", "response.create", "conversation.item.create", "response.create"]);
  assert.deepEqual(h.notices, []);
  h.advance(2_000);
  assert.equal(h.types().length, 5, "only two attempts");
  assert.deepEqual(h.notices, [NO_GREETING_NOTICE]);
  assert.equal(h.protocol.snapshot().greetingDone, true);
});

test("greeting: a slow first response after the repeat is not reported as a talk-over", () => {
  const h = harness({ greetOnStart: true, greetingTimeoutMs: 2_000 });
  h.protocol.onOpen();
  h.protocol.onServerEvent({ type: "session.updated" });
  h.advance(2_000);
  assert.equal(h.types().filter((type) => type === "response.create").length, 2);
  h.protocol.onServerEvent({ type: "response.created", response: { id: "resp_slow" } });
  h.protocol.onServerEvent({ type: "error", error: { type: "invalid_request_error", code: "conversation_already_has_active_response", message: "active" } });
  assert.deepEqual(h.notices, [], "our own repeat collided with the late response; nobody talked over anyone");
  h.advance(2_500);
  h.protocol.onServerEvent({ type: "error", error: { type: "invalid_request_error", code: "conversation_already_has_active_response", message: "active" } });
  assert.deepEqual(h.notices, [TALK_OVER_NOTICE], "later conflicts are real talk-overs again");
});

test("greeting: a failed greeting response is retried once, a second failure is reported", () => {
  const h = harness({ greetOnStart: true });
  h.protocol.onOpen();
  h.protocol.onServerEvent({ type: "session.updated" });
  h.protocol.onServerEvent({ type: "response.created", response: { id: "resp_1" } });
  h.protocol.onServerEvent({
    type: "response.done",
    response: { id: "resp_1", status: "failed", status_details: { type: "failed", error: { code: "server_error", message: "upstream hiccup" } } },
  });
  assert.equal(h.types().filter((type) => type === "response.create").length, 2);
  assert.deepEqual(h.notices, []);

  h.protocol.onServerEvent({ type: "response.created", response: { id: "resp_2" } });
  h.protocol.onServerEvent({
    type: "response.done",
    response: { id: "resp_2", status: "failed", status_details: { type: "failed", error: { code: "server_error", message: "still down" } } },
  });
  assert.equal(h.types().filter((type) => type === "response.create").length, 2, "no third attempt");
  assert.deepEqual(h.notices, ["The orchestrator could not respond: still down"]);
});

test("greeting: skipped when the person already spoke and a response is active", () => {
  const h = harness({ greetOnStart: true });
  h.protocol.onOpen();
  h.protocol.onServerEvent({ type: "response.created", response: { id: "vad_1" } });
  h.protocol.onServerEvent({ type: "session.updated" });
  assert.deepEqual(h.types(), ["session.update"]);
  h.advance(10_000);
  assert.deepEqual(h.types(), ["session.update"]);
  assert.deepEqual(h.notices, []);
});

test("greeting: nothing is sent when greetOnStart is off", () => {
  const h = harness({ greetOnStart: false });
  h.protocol.onOpen();
  h.protocol.onServerEvent({ type: "session.updated" });
  h.advance(10_000);
  assert.deepEqual(h.types(), ["session.update"]);
});

test("mic gate: muted while the agent speaks with Interrupt off, and the local detector raises the notice", () => {
  const h = harness();
  h.protocol.onOpen();
  assert.deepEqual(h.mic, [true]);
  h.protocol.onServerEvent({ type: "response.created", response: { id: "r" } });
  h.protocol.onServerEvent({ type: "output_audio_buffer.started" });
  assert.equal(h.mic.at(-1), false);

  assert.equal(h.protocol.localSpeechDetected(), true);
  assert.deepEqual(h.notices, [TALK_OVER_NOTICE]);
  h.advance(1_000);
  assert.equal(h.protocol.localSpeechDetected(), false, "cooldown");
  h.advance(3_000);
  assert.equal(h.protocol.localSpeechDetected(), true);
  assert.equal(h.notices.length, 2);

  h.protocol.onServerEvent({ type: "output_audio_buffer.stopped" });
  assert.equal(h.mic.at(-1), true);
  assert.equal(h.protocol.localSpeechDetected(), false, "agent is quiet, nothing to talk over");
});

test("mic gate: Interrupt on keeps the mic open and leaves talk-over to server VAD", () => {
  const h = harness({ interruptEnabled: true });
  h.protocol.onOpen();
  const update = h.sent[0] as { session: { audio: { input: { turn_detection: { interrupt_response: boolean } } } } };
  assert.equal(update.session.audio.input.turn_detection.interrupt_response, true);
  h.protocol.onServerEvent({ type: "response.created", response: { id: "r" } });
  h.protocol.onServerEvent({ type: "output_audio_buffer.started" });
  assert.equal(h.mic.at(-1), true);
  assert.equal(h.protocol.localSpeechDetected(), false);
  h.protocol.onServerEvent({ type: "input_audio_buffer.speech_started" });
  assert.deepEqual(h.notices, [TALK_OVER_NOTICE]);
});

test("setInterrupt: applied at open when set early, and not re-sent when unchanged", () => {
  const h = harness();
  h.protocol.setInterrupt(true);
  assert.deepEqual(h.types(), [], "nothing goes out before the channel opens");
  h.protocol.onOpen();
  assert.deepEqual(h.types(), ["session.update"]);
  h.protocol.setInterrupt(true);
  assert.deepEqual(h.types(), ["session.update"], "duplicate suppressed");
  h.protocol.setInterrupt(false);
  assert.deepEqual(h.types(), ["session.update", "session.update"]);
});

test("errors: the active-response conflict is the talk-over notice; anything else is shown as a session error", () => {
  const h = harness();
  h.protocol.onOpen();
  h.protocol.onServerEvent({ type: "error", error: { type: "invalid_request_error", code: "conversation_already_has_active_response", message: "Conversation already has an active response" } });
  assert.deepEqual(h.notices, [TALK_OVER_NOTICE]);
  h.protocol.onServerEvent({ type: "error", error: { type: "invalid_request_error", code: "invalid_value", message: "Invalid value for input_audio_format" } });
  assert.deepEqual(h.notices, [TALK_OVER_NOTICE, "Live session error: invalid_request_error invalid_value Invalid value for input_audio_format"]);
});

test("tool calls: the result is sent back followed by a response request", async () => {
  const h = harness();
  h.protocol.onOpen();
  h.protocol.onServerEvent({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", status: "completed", name: "whats_waiting", arguments: '{"scope":"me"}', call_id: "call_1" }] } });
  await tick();
  assert.deepEqual(h.calls, [{ name: "whats_waiting", args: { scope: "me" } }]);
  assert.deepEqual(h.sent.slice(1), [
    { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_1", output: "tool ok" } },
    { type: "response.create" },
  ]);
});

test("transcripts: partial assistant words stream, finished lines are delivered once", () => {
  const h = harness();
  const partials: string[] = [];
  const p = createRealtimeProtocol(
    { onUserTranscript: (t) => h.user.push(t), onAssistantTranscript: (t) => h.assistant.push(t), onPartialTranscript: (_r, t) => partials.push(t), onToolCall: async () => "" },
    { send: () => undefined, setMicOpen: () => undefined, now: () => 0, setTimer: () => 0, clearTimer: () => undefined },
  );
  p.onServerEvent({ type: "response.output_audio_transcript.delta", delta: "Good " });
  p.onServerEvent({ type: "response.output_audio_transcript.delta", delta: "morning." });
  p.onServerEvent({ type: "response.output_audio_transcript.done", transcript: "Good morning." });
  p.onServerEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: " What is waiting? " });
  assert.deepEqual(partials, ["Good ", "Good morning.", ""]);
  assert.deepEqual(h.assistant, ["Good morning."]);
  assert.deepEqual(h.user, ["What is waiting?"]);
});

test("dispose: timers are cleared and nothing further is sent", () => {
  const h = harness({ greetOnStart: true });
  h.protocol.onOpen();
  h.protocol.dispose();
  assert.equal(h.pendingTimers(), 0);
  h.protocol.onServerEvent({ type: "session.updated" });
  h.protocol.notify("hello");
  assert.deepEqual(h.types(), ["session.update"]);
});


test("voice actions ignore interrupted calls and execute completed calls exactly once", async () => {
  const h = harness();
  const item = { type: "function_call", status: "completed", name: "add_library_injury", arguments: '{"name":"broken kneecap"}', call_id: "library-1" };
  h.protocol.onServerEvent({ ...item, type: "response.function_call_arguments.done" });
  h.protocol.onServerEvent({ type: "response.done", response: { status: "cancelled", output: [item] } });
  await tick();
  assert.equal(h.calls.length, 0);
  const completed = { type: "response.done", response: { status: "completed", output: [item] } };
  h.protocol.onServerEvent(completed);
  h.protocol.onServerEvent(completed);
  await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.sent.filter(e => e.type === "response.create").length, 1);
});

test("voice action errors are visible and are returned as failures, never Done", async () => {
  const sent: any[] = [], notices: string[] = [];
  const p = createRealtimeProtocol({
    onUserTranscript() {}, onAssistantTranscript() {},
    onToolCall: async () => { throw new Error("Medical Library Agent is not configured."); },
    onNotice: t => notices.push(t),
  }, { send: e => sent.push(e), setMicOpen() {}, now: () => 0, setTimer: () => 0, clearTimer() {} });
  p.onServerEvent({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", status: "completed", name: "add_library_injury", call_id: "failed", arguments: '{"name":"sprain"}' }] } });
  await tick();
  assert.match(notices.at(-1)!, /Medical Library Agent is not configured/);
  assert.equal(JSON.parse(sent[0].item.output).ok, false);
  assert.equal(sent[1].type, "response.create");
});

test("voice batches tool results before requesting one follow-up", async () => {
  const h = harness();
  h.protocol.onServerEvent({ type: "response.done", response: { status: "completed", output: ["one", "two"].map(call_id => ({ type: "function_call", status: "completed", name: "find_cases", call_id, arguments: "{}" })) } });
  await tick();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.types(), ["conversation.item.create", "conversation.item.create", "response.create"]);
});
