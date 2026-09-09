import { z } from "zod";
export const WORKFLOW_CONTRACT = "injury.bot.private-workflow/0.1" as const;
export const WORKFLOW_POINT = "private-workspace" as const;
export const WORKFLOW_PERMISSION = "workflow.private.use" as const;
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[<>\x00-\x1f\x7f]/.test(s), "Plain text only");
const key = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export const workflowDefinitionSchema = z
  .strictObject({
    title: text(100),
    description: text(600),
    stages: z
      .array(
        z.strictObject({
          id: key,
          title: text(100),
          items: z
            .array(
              z.strictObject({
                id: key,
                label: text(240),
                required: z.boolean(),
              }),
            )
            .min(1)
            .max(20),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine((d, ctx) => {
    const ids = d.stages.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Stage and item IDs must be unique",
      });
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export const workflowCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("draft"),
    id: z.string().uuid().optional(),
    revision: z.number().int().nonnegative(),
    definition: workflowDefinitionSchema,
  }),
  ...(["activate", "disable", "remove", "rollback"] as const).map((action) =>
    z.strictObject({
      action: z.literal(action),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      version: z.number().int().positive().optional(),
    }),
  ),
]);
export const workflowRunSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    featureId: z.string().uuid(),
    title: text(100),
  }),
  z.strictObject({
    action: z.literal("update"),
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    completed: z.array(key).max(240),
    notes: z
      .string()
      .max(8000)
      .refine((s) => !/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)),
  }),
]);
