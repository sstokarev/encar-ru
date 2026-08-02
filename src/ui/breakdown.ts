/**
 * Expandable cost breakdown on the car detail screen (U2, R2).
 *
 * The U1 badge becomes expandable: a tap toggles a Shadow DOM panel listing
 * the lot price, cost items from the importer config and the RUB total, plus
 * the Order button (R5). Tap target is >= 44x44 px. When the embedded
 * fallback config is in use, the panel shows a marker line.
 *
 * U5: the lot is converted with the resolved KRW->RUB rate (mirror -> cache
 * -> config, src/rates/cbr.ts); the rate date is always shown and config-tier
 * rates carry a preliminary-rate marker.
 *
 * U6: rows come from the real all-in calculator (src/calc/customs.ts) — the
 * lot price, config cost items and the computed customs lines. When the lot
 * params are unknown (or the lot is an EV) only known items are listed and
 * the total renders as "расчёт по запросу". Lot params arrive from the caller
 * (DOM extraction is U7).
 *
 * U8: the panel is a self-contained overlay, not an in-flow block — it used
 * to expand inside encar's price box and collide with the site's own
 * controls. Wide viewports get a card anchored to the toggle (position:
 * fixed, clamped inside the viewport); narrow viewports get a bottom sheet.
 * Both have a header with a close button, and close on Esc / outside click.
 *
 * U10 (customer feedback "в вёрстку легло криво"): on a detail screen the
 * widget is one control, not two pills wedged into encar's price line.
 *  - Placement: the host is a block-level row of its own inserted directly
 *    after the block that holds the price (src/ui/badge.ts detailAnchor), so
 *    the site's own tab row below reflows instead of being overlapped.
 *  - Presentation: value and toggle are merged into a single tappable row in
 *    encar's design language — inherited Pretendard, white surface, 8px
 *    radius, hairline border, red accent, chevron affordance. The inline
 *    badge is absorbed (hidden) so exactly one number is on screen.
 */

import { BADGE_ATTR, type PriceCandidate } from "../scan/scanner";
import type { LoadedConfig } from "../config";
import type { ResolvedRates } from "../rates/cbr";
import { computeAllIn, type LotParams } from "../calc/customs";
import { createOrderButton } from "./order-button";
import {
  ENCAR,
  absorbBadge,
  badgeText,
  detailAnchor,
  findWidgetHost,
  insertBlockHost,
  isDegraded,
  markDegraded,
  type BadgeProvenance,
} from "./badge";

/** Marker carried by breakdown host elements (idempotency + tests). */
export const BREAKDOWN_ATTR = "data-encar-ru-breakdown";

const DETAIL_PAGE_RE = /\/cars\/detail\//;

/** True for encar car detail screens (fem SPA route). */
export function isDetailPage(url: string): boolean {
  return DETAIL_PAGE_RE.test(url);
}

/** Lot parameters known to the caller; the price itself comes from the scan. */
export type BreakdownLotDetails = Omit<LotParams, "priceKrw">;

/** User-facing marker rendered instead of a total that needs a manager. */
const ON_REQUEST_TEXT = "расчёт по запросу";

/** Panel title, also its accessible name. */
const PANEL_TITLE = "Цена под ключ в РФ";

/** Caption of the merged control; the value sits next to it. */
const CONTROL_LABEL = "Под ключ в РФ";

/** Below this viewport width the panel renders as a bottom sheet. */
const NARROW_MAX_WIDTH_PX = 599;
const NARROW_QUERY = `(max-width: ${NARROW_MAX_WIDTH_PX}px)`;

/** Control height: comfortably above the 44px minimum tap target. */
const CONTROL_HEIGHT_PX = "52px";

/** Anchored-card geometry (kept in sync with the stylesheet). */
const PANEL_WIDTH_PX = 380;
const VIEWPORT_MARGIN_PX = 12;
const ANCHOR_GAP_PX = 8;

/**
 * Control rows already attached, keyed by the price element they annotate.
 * The row no longer lives inside the price element, so DOM proximity can no
 * longer answer "is this price already annotated?" — and a stale row whose
 * price element the SPA replaced has to be swept, not left showing an old
 * number next to a new car.
 */
const attachedHosts = new WeakMap<Element, HTMLElement>();
const hostPrices = new WeakMap<Element, Element>();

/** Grouped RUB amount without the approximation prefix: "120 000 ₽". */
function formatAmount(value: number): string {
  const grouped = String(Math.round(value)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    " ",
  );
  return `${grouped} ₽`;
}

