/**
 * Lot parameter extraction from encar DOM (U7, R3/AE1).
 *
 * Card pages (fem.encar.com detail): parameters are read in priority order
 *  1. hidden SPA state — the inline `__PRELOADED_STATE__` script carries the
 *     exact spec (`displacement`, `fuelName`, `yearMonth`) and survives
 *     browser translation (scripts are never translated). It is usable only
 *     while its `vehicleId` matches the lot in the URL: fem writes the script
 *     once and never rewrites it, so after a soft navigation it still
 *     describes the PREVIOUS car and is discarded;
 *  2. visible spec list — `dt/dd` pairs (연식 / 연료 / 배기량);
 *  3. title heuristic — a "2.2"-style displacement in the LOT TITLE yields an
 *     ESTIMATED cc (flagged, degrades precision to "approx"). Only the title
 *     element is read: a "4.5" from a rating widget elsewhere on the page
 *     would silently change the duty and recycling bracket.
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
  isNearAgeBracket,
  type FuelType,
  type LotParams,
} from "../calc/customs";
import { PRICE_ELEMENT_SELECTOR } from "./scanner";
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
 * base-fuel tokens. encar labels hybrids "가솔린+전기" (and prints
 * "하이브리드" only in some model names), so the compound must be matched
 * before the bare 전기 rule — otherwise every gasoline hybrid is read as an
 * EV and degrades to "по запросу".
 *
 * The electric rule therefore only accepts a standalone 전기: not the right
 * half of a compound ("가솔린+전기"), and not 전기형, which is a pre-facelift
 * model marker rather than a fuel. No lookbehind — Safari support for it is
 * too recent for a bookmarklet.
 */
const FUEL_TOKENS: ReadonlyArray<readonly [RegExp, FuelType]> = [
  [/하이브리드|가솔린\s*\+\s*전기|전기\s*\+\s*가솔린/, "hybrid"],
  [/(?:^|[^+가-힣])전기(?!형)(?!\s*\+)/, "electric"],
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

/**
 * A displacement-in-liters number ("2.2") not embedded in a larger number and
 * not carrying a unit that rules an engine out ("4.5점" is a rating, "1.5km"
 * a distance). The heuristic is only ever run on a lot TITLE (see
 * lotTitleText / the listing ".dtl"), never on a text blob: a "4.5" picked up
 * from a rating widget would silently change the duty and recycling bracket.
 */
const LITERS_RE =
  /(?:^|[^\d.,])(\d)\.(\d)(?![\d.])(?!\s*(?:점|%|km|㎞|원|인승|년|월|배|kg|㎏|만))/;

/** Wording that makes a N.N number a score, never a displacement. */
const RATING_CONTEXT_RE = /평점|별점|점수|리뷰|후기|등급|평가/;

/** Plausible car displacement: 0.6 L .. 6.0 L. */
const MIN_ESTIMATED_CC = 599;
const MAX_ESTIMATED_CC = 5999;

/**
 * Estimates displacement in cc from a "2.2"-style model title: 2.2 -> 2199.
 * The -1 mirrors how nominal liters relate to real displacement (2.2 L
 * engines are 2199cc); the caller must flag the result as estimated.
 *
 * Returns null on anything that is not plainly an engine size — the caller
 * then degrades to "по запросу" instead of quoting an invented bracket (R3).
 */
export function estimateCcFromText(text: string): number | null {
  if (RATING_CONTEXT_RE.test(text)) return null;
  const match = LITERS_RE.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  const cc = Number(match[1]) * 1000 + Number(match[2]) * 100 - 1;
  return cc >= MIN_ESTIMATED_CC && cc <= MAX_ESTIMATED_CC ? cc : null;
}

const STATE_YEAR_MONTH_RE = /"yearMonth":"(\d{4})(\d{2})"/;
const STATE_DISPLACEMENT_RE = /"displacement":(\d+)/;
const STATE_FUEL_RE = /"fuelName":"([^"]+)"/;
/** Lot the inline state describes. */
const STATE_VEHICLE_ID_RE = /"vehicleId"\s*:\s*"?(\d+)"?/;
/** Lot id of a car detail URL ("/cars/detail/41756847"). */
const DETAIL_LOT_ID_RE = /\/cars\/detail\/(\d+)/;

/** Lot id carried by a detail URL, or null when the URL names no lot. */
export function lotIdFromUrl(url: string): string | null {
  const match = DETAIL_LOT_ID_RE.exec(url);
  return match?.[1] ?? null;
}

/**
 * Inline SPA state that belongs to `lotId`.
 *
 * fem.encar.com writes `__PRELOADED_STATE__` once, at the initial document
 * load, and never rewrites it on a client-side route change — after a soft
 * navigation it still describes the PREVIOUS car. Its values are only usable
 * while the vehicle id inside it matches the lot in the URL, so every script
 * is re-read on every pass and checked against that id. A state that names
 * another lot (or names none at all while the URL does) is discarded.
 *
 * When the URL names no lot (a detached document in tests, a non-detail
 * page) there is nothing to contradict the state and it is used as it is.
 */
