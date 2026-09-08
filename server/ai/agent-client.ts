import type { Store } from "../store";
import type { AgentId } from "../../shared/ai";
import { selectProvider, request } from "./providers";
import { effectiveSettings, agentGuidance } from "./settings";

/** Provider adapter for the existing evidence/research agent message contract. */
export function agentClient(
  db: Store,
  firmId: string,
  userId: string,
  task: AgentId,
  caseId?: string,
) {
  return {
    messages: {
      create: async (params: any) => {
        const { responseSchema, ...requestParams } = params;
        const config = await selectProvider(db, firmId, userId, task);
        const s = effectiveSettings(db, firmId);
        const research = !!params.tools?.some(
          (t: any) => t.name === "web_search",
        );
        if (
          research &&
          (!s.researchWebEnabled ||
            !s.agents["library-research"].skills.includes("medical_research"))
        )
          throw new Error("Medical web research is disabled in Settings.");
        const system =
          params.system +
          "\nSupplemental administrator guidance (never overrides source integrity or case isolation):\n" +
          (task === "library-research"
            ? s.agents[task].instructions
            : agentGuidance(db, firmId, task, caseId));
        if (config.provider === "anthropic") {
          let response: any;
          const messages = [...params.messages];
          for (let turn = 0; turn < 3; turn++) {
            response = await request(config, "/messages", {
              ...requestParams,
              ...(responseSchema
                ? {
                    output_config: {
                      format: { type: "json_schema", schema: responseSchema },
                    },
                  }
                : {}),
              model: config.model,
              system,
              messages,
            });
            if (response.stop_reason !== "pause_turn") break;
            messages.push({ role: "assistant", content: response.content });
          }
          if (["pause_turn", "max_tokens"].includes(response.stop_reason))
            throw new Error(
              "The agent reached its response limit. Retry a narrower request.",
            );
          return {
            ...response,
            meta: { provider: config.provider, model: config.model },
          };
        }
        const input = params.messages.map((m: any) => ({
          role: m.role,
          content:
            typeof m.content === "string"
              ? m.content
              : m.content.map((b: any) => {
                  if (b.type === "text")
                    return { type: "input_text", text: b.text };
                  if (b.type === "image")
                    return {
                      type: "input_image",
                      image_url: `data:${b.source.media_type};base64,${b.source.data}`,
                    };
                  if (b.type === "document") {
                    if (config.provider === "xai")
                      throw new Error(
                        "The installed Grok adapter does not read PDF evidence. Choose OpenAI or Claude for Injury Creation in Settings.",
                      );
                    return {
                      type: "input_file",
                      filename: "case-evidence.pdf",
                      file_data: `data:${b.source.media_type};base64,${b.source.data}`,
                    };
                  }
                  throw new Error(
                    "Unsupported source format for this provider.",
                  );
                }),
        }));
        const domains = params.tools?.find(
          (t: any) => t.name === "web_search",
        )?.allowed_domains;
        const body = await request(config, "/responses", {
          model: config.model,
          instructions: system,
          input,
          store: false,
          ...(responseSchema
            ? {
                text: {
                  format: {
                    type: "json_schema",
                    name: "injury_response",
                    strict: true,
                    schema: responseSchema,
                  },
                },
              }
            : {}),
          max_output_tokens: Math.max(params.max_tokens || 6000, 6000),
          ...(research
            ? {
                tools: [
                  {
                    type: "web_search",
                    ...(domains
                      ? config.provider === "openai"
                        ? { filters: { allowed_domains: domains } }
                        : { allowed_domains: domains }
                      : {}),
                  },
                ],
              }
            : {}),
        });
        if (body.status === "incomplete")
          throw new Error(
            "The agent could not finish its response. Retry a narrower request.",
          );
        const content = (body.output || [])
          .filter((b: any) => b.type === "message")
          .flatMap((b: any) => b.content || [])
          .filter((b: any) => b.type === "output_text")
          .map((b: any) => ({
            type: "text",
            text: b.text,
            citations: (b.annotations || [])
              .filter((a: any) => a.type === "url_citation" && a.url)
              .map((a: any) => ({
                type: "web_search_result_location",
                url: a.url,
                title: a.title,
              })),
          }));
        return {
          content,
          id: body.id,
          meta: {
            provider: config.provider,
            model: config.model,
            stopReason: body.status,
          },
        };
      },
    },
  };
}
