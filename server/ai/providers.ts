import { AiError } from "./error";
import { agentConfig, reserveRun } from "./settings";
import type { Provider as AiProviderId, AgentId } from "../../shared/ai";
import type { Store } from "../store";
import type { FunctionTool, ModelTurn, ResponseInputItem } from "./openai";

export interface ProviderConfig {
  provider: AiProviderId;
  model: string;
  apiKey: string;
}
export interface SourceCitation {
  title: string;
  url: string;
}
export interface GeneratedWork {
  text: string;
  sources: SourceCitation[];
  requestId: string;
}
const endpoints = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  xai: "https://api.x.ai/v1",
};
export const providerNames = {
  openai: "OpenAI",
  anthropic: "Claude",
  xai: "Grok",
};
function headers(
  config: Pick<ProviderConfig, "provider" | "apiKey">,
): Record<string, string> {
  return config.provider === "anthropic"
    ? {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      }
    : {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      };
}
export async function request(
  config: ProviderConfig,
  path: string,
  body: unknown,
): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(`${endpoints[config.provider]}${path}`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new AiError(
      `${providerNames[config.provider]} did not respond in time. Your work was saved; you can retry it.`,
    );
  }
  if (!response.ok) {
    const reason =
      response.status === 401 || response.status === 403
        ? "Check the API key and model access."
        : response.status === 429
          ? "Check usage limits and available credit."
          : response.status === 400
            ? "Check the model ID and whether it supports the requested tools."
            : "Try again after checking the provider status.";
    throw new AiError(
      `${providerNames[config.provider]} returned ${response.status}. ${reason}`,
    );
  }
  return response.json();
}
export async function validateProviderKey(
  provider: AiProviderId,
  apiKey: string,
): Promise<void> {
  const response = await fetch(`${endpoints[provider]}/models`, {
    headers: headers({ provider, apiKey }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new AiError(
      `${providerNames[provider]} did not accept this key (${response.status}). Check the key and account access.`,
    );
}
export async function selectProvider(
  db: Store,
  firmId: string,
  userId: string,
  agentId: AgentId = "coordinator",
): Promise<ProviderConfig> {
  const config = agentConfig(db, firmId, agentId);
  reserveRun(db, { id: userId, firm_id: firmId }, agentId, config);
  return config;
}
/** Translate the application-owned tool transcript into Anthropic messages. */
export function anthropicMessages(
  input: ResponseInputItem[],
): Array<{ role: "user" | "assistant"; content: any[] }> {
  const messages: Array<{ role: "user" | "assistant"; content: any[] }> = [];
  const add = (role: "user" | "assistant", block: any) => {
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const item of input) {
    if ("role" in item)
      add(item.role === "assistant" ? "assistant" : "user", {
        type: "text",
        text: item.content,
      });
    else if (item.type === "function_call")
      add("assistant", {
        type: "tool_use",
        id: item.call_id,
        name: item.name,
        input: JSON.parse(item.arguments),
      });
    else
      add("user", {
        type: "tool_result",
        tool_use_id: item.call_id,
        content: item.output,
      });
  }
  return messages;
}
export async function createProviderTurn(
  config: ProviderConfig,
  params: {
    instructions: string;
    input: ResponseInputItem[];
    tools: FunctionTool[];
  },
): Promise<ModelTurn> {
  if (config.provider === "anthropic") {
    const body = await request(config, "/messages", {
      model: config.model,
      max_tokens: 6000,
      system: params.instructions,
      messages: anthropicMessages(params.input),
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    });
    if (body.stop_reason === "max_tokens")
      throw new AiError(
        "The model reached its response limit. Shorten the request and try again.",
      );
    return {
      id: body.id ?? "",
      text: (body.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n"),
      functionCalls: (body.content ?? [])
        .filter((c: any) => c.type === "tool_use")
        .map((c: any) => ({
          callId: c.id,
          name: c.name,
          arguments: JSON.stringify(c.input),
        })),
    };
  }
  const body = await request(config, "/responses", {
    model: config.model,
    instructions: params.instructions,
    input: params.input,
    tools: params.tools.map((t) => ({ ...t, strict: false })),
    tool_choice: "auto",
    store: false,
    ...(config.provider === "openai"
      ? { include: ["reasoning.encrypted_content"] }
      : {}),
    max_output_tokens: 10000,
  });
  if (body.status === "incomplete")
    throw new AiError(
      "The model could not complete this response. Shorten the request and try again.",
    );
  const output = body.output ?? [];
  return {
    id: body.id ?? "",
    replay: output,
    text: output
      .filter((c: any) => c.type === "message")
      .flatMap((c: any) => c.content ?? [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("\n"),
    functionCalls: output
      .filter((c: any) => c.type === "function_call")
      .map((c: any) => ({
        callId: c.call_id,
        name: c.name,
        arguments: c.arguments,
      })),
  };
}
function citations(items: any[]): SourceCitation[] {
  const found = new Map<string, SourceCitation>();
  const visit = (value: any): void => {
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string" && /^https?:\/\//.test(value.url)) {
      try {
        const url = new URL(value.url);
        if (!url.username && !url.password)
          found.set(value.url, {
            url: value.url,
            title: String(value.title ?? value.url),
          });
      } catch {}
    }
    for (const child of Object.values(value))
      if (typeof child === "object")
        Array.isArray(child) ? child.forEach(visit) : visit(child);
  };
  items.forEach(visit);
  return [...found.values()].slice(0, 40);
}
export async function generateWork(
  config: ProviderConfig,
  params: { instructions: string; input: string; webSearch?: boolean },
): Promise<GeneratedWork> {
  if (config.provider === "anthropic") {
    const messages: any[] = [{ role: "user", content: params.input }];
    let body: any;
    for (let turn = 0; turn < 3; turn++) {
      body = await request(config, "/messages", {
        model: config.model,
        max_tokens: 12000,
        system: params.instructions,
        messages,
        ...(params.webSearch
          ? {
              tools: [
                {
                  type: "web_search_20250305",
                  name: "web_search",
                  max_uses: 5,
                },
              ],
            }
          : {}),
      });
      if (body.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: body.content });
    }
    if (body.stop_reason === "max_tokens" || body.stop_reason === "pause_turn")
      throw new AiError(
        "The research response reached its limit. Narrow the assignment and retry.",
      );
    return {
      text: (body.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n\n"),
      sources: citations(body.content ?? []),
      requestId: body.id ?? "",
    };
  }
  const body = await request(config, "/responses", {
    model: config.model,
    instructions: params.instructions,
    input: params.input,
    store: false,
    max_output_tokens: 16000,
    ...(params.webSearch
      ? {
          tools: [{ type: "web_search" }],
          ...(config.provider === "openai"
            ? { include: ["web_search_call.action.sources"] }
            : {}),
        }
      : {}),
  });
  if (body.status === "incomplete")
    throw new AiError(
      "The document exceeded the response limit. Narrow the assignment and retry.",
    );
  const output = body.output ?? [];
  return {
    text: output
      .filter((c: any) => c.type === "message")
      .flatMap((c: any) => c.content ?? [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("\n\n"),
    sources: citations(output),
    requestId: body.id ?? "",
  };
}
