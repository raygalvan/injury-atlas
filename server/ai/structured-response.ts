import { z } from "zod";

/** One contract for prompt, constrained decoding and server validation. */
export function responseSchema(schema: z.ZodType): Record<string, any> {
  const raw = z.toJSONSchema(schema, { io: "input" }) as Record<string, any>;
  const visit = (node: any): any => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const result: Record<string, any> = {};
    const limits: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          "minimum",
          "maximum",
          "exclusiveMinimum",
          "exclusiveMaximum",
          "minLength",
          "maxLength",
          "minItems",
          "maxItems",
        ].includes(key)
      ) {
        limits.push(`${key}: ${value}`);
        continue;
      }
      if (["$schema", "default"].includes(key)) continue;
      result[key] = visit(value);
    }
    if (limits.length)
      result.description = [result.description, ...limits]
        .filter(Boolean)
        .join("; ");
    if (result.type === "object") {
      result.additionalProperties = false;
      result.required = Object.keys(result.properties || {});
    }
    return result;
  };
  return visit(raw);
}
export class ResponseContractError extends Error {
  constructor(
    readonly issues: { path: string; code: string }[],
    readonly attempts: number,
  ) {
    super(
      `The injury agent could not complete its response after ${attempts} automatic attempts (${issues
        .map((i) => i.path + ": " + i.code)
        .join(", ")
        .slice(0, 220)}). Your request is saved; no medical fields are needed.`,
    );
  }
}
export function parseResponse<T>(text: string, schema: z.ZodType<T>): T {
  let value: unknown;
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    value = JSON.parse(clean);
  } catch {
    // Permit a single JSON object surrounded by explanatory prose, without
    // combining separate objects or silently repairing clinical content.
    value = JSON.parse(
      clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1),
    );
  }
  return schema.parse(value);
}
export async function structuredResponse<T>(
  client: any,
  params: any,
  schema: z.ZodType<T>,
  onIssue: (details: any) => void = () => {},
): Promise<T> {
  const contract = responseSchema(schema),
    messages = [...params.messages];
  let issues: { path: string; code: string }[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await client.messages.create({
      ...params,
      responseSchema: contract,
      system:
        params.system +
        "\nThe exact response contract is: " +
        JSON.stringify(contract),
      messages,
    });
    const text = (response.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    try {
      return parseResponse(text, schema);
    } catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof SyntaxError))
        throw error;
      issues =
        error instanceof z.ZodError
          ? error.issues
              .slice(0, 12)
              .map((i) => ({
                path: i.path.join(".") || "response",
                code: i.code,
              }))
          : [
              {
                path: "response",
                code: text ? "invalid_json" : "empty_response",
              },
            ];
      onIssue({
        attempt,
        issues,
        provider: response.meta?.provider || "unknown",
        model: response.meta?.model || params.model,
        responseId: response.id || "",
        stopReason: response.stop_reason || response.meta?.stopReason || "",
      });
      if (attempt === 3) break;
      // Stay in this case and with this provider. The lawyer never supplies repairs.
      if (text)
        messages.push({ role: "assistant", content: text.slice(0, 60000) });
      messages.push({
        role: "user",
        content:
          "Correct your previous response to satisfy the exact JSON contract. Validation failures: " +
          JSON.stringify(issues) +
          ". Re-read the original request and supplied evidence. Return the entire corrected object. Do not invent missing clinical facts. Null is permitted only where the schema says so. General medical explanation and client-specific facts remain separate.",
      });
    }
  }
  throw new ResponseContractError(issues, 3);
}
