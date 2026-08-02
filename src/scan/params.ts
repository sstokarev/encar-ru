/**
 * Lot parameter extraction from encar DOM (U7, R3/AE1).
 *
 * Card pages (fem.encar.com detail): parameters are read in priority order
 *  1. hidden SPA state — the inline `__PRELOADED_STATE__` script carries the
 *     exact spec (`displacement`, `fuelName`, `yearMonth`) and survives
 *     browser translation (scripts are never translated);
 *  2. visible spec list — `dt/dd` pairs (연식 / 연료 / 배기량);
 *  3. title heuristic — a "2.2"-style displacement in the model title yields
 *     an ESTIMATED cc (flagged, degrades precision to "approx").
 *
 * Listing rows (www + fem search): only what is visible near the price is
 * used — registration "16/09식" and Korean fuel tokens from the row text,
 * cc estimated from the row title. Listing params are always flagged
 * estimated, so listing badges never claim exact precision (KTD6 alignment:
 * the same row walk works for desktop tables, photo ads and list items).
 *
 * Row text is read through `originalText` (src/translate/apply.ts), never
 * through plain textContent: our own ko->ru dictionary runs after each scan
 * and rewrites exactly the tokens matched here ("16/09식" -> "16/09 г.в.",
 * "디젤" -> "дизель"), so a rescan of an already translated page would
 * otherwise parse nothing. A row measured once is additionally marked and
 * cached (ROW_ATTR + rowParamsCache), so a price cell re-rendered by the site
 * inside an already translated row still gets the pre-translation reading.
 *
 * Anything unparseable simply stays undefined: precision degrades to
 * "approx"/"onRequest" downstream instead of throwing (R3 degradation).
 */

import {
  computeAgeYears,
  type FuelType,
  type LotParams,
} from "../calc/customs";
import { originalText } from "../translate/apply";

/** Raw parameters read from the DOM, before age computation. */
export interface DomLotParams {
  /** First registration year (4-digit). */
  regYear?: number;
  /** First registration month, 1-12. */
  regMonth?: number;
  fuel?: FuelType;
  /** Engine displacement in cc. */
  engineCc?: number;
  /** True when any value was derived from indirect evidence, not read. */
  estimated: boolean;
}

/** Registration in the compact "16/09식" form. */
const REG_COMPACT_RE = /(\d{2})\/(\d{2})식/;
/** Registration in the long Korean form "16년 09월". */
const REG_LONG_RE = /(\d{2})년\s*(\d{1,2})월/;
/** All compact registrations in a subtree (row detection). */
const REG_GLOBAL_RE = /\d{2}\/\d{2}식/g;

/**
 * Parses a first-registration date out of free text ("16/09식", "16년 09월").
 * Two-digit years pivot at 49: 00-49 -> 20xx, 50-99 -> 19xx.
 */
export function parseRegistration(
  text: string,
): { year: number; month: number } | null {
  const match = REG_COMPACT_RE.exec(text) ?? REG_LONG_RE.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  const yy = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: yy <= 49 ? 2000 + yy : 1900 + yy, month };
}

/**
 * Korean fuel tokens in match-priority order: hybrid must win over its
 * base-fuel token ("가솔린 하이브리드" is a hybrid, not gasoline).
 */
const FUEL_TOKENS: ReadonlyArray<readonly [RegExp, FuelType]> = [
  [/하이브리드/, "hybrid"],
  [/전기/, "electric"],
  [/lpg|엘피지/i, "lpg"],
  [/디젤/, "diesel"],
  [/가솔린/, "gasoline"],
];

/** Maps a Korean fuel token found in the text to the calculator fuel type. */
export function parseFuel(text: string): FuelType | null {
  for (const [re, fuel] of FUEL_TOKENS) {
    if (re.test(text)) return fuel;
  }
  return null;
}

/** A displacement-in-liters number ("2.2") not embedded in a larger number. */
const LITERS_RE = /(?:^|[^\d.])(\d)\.(\d)(?![\d.])/;

/**
 * Estimates displacement in cc from a "2.2"-style model title: 2.2 -> 2199.
 * The -1 mirrors how nominal liters relate to real displacement (2.2 L
 * engines are 2199cc); the caller must flag the result as estimated.
 */
