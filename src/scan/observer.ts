/**
 * Debounced MutationObserver that re-runs the scan when new content is added
 * to the page (covers AE3: dynamically loaded lots get badges).
 *
 * Two properties matter on encar, whose listings mutate constantly:
 *  - the widget's own DOM is invisible to it. Badges, breakdown controls,
 *    shared widget hosts and the translation hint are all skipped, so our own
 *    writes can never trigger a rescan (or a rescan loop);
 *  - the listener receives the ROOTS of the batch — the added subtrees — so
 *    the scan can walk those instead of the whole document again.
 */

import { BADGE_ATTR } from "./scanner";
import { WIDGET_HOST_ATTR } from "../ui/badge";
import { BREAKDOWN_ATTR } from "../ui/breakdown";
import { HINT_ATTR } from "../translate/apply";

const DEFAULT_DEBOUNCE_MS = 100;

/** Every host this widget owns; nothing inside them is page content. */
const WIDGET_SELECTOR = [
  `[${BADGE_ATTR}]`,
  `[${BREAKDOWN_ATTR}]`,
  `[${WIDGET_HOST_ATTR}]`,
  `[${HINT_ATTR}]`,
].join(", ");

/** True for our own hosts and anything inside them. */
function isOwnWidgetNode(node: Node): boolean {
  const el =
    node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null);
  return el !== null && el.closest(WIDGET_SELECTOR) !== null;
}

/** Subtree to rescan for an added node: the element itself, or its parent. */
function scanRootOf(node: Node): Element | null {
  if (node.nodeType === 1) return node as Element;
  return node.parentElement;
}

export function observeDom(
  target: Node,
  onChange: (roots: Element[]) => void,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Roots accumulate across the whole debounce window, so no batch is lost.
  let pending = new Set<Element>();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (isOwnWidgetNode(node)) continue;
        const root = scanRootOf(node);
        if (root === null || isOwnWidgetNode(root)) continue;
        pending.add(root);
      }
    }
    if (pending.size === 0) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const roots = Array.from(pending);
      pending = new Set<Element>();
      onChange(roots);
    }, debounceMs);
  });

  observer.observe(target, { childList: true, subtree: true });
  return observer;
}
