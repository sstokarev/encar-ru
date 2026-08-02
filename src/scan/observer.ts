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
 *
 * The pending roots are drained with iteration syntax, never Array.from.
 * www.encar.com loads an ES5 polyfill bundle that REPLACES several built-ins
 * (measured live 2026-08-02: Array.from, Object.keys, Object.values,
 * Array.prototype.find, Array.prototype.filter). Its Array.from copies
 * indices 0..length-1 only, so array-likes still work but iterables do not:
 * `Array.from(new Set(["a"]))` yields `[]` there. Draining the Set that way
 * handed every batch to the scan as ZERO roots — nothing added after
 * activation was ever annotated (paging, filters, infinite scroll), while an
 * explicit rescan() kept working because it passes no roots at all. Globals
 * belong to the host page; spread is syntax and cannot be replaced.
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

/**
 * How often the URL is compared with the previous one. A soft navigation is a
 * user action, so a sub-second lag is invisible; the check itself is a string
 * comparison.
 */
const URL_POLL_MS = 700;

/**
 * Calls back on every client-side navigation (U11).
 *
 * `popstate` and `hashchange` cover the back button and www.encar.com's
 * hash-routed search list, but NEITHER fires for history.pushState — which is
 * how fem.encar.com opens a car screen. Patching History.prototype would catch
 * it, at the price of rewriting a global of a page we do not own (and of
 * breaking whichever other script patched it first), so the remaining case is
 * covered by polling location.href.
 *
 * Returns a stop function; the widget never calls it in the browser (the page
 * outlives the widget), but a test that leaves the timer running would rescan
 * across its neighbours.
 */
export function watchUrl(
  win: Window,
  onChange: (url: string) => void,
  pollMs: number = URL_POLL_MS,
): () => void {
  let current = win.location.href;
  const check = (): void => {
    const next = win.location.href;
    if (next === current) return;
    current = next;
    onChange(next);
  };
  win.addEventListener("popstate", check);
  win.addEventListener("hashchange", check);
  const timer = win.setInterval(check, pollMs);
  return () => {
    win.clearInterval(timer);
    win.removeEventListener("popstate", check);
    win.removeEventListener("hashchange", check);
  };
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
      for (const node of [...record.addedNodes]) {
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
      const roots = [...pending];
      pending = new Set<Element>();
      onChange(roots);
    }, debounceMs);
  });

  observer.observe(target, { childList: true, subtree: true });
  return observer;
}
