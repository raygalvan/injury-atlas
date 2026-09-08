import { AiError } from "./error";
/**
 * OpenAI behind the provider boundary.
 *
 * Two capabilities: minting a short-lived Realtime client secret so a browser
 * can open a speech-to-speech session without ever seeing the API key, and a
 * text turn through the Responses API with function tools. Plain HTTP on
 * purpose: the surface stays visible and there is nothing to upgrade.
 *
 * Credentials come from the environment today. When per-firm credential
 * storage lands, `resolveOpenAiConfig` is the one function to change.
 */

import { credentialFor, effectiveSettings } from "./settings";
import type { Store } from "../store";
const REALTIME_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";
const RESPONSES_URL = "https://api.openai.com/v1/responses";

export interface OpenAiConfig {
  apiKey: string;
  realtimeModel: string;
  realtimeVoice: string;
  textModel: string;
  transcriptionLanguage: string;
}

export function openAiConfigFromEnv(): OpenAiConfig | null {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return {
    apiKey,
    realtimeModel: (process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime").trim(),
    realtimeVoice: (process.env.OPENAI_REALTIME_VOICE ?? "marin").trim(),
    textModel: (process.env.OPENAI_TEXT_MODEL ?? "gpt-5").trim(),
    transcriptionLanguage: (
      process.env.OPENAI_TRANSCRIPTION_LANGUAGE ?? "en"
    ).trim(),
  };
}

/** Per-firm resolution seam. Environment only for now. */
export async function resolveOpenAiConfig(
  db: Store,
  firmId: string,
): Promise<OpenAiConfig | null> {
  const apiKey = credentialFor(db, firmId, "openai");
  const settings = effectiveSettings(db, firmId);
  if (!settings.voice.enabled || !settings.agents.coordinator.enabled)
    return null;
  if (!apiKey) return null;
  return {
    apiKey,
    realtimeModel: settings.voice.model,
    realtimeVoice: settings.voice.voice,
    textModel: process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-5",
    transcriptionLanguage: settings.voice.language,
  };
}

export interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export class ProviderUnavailableError extends Error {
  readonly unavailable = true;
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export interface RealtimeClientSecret {
  clientSecret: string;
  expiresAt: string | null;
  model: string;
}

/**
 * Mint a client secret scoped to one session's instructions and tools.
 * Barge-in starts off: detected speech never cancels the agent mid-sentence,
 * so speaker echo cannot make it interrupt itself. The browser can flip it.
 */
export async function mintRealtimeClientSecret(
  config: OpenAiConfig,
  session: { instructions: string; tools: FunctionTool[] },
): Promise<RealtimeClientSecret> {
  const response = await fetch(REALTIME_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: config.realtimeModel,
        instructions: session.instructions,
        tools: session.tools,
        audio: {
          input: {
            transcription: {
              model: "whisper-1",
              language: config.transcriptionLanguage,
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.6,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
              create_response: true,
              interrupt_response: false,
            },
          },
          output: { voice: config.realtimeVoice },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    value?: string;
    expires_at?: string;
    client_secret?: { value?: string; expires_at?: string };
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new AiError(
      `Live voice could not start (OpenAI ${response.status}). Check the selected voice model and credential in Settings.`,
    );
  }
  const clientSecret = body.value ?? body.client_secret?.value;
  if (!clientSecret)
    throw new AiError(
      "Live voice could not start: no client secret was returned",
    );
  return {
    clientSecret,
    expiresAt: body.expires_at ?? body.client_secret?.expires_at ?? null,
    model: config.realtimeModel,
  };
}

export type ResponseInputItem =
  | { role: "user" | "assistant" | "system" | "developer"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface ModelFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ModelTurn {
  id: string;
  text: string;
  functionCalls: ModelFunctionCall[];
  replay?: ResponseInputItem[];
}

/** One request to the Responses API. The caller owns the tool loop. */
export async function createModelTurn(
  config: OpenAiConfig,
  request: {
    instructions: string;
    input: ResponseInputItem[];
    tools: FunctionTool[];
  },
): Promise<ModelTurn> {
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.textModel,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools,
      tool_choice: "auto",
      store: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    output?: Array<{
      type: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new AiError(
      `The assistant could not respond: ${(body.error?.message ?? `OpenAI returned ${response.status}`).slice(0, 300)}`,
    );
  }
  const output = body.output ?? [];
  const text = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter(
      (part) => part.type === "output_text" && typeof part.text === "string",
    )
    .map((part) => part.text as string)
    .join("")
    .trim();
  const functionCalls = output
    .filter(
      (item) => item.type === "function_call" && item.call_id && item.name,
    )
    .map((item) => ({
      callId: item.call_id as string,
      name: item.name as string,
      arguments: item.arguments ?? "{}",
    }));
  return { id: body.id ?? "", text, functionCalls };
}
