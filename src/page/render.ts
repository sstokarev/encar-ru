/**
 * DOM rendering of the calc page result (U4).
 *
 * Same money semantics as the widget's breakdown (src/ui/breakdown.ts): rows
 * come straight from computeQuote (src/calc/pricing.ts — the tariff engine's
 * lines, with the price row split into car + Korean costs, the tariff-rounding
 * row and the commission row added), an undeterminable line keeps its label and
 * shows an em dash with its reason, the total renders with its precision
 * prefix ("≈"/"от") or as "расчёт по запросу", and every provenance caveat
 * (embedded config, preliminary/rejected rate, rate date) is spelled out.
 * All text lands via textContent — nothing user- or API-supplied is parsed
 * as HTML.
 */

import {
  isUnknownLine,
  UNKNOWN_DASH,
  type AllInResult,
  type CostLine,
} from "../calc/customs";
import type { LoadedConfig } from "../config";
import type { ResolvedRates } from "../rates/cbr";
import type { CarData } from "../encar/types";
import type { FuelType } from "../calc/customs";
import { formatAmountRub, formatRub } from "../ui/badge";
import { EXACT_MAP } from "../translate/dictionary";
import { buildDraftLink } from "./tg-link";

/** Everything one render needs; assembled by main.ts. */
export interface PageModel {
  car: CarData;
  /** The URL the client pasted, normalized (trimmed) — goes into the draft. */
  lotUrl: string;
  allIn: AllInResult;
  loaded: LoadedConfig;
  rates: ResolvedRates;
  /** True when the data source is the fixture adapter (demo banner). */
  demo: boolean;
}

/** Russian labels of the calculator fuel types. */
const FUEL_RU: Readonly<Record<FuelType, string>> = {
  gasoline: "бензин",
  diesel: "дизель",
  lpg: "газ (LPG)",
  hybrid: "гибрид",
  electric: "электро",
};

/** Rendered instead of a numeric total when the quote needs a manager. */
const ON_REQUEST_TEXT = "расчёт по запросу";

/** Korean spec value -> Russian via the widget's exact dictionary, else raw. */
function ru(value: string): string {
  const key = value.trim();
  // Own-key lookup only: an API value like "constructor" must not resolve
  // into Object.prototype members.
  return Object.hasOwn(EXACT_MAP, key) ? (EXACT_MAP[key] as string) : value;
}