const BREAKDOWN_STYLE = `
  :host {
    all: initial;
    /* Encar's font (Pretendard) is inherited from the page, never redeclared. */
    font-family: inherit;
    display: block;
  }
  button,
  a {
    font-family: inherit;
  }
  [data-toggle] {
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    width: 100%;
    min-height: ${CONTROL_HEIGHT_PX};
    margin: 0;
    padding: 8px 12px;
    border: 1px solid ${ENCAR.border};
    border-left: 3px solid ${ENCAR.red};
    border-radius: ${ENCAR.radius};
    background: ${ENCAR.surface};
    color: ${ENCAR.text};
    font-size: 14px;
    line-height: 1.35;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  [data-toggle]:hover {
    border-color: #D8D8D8;
    border-left-color: ${ENCAR.red};
  }
  [data-toggle-label] {
    flex: 1 1 auto;
    color: ${ENCAR.muted};
    font-size: 13px;
    font-weight: 500;
  }
  [data-toggle-value] {
    flex: 0 0 auto;
    color: ${ENCAR.red};
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  [data-toggle] [data-degraded] {
    flex: 0 0 auto;
    margin-left: -4px;
    color: ${ENCAR.note};
    font-size: 14px;
    font-style: normal;
  }
  [data-chevron] {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    margin: 0 2px 0 2px;
    border-right: 2px solid ${ENCAR.muted};
    border-bottom: 2px solid ${ENCAR.muted};
    transform: rotate(45deg);
    transition: transform 120ms ease;
  }
  [data-toggle][aria-expanded="true"] [data-chevron] {
    transform: rotate(225deg);
  }
  [data-panel] {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483000;
    box-sizing: border-box;
    width: ${PANEL_WIDTH_PX}px;
    max-width: calc(100vw - ${VIEWPORT_MARGIN_PX * 2}px);
    max-height: calc(100vh - ${VIEWPORT_MARGIN_PX * 2}px);
    overflow-y: auto;
    padding: 16px;
    border: 1px solid ${ENCAR.border};
    border-radius: ${ENCAR.radius};
    background: ${ENCAR.surface};
    color: ${ENCAR.text};
    font-family: inherit;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.5;
    text-align: left;
    white-space: normal;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  }
  [data-panel][hidden] {
    display: none;
  }
  [data-header] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: -6px -8px 6px 0;
  }
  [data-title] {
    font-size: 15px;
    font-weight: 700;
  }
  [data-close] {
    flex: none;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border: none;
    border-radius: ${ENCAR.radius};
    background: transparent;
    color: ${ENCAR.muted};
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  [data-row] {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 0;
    border-top: 1px solid ${ENCAR.separator};
  }
  [data-row]:first-child {
    border-top: none;
  }
  [data-label] {
    color: ${ENCAR.muted};
  }
  [data-value] {
    flex: none;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  [data-row="total"] {
    margin-top: 4px;
    border-top: 1px solid ${ENCAR.border};
    padding-top: 11px;
    font-size: 15px;
    font-weight: 700;
  }
  [data-row="total"] [data-label] {
    color: ${ENCAR.text};
  }
  [data-row="total"] [data-value] {
    color: ${ENCAR.red};
  }
  [data-notes] {
    margin-top: 10px;
  }
  [data-embedded-marker],
  [data-approx-reason],
  [data-calc-note],
  [data-rejected-rate],
  [data-preliminary-rate] {
    margin-top: 4px;
    color: ${ENCAR.warn};
    font-size: 12px;
    line-height: 1.4;
  }
  [data-note],
  [data-rate-date] {
    margin-top: 4px;
    color: ${ENCAR.note};
    font-size: 12px;
    line-height: 1.4;
  }
  [data-order-button] {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-height: 50px;
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: ${ENCAR.radius};
    background: ${ENCAR.red};
    color: ${ENCAR.surface};
    font-size: 15px;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
  }
  @media (max-width: ${NARROW_MAX_WIDTH_PX}px) {
    /* Bottom sheet: full width, rounded top corners, safe-area padding. */
    [data-panel] {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-width: none;
      max-height: 80vh;
      border-width: 1px 0 0 0;
      border-radius: 16px 16px 0 0;
      padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      box-shadow: 0 -8px 36px rgba(0, 0, 0, 0.24);
    }
  }
`;

function appendRow(
  doc: Document,
  rows: HTMLElement,
  id: string,
  label: string,
  value: string,
): void {
  const row = doc.createElement("div");
  row.setAttribute("data-row", id === "total" ? "total" : "item");
  row.setAttribute("data-item-id", id);
  const labelEl = doc.createElement("span");
  labelEl.setAttribute("data-label", "");
  labelEl.textContent = label;
  const valueEl = doc.createElement("span");
  valueEl.setAttribute("data-value", "");
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  rows.appendChild(row);
}

