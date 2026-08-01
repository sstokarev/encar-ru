/**
 * Emulates Chrome/Google in-browser page translation applied to a DOM subtree.
 *
 * Real browser translation does two things that break naive price scanning:
 *  1. Every translated text chunk is wrapped in nested
 *     `<font style="vertical-align: inherit;">` elements.
 *  2. Korean text is rewritten; the literal price unit 만원 either becomes an
 *     English phrase (" ten thousand won") or disappears entirely, while the
 *     numeric part of the price usually survives verbatim.
 *
 * Elements marked `translate="no"` / `.notranslate` are left untouched,
 * mirroring real browser behavior.
 */
export type TranslationVariant = "english-unit" | "strip-unit";

export function emulateBrowserTranslation(
  root: Element,
  variant: TranslationVariant = "english-unit",
): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") continue;
    if (parent.closest('[translate="no"], .notranslate')) continue;
    if (!node.data.trim()) continue;

    let text = node.data;
    if (variant === "english-unit") {
      text = text.replace(/만\s*원/g, " ten thousand won");
    } else {
      text = text.replace(/만\s*원/g, "");
    }

    const outer = doc.createElement("font");
    outer.setAttribute("style", "vertical-align: inherit;");
    const inner = doc.createElement("font");
    inner.setAttribute("style", "vertical-align: inherit;");
    inner.textContent = text;
    outer.appendChild(inner);
    node.replaceWith(outer);
  }
}
