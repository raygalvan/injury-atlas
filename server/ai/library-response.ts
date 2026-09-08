import { request, type ProviderConfig } from "./providers";

const MAX_CALLS = 6;
const MAX_TOKENS = 16384;
const STAGE_TIMEOUT = 180000;
export const OUTPUT_LIMIT_ERROR =
  "Medical research exceeded its expanded response budget. Your injury name is saved. Retry research; no additional medical details are needed.";
export const PAUSE_LIMIT_ERROR =
  "Medical research did not finish after its continuation budget. Your injury name is saved. Retry research; no additional medical details are needed.";

/** Complete a library stage without accepting truncated prose or losing citations.
 * Keep retries within the worker's eight-minute watchdog (two three-minute stages).
 * Restart truncated Responses output; replay only complete Claude pause_turn blocks.
 */
export async function libraryResponse(
  config: ProviderConfig,
  body: Record<string, any>,
  send = request,
  now = Date.now,
  limits = { maxTokens: MAX_TOKENS, maxCalls: MAX_CALLS, timeoutMs: STAGE_TIMEOUT },
) {
  const anthropic = config.provider === "anthropic";
  const tokenKey = anthropic ? "max_tokens" : "max_output_tokens";
  let budget = Math.min(limits.maxTokens, Math.max(2048, Number(body[tokenKey]) || 2048));
  const messages = [...(body.messages || [])];
  const retained: any[] = [];
  const deadline = now() + limits.timeoutMs;
  let reason = "pause_turn";
  for (let attempt = 0; attempt < limits.maxCalls; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0)
      throw new Error(
        "Medical research reached its time budget. Your injury name is saved. Retry research; no additional medical details are needed.",
      );
    const response = await send(
      config,
      anthropic ? "/messages" : "/responses",
      {
        ...body,
        [tokenKey]: budget,
        ...(anthropic ? { messages: [...messages] } : {}),
      },
      remaining,
    );
    reason = anthropic ? response.stop_reason : response.incomplete_details?.reason;
    if (anthropic && reason === "pause_turn") {
      // Preserve server tool results and provider-attached citations unchanged.
      messages.push({ role: "assistant", content: response.content });
      retained.push(...(response.content || []));
      continue;
    }
    if (
      reason === "max_tokens" ||
      (!anthropic && response.status === "incomplete" && reason === "max_output_tokens")
    ) {
      if (budget >= limits.maxTokens) throw new Error(OUTPUT_LIMIT_ERROR);
      budget = Math.min(limits.maxTokens, budget * 2);
      // Do not append a cut-off tool call/JSON fragment. Retry the last complete context.
      continue;
    }
    if (anthropic && reason !== "end_turn")
      throw new Error(
        "The medical research provider stopped before completing the definition. Your request is saved; retry research or check the selected model.",
      );
    if (!anthropic && response.status !== "completed")
      throw new Error(
        "The medical research provider did not complete the definition. Your request is saved; retry research or check the selected model.",
      );
    return anthropic
      ? { ...response, content: [...retained, ...(response.content || [])] }
      : response;
  }
  throw new Error(reason === "pause_turn" ? PAUSE_LIMIT_ERROR : OUTPUT_LIMIT_ERROR);
}
