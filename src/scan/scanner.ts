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
 *
 * Lease and rent lots are rejected outright: encar renders them with the
 * MONTHLY instalment in the very same .prc element, marked by
 * <em class="txt_month">월</em> / <em class="txt_leaserent">리스</em> and a
 * <span class="remain">/N개월</span> tail. Reading 66만원/month as the lot
 * price would headline an all-in total roughly 30x below reality — the worst
 * thing this widget can do (R3: never a confident wrong number).
 *
 * Scanning is incremental: `scanPrices(doc, roots)` walks only the given
 * subtrees (the MutationObserver's added nodes), so a listing that mutates
 * constantly is not re-walked end to end on every batch.
 */

export interface PriceCandidate {
  /** Element the badge should be attached to (and marked as annotated). */
  element: Element;
  /** Absolute price in KRW. */
  krw: number;
}

/**
 * Marker set on annotated price elements (idempotency). Its VALUE is the KRW
 * amount the attached badge was computed from — an SPA that rewrites a price
 * in place keeps the same element, so the marker alone cannot tell "already
 * done" from "done for the car that used to be here" (see refreshStale).
 */
export const ANNOTATED_ATTR = "data-encar-ru";
/** Marker carried by badge host elements. */
export const BADGE_ATTR = "data-encar-ru-badge";

const MANWON_PER_KRW = 10_000;

/**
 * Known encar price-element selectors:
 *  - [data-intl-currency-amount] — fem.encar.com car detail (exact KRW amount)
 *  - .prc / .prc_hs             — www.encar.com search listing price cells
 */
export const PRICE_ELEMENT_SELECTOR =
  "[data-intl-currency-amount], .prc, .prc_hs";

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

/**
 * The KRW price an already-found price element currently shows. Exported for
 * the staleness check: it must read the price exactly the way the scan did,
 * otherwise every rescan would "detect" a change and rebuild every badge.
 */
export function readPriceKrw(el: Element): number | null {
  return priceFromElement(el);
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
 * Classes encar puts on the lease/rent decorations of a monthly instalment:
 * "월" (per month), the 리스/렌트 tag and the "/N개월" remainder.
 */
const LEASE_ELEMENT_SELECTOR = ".txt_month, .txt_leaserent, .remain";
/** Lease/rent wording, for markup that carries no known class. */
const LEASE_TEXT_RE = /개월|리스|렌트/;
/**
 * Longest sibling text still read as part of the price group. Lease markers
 * are tiny ("월", "리스", "/24개월"); a long sibling is body copy of the row
 * (e.g. the seller note "1인장기렌트 이력" on a perfectly normal sale lot,
 * which is exactly why the row as a whole is NOT a lease signal).
 */
const LEASE_SIBLING_MAX_LENGTH = 40;

/**
 * True when the price group of `el` marks the amount as a monthly lease/rent
 * instalment rather than the lot price. Scope is the price element and its
 * immediate siblings — the container encar renders the instalment in.
 */
function hasLeaseSignal(el: Element): boolean {
  if (el.matches(LEASE_ELEMENT_SELECTOR)) return true;
  if (el.querySelector(LEASE_ELEMENT_SELECTOR) !== null) return true;
  if (LEASE_TEXT_RE.test(el.textContent ?? "")) return true;

  const parent = el.parentElement;
  if (parent === null) return false;
  for (const node of [...parent.childNodes]) {
    if (node === el) continue;
    if (node.nodeType === 3) {
      if (LEASE_TEXT_RE.test((node as Text).data)) return true;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const sibling = node as Element;
    if (sibling.matches(LEASE_ELEMENT_SELECTOR)) return true;
    if (sibling.querySelector(LEASE_ELEMENT_SELECTOR) !== null) return true;
    const text = (sibling.textContent ?? "").trim();
    if (text.length <= LEASE_SIBLING_MAX_LENGTH && LEASE_TEXT_RE.test(text)) {
      return true;
    }
  }
  return false;
}

/** Roots of a scan: the given subtrees, or the whole document body. */
function resolveRoots(
  doc: Document,
  roots: readonly Element[] | undefined,
): Element[] {
  if (roots !== undefined) return roots.filter((root) => root.isConnected);
  const body: Element | null = doc.body ?? doc.documentElement;
  return body === null ? [] : [body];
}

/**
 * Scans for KRW price sites. Pure: does not mutate the DOM.
 *
 * `roots` limits the walk to the given subtrees (the added nodes of a
 * mutation batch); omit it for a full-document scan. The zero-candidate
 * diagnostic is a full-scan concern only, and fires only when the document
 * carries no annotated price at all — on a healthy page every later pass
 * legitimately finds nothing new, so warning there would bury the one signal
 * it exists for: encar changing its price markup.
 */
export function scanPrices(
  doc: Document,
  roots?: readonly Element[],
): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  // Two WeakSets instead of a linear scan over the chosen elements: `chosen`
  // answers "is an ancestor of el already taken" via a bounded parent walk,
  // `chosenAncestors` answers "does el contain something already taken".
  const chosen = new WeakSet<Element>();
  const chosenAncestors = new WeakSet<Element>();

  const covered = (el: Element): boolean => {
    if (chosen.has(el) || chosenAncestors.has(el)) return true;
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      if (chosen.has(node)) return true;
    }
    return false;
  };

  const push = (el: Element, krw: number): void => {
    chosen.add(el);
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      chosenAncestors.add(node);
    }
    candidates.push({ element: el, krw });
  };

  const scanRoots = resolveRoots(doc, roots);

  // Pass 1: known price-element selectors.
  for (const root of scanRoots) {
    const elements: Element[] = [];
    if (root.matches(PRICE_ELEMENT_SELECTOR)) elements.push(root);
    elements.push(...root.querySelectorAll(PRICE_ELEMENT_SELECTOR));
    for (const el of elements) {
      if (NON_CONTENT_TAGS.has(el.tagName)) continue;
      if (isAlreadyHandled(el)) continue;
      // Innermost element wins: td.prc_hs contains strong.prc for the same price.
      if (el.querySelector(PRICE_ELEMENT_SELECTOR) !== null) continue;
      if (covered(el)) continue;
      // Monthly lease/rent instalment, not a lot price.
      if (hasLeaseSignal(el)) continue;
      const krw = priceFromElement(el);
      if (krw === null) continue;
      push(el, krw);
    }
  }

  // Pass 2: regex fallback over text nodes (unknown markup).
  for (const root of scanRoots) {
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
      if (hasLeaseSignal(target)) continue;
      const krw = parsePriceText(target.textContent ?? "");
      if (krw === null) continue;
      push(target, krw);
    }
  }

  if (
    roots === undefined &&
    candidates.length === 0 &&
    doc.body &&
    doc.querySelector(`[${ANNOTATED_ATTR}]`) === null
  ) {
    // Diagnostic distinguishing selector breakage from a page that simply
    // carries no prices. Cumulative: an annotated document is a working one.
    console.warn("[encar-ru] no prices found");
  }

  return candidates;
}