/** "202109" -> "09.2021"; anything else (incl. month 13) is shown as sent. */
function formatYearMonth(yearMonth: string): string {
  const match = /^(\d{4})(\d{2})$/.exec(yearMonth);
  if (match === null) return yearMonth;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[2]}.${match[1]}` : yearMonth;
}

/** Grouped integer with narrow spaces: 48210 -> "48 210". */
function groupInt(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function el(
  doc: Document,
  tag: string,
  attr: string,
  text?: string,
): HTMLElement {
  const node = doc.createElement(tag);
  node.setAttribute(attr, "");
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One photo element that removes itself when the URL refuses to load. */
function photo(doc: Document, url: string, main: boolean): HTMLImageElement {
  const img = doc.createElement("img");
  img.setAttribute(main ? "data-photo-main" : "data-photo-thumb", "");
  // Same referrer discipline as the API fetch and the messenger anchor: the
  // photo host must not learn the Pages origin (and must not get a reason to
  // hotlink-403 the whole gallery into onerror removal).
  img.setAttribute("referrerpolicy", "no-referrer");
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => img.remove());
  return img;
}

function renderPhotos(doc: Document, urls: readonly string[]): HTMLElement {
  const wrap = el(doc, "div", "data-photos");
  urls.forEach((url, index) => wrap.appendChild(photo(doc, url, index === 0)));
  return wrap;
}

/** Spec rows; a null/absent value simply skips its row. */
function renderSpecs(doc: Document, car: CarData, fuel: FuelType | undefined): HTMLElement {
  const list = el(doc, "dl", "data-specs");
  const add = (label: string, value: string | null): void => {
    if (value === null || value.trim() === "") return;
    const dt = doc.createElement("dt");
    dt.textContent = label;
    const dd = doc.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  };
  // yearMonth is the FIRST REGISTRATION month (src/encar/types.ts), which for
  // an export car can lag the manufacture year — the label must not overclaim.
  add("Первая регистрация", formatYearMonth(car.yearMonth));
  add("Пробег", `${groupInt(car.mileageKm)} км`);
  // The client admits 0 for numeric fields; a zero displacement (EV) or zero
  // seat count is "not published", not a spec to print.
  add(
    "Двигатель",
    car.displacementCc !== null && car.displacementCc > 0
      ? `${groupInt(car.displacementCc)} см³`
      : null,
  );
  add("Топливо", fuel !== undefined ? FUEL_RU[fuel] : car.fuelName);
  add("КПП", ru(car.transmissionName));
  add("Цвет", ru(car.colorName));
  add(
    "Мест",
    car.seatCount !== null && car.seatCount > 0 ? String(car.seatCount) : null,
  );
  add("Кузов", ru(car.bodyName));
  add("VIN", car.vin);
  return list;
}

function renderRow(doc: Document, item: CostLine): HTMLElement {
  const row = el(doc, "div", "data-row");
  row.setAttribute("data-item-id", item.id);
  const unknown = isUnknownLine(item);
  if (unknown) row.setAttribute("data-unknown", "");
  const label = el(doc, "span", "data-label", item.label);
  if (item.note !== undefined) {
    label.appendChild(el(doc, "small", "data-line-note", item.note));
  }
  const value = el(
    doc,
    "span",
    "data-value",
    unknown ? UNKNOWN_DASH : formatAmountRub(item.rub),
  );
  row.append(label, value);
  return row;
}

function renderCostTable(doc: Document, allIn: AllInResult): HTMLElement {
  const table = el(doc, "div", "data-cost-table");
  table.setAttribute("data-precision", allIn.precision);
  for (const item of allIn.items) table.appendChild(renderRow(doc, item));
  const total = el(doc, "div", "data-row");
  total.setAttribute("data-row", "total");
  total.append(
    el(doc, "span", "data-label", "Итого в РФ"),
    el(
      doc,
      "span",
      "data-value",
      allIn.precision === "onRequest"
        ? ON_REQUEST_TEXT
        : formatRub(allIn.totalRub, allIn.precision),
    ),
  );
  table.appendChild(total);
  return table;
}

function renderNotes(doc: Document, model: PageModel): HTMLElement {
  const { allIn, loaded, rates } = model;
  const notes = el(doc, "div", "data-notes");
  for (const text of allIn.notes) {
    notes.appendChild(el(doc, "div", "data-calc-note", text));
  }
  if (loaded.source === "embedded") {
    notes.appendChild(
      el(
        doc,
        "div",
        "data-embedded-marker",
        "Показаны встроенные тарифы: актуальная конфигурация не загрузилась.",
      ),
    );
  }
  if (rates.source === "config") {
    notes.appendChild(
      el(
        doc,
        "div",
        "data-preliminary-rate",
        `Курс предварительный (${rates.dateISO}).`,
      ),
    );
  }
  if (rates.rejected === true) {
    notes.appendChild(
      el(
        doc,
        "div",
        "data-rejected-rate",
        "Свежий курс не прошёл проверку — показан последний надёжный.",
      ),
    );
  }
  notes.appendChild(
    el(doc, "div", "data-rate-date", `Курс ЦБ РФ на ${rates.dateISO}.`),
  );
  notes.appendChild(
    el(doc, "div", "data-commission-note", loaded.config.commissionNote),
  );
  return notes;
}

/** The messenger button under the table; label follows the config type. */
function renderMessengerButton(doc: Document, model: PageModel): HTMLElement {
  const { messenger } = model.loaded.config;
  const anchor = doc.createElement("a");
  anchor.setAttribute("data-messenger-button", "");
  anchor.textContent =
    messenger.type === "telegram"
      ? "Написать в Telegram"
      : "Написать в WhatsApp";
  anchor.href = buildDraftLink(
    messenger,
    model.car.title,
    model.lotUrl,
    model.allIn,
  );
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.setAttribute("referrerpolicy", "no-referrer");
  return anchor;
}

/** Replaces the container content with an error card. */
export function renderError(container: HTMLElement, message: string): void {
  const doc = container.ownerDocument;
  container.replaceChildren(el(doc, "div", "data-error", message));
}

/**
 * Replaces the container content with a loading card: on the FIRST submit the
 * container is empty, so a dimming style alone gives the user (and the
 * aria-live region) nothing at all for up to the fetch timeout.
 */
export function renderLoading(container: HTMLElement): void {
  const doc = container.ownerDocument;
  container.replaceChildren(
    el(doc, "div", "data-loading-card", "Загружаю данные автомобиля…"),
  );
}

/**
 * Replaces the container content with the full result: demo banner (fixture
 * source), photos, title, specs, cost table, notes and the messenger button.
 */
export function renderResult(
  container: HTMLElement,
  model: PageModel,
  fuel: FuelType | undefined,
): void {
  const doc = container.ownerDocument;
  const card = el(doc, "article", "data-result");
  if (model.demo) {
    card.appendChild(
      el(
        doc,
        "div",
        "data-demo-banner",
        "Демо-данные: подключение к encar ещё в работе, расчёт показан на примере.",
      ),
    );
  }
  if (model.car.photoUrls.length > 0) {
    card.appendChild(renderPhotos(doc, model.car.photoUrls));
  }
  const title = doc.createElement("h2");
  title.setAttribute("data-title", "");
  title.textContent = model.car.title;
  card.appendChild(title);
  card.appendChild(renderSpecs(doc, model.car, fuel));
  card.appendChild(renderCostTable(doc, model.allIn));
  card.appendChild(renderNotes(doc, model));
  card.appendChild(renderMessengerButton(doc, model));
  container.replaceChildren(card);
}