/** True when the panel should render as a bottom sheet (narrow viewport). */
function isNarrowViewport(win: Window | null): boolean {
  return win?.matchMedia?.(NARROW_QUERY).matches === true;
}

/**
 * Anchors the open panel next to its toggle, clamped inside the viewport.
 * The bottom-sheet variant is positioned by the stylesheet, so the inline
 * coordinates are cleared there (inline styles would outrank the media query).
 */
function positionPanel(
  panel: HTMLElement,
  toggle: HTMLElement,
  win: Window | null,
): void {
  if (win === null || isNarrowViewport(win)) {
    panel.style.left = "";
    panel.style.top = "";
    return;
  }
  const rect = toggle.getBoundingClientRect();
  const width = Math.min(PANEL_WIDTH_PX, win.innerWidth - VIEWPORT_MARGIN_PX * 2);
  const maxLeft = win.innerWidth - width - VIEWPORT_MARGIN_PX;
  const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.left, maxLeft));

  const height = panel.offsetHeight;
  const below = rect.bottom + ANCHOR_GAP_PX;
  const maxTop = win.innerHeight - height - VIEWPORT_MARGIN_PX;
  // Flip above the toggle when the card would not fit below it.
  const top =
    below <= maxTop ? below : Math.max(VIEWPORT_MARGIN_PX, rect.top - height - ANCHOR_GAP_PX);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

/**
 * Removes control rows whose price element is gone (SPA re-render): the row
 * outlives its price now that it is a sibling of the price block, and a row
 * left behind would headline the previous car's total.
 */
function dropStaleHosts(scope: ParentNode): void {
  for (const node of Array.from(scope.querySelectorAll(`[${BREAKDOWN_ATTR}]`))) {
    const price = hostPrices.get(node);
    if (price === undefined || !price.isConnected) node.remove();
  }
}

/**
 * Renders the detail-page control for a price candidate: one tappable row
 * showing the all-in RUB total, expanding into the cost breakdown overlay.
 * Idempotent per price element.
 */
