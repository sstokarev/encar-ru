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
 */

import { BADGE_ATTR, type PriceCandidate } from "../scan/scanner";
import type { LoadedConfig } from "../config";
import type { ResolvedRates } from "../rates/cbr";
import { computeAllIn, type LotParams } from "../calc/customs";
import { createOrderButton } from "./order-button";

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
    display: inline-block;
    vertical-align: middle;
  }
  button {
    min-width: 44px;
    min-height: 44px;
    margin-left: 0.35em;
    padding: 0 0.6em;
    border: none;
    border-radius: 0.6em;
    background: #1a6b3c;
    color: #ffffff;
    font: 600 13px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
  }
  [data-panel] {
    position: relative;
    z-index: 2147483000;
    box-sizing: border-box;
    max-width: 320px;
    margin-top: 6px;
    padding: 12px;
    border-radius: 10px;
    background: #ffffff;
    color: #17181a;
    font: 400 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25);
  }
  [data-row] {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0;
  }
  [data-row="total"] {
    margin-top: 4px;
    border-top: 1px solid #d7d9dd;
    padding-top: 6px;
    font-weight: 700;
  }
  [data-embedded-marker],
  [data-approx-reason],
  [data-preliminary-rate] {
    margin-top: 6px;
    color: #a05a00;
    font-size: 12px;
  }
  [data-note],
  [data-rate-date] {
    margin-top: 6px;
    color: #6b6f76;
    font-size: 12px;
  }
  [data-order-button] {
    display: block;
    box-sizing: border-box;
    min-height: 44px;
    margin-top: 10px;
    padding: 12px;
    border-radius: 8px;
    background: #1a6b3c;
    color: #ffffff;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
  }
`;

function appendRow(
  doc: Document,
  panel: HTMLElement,
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
  panel.appendChild(row);
}

/**
 * Makes the badge of a detail-page price candidate expandable: appends a
 * breakdown host (toggle + panel in Shadow DOM) next to the badge and wires
 * the badge itself as an additional tap target. Idempotent per element.
 */
export function attachBreakdown(
  candidate: PriceCandidate,
  loaded: LoadedConfig,
  rates: ResolvedRates,
  lot: BreakdownLotDetails = {},
): void {
  const el = candidate.element;
  if (el.querySelector(`[${BREAKDOWN_ATTR}]`) !== null) return;

  const doc = el.ownerDocument;
  const { config, source } = loaded;
  const result = computeAllIn(
    { priceKrw: candidate.krw, ...lot },
    rates,
    config,
  );

  const host = doc.createElement("span");
  host.setAttribute(BREAKDOWN_ATTR, "");
  host.setAttribute("translate", "no");
  host.className = "notranslate";

  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = BREAKDOWN_STYLE;

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Расчёт";
  toggle.setAttribute("aria-expanded", "false");
  // Inline duplicates of the stylesheet minimums keep the >=44px tap target
  // verifiable (and immune to host-page style leaks through the shadow host).
  toggle.style.minWidth = "44px";
  toggle.style.minHeight = "44px";

  const panel = doc.createElement("div");
  panel.setAttribute("data-panel", "");
  panel.setAttribute("data-precision", result.precision);
  panel.hidden = true;

  for (const item of result.items) {
    appendRow(doc, panel, item.id, item.label, formatAmount(item.rub));
  }
  // Under "onRequest" the customs lines are missing, so a numeric total
  // would be a lie — render the honest marker instead (U6 plan decision).
  // "approx" totals (partially estimated params, U7) carry the "≈" prefix.
  appendRow(
    doc,
    panel,
    "total",
    "Итого в РФ",
    result.precision === "onRequest"
      ? ON_REQUEST_TEXT
      : result.precision === "approx"
        ? `≈ ${formatAmount(result.totalRub)}`
        : formatAmount(result.totalRub),
  );

  if (result.precision === "approx") {
    // U7/AE1: the user must see WHY the total is approximate.
    const reason = doc.createElement("div");
    reason.setAttribute("data-approx-reason", "");
    reason.textContent = "Приблизительно: не все данные лота видны";
    panel.appendChild(reason);
  }

  if (source === "embedded") {
    const marker = doc.createElement("div");
    marker.setAttribute("data-embedded-marker", "");
    marker.textContent =
      "Показаны встроенные тарифы: актуальная конфигурация не загрузилась.";
    panel.appendChild(marker);
  }

  // Config-tier rates (mirror and cache both unavailable) are preliminary:
  // same marker pattern as the embedded-config line above (U5, KTD2).
  if (rates.source === "config") {
    const preliminary = doc.createElement("div");
    preliminary.setAttribute("data-preliminary-rate", "");
    preliminary.textContent = `Курс предварительный (${rates.dateISO}).`;
    panel.appendChild(preliminary);
  }

  // The rate date is always visible, whatever tier resolved it (R9, KTD2).
  const rateDate = doc.createElement("div");
  rateDate.setAttribute("data-rate-date", "");
  rateDate.textContent = `Курс ЦБ РФ на ${rates.dateISO}.`;
  panel.appendChild(rateDate);

  const note = doc.createElement("div");
  note.setAttribute("data-note", "");
  note.textContent = config.commissionNote;
  panel.appendChild(note);

  panel.appendChild(createOrderButton(doc, config.messenger));

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.hidden);
  });

  // The U1 badge itself is also a tap target for expanding (R2).
  const badge = el.querySelector(`[${BADGE_ATTR}]`);
  if (badge !== null) {
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(panel.hidden);
    });
  }

  shadow.append(style, toggle, panel);
  el.appendChild(host);
}
