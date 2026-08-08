/**
 * RUB badge rendered in Shadow DOM next to a detected KRW price (KTD5:
 * no frameworks, style isolation via shadow root, DOM text set only through
 * textContent). The host element opts out of browser translation so the
 * badge text is never rewritten.
 *
 * The badge shows the all-in ("под ключ") total computed by
 * src/calc/customs.ts — the same number the breakdown totals (R1). It never
 * shows the bare converted lot price: that figure is not what the client
 * pays. When the lot params do not allow a customs computation the badge
 * says "по запросу" instead of inventing a number (R3, KTD3); when only some
 * cost items are undeterminable the sum is a lower bound and is marked "от".
 *
 * U8: the badge must never disturb the host page layout. Two defenses:
 *  1. Placement — the badge is inserted *after* the price element and the
 *     unit tail that belongs to it ("659" + "만원"), so the site's own price
 *     text is never split and the unit can never be pushed to its own line.
 *  2. Sizing — the host has inherit-based font sizing (0.9em with a px floor)
 *     and its layout is declared inline, because host-page CSS outranks
 *     :host rules.
 *
 * U12 (customer feedback "вёрстка кривоватая"): the RUB price is a LINE OF ITS
 * OWN under the Korean price, not a chip wedged in beside it. Sitting inline it
 * had to share whatever space the row's price cell had left — the gap between
 * the two numbers varied per layout, and in a narrow cell the row grew a second
 * line anyway, in an arbitrary place. As a block-level row directly under the
 * price the spacing is one constant (BADGE_GAP_PX) everywhere, and the badge
 * inherits the price cell's own text alignment, so it lines up with the Korean
 * price in all three encar listing shapes: an inline .prc inside a block .val,
 * a .prc_hs table cell (right-aligned column) and a block .val. The insertion
 * point is unchanged — the price text and its 만원 unit still stay together.
 *
 * U10: the visual language is encar's own — the page font is inherited
 * (Pretendard on encar), the chip is a white surface with a hairline border
 * and the accent is encar's red #D72E36. The badge must read as part of the
 * site, not as a foreign widget pasted on top of it.
 *
 * U10/P1: listing rows show the badge alone — the breakdown (which carries
 * the "embedded config" / "preliminary rate" markers) never renders there.
 * A badge whose number rests on degraded inputs therefore carries its own
 * compact marker: a muted "~" affix plus a Russian title on the host.
 */

import { ANNOTATED_ATTR, BADGE_ATTR, type PriceCandidate } from "../scan/scanner";
import type { AllInResult } from "../calc/customs";
import type { ConfigSource } from "../config";
import type { RatesSource } from "../rates/cbr";

/** Marker shared by every widget host element (badge, breakdown). */
export const WIDGET_HOST_ATTR = "data-encar-ru-host";

/** Marker set on a host whose number rests on degraded inputs (P1). */
export const DEGRADED_ATTR = "data-degraded";

/** Marker set on a badge whose value is presented by the detail control. */
export const ABSORBED_ATTR = "data-encar-ru-absorbed";

/** Muted affix appended to a degraded value. */
export const DEGRADED_MARK = "~";

/** Short user-facing marker shown instead of a total that needs a manager. */
const ON_REQUEST_TEXT = "по запросу";

/** Attribute encar uses for the "만원" unit span on fem detail pages. */
const UNIT_ATTR = "data-intl-currency-unit";

/** Bare 만원 unit node ("659" + "만원" split across siblings). */
const UNIT_TEXT_RE = /^만\s*원$/;

/** Sibling nodes inspected while looking for the unit tail of a price. */
const UNIT_LOOKAHEAD = 4;

/**
 * Encar's own design tokens, measured on fem.encar.com. Everything the widget
 * draws uses these and nothing else, so the overlay reads as part of the page.
 */
export const ENCAR = {
  /** Primary brand red: buttons and the price accent. */
  red: "#D72E36",
  /** Body text. */
  text: "#181818",
  /** Secondary/label text. */
  muted: "#767676",
  /** Note text. */
  note: "#8A8A8A",
  /** Card and control borders. */
  border: "#E5E5E5",
  /** Row separators inside cards. */
  separator: "#F0F0F0",
  /** Card surface. */
  surface: "#FFFFFF",
  /** Warning-tinted marker text (degraded data). */
  warn: "#A05A00",
  /** Card/control corner radius. */
  radius: "8px",
} as const;