export function estimateCcFromText(text: string): number | null {
  const match = LITERS_RE.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  const cc = Number(match[1]) * 1000 + Number(match[2]) * 100 - 1;
  // Below 0.5 L it is noise (version numbers etc.), not an engine.
  return cc >= 499 ? cc : null;
}

const STATE_YEAR_MONTH_RE = /"yearMonth":"(\d{4})(\d{2})"/;
const STATE_DISPLACEMENT_RE = /"displacement":(\d+)/;
const STATE_FUEL_RE = /"fuelName":"([^"]+)"/;

/** Text of the inline SPA state script, if the page carries one. */
function hiddenStateText(doc: Document): string | null {
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (text.includes("__PRELOADED_STATE__")) return text;
  }
  return null;
}

/** Title candidates for the cc estimation fallback (head may be absent). */
function cardTitleText(doc: Document): string {
  const parts: string[] = [];
  const og = doc.querySelector('meta[property="og:title"]');
  if (og) parts.push(og.getAttribute("content") ?? "");
  parts.push(doc.title);
  // Heading children are pushed individually: adjacent spans otherwise
  // concatenate without a separator ("K7" + "2.2" -> "K72.2") and hide the
  // displacement number from the liters pattern.
  const headingParts = doc.querySelectorAll("h1, h2, h3, h1 *, h2 *, h3 *");
  for (const el of Array.from(headingParts)) {
    parts.push(el.textContent ?? "");
  }
  return parts.join(" ");
}

/** Parses "2,199" / "2199cc" style displacement text from a spec value. */
function parseCcText(text: string): number | null {
  const match = /(\d{1,2},\d{3}|\d{3,5})/.exec(text);
  if (!match || match[1] === undefined) return null;
  const cc = Number(match[1].replace(/,/g, ""));
  return cc > 0 && cc < 20_000 ? cc : null;
}

/**
 * Extracts lot params from a car detail page. Missing fields stay undefined;
 * `estimated` is true only when the cc had to be derived from the title.
 */
export function extractCardParams(doc: Document): DomLotParams {
  const params: DomLotParams = { estimated: false };

  // 1. Hidden SPA state: exact values, translation-proof.
  const state = hiddenStateText(doc);
  if (state !== null) {
    const ym = STATE_YEAR_MONTH_RE.exec(state);
    if (ym && ym[1] !== undefined && ym[2] !== undefined) {
      const month = Number(ym[2]);
      if (month >= 1 && month <= 12) {
        params.regYear = Number(ym[1]);
        params.regMonth = month;
      }
    }
    const displacement = STATE_DISPLACEMENT_RE.exec(state);
    if (displacement && displacement[1] !== undefined) {
      const cc = Number(displacement[1]);
      if (cc > 0) params.engineCc = cc;
    }
    const fuelName = STATE_FUEL_RE.exec(state);
    if (fuelName && fuelName[1] !== undefined) {
      const fuel = parseFuel(fuelName[1]);
      if (fuel !== null) params.fuel = fuel;
    }
  }

  // 2. Visible spec list (dt/dd) for anything the state did not provide.
  for (const dt of Array.from(doc.querySelectorAll("dt"))) {
    const label = (dt.textContent ?? "").trim();
    const dd = dt.nextElementSibling;
    if (!dd || dd.tagName !== "DD") continue;
    const value = dd.textContent ?? "";
    if (params.regYear === undefined && label.includes("연식")) {
      const reg = parseRegistration(value);
      if (reg !== null) {
        params.regYear = reg.year;
        params.regMonth = reg.month;
      }
    } else if (params.fuel === undefined && label.includes("연료")) {
      const fuel = parseFuel(value);
      if (fuel !== null) params.fuel = fuel;
    } else if (params.engineCc === undefined && label.includes("배기량")) {
      const cc = parseCcText(value);
      if (cc !== null) params.engineCc = cc;
    }
  }

  // 3. Title heuristic: "2.2" -> 2199cc, honestly flagged as estimated.
  if (params.engineCc === undefined) {
    const cc = estimateCcFromText(cardTitleText(doc));
    if (cc !== null) {
      params.engineCc = cc;
      params.estimated = true;
    }
  }

  return params;
}