export function attachBreakdown(
  candidate: PriceCandidate,
  loaded: LoadedConfig,
  rates: ResolvedRates,
  lot: BreakdownLotDetails = {},
): void {
  const el = candidate.element;
  const attached = attachedHosts.get(el);
  if (attached !== undefined && attached.isConnected) return;

  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const { config, source } = loaded;
  const result = computeAllIn(
    { priceKrw: candidate.krw, ...lot },
    rates,
    config,
  );
  const provenance: BadgeProvenance = {
    configSource: source,
    ratesSource: rates.source,
  };

  const host = doc.createElement("div");
  host.setAttribute(BREAKDOWN_ATTR, "");
  host.setAttribute("translate", "no");
  host.className = "notranslate";

  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = BREAKDOWN_STYLE;

  // One control, not two: caption, the all-in total (the very string the
  // badge renders) and a chevron saying it expands.
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.setAttribute("data-toggle", "");
  toggle.setAttribute("aria-expanded", "false");
  // Inline duplicates of the stylesheet minimums keep the tap target
  // verifiable (and immune to host-page style leaks through the shadow host).
  // They outrank the stylesheet, so they carry the control's real height.
  toggle.style.minWidth = "44px";
  toggle.style.minHeight = CONTROL_HEIGHT_PX;

  const caption = doc.createElement("span");
  caption.setAttribute("data-toggle-label", "");
  caption.textContent = CONTROL_LABEL;
  const value = doc.createElement("span");
  value.setAttribute("data-toggle-value", "");
  value.textContent = badgeText(result);
  toggle.append(caption, value);
  // P1: the same degraded marker the listing badge carries, so a preliminary
  // number never looks like a fresh one.
  if (isDegraded(provenance)) {
    toggle.appendChild(markDegraded(doc, toggle, provenance));
  }
  const chevron = doc.createElement("span");
  chevron.setAttribute("data-chevron", "");
  chevron.setAttribute("aria-hidden", "true");
  toggle.appendChild(chevron);

  const panel = doc.createElement("div");
  panel.setAttribute("data-panel", "");
  panel.setAttribute("data-precision", result.precision);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", PANEL_TITLE);
  panel.hidden = true;

  const header = doc.createElement("div");
  header.setAttribute("data-header", "");
  const title = doc.createElement("span");
  title.setAttribute("data-title", "");
  title.textContent = PANEL_TITLE;
  const close = doc.createElement("button");
  close.type = "button";
  close.setAttribute("data-close", "");
  close.setAttribute("aria-label", "Закрыть");
  close.textContent = "×";
  close.style.minWidth = "44px";
  close.style.minHeight = "44px";
  header.append(title, close);
  panel.appendChild(header);

  const rows = doc.createElement("div");
  rows.setAttribute("data-rows", "");
  panel.appendChild(rows);

  for (const item of result.items) {
    appendRow(doc, rows, item.id, item.label, formatAmount(item.rub));
  }
  // Under "onRequest" the customs lines are missing, so a numeric total
  // would be a lie — render the honest marker instead (U6 plan decision).
  // "approx" totals (partially estimated params, U7) carry the "≈" prefix.
  appendRow(
    doc,
    rows,
    "total",
    "Итого в РФ",
    result.precision === "onRequest"
      ? ON_REQUEST_TEXT
      : result.precision === "approx"
        ? `≈ ${formatAmount(result.totalRub)}`
        : formatAmount(result.totalRub),
  );

  const notes = doc.createElement("div");
  notes.setAttribute("data-notes", "");
  panel.appendChild(notes);

  if (result.precision === "approx") {
    // U7/AE1: the user must see WHY the total is approximate.
    const reason = doc.createElement("div");
    reason.setAttribute("data-approx-reason", "");
    reason.textContent = "Приблизительно: не все данные лота видны";
    notes.appendChild(reason);
  }

  // Calculator-supplied caveats (age near a duty boundary, unhandled cost
  // item): ready-to-print Russian strings, one line each.
  for (const text of result.notes) {
    const calcNote = doc.createElement("div");
    calcNote.setAttribute("data-calc-note", "");
    calcNote.textContent = text;
    notes.appendChild(calcNote);
  }

  if (source === "embedded") {
    const marker = doc.createElement("div");
    marker.setAttribute("data-embedded-marker", "");
    marker.textContent =
      "Показаны встроенные тарифы: актуальная конфигурация не загрузилась.";
    notes.appendChild(marker);
  }

  // Config-tier rates (mirror and cache both unavailable) are preliminary:
  // same marker pattern as the embedded-config line above (U5, KTD2).
  if (rates.source === "config") {
    const preliminary = doc.createElement("div");
    preliminary.setAttribute("data-preliminary-rate", "");
    preliminary.textContent = `Курс предварительный (${rates.dateISO}).`;
    notes.appendChild(preliminary);
  }

  // A live response that failed the plausibility check is a different story
  // from an unreachable mirror: the rate shown is older than today's, and the
  // customer should know that rather than read a stale date as fresh.
  if (rates.rejected === true) {
    const stale = doc.createElement("div");
    stale.setAttribute("data-rejected-rate", "");
    stale.textContent =
      "Свежий курс не прошёл проверку — показан последний надёжный.";
    notes.appendChild(stale);
  }

  // The rate date is always visible, whatever tier resolved it (R9, KTD2).
  const rateDate = doc.createElement("div");
  rateDate.setAttribute("data-rate-date", "");
  rateDate.textContent = `Курс ЦБ РФ на ${rates.dateISO}.`;
  notes.appendChild(rateDate);

  const note = doc.createElement("div");
  note.setAttribute("data-note", "");
  note.textContent = config.commissionNote;
  notes.appendChild(note);

  panel.appendChild(createOrderButton(doc, config.messenger));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") setOpen(false);
  };
  // Clicks inside the shadow tree are retargeted to the host element, so
  // "outside" is simply "not this host".
  const onOutsideClick = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && host.contains(target)) return;
    setOpen(false);
  };
  const reposition = (): void => positionPanel(panel, toggle, win);

  const bindDismiss = (bound: boolean): void => {
    if (win === null) return;
    if (bound) {
      win.addEventListener("keydown", onKeyDown, true);
      win.addEventListener("click", onOutsideClick, true);
      win.addEventListener("resize", reposition);
      win.addEventListener("scroll", reposition, true);
      return;
    }
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("click", onOutsideClick, true);
    win.removeEventListener("resize", reposition);
    win.removeEventListener("scroll", reposition, true);
  };

  function setOpen(open: boolean): void {
    if (!panel.hidden === open) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    // Dismissal listeners only live while the panel is open. The click that
    // opens the panel has already passed the capture phase, so it cannot
    // immediately close it again.
    bindDismiss(open);
    if (open) reposition();
  }

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.hidden);
  });
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(false);
  });

  // The inline badge (attached before us, U1) is absorbed: the control above
  // renders the same number, and two of them side by side is exactly the
  // clutter the customer rejected. It stays a tap target for the panel.
  const badge = findWidgetHost(el, BADGE_ATTR);
  if (badge instanceof HTMLElement) {
    absorbBadge(badge);
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(panel.hidden);
    });
  }

  shadow.append(style, toggle, panel);
  const anchor = detailAnchor(el);
  dropStaleHosts(anchor.parentNode ?? doc);
  insertBlockHost(anchor, host);
  attachedHosts.set(el, host);
  hostPrices.set(host, el);
}
