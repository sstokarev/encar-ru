/**
 * KRW price scanner for encar.com pages (desktop www + mobile fem).
 *
 * Dual strategy (KTD3 — translation-resilient scanning):
 *  1. Known price-element selectors + numeric parse. Browser translation
 *     rewrites the 만원 unit text but preserves numeric text and data
 *     attributes, so selector-found elements survive translated DOM.
 *  2. Regex fallback over text nodes for pages whose price markup carries no
 *     known selector. Handles both "1,250만원" inside one text node and the
 *     split form <b>1,250</b>만원 (number and unit in sibling nodes).
 *
 * Prices are quoted in 만원 (10,000 KRW): "1,250만원" = 12,500,000 KRW.
 * fem.encar.com exposes the exact KRW amount via data-intl-currency-amount.
 */

export interface PriceCandidate {
  /** Element the badge should be attached to (and marked as annotated). */
  element: Element;
  /** Absolute price in KRW. */
  krw: number;
}

/** Marker set on annotated price elements (idempotency). */
export const ANNOTATED_ATTR = "data-encar-ru";
/** Marker carried by badge host elements. */
export const BADGE_ATTR = "data-encar-ru-badge";

const MANWON_PER_KRW = 10_000;

/**
 * Known encar price-element selectors:
 *  - [data-intl-currency-amount] — fem.encar.com car detail (exact KRW amount)
 *  - .prc / .prc_hs             — www.encar.com search listing price cells
 */
const PRICE_ELEMENT_SELECTOR = "[data-intl-currency-amount], .prc, .prc_hs";

const NON_CONTENT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "COL",
  "COLGROUP",
]);

const NUMBER_RE = /(\d{1,3}(?:,\d{3})+|\d+)/;
const MANWON_TEXT_RE = /(\d{1,3}(?:,\d{3})+|\d+)\s*만\s*원/;
const MANWON_UNIT_RE = /만\s*원/;
const TRAILING_NUMBER_RE = /(\d{1,3}(?:,\d{3})+|\d+)\s*$/;

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/**
 * Parses a 만원-denominated price out of free text.
 * Returns the absolute KRW amount, or null when no price is present.
 * "1,250만원" -> 12_500_000.
 */
export function parsePriceText(text: string): number | null {
  const match = MANWON_TEXT_RE.exec(text.replace(/\s+/g, " "));
  if (!match || match[1] === undefined) return null;
  const manwon = parseNumber(match[1]);
  if (!Number.isFinite(manwon) || manwon <= 0) return null;
  return manwon * MANWON_PER_KRW;
}

function priceFromElement(el: Element): number | null {
  const amountAttr = el.getAttribute("data-intl-currency-amount");
  if (amountAttr !== null) {
    const krw = parseNumber(amountAttr);
    if (Number.isFinite(krw) && krw > 0) return krw;
  }
  // Price elements carry 만원-denominated numbers; the unit text may be
  // rewritten or removed by browser translation, so parse the number alone.
  const text = (el.textContent ?? "").replace(/\s+/g, " ");
  const match = NUMBER_RE.exec(text);
  if (!match || match[1] === undefined) return null;
  const manwon = parseNumber(match[1]);
  if (!Number.isFinite(manwon) || manwon <= 0) return null;
  return manwon * MANWON_PER_KRW;
}

/** True when the element is already annotated, inside a badge, or wraps an annotated node. */
function isAlreadyHandled(el: Element): boolean {
  return (
    el.closest(`[${ANNOTATED_ATTR}]`) !== null ||
    el.closest(`[${BADGE_ATTR}]`) !== null ||
    el.querySelector(`[${ANNOTATED_ATTR}]`) !== null
  );
}

/**
 * Scans the document for KRW price sites. Pure: does not mutate the DOM.
 * Logs the zero-candidate diagnostic when the page has a body but no prices
 * were detected (distinguishes selector breakage from an empty page).
 */
export function scanPrices(doc: Document): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  const chosen: Element[] = [];

  const covered = (el: Element): boolean =>
    chosen.some((c) => c === el || c.contains(el) || el.contains(c));

  const push = (el: Element, krw: number): void => {
    chosen.push(el);
    candidates.push({ element: el, krw });
  };

  // Pass 1: known price-element selectors.
  for (const el of Array.from(doc.querySelectorAll(PRICE_ELEMENT_SELECTOR))) {
    if (NON_CONTENT_TAGS.has(el.tagName)) continue;
    if (isAlreadyHandled(el)) continue;
    // Innermost element wins: td.prc_hs contains strong.prc for the same price.
    if (el.querySelector(PRICE_ELEMENT_SELECTOR) !== null) continue;
    if (covered(el)) continue;
    const krw = priceFromElement(el);
    if (krw === null) continue;
    push(el, krw);
  }

  // Pass 2: regex fallback over text nodes (unknown markup).
  const root: Element | null = doc.body ?? doc.documentElement;
  if (root) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    for (const node of textNodes) {
      const parent = node.parentElement;
      if (!parent || NON_CONTENT_TAGS.has(parent.tagName)) continue;
      if (!MANWON_UNIT_RE.test(node.data)) continue;

      let target: Element | null = null;
      if (MANWON_TEXT_RE.test(node.data)) {
        // Number and unit in the same text node.
        target = parent;
      } else {
        // Unit-only node: the number lives in a preceding sibling
        // (e.g. <strong>1,250</strong>만원) or the parent's preceding
        // sibling (e.g. <span>659</span><span>만원</span>).
        let prev: Node | null = node.previousSibling;
        target = parent;
        if (!prev) {
          prev = parent.previousSibling;
          target = parent.parentElement;
        }
        const prevText = prev?.textContent ?? "";
        if (!TRAILING_NUMBER_RE.test(prevText.replace(/\s+/g, " ").trimEnd())) {
          continue;
        }
      }

      if (!target || covered(target) || isAlreadyHandled(target)) continue;
      const krw = parsePriceText(target.textContent ?? "");
      if (krw === null) continue;
      push(target, krw);
    }
  }

  if (candidates.length === 0 && doc.body) {
    // Diagnostic distinguishing "no prices on the page" / selector breakage
    // from a successful scan. Logged exactly when zero candidates are found.
    console.warn("[encar-ru] no prices found");
  }

  return candidates;
}