/**
 * The chip is styled on a wrapper so the value keeps a text node of its own:
 * the first <span> of the shadow tree is the rendered total and nothing else
 * (the widget's own contract — the breakdown, the tests and the scan-time
 * regression checks all read it that way). The degraded affix therefore lives
 * in a sibling element, never inside the value.
 */
const BADGE_STYLE = `
  :host {
    all: initial;
    /* Encar's font (Pretendard) is inherited from the page, never redeclared. */
    font-family: inherit;
    display: block;
    white-space: nowrap;
    /* Follows the price cell's own alignment (right in the table column). */
    text-align: inherit;
  }
  [data-chip] {
    display: inline-block;
    margin: 0;
    padding: 0.1em 0.45em;
    border: 1px solid ${ENCAR.border};
    border-radius: 6px;
    background: ${ENCAR.surface};
    color: ${ENCAR.red};
    font-family: inherit;
    /* Inherit-based with a px floor: tiny host fonts must stay legible,
       huge host fonts must not blow the price line apart. */
    font-size: max(11px, 0.9em);
    font-style: normal;
    font-weight: 700;
    line-height: 1.45;
    white-space: nowrap;
    vertical-align: middle;
    font-variant-numeric: tabular-nums;
  }
  [data-value] {
    font: inherit;
    color: inherit;
  }
  [data-degraded] {
    margin-left: 2px;
    color: ${ENCAR.note};
    font-style: normal;
    font-weight: 400;
  }
`;

/** Grouped RUB amount with no precision marker: "12 345 678 ₽". */
export function formatAmountRub(value: number): string {
  const grouped = String(Math.round(value)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    " ",
  );
  return `${grouped} ₽`;
}

/**
 * The marker that tells the customer how to read the number:
 *
 *  - ""    exact — every cost item is computed from data;
 *  - "≈ "  approx — complete, but some inputs were estimated, so the real
 *          figure can land on either side of it;
 *  - "от " partial — some cost items are not determinable yet and are not in
 *          the sum, so the number is a lower bound and can only grow. "≈"
 *          would be a lie here: it promises the price might also come out
 *          lower, and it cannot.
 */
export function precisionPrefix(precision: BadgePrecision): string {
  if (precision === "exact") return "";
  return precision === "partial" ? "от " : "≈ ";
}

/**
 * Formats a RUB amount with the marker its precision earns (R3):
 * "12 345 678 ₽", "≈ 12 345 678 ₽" or "от 12 345 678 ₽".
 */
