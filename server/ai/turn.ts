import type { FunctionTool, ModelTurn, ResponseInputItem } from "./openai";

import type { AssistantCard } from "../../shared/ai";
export type ToolOutcome = { speech: string; card?: AssistantCard };

export interface TurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolEvent {
  name: string;
  args: Record<string, unknown>;
  outcome: ToolOutcome;
}

export interface TurnResult {
  text: string;
  toolEvents: ToolEvent[];
}

export type ModelCaller = (
  input: ResponseInputItem[],
  tools: FunctionTool[],
) => Promise<ModelTurn>;
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  callId: string,
) => Promise<ToolOutcome>;

export interface TextTurnOptions {
  history: TurnMessage[];
  userText: string;
  tools: FunctionTool[];
  callModel: ModelCaller;
  execute: ToolExecutor;
  /** How many rounds of tool calls before the model is asked to answer in words. */
  maxRounds?: number;
  /** How much history to send. Older turns are dropped, newest kept. */
  historyLimit?: number;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * One text turn: model, tools, model again, until it answers in words.
 * The model never sees a tool it was not given, and a tool that throws
 * becomes a plain error string the model can explain rather than a crash.
 */
export async function runTextTurn(
  options: TextTurnOptions,
): Promise<TurnResult> {
  const maxRounds = options.maxRounds ?? 4;
  const history = options.history.slice(-(options.historyLimit ?? 30));
  const input: ResponseInputItem[] = [
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user" as const, content: options.userText },
  ];
  const toolEvents: ToolEvent[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const turn = await options.callModel(input, options.tools);
    if (turn.functionCalls.length === 0) {
      return { text: turn.text, toolEvents };
    }
    if (turn.replay) input.push(...turn.replay);
    for (const call of turn.functionCalls) {
      const args = parseArgs(call.arguments);
      let outcome: ToolOutcome;
      try {
        outcome = await options.execute(call.name, args, call.callId);
      } catch (error) {
        outcome = {
          speech:
            `Error: ${error instanceof Error ? error.message : String(error)}`.slice(
              0,
              400,
            ),
        };
      }
      toolEvents.push({ name: call.name, args, outcome });
      if (!turn.replay)
        input.push({
          type: "function_call",
          call_id: call.callId,
          name: call.name,
          arguments: call.arguments,
        });
      input.push({
        type: "function_call_output",
        call_id: call.callId,
        output: outcome.speech,
      });
    }
  }

  // Out of rounds: ask for words only.
  const final = await options.callModel(input, []);
  return {
    text: final.text || "I have put what I found on screen.",
    toolEvents,
  };
}
