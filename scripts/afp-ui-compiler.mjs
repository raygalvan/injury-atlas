import ts from "typescript";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build-time instrumentation, never user-generated source or executable code.
// Only static source labels/classes enter the catalogue, never rendered client data.
export function instrumentUi(source, file) {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const targets = [],
    occurrences = new Map();
  const excluded = /(?:Login|portal-entry|AfpUiEditor|afp-ui-runtime)/i.test(
    file,
  );
  const result = ts.transform(sf, [
    (context) => (root) => {
      const visit = (node) => {
        if (
          !excluded &&
          (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
        ) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node;
          const tag = opening.tagName.getText(sf);
          const attrs = opening.attributes.properties;
          const literal = (name) => {
            const a = attrs.find(
              (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === name,
            );
            return a?.initializer && ts.isStringLiteral(a.initializer)
              ? a.initializer.text
              : "";
          };
          const children = ts.isJsxElement(node) ? node.children : [];
          const leafText =
            children.length && children.every(ts.isJsxText)
              ? children
                  .map((c) => c.text)
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim()
              : "";
          const className = literal("className"),
            label = literal("aria-label") || leafText;
          if (
            /^(button|a|div|section|header|footer|nav|aside|main|h[1-6]|ul|ol|li|input|textarea|select|label|form|p|span|img|table|thead|tbody|tr|th|td|details|summary|iframe)$/.test(
              tag,
            ) &&
            !literal("data-afp-protected")
          ) {
            const signature = `${file}:${tag}:${className}:${label}:${literal("href")}`;
            const ordinal = occurrences.get(signature) || 0;
            occurrences.set(signature, ordinal + 1);
            const id =
              "ui-" +
              createHash("sha256")
                .update(signature + ":" + ordinal)
                .digest("hex")
                .slice(0, 20);
            targets.push({
              id,
              file,
              tag,
              label: label.slice(0, 160),
              className,
              textEditable: !!leafText && /^(button|a|h[1-6])$/.test(tag),
            });
            const attributes = ts.factory.updateJsxAttributes(
              opening.attributes,
              [
                ...attrs,
                ts.factory.createJsxAttribute(
                  ts.factory.createIdentifier("data-afp-ui"),
                  ts.factory.createStringLiteral(id),
                ),
              ],
            );
            node = ts.isJsxElement(node)
              ? ts.factory.updateJsxElement(
                  node,
                  ts.factory.updateJsxOpeningElement(
                    opening,
                    opening.tagName,
                    opening.typeArguments,
                    attributes,
                  ),
                  node.children,
                  node.closingElement,
                )
              : ts.factory.updateJsxSelfClosingElement(
                  node,
                  node.tagName,
                  node.typeArguments,
                  attributes,
                );
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit);
    },
  ]);
  const code = ts.createPrinter().printFile(result.transformed[0]);
  result.dispose();
  return { code, targets };
}
export function catalogue(root = process.cwd()) {
  const walk = (dir) =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(`${dir}/${e.name}`)
        : e.name.endsWith(".tsx")
          ? [`${dir}/${e.name}`]
          : [],
    );
  return walk("src")
    .sort()
    .flatMap(
      (file) =>
        instrumentUi(readFileSync(path.join(root, file), "utf8"), file).targets,
    );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  writeFileSync(
    "shared/afp-ui-catalog.json",
    JSON.stringify(catalogue(), null, 2) + "\n",
  );
}