export function formatRub(
  value: number,
  precision: BadgePrecision = "approx",
): string {
  return `${precisionPrefix(precision)}${formatAmountRub(value)}`;
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

/**
 * Removes the badge attached to a price element and clears its annotation
 * marker, so the next scan treats the price as new (U11). Used when the page
 * rewrites a price in place — the element survives a soft navigation, the
 * number on it does not.
 *
 * Both places a host can sit are swept: inside the price element, and in the
 * sibling chain that follows the price tail (see insertWidgetHost).
 */
export function detachBadge(price: Element): void {
  price.removeAttribute(ANNOTATED_ATTR);
  for (const inside of [...price.querySelectorAll(`[${WIDGET_HOST_ATTR}]`)]) {
    inside.remove();
  }
  let node: ChildNode | null = priceTail(price).nextSibling;
  while (node !== null && isElement(node) && node.hasAttribute(WIDGET_HOST_ATTR)) {
    const next: ChildNode | null = node.nextSibling;
    node.remove();
    node = next;
  }
}

/** Constant gap between the Korean price and the RUB line under it (U12). */
export const BADGE_GAP_PX = 4;

/**
 * Layout guards for the listing badge: a line of its own directly under the
 * price, with one constant gap everywhere (U12). Declared inline because
 * host-page CSS outranks the shadow's own :host rules.
 *
 * `vertical-align` is still set: the host may be laid out as a table-cell's
 * block child or, on a legacy row, as an inline-level box, and leaving the
 * property to the page produced a half-line wobble between rows.
 */
export function applyHostLayoutGuards(host: HTMLElement): void {
  host.style.display = "block";
  host.style.whiteSpace = "nowrap";
  host.style.verticalAlign = "baseline";
  host.style.margin = `${BADGE_GAP_PX}px 0 0`;
  host.style.float = "none";
  // The badge follows the price column's alignment instead of imposing one:
  // right-aligned price cells keep their right edge, left-aligned cards stay
  // left. Only a block-level row can do this — an inline chip sat wherever the
  // price text happened to end.
  host.style.textAlign = "inherit";
}

/**
 * Inline layout guards for a block-level widget row (detail pages, U10):
 * a full-width band of its own, so the host page reflows around it instead of
 * being overlapped. Declared inline for the same reason as the inline guards.
 */
export function applyBlockHostGuards(host: HTMLElement): void {
  host.style.display = "block";
  host.style.width = "100%";
  host.style.boxSizing = "border-box";
  host.style.margin = "10px 0 12px";
  host.style.whiteSpace = "normal";
  host.style.textAlign = "left";
  host.style.verticalAlign = "baseline";
  host.style.float = "none";
  host.style.clear = "both";
}

/** Ancestors climbed while looking for the price's own block. */
const MAX_ANCHOR_HOPS = 4;

/**
 * Text budget of an anchor candidate: the block that holds the price carries
 * the price and little else. Anything wordier is a layout column, and hanging
 * our row off it would move the widget away from the price it annotates.
 */
const MAX_ANCHOR_TEXT_LENGTH = 160;

function displayOf(el: Element, win: Window | null): string {
  try {
    return win?.getComputedStyle(el).display ?? "";
  } catch {
    return "";
  }
}

/**
 * The element our detail row is inserted after: the price's own block.
 *
 * Climbs out of inline wrappers (the price number is a <span> inside a <p>)
 * and out of flex/grid parents — a block inserted as a flex item would become
 * a column next to the price instead of a row under it. Stops at the first
 * block-in-flow ancestor, at BODY, or as soon as the candidate carries more
 * than the price line's worth of text.
 */
export function detailAnchor(price: Element): Element {
  const win = price.ownerDocument.defaultView;
  let anchor: Element = price;
  for (let hop = 0; hop < MAX_ANCHOR_HOPS; hop++) {
    const parent = anchor.parentElement;
    if (parent === null) break;
    if (parent.tagName === "BODY" || parent.tagName === "HTML") break;
    const own = displayOf(anchor, win);
    const isInlineSelf = own === "" || own.startsWith("inline") || own === "contents";
    const outer = displayOf(parent, win);
    const isPackedParent = outer.includes("flex") || outer.includes("grid");
    if (!isInlineSelf && !isPackedParent) break;
    if ((parent.textContent ?? "").trim().length > MAX_ANCHOR_TEXT_LENGTH) break;
    anchor = parent;
  }
  return anchor;
}

/** Inserts a block-level widget host as the row right after `anchor`. */
export function insertBlockHost(anchor: Element, host: HTMLElement): void {
  host.setAttribute(WIDGET_HOST_ATTR, "");
  applyBlockHostGuards(host);
  const parent = anchor.parentNode;
  if (parent === null) {
    anchor.appendChild(host);
    return;
  }
  // detailAnchor climbs out of flex/grid parents, but it stops early when the
  // parent carries too much text to be the price's own block. In that corner
  // the host is a flex item: a full basis makes it take a line of its own
  // wherever the container wraps (and is ignored in block containers).
  const outer = anchor.parentElement;
  if (outer !== null) {
    const display = displayOf(outer, anchor.ownerDocument.defaultView);
    if (display.includes("flex") || display.includes("grid")) {
      host.style.flexBasis = "100%";
    }
  }
  parent.insertBefore(host, anchor.nextSibling);
}

/**
 * Hides the inline badge because the detail control now renders its value.
 * The host stays in the DOM: it is the annotation marker of the price element
 * and the machine-readable copy of the number (display:none costs no layout).
 */
export function absorbBadge(badge: HTMLElement): void {
  badge.setAttribute(ABSORBED_ATTR, "");
  badge.style.display = "none";
}

/**
 * Precision values the presentation renders. Declared as a superset of the
 * calculator's own Precision so the UI compiles both before and after the
 * calculator learns to report a partial sum; once "partial" is part of
 * Precision the union collapses onto it.
 */
export type BadgePrecision = AllInResult["precision"] | "partial";

/** All-in figures the badge renders; the shape computeQuote() returns. */
export interface BadgeTotal {
  totalRub: number;
  precision: BadgePrecision;
}

/**
 * Where the numbers behind a rendered value come from (P1). Optional
 * everywhere: a caller that does not know stays silent rather than claiming
 * the data is fresh.
 */
export interface BadgeProvenance {
  configSource: ConfigSource;
  ratesSource: RatesSource;
}

/**
 * True when the value rests on degraded inputs: tariffs from the embedded
 * fallback config, or an FX rate that is not today's CBR quote (cache tier,
 * or the config tier used after a rejected/unavailable rate).
 */
export function isDegraded(provenance?: BadgeProvenance): boolean {
  if (provenance === undefined) return false;
  return provenance.configSource === "embedded" || provenance.ratesSource !== "cbr";
}

/** Russian explanation of why a value is marked, for the title attribute. */
export function degradedTitle(provenance: BadgeProvenance): string {
  const reasons: string[] = [];
  if (provenance.configSource === "embedded") {
    reasons.push("используются встроенные тарифы, актуальные не загрузились");
  }
  if (provenance.ratesSource === "cache") {
    reasons.push("курс взят из ранее сохранённого значения");
  } else if (provenance.ratesSource === "config") {
    reasons.push("курс предварительный, получить курс ЦБ РФ не удалось");
  }
  return `Предварительный расчёт: ${reasons.join("; ")}. Точную сумму уточните у менеджера.`;
}

/**
 * Marks a widget element as degraded: the muted "~" affix plus the Russian
 * explanation on hover/long-press. Returns the affix element so the caller can
 * place it (the value element must stay a pure number, see BADGE_STYLE).
 */
export function markDegraded(
  doc: Document,
  host: HTMLElement,
  provenance: BadgeProvenance,
): HTMLElement {
  host.setAttribute(DEGRADED_ATTR, "");
  host.setAttribute("title", degradedTitle(provenance));
  const mark = doc.createElement("i");
  mark.setAttribute(DEGRADED_ATTR, "");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = DEGRADED_MARK;
  return mark;
}

/**
 * Badge text for an all-in result: "1 701 437 ₽" when exact, "≈ 1 701 437 ₽"
 * when computed from estimated params, "от 1 701 437 ₽" when the sum is
 * partial (some cost items are not determinable yet, so it is a lower bound),
 * and the honest "по запросу" when nothing can be quoted at all — an
 * "onRequest" total covers known items only, so rendering it would understate
 * the price (U6/U7, R3).
 *
 * A non-finite total can only be an upstream bug (the calculator refuses to
 * produce one), and "≈ NaN ₽" is the worst thing a price badge can say: it is
 * rendered as the honest marker instead. Belt and braces on purpose — this is
 * the last code that touches the number before the client reads it.
 */
export function badgeText(allIn: BadgeTotal): string {
  if (allIn.precision === "onRequest" || !Number.isFinite(allIn.totalRub)) {
    return ON_REQUEST_TEXT;
  }
  return formatRub(allIn.totalRub, allIn.precision);
}

/**
 * Marks the price element as annotated and inserts a Shadow DOM badge with
 * the all-in RUB total. Idempotent: a second call for the same element is a
 * no-op thanks to the data-attribute marker. Only exact precision drops the
 * "≈" marker (U7, R3): listings and degraded cards keep it.
 *
 * `provenance` is optional: when given and degraded, the badge carries the
 * muted "~" affix and a Russian title explaining it (P1).
 */
export function attachBadge(
  candidate: PriceCandidate,
  allIn: BadgeTotal,
  provenance?: BadgeProvenance,
): void {
  const el = candidate.element;
  if (el.hasAttribute(ANNOTATED_ATTR)) return;
  // The marker carries the price it was computed from, so a later pass can
  // tell an untouched badge from one left over by a previous car (U11).
  el.setAttribute(ANNOTATED_ATTR, String(candidate.krw));

  const doc = el.ownerDocument;
  const host = doc.createElement("span");
  host.setAttribute(BADGE_ATTR, "");
  host.setAttribute("translate", "no");
  host.className = "notranslate";
  applyHostLayoutGuards(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = BADGE_STYLE;

  const chip = doc.createElement("b");
  chip.setAttribute("data-chip", "");
  const label = doc.createElement("span");
  label.setAttribute("data-value", "");
  label.textContent = badgeText(allIn);
  chip.appendChild(label);
  if (provenance !== undefined && isDegraded(provenance)) {
    chip.appendChild(markDegraded(doc, host, provenance));
  }
  shadow.append(style, chip);

  insertWidgetHost(el, host);
}
