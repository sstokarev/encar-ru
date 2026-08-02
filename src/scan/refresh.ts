/**
 * Staleness sweep for annotated prices (U11).
 *
 * Both encar front-ends are single-page apps: www.encar.com routes the search
 * list through the URL hash and fem.encar.com routes car screens client-side.
 * Nothing reloads, so the widget's own markers outlive the content they
 * describe. Two different things can happen to a badged price element:
 *
 *  - it is REPLACED (a new row is rendered) — the scan finds an unannotated
 *    element and badges it; nothing to do here;
 *  - it SURVIVES and only its text changes (React updates the price of the
 *    same node when the user opens another car). The annotation marker still
 *    says "done", so the scan skips it and the client reads the previous car's
 *    total next to the new car's price. That is the failure this module
 *    exists to prevent — a wrong number is worse than no number (R3).
 *
 * The marker carries the KRW amount the badge was computed from
 * (ANNOTATED_ATTR), so the check is a comparison, not a guess.
 *
 * Deliberately conservative: an element whose price no longer parses at all is
 * left alone. A React re-render can empty a node for one frame, and detaching
 * on that would strip badges the page is about to restore — churn that is
 * visible to the client. A price that never comes back keeps a stale badge,
 * which the next real value corrects.
 */

import { ANNOTATED_ATTR, readPriceKrw } from "./scanner";
import { detachBadge } from "../ui/badge";
import { detachBreakdown } from "../ui/breakdown";

/** Every annotated price element in the scope, including the scope itself. */
function annotatedIn(scope: ParentNode): Element[] {
  const found = [...scope.querySelectorAll(`[${ANNOTATED_ATTR}]`)];
  const self = scope as Partial<Element>;
  if (
    typeof self.matches === "function" &&
    (scope as Element).matches(`[${ANNOTATED_ATTR}]`)
  ) {
    found.unshift(scope as Element);
  }
  return found;
}

/**
 * Detaches badges (and detail controls) whose price element now shows a
 * different price. Returns the elements that were reset, so the caller can
 * treat them as fresh candidates.
 */
export function refreshStale(scope: ParentNode): Element[] {
  const reset: Element[] = [];
  for (const el of annotatedIn(scope)) {
    const marked = Number(el.getAttribute(ANNOTATED_ATTR));
    // Pre-U11 badges carry "1": unknown provenance, so they are left as they
    // are rather than rebuilt on every pass.
    if (!Number.isFinite(marked) || marked <= 1) continue;
    const current = readPriceKrw(el);
    if (current === null || current === marked) continue;
    detachBreakdown(el);
    detachBadge(el);
    reset.push(el);
  }
  return reset;
}
