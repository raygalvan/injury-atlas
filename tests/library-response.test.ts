import { test } from "node:test";
import assert from "node:assert/strict";
import {
  libraryResponse,
  OUTPUT_LIMIT_ERROR,
  PAUSE_LIMIT_ERROR,
} from "../server/ai/library-response";
const config = { provider: "anthropic" as const, model: "synthetic", apiKey: "fake" };
test("paused research retains cited text and tool context beyond the old three-call ceiling", async () => {
  const requests: any[] = [];
  const citation = {
    type: "text",
    text: "Cited definition.",
    citations: [{ type: "web_search_result_location", url: "https://nih.gov/test" }],
  };
  const result = await libraryResponse(
    config,
    { max_tokens: 8192, messages: [{ role: "user", content: "generic injury" }] },
    async (_c, _p, b: any) => {
      requests.push(b);
      return requests.length < 5
        ? {
            stop_reason: "pause_turn",
            content: [
              requests.length === 1
                ? citation
                : {
                    type: "server_tool_use",
                    id: "tool" + requests.length,
                    name: "web_search",
                    input: { query: "generic" },
                  },
            ],
          }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "Final explanation." }] };
    },
  );
  assert.equal(requests.length, 5);
  assert.deepEqual(requests[1].messages[1].content, [citation]);
  assert.deepEqual(result.content[0], citation);
});
test("truncation retries last complete context at a larger budget, excluding broken JSON and incomplete tools", async () => {
  const requests: any[] = [];
  const result = await libraryResponse(
    config,
    { max_tokens: 2048, messages: [{ role: "user", content: "injury" }] },
    async (_c, _p, b: any) => {
      requests.push(b);
      return requests.length === 1
        ? { stop_reason: "max_tokens", content: [{ type: "text", text: '{"broken' }] }
        : { stop_reason: "end_turn", content: [{ type: "text", text: '{"name":"injury"}' }] };
    },
  );
  assert.equal(requests[1].max_tokens, 4096);
  assert.equal(requests[1].messages.length, 1);
  assert.equal(result.content.length, 1);
});
test("recovery remains bounded and distinguishes token exhaustion, pauses, and elapsed time", async () => {
  await assert.rejects(
    libraryResponse(config, { max_tokens: 16384 }, async () => ({ stop_reason: "max_tokens" })),
    { message: OUTPUT_LIMIT_ERROR },
  );
  let calls = 0;
  await assert.rejects(
    libraryResponse(config, { max_tokens: 8192 }, async () => {
      calls++;
      return { stop_reason: "pause_turn", content: [] };
    }),
    { message: PAUSE_LIMIT_ERROR },
  );
  assert.equal(calls, 6);
  let time = 0;
  calls = 0;
  await assert.rejects(
    libraryResponse(
      config,
      {},
      async () => {
        calls++;
        time = 200000;
        return { stop_reason: "pause_turn", content: [] };
      },
      () => time,
    ),
    /time budget/,
  );
  assert.equal(calls, 1);
});
test("Responses provider truncation expands budget without accepting partial content", async () => {
  const seen: any[] = [];
  const r = await libraryResponse(
    { ...config, provider: "openai" },
    { max_output_tokens: 8192, input: [] },
    async (_c, _p, b: any) => {
      seen.push(b);
      return seen.length === 1
        ? { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }
        : { status: "completed", output: [] };
    },
  );
  assert.equal(seen[1].max_output_tokens, 16384);
  assert.equal(r.status, "completed");
});