/**
 * Marker on a listing row whose params have already been read from
 * untranslated text. It lets a later pass recognise the same row even after
 * every Korean token in it was rewritten. Deliberately NOT one of
 * applyDictionary's skip markers (see SKIP_SELECTOR): rows must stay
 * translatable.
 */
const ROW_ATTR = "data-encar-ru-row";

/** Pre-translation reading of a row, kept for rescans of that same row. */
const rowParamsCache = new WeakMap<Element, DomLotParams>();

/**
 * Smallest ancestor of the price element that contains exactly one
 * registration date — the "row" of this lot. Works for desktop table rows
 * (tr), photo-ad cards and drencar list items alike. An ancestor with
 * several registrations means the walk overshot into a multi-lot container:
 * give up rather than read another lot's params.
 *
 * A row we already measured stays the row whatever its text reads now, so a
 * price element re-rendered by the site into a translated row still resolves.
 */
function findListingRow(priceEl: Element): Element | null {
  let node: Element | null = priceEl;
  for (let depth = 0; node !== null && depth < 12; depth += 1) {
    if (node.hasAttribute(ROW_ATTR)) return node;
    const matches = originalText(node).match(REG_GLOBAL_RE);
    if (matches !== null) return matches.length === 1 ? node : null;
    node = node.parentElement;
  }
  return null;
}

/**
 * Extracts lot params visible near a listing price element. Listing values
 * are heuristic by design, so the result is always flagged estimated —
 * listing badges never claim exact precision (R3).
 */
export function extractListingParams(priceEl: Element): DomLotParams {
  const params: DomLotParams = { estimated: true };
  const row = findListingRow(priceEl);
  if (row === null) return params;

  // Read what the site wrote, not what this widget rewrote (U9 vs U7).
  const text = originalText(row);
  const reg = parseRegistration(text);
  if (reg !== null) {
    params.regYear = reg.year;
    params.regMonth = reg.month;
  }
  const fuel = parseFuel(text);
  if (fuel !== null) params.fuel = fuel;

  // Model title ("2.2 디젤 프레스티지") is the only cc source in listings.
  // ".dtl" must be preferred explicitly: a single ".dtl, .cls" query returns
  // whichever comes first in document order, and that is always ".cls" (the
  // brand + model name, which never carries a displacement).
  // The whole row text is NOT a cc source: it also carries mileage, price
  // and dealer notes, and a "1.6" picked out of those would silently drive
  // the badge total. No title element -> no displacement (R3 degradation).
  const titleEl = row.querySelector(".dtl") ?? row.querySelector(".cls");
  const title = titleEl === null ? "" : originalText(titleEl);
  const cc = estimateCcFromText(title);
  if (cc !== null) params.engineCc = cc;

  if (params.regYear === undefined) {
    // Nothing parseable left — e.g. the browser's own translator rewrote the
    // row, which leaves no originals behind. Reuse the pre-translation
    // reading if this row ever had one; otherwise degrade honestly (the
    // caller turns missing params into "по запросу"), never guess.
    const cached = rowParamsCache.get(row);
    return cached === undefined ? params : { ...cached };
  }

  // Freshly parsed from untranslated text: remember it for later passes.
  row.setAttribute(ROW_ATTR, "");
  rowParamsCache.set(row, params);
  return params;
}

/**
 * Converts DOM params into calculator lot details: the registration date
 * becomes the customs age in full years.
 */
export function toLotDetails(
  params: DomLotParams,
  now: Date = new Date(),
): Omit<LotParams, "priceKrw"> {
  const details: Omit<LotParams, "priceKrw"> = { estimated: params.estimated };
  if (params.regYear !== undefined && params.regMonth !== undefined) {
    details.ageYears = computeAgeYears(params.regYear, params.regMonth, now);
  }
  if (params.engineCc !== undefined) details.engineCc = params.engineCc;
  if (params.fuel !== undefined) details.fuel = params.fuel;
  return details;
}
