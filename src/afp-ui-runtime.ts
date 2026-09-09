import { useEffect } from "react";
import {
  cssProperty,
  cssValue,
  uiStyleSchema,
  type UiStyle,
} from "../shared/afp-ui";

/** One host-owned adapter. It changes presentation only, never events, URLs, form values or permissions. */
export function usePrivateUi(identity: string | null) {
  useEffect(() => {
    if (!identity) return;
    let stopped = false,
      busy = false,
      edits: any[] = [],
      lastObservation = "";
    const sheet = document.createElement("style");
    sheet.dataset.afpPrivateUi = "true";
    document.head.append(sheet);
    const originals = new Map<HTMLElement, string>();
    const restore = () => {
      for (const [el, text] of originals)
        if (
          el.isConnected &&
          el.childNodes.length === 1 &&
          el.firstChild?.nodeType === Node.TEXT_NODE
        )
          el.firstChild.textContent = text;
      originals.clear();
    };
    const apply = () => {
      restore();
      const css: string[] = [];
      for (const edit of edits)
        if (edit.effective) {
          for (const [viewport, variant] of Object.entries(
            edit.body.variants,
          ).sort(([a],[b])=>Number(a!=='all')-Number(b!=='all')) as [string, any][]) {
            const styles = uiStyleSchema.safeParse(variant.styles);
            if (!styles.success) continue;
            const rule = `[data-afp-ui="${edit.targetId}"]{${Object.entries(
              styles.data,
            )
              .map(
                ([k, v]) => `${cssProperty(k)}:${cssValue(k, v!)} !important`,
              )
              .join(";")}}`;
            css.push(
              viewport === "mobile"
                ? `@media(max-width:767px){${rule}}`
                : viewport === "desktop"
                  ? `@media(min-width:768px){${rule}}`
                  : rule,
            );
            if (
              variant.text &&
              (viewport === "all" ||
                (viewport === "mobile") === innerWidth < 768)
            ) {
              document
                .querySelectorAll<HTMLElement>(
                  `[data-afp-ui="${edit.targetId}"]`,
                )
                .forEach((el) => {
                  if (
                    el.childNodes.length === 1 &&
                    el.firstChild?.nodeType === Node.TEXT_NODE
                  ) {
                    if (!originals.has(el))
                      originals.set(el, el.textContent || "");
                    el.firstChild.textContent = variant.text;
                  }
                });
            }
          }
        }
      sheet.textContent = css.join("\n");
    };
    const observe = async () => {
      const seen = new Set<string>();
      const observations = Array.from(
        document.querySelectorAll<HTMLElement>("[data-afp-ui]"),
      )
        .sort(
          (a, b) =>
            Number(edits.some((e) => e.targetId === b.dataset.afpUi)) -
            Number(edits.some((e) => e.targetId === a.dataset.afpUi)),
        )
        .filter((el) => {
          const id = el.dataset.afpUi!;
          if (
            seen.has(id) ||
            (!el.getClientRects().length &&
              !edits.some((e) => e.targetId === id))
          )
            return false;
          seen.add(id);
          return true;
        })
        .slice(0, 40)
        .map((el) => {
          const c = getComputedStyle(el),
            styles: Record<string, unknown> = {};
          for (const key of Object.keys(uiStyleSchema.shape)) {
            let value: unknown = (c as any)[key];
            if (typeof value !== "string") continue;
            if (
              /^-?[\d.]+px$/.test(value) ||
              ["lineHeight", "order", "flexGrow", "flexShrink"].includes(key)
            )
              value = parseFloat(value);
            if (
              uiStyleSchema.shape[key as keyof UiStyle].safeParse(value).success
            )
              styles[key] = value;
          }
          return {
            targetId: el.dataset.afpUi!,
            revision:
              edits.find((e) => e.targetId === el.dataset.afpUi)?.revision ?? 0,
            viewport: innerWidth < 768 ? "mobile" : "desktop",
            visible: c.display !== "none" && c.visibility !== "hidden",
            styles,
          };
        });
      const body = JSON.stringify({ observations });
      if (body === lastObservation) return;
      lastObservation = body;
      await fetch("/api/afp/ui/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch(() => {});
    };
    const refresh = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const r = await fetch("/api/afp/ui", { cache: "no-store" });
        if (stopped) return;
        if (!r.ok) {
          edits = [];
          apply();
          return;
        }
        const data = await r.json();
        if (stopped) return;
        edits = data.edits || [];
        apply();
        await observe();
        window.dispatchEvent(new Event("afp-ui-updated"));
      } catch {
        /* Keep the last valid private presentation during a network outage. */
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 2500);
    const changed = () => void refresh();
    window.addEventListener("afp-ui-refresh", changed);
    window.addEventListener("focus", changed);
    void refresh();
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("afp-ui-refresh", changed);
      window.removeEventListener("focus", changed);
      restore();
      sheet.remove();
    };
  }, [identity]);
}
