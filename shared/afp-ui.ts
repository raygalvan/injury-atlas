import { z } from "zod";
export const UI_POINT = "application-presentation" as const;
export const UI_CONTRACT = "injury.bot.application.presentation/0.1" as const;
export const UI_PERMISSION = "ui.presentation.private.write" as const;
export const UI_FEATURE = "private-application-presentation" as const;
const px = z.number().finite().min(0).max(2400);
const spacing = z.number().finite().min(0).max(240);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$|^(transparent|currentColor)$/);
export const uiStyleSchema = z.strictObject({
  paddingTop: spacing.optional(),
  paddingRight: spacing.optional(),
  paddingBottom: spacing.optional(),
  paddingLeft: spacing.optional(),
  marginTop: spacing.optional(),
  marginRight: spacing.optional(),
  marginBottom: spacing.optional(),
  marginLeft: spacing.optional(),
  gap: spacing.optional(),
  rowGap: spacing.optional(),
  columnGap: spacing.optional(),
  width: z.union([px, z.enum(["auto", "100%"])]).optional(),
  height: z.union([px, z.enum(["auto", "100%"])]).optional(),
  minWidth: px.optional(),
  maxWidth: z.union([px, z.literal("100%")]).optional(),
  minHeight: px.optional(),
  maxHeight: px.optional(),
  fontSize: z.number().min(10).max(100).optional(),
  fontWeight: z.enum(["400", "500", "600", "700", "800"]).optional(),
  fontFamily: z
    .enum(["inherit", "sans-serif", "serif", "monospace"])
    .optional(),
  lineHeight: z.number().min(1).max(3).optional(),
  letterSpacing: z.number().min(-2).max(12).optional(),
  textAlign: z.enum(["left", "center", "right", "start", "end"]).optional(),
  color: color.optional(),
  backgroundColor: color.optional(),
  borderColor: color.optional(),
  borderWidth: z.number().min(0).max(16).optional(),
  borderStyle: z.enum(["none", "solid", "dashed", "dotted"]).optional(),
  borderRadius: spacing.optional(),
  display: z
    .enum(["block", "inline-block", "flex", "inline-flex", "grid", "none"])
    .optional(),
  flexDirection: z
    .enum(["row", "column", "row-reverse", "column-reverse"])
    .optional(),
  flexWrap: z.enum(["wrap", "nowrap"]).optional(),
  alignItems: z
    .enum(["start", "end", "center", "stretch", "baseline"])
    .optional(),
  justifyContent: z
    .enum([
      "start",
      "end",
      "center",
      "space-between",
      "space-around",
      "space-evenly",
    ])
    .optional(),
  alignSelf: z.enum(["auto", "start", "end", "center", "stretch"]).optional(),
  flexGrow: z.number().min(0).max(12).optional(),
  flexShrink: z.number().min(0).max(12).optional(),
  order: z.number().int().min(-100).max(100).optional(),
  gridColumns: z.number().int().min(1).max(12).optional(),
});
export type UiStyle = z.infer<typeof uiStyleSchema>;
export const uiTargetId = z.string().regex(/^ui-[a-f0-9]{20}$/);
export const uiCommandSchema = z.strictObject({
  action: z.enum(["set", "undo", "disable", "remove"]),
  targetId: uiTargetId,
  revision: z.number().int().nonnegative(),
  viewport: z.enum(["all", "mobile", "desktop"]).optional(),
  styles: uiStyleSchema.optional(),
  text: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^<>\x00-\x1f\x7f]+$/)
    .optional(),
});
export const uiInspectSchema = z.strictObject({
  query: z.string().max(160).optional(),
  targetId: uiTargetId.optional(),
});
export const uiObservationSchema = z.strictObject({
  observations: z
    .array(
      z.strictObject({
        targetId: uiTargetId,
        revision: z.number().int().nonnegative(),
        viewport: z.enum(["mobile", "desktop"]),
        visible: z.boolean(),
        styles: uiStyleSchema,
      }),
    )
    .max(120),
});
export type UiTarget = {
  id: string;
  file: string;
  tag: string;
  label: string;
  className: string;
  textEditable: boolean;
};
export function cssProperty(key: string) {
  return key === "gridColumns"
    ? "grid-template-columns"
    : key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}
export function cssValue(key: string, value: string | number) {
  if (key === "gridColumns") return `repeat(${value}, minmax(0, 1fr))`;
  return typeof value === "number" &&
    !["lineHeight", "order", "flexGrow", "flexShrink"].includes(key)
    ? `${value}px`
    : String(value);
}