function boundStateText(
  doc: Document,
  lotId: string | null,
): { text: string | null; discarded: boolean } {
  const texts: string[] = [];
  for (const script of [...doc.querySelectorAll("script")]) {
    const text = script.textContent ?? "";
    if (text.includes("__PRELOADED_STATE__")) texts.push(text);
  }
  if (texts.length === 0) return { text: null, discarded: false };
  if (lotId === null) {
    return { text: texts[texts.length - 1] ?? null, discarded: false };
  }
  for (const text of texts) {
    if (STATE_VEHICLE_ID_RE.exec(text)?.[1] === lotId) {
      return { text, discarded: false };
    }
  }
  return { text: null, discarded: true };
}

/**
 * Text of the lot title element — the ONLY place a displacement may be
 * estimated from. Preference order:
 *  1. og:title (the site's own name for this lot, no page furniture);
 *  2. the last heading before the lot price, i.e. the visible lot title
 *     (the page header <h1> is "엔카" and never wins this way);
 *  3. the document title.
 *
 * Heading children are read individually: adjacent spans otherwise
 * concatenate without a separator ("K7" + "2.2" -> "K72.2") and hide the
 * displacement from the liters pattern.
 */
function lotTitleText(doc: Document): string {
  const og = doc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute("content");
  if (og !== null && og !== undefined && og.trim() !== "") return og;

  const price = doc.querySelector(PRICE_ELEMENT_SELECTOR);
  if (price !== null) {
    const headings = [...doc.querySelectorAll("h1, h2, h3")].filter(
      // Node.DOCUMENT_POSITION_FOLLOWING: the price comes after the heading.
      (heading) => (heading.compareDocumentPosition(price) & 4) !== 0,
    );
    const title = headings[headings.length - 1];
    if (title !== undefined) {
      const parts = [...title.childNodes].map(
        (child) => child.textContent ?? "",
      );
      return parts.join(" ");
    }
  }
  return doc.title;
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
 * `estimated` is true when the cc had to be derived from the title, or when
 * the inline SPA state had to be discarded as belonging to another lot (the
 * remaining values then come from the visible DOM only, so the badge must not
 * claim exact precision).
 *
 * `url` binds the state to the lot on screen; it defaults to the document's
 * own location, which is what the widget passes on every annotate pass.
 */
export function extractCardParams(
  doc: Document,
  url: string = doc.defaultView?.location?.href ?? "",
): DomLotParams {
  const params: DomLotParams = { estimated: false };

  const { text: state, discarded } = boundStateText(doc, lotIdFromUrl(url));
  // A discarded state means the page was soft-navigated: everything below is
  // read off the visible DOM, so the result cannot claim exact precision.
  if (discarded) params.estimated = true;

  // 1. Hidden SPA state: exact values, translation-proof.
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
  for (const dt of [...doc.querySelectorAll("dt")]) {
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
    const cc = estimateCcFromText(lotTitleText(doc));
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
  //
  // There is nothing else to fall back on. Audited live on the imported-car
  // listing (www.encar.com, 2026-08-02): a row exposes .cls (maker + model),
  // .dtl (trim badge), .detail (.yer/.km/.fue/.lo/.ins), .prc and nothing
  // more; its only data-* payload is data-impression="carid|price|modelGroup
  // |slot…"; the row link carries the car id plus tracking parameters; and
  // the search record the list is rendered from (Id, Manufacturer, Model,
  // Badge, Transmission, FuelType, Year, FormYear, Mileage, Price, SellType,
  // BuyType, ModifiedDate, Office*, Dealer*, Trust, Condition, Photo*) has no
  // displacement field at all. So roughly 4 of 5 imported rows legitimately
  // end up without a cc: their .dtl is a marketing designation ("520d M 스포츠",
  // "E350 4MATIC AMG Line", "xDrive 30d"), which must NOT be read as a
  // displacement — those names do not reliably encode one, and a wrong cc
  // silently moves the lot into another duty bracket. Undefined is the honest
  // answer; the calculator degrades the customs line instead.
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
    // Only the registration MONTH is on the page, so within a couple of months
    // of the 3y/5y duty boundary the day decides the regime: the calculator
    // downgrades such a quote to approximate instead of claiming exactness.
    details.ageNearBracket = isNearAgeBracket(
      params.regYear,
      params.regMonth,
      now,
    );
  }
  if (params.engineCc !== undefined) details.engineCc = params.engineCc;
  if (params.fuel !== undefined) details.fuel = params.fuel;
  return details;
}
