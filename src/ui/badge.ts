/**
 * RUB badge rendered in Shadow DOM next to a detected KRW price (KTD5:
 * no frameworks, style isolation via shadow root, DOM text set only through
 * textContent). The host element opts out of browser translation so the
 * badge text is never rewritten.
 *
 * U8: the badge must never disturb the host page layout. Two defenses:
 *  1. Placement — the badge is inserted *after* the price element and the
 *     unit tail that belongs to it ("659" + "만원"), so the site's own price
 *     text is never split and the unit can never be pushed to its own line.
 *  2. Sizing — the host is a nowrap inline-block with inherit-based font
 *     sizing (0.9em with a px floor), declared inline so host-page CSS
 *     (which outranks :host rules) cannot turn it into a block.
 */

import { ANNOTATED_ATTR, BADGE_ATTR, type PriceCandidate } from "../scan/scanner";
import type { Precision } from "../calc/customs";

/** Marker shared by every widget host element (badge, breakdown). */
export const WIDGET_HOST_ATTR = "data-encar-ru-host";

/** Attribute encar uses for the "만원" unit span on fem detail pages. */
const UNIT_ATTR = "data-intl-currency-unit";

/** Bare 만원 unit node ("659" + "만원" split across siblings). */
const UNIT_TEXT_RE = /^만\s*원$/;

/** Sibling nodes inspected while looking for the unit tail of a price. */
const UNIT_LOOKAHEAD = 4;

const BADGE_STYLE = `
  :host {
    all: initial;
    display: inline-block;
    white-space: nowrap;
    vertical-align: middle;
  }
  span {
    display: inline-block;
    margin: 0 0 0 0.35em;
    padding: 0.1em 0.5em;
    border-radius: 999px;
    background: #1a6b3c;
    color: #ffffff;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    /* Inherit-based with a px floor: tiny host fonts must stay legible,
       huge host fonts must not blow the price line apart. */
    font-size: max(11px, 0.9em);
    font-weight: 600;
    line-height: 1.45;
    white-space: nowrap;
    vertical-align: middle;
    font-variant-numeric: tabular-nums;
  }
`;

/**
 * Formats a RUB amount as "≈ 12 345 678 ₽" (space-grouped thousands).
 * Pass approx=false to drop the marker for exact-precision values (R3).
 */
export function formatRub(value: number, approx: boolean = true): string {
  const grouped = String(Math.round(value)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    " ",
  );
  return approx ? `≈ ${grouped} ₽` : `${grouped} ₽`;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/**
 * Last node of the host page's own price text: the price element itself, or
 * the trailing 만원 unit node that belongs to it. Nothing may be inserted
 * between the two, otherwise the site's price reads "659 <badge> 만원" and
 * the unit gets pushed onto its own line.
 */
function priceTail(price: Element): ChildNode {
  let tail: ChildNode = price;
  let node: ChildNode | null = price.nextSibling;
  for (let hop = 0; node !== null && hop < UNIT_LOOKAHEAD; hop++) {
    const text = (node.textContent ?? "").trim();
    const isUnit =
      (isElement(node) && node.hasAttribute(UNIT_ATTR)) || UNIT_TEXT_RE.test(text);
    if (isUnit) tail = node;
    // Whitespace-only nodes and our own (text-less) hosts are skipped over;
    // any other real content ends the price group.
    else if (text !== "") break;
    node = node.nextSibling;
  }
  return tail;
}

/** Last node of the price group including widget hosts already inserted. */
function widgetTail(price: Element): ChildNode {
  let tail = priceTail(price);
  let node: ChildNode | null = tail.nextSibling;
  while (node !== null && isElement(node) && node.hasAttribute(WIDGET_HOST_ATTR)) {
    tail = node;
    node = node.nextSibling;
  }
  return tail;
}

/**
 * Inserts a widget host after the price text it annotates: as a sibling when
 * the price has a separate unit node, otherwise appended inside the price
 * element (nothing follows the price text there, so nothing can be split).
 */
export function insertWidgetHost(price: Element, host: Element): void {
  host.setAttribute(WIDGET_HOST_ATTR, "");
  const tail = widgetTail(price);
  const parent = tail.parentNode;
  if (tail === price || parent === null) {
    price.appendChild(host);
    return;
  }
  parent.insertBefore(host, tail.nextSibling);
}

/**
 * Finds a widget host with `attr` already attached to this price element —
 * inside it or in the host chain that follows it. Used for idempotency.
 */
export function findWidgetHost(price: Element, attr: string): Element | null {
  const inside = price.querySelector(`[${attr}]`);
  if (inside !== null) return inside;
  let node: ChildNode | null = priceTail(price).nextSibling;
  while (node !== null && isElement(node) && node.hasAttribute(WIDGET_HOST_ATTR)) {
    if (node.hasAttribute(attr)) return node;
    node = node.nextSibling;
  }
  return null;
}

/** Inline layout guards: host-page CSS outranks :host rules in the shadow. */
export function applyHostLayoutGuards(host: HTMLElement): void {
  host.style.display = "inline-block";
  host.style.whiteSpace = "nowrap";
  host.style.verticalAlign = "middle";
  host.style.float = "none";
}

/**
 * Marks the price element as annotated and inserts a Shadow DOM badge with
 * the converted RUB value. Idempotent: a second call for the same element
 * is a no-op thanks to the data-attribute marker. Only exact precision
 * drops the "≈" marker (U7, R3): listings and degraded cards keep it.
 */
export function attachBadge(
  candidate: PriceCandidate,
  rubPerKrw: number,
  precision: Precision = "approx",
): void {
  const el = candidate.element;
  if (el.hasAttribute(ANNOTATED_ATTR)) return;
  el.setAttribute(ANNOTATED_ATTR, "1");

  const doc = el.ownerDocument;
  const host = doc.createElement("span");
  host.setAttribute(BADGE_ATTR, "");
  host.setAttribute("translate", "no");
  host.className = "notranslate";
  applyHostLayoutGuards(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = BADGE_STYLE;
  const label = doc.createElement("span");
  label.textContent = formatRub(
    candidate.krw * rubPerKrw,
    precision !== "exact",
  );
  shadow.append(style, label);

  insertWidgetHost(el, host);
}
