import { z } from "zod";
export const recipeSchema = z
  .object({
    kind: z.enum(["abrasion", "subarachnoid", "fracture"]),
    parentId: z.string().regex(/^FJ\d+$/),
    center: z.tuple([
      z.number().finite().min(-2).max(2),
      z.number().finite().min(-2).max(3),
      z.number().finite().min(-2).max(2),
    ]),
    normal: z
      .tuple([
        z.number().finite().min(-1).max(1),
        z.number().finite().min(-1).max(1),
        z.number().finite().min(-1).max(1),
      ])
      .refine((v) => Math.hypot(...v) > 0.9 && Math.hypot(...v) < 1.1),
    widthMm: z.number().positive().max(250),
    heightMm: z.number().positive().max(250),
    depthMm: z.number().min(0).max(10),
  })
  .refine((r) => (r.kind === "abrasion" ? r.depthMm === 0 : r.depthMm > 0));
