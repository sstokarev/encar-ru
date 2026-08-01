/**
 * Debounced MutationObserver that re-runs the scan when new content is added
 * to the page (covers AE3: dynamically loaded lots get badges).
 *
 * Mutations caused purely by our own badge insertions are ignored to avoid
 * pointless rescans (the scan itself is idempotent either way).
 */

import { BADGE_ATTR } from "./scanner";

const DEFAULT_DEBOUNCE_MS = 100;

function isOwnBadgeNode(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).hasAttribute(BADGE_ATTR);
}

export function observeDom(
  target: Node,
  onChange: () => void,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) =>
      Array.from(record.addedNodes).some((node) => !isOwnBadgeNode(node)),
    );
    if (!relevant) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  });

  observer.observe(target, { childList: true, subtree: true });
  return observer;
}
