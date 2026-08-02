/**
 * Real all-in customs calculator (U6, R9-R11).
 *
 * Pure bracket interpreter: every tariff number (duty tiers, recycling fee,
 * clearance fee brackets, fixed items, commission percent) lives in the
 * importer config (src/config.default.ts / site/config.json, `asOf` field) —
 * this module only interprets it. Rules implemented for individuals /
 * personal use:
 *
 *  - Duty, age <3y: percent of the customs value (EUR) with a EUR/cc minimum,
 *    tier chosen by customs value (dutyValueTiers).
 *  - Duty, ages 3-5 inclusive / >5: flat EUR per cc (dutyPerCcByAge.y3 /
 *    .y5plus). Customs age = full years from first registration to now,
 *    counted from the END of the registration month because the DOM never
 *    gives the day (computeAgeYears); near a regime boundary the quote is
 *    additionally demoted to "approx" with AGE_BRACKET_NOTE.
 *  - Recycling fee: fixed RUB by displacement class and age (recyclingFee).
 *  - Clearance fee: RUB bracket by lot customs value (clearanceFeeBrackets).
 *
 * EV (and any lot without a usable displacement or age) degrades honestly:
 * precision "onRequest" — only computable items are listed and the UI shows
 * "расчёт по запросу" instead of a total.
 *
 * Garbage in never becomes a confident number out. Any non-finite or
 * nonsensical input (NaN/Infinity, a non-positive price or FX rate, a negative
 * age, a non-positive displacement) counts as MISSING, not as data, and the
 * produced total is re-checked for finiteness before it is returned. A
 * confidently wrong number is worse for the client than an honest
 * "по запросу" (R3).
 */

import {
  CUSTOMS_FORMULA,
  type CustomsConfig,
  type DutyPerCcBracket,
  type DutyValueTier,
  type WidgetConfig,
} from "../config.default";

export type FuelType = "gasoline" | "diesel" | "lpg" | "hybrid" | "electric";

export interface LotParams {
  priceKrw: number;
  /** Customs age in full years (computeAgeYears); undefined when unknown. */
  ageYears?: number;
  /** Engine displacement in cc; undefined for EV or when unknown. */
  engineCc?: number;
  fuel?: FuelType;
  /**
   * True when any param above was derived from indirect evidence (e.g. cc
   * estimated from a "2.2" model title, U7) rather than read as data.
   */
  estimated?: boolean;
  /**
   * True when the registration date sits within a couple of months of a duty
   * bracket boundary (see isNearAgeBracket): the unknown registration DAY can
   * then still move the lot into another duty regime, so the quote is marked
   * approximate and carries AGE_BRACKET_NOTE.
   */
  ageNearBracket?: boolean;
}

export interface FxRates {
  /** RUB per 1 KRW. */
  krwRub: number;
  /** RUB per 1 EUR. */
  eurRub: number;
}

export interface CostLine {
  id: string;
  /** User-facing Russian label. */
  label: string;
  /** Rounded RUB amount. */
  rub: number;
  /** Optional applied-rate detail for spot-checking. */
  note?: string;
}

/**
 * exact     — all customs formulas computed from full lot params;
 * approx    — computed from partially estimated params (U7 listings);
 * onRequest — customs items not computable, total shown as "on request".
 */
export type Precision = "exact" | "approx" | "onRequest";

export interface AllInResult {
  items: CostLine[];
  /** Sum of listed items; under "onRequest" it covers known items only. */
  totalRub: number;
  precision: Precision;
  /** User-facing Russian notes for the breakdown (may be empty). */
  notes: string[];
}

/**
 * Finite and strictly positive — the only shape a money amount, an FX rate or
 * a displacement may have. NaN/Infinity are treated as missing data, never as
 * a value to compute with.
 */
function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Finite and not negative — a brand-new car legitimately has age 0. */
function isAge(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Finite config amount. Unlike a price it may be zero (a waived fee) or
 * negative (a discount line) — it only may not be NaN/Infinity, and it is
 * never a formula identifier string.
 */
function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Precision the given lot params can support (U7, R3):
 * customs not computable (missing age/cc or an EV) -> "onRequest";
 * computable from estimated params -> "approx"; otherwise "exact".
 *
 * "Missing" covers unusable numbers too: a half-parsed row that yields NaN
 * must degrade exactly like a row that yielded nothing.
 */
export function lotPrecision(lot: Omit<LotParams, "priceKrw">): Precision {
  const computable =
    lot.fuel !== "electric" && isAge(lot.ageYears) && isPositive(lot.engineCc);
  if (!computable) return "onRequest";
  return lot.estimated === true ? "approx" : "exact";
}

/**
 * Full months from the first registration (year, month 1-12) to `now`.
 *
 * The DOM gives year and month only — the registration DAY is genuinely
 * unknown — so the car is treated as registered on the LAST day of its
 * registration month: an anniversary counts only once the whole anniversary
 * month has passed. At the 3-year cliff that is the conservative reading:
 * "2023-08, valued on 2026-08-01" could be 2023-08-31 (not yet 3 years), and
 * the 3-5y flat EUR/cc regime is far cheaper than the <3y percent-of-value
 * one — a bracket the widget cannot prove must never be the one quoted.
 * May be negative for a future registration date.
 */
function ageMonths(regYear: number, regMonth: number, now: Date): number {
  return (
    (now.getFullYear() - regYear) * 12 + (now.getMonth() + 1 - regMonth) - 1
  );
}

/**
 * Customs age in full years from the first registration (year, month 1-12)
 * to `now`, counted from the END of the registration month (see ageMonths).
 * Never negative.
 */
export function computeAgeYears(
  regYear: number,
  regMonth: number,
  now: Date = new Date(),
): number {
  const months = ageMonths(regYear, regMonth, now);
  return months <= 0 ? 0 : Math.floor(months / 12);
}

/** Duty regime boundaries in months (3 and 5 years). */
const AGE_BRACKET_MONTHS = [36, 60] as const;

/** How close to a boundary the unknown registration day still matters. */
const AGE_BRACKET_MARGIN_MONTHS = 2;

/** Shown when the age sits close enough to a boundary to change the regime. */
export const AGE_BRACKET_NOTE =
  "Возраст близок к границе таможенного режима (3 и 5 лет): точная дата регистрации может изменить размер пошлины.";

/**
 * True when the lot age is within AGE_BRACKET_MARGIN_MONTHS of a duty regime
 * boundary. Only the registration month is known, so around the boundary the
 * quote cannot be called exact whichever side it lands on.
 */
export function isNearAgeBracket(
  regYear: number,
  regMonth: number,
  now: Date = new Date(),
): boolean {
  const months = ageMonths(regYear, regMonth, now);
  return AGE_BRACKET_MONTHS.some(
    (boundary) => Math.abs(months - boundary) <= AGE_BRACKET_MARGIN_MONTHS,
  );
}

/**
 * First bracket whose inclusive upper bound admits `value`; the validator
 * guarantees the last bracket is open-ended, so it is the fallback.
 */
function pickBracket<T>(
  brackets: readonly T[],
  value: number,
  maxOf: (bracket: T) => number | undefined,
): T {
  for (const bracket of brackets) {
    const max = maxOf(bracket);
    if (max === undefined || value <= max) return bracket;
  }
  return brackets[brackets.length - 1] as T;
}

interface DutyEur {
  eur: number;
  note: string;
}

/** Duty in EUR per the age category (boundaries: <3, 3-5 incl., >5). */
function computeDutyEur(
  lotEur: number,
  ageYears: number,
  engineCc: number,
  customs: CustomsConfig,
): DutyEur {
  if (ageYears < 3) {
    const tier: DutyValueTier = pickBracket(
      customs.dutyValueTiers,
      lotEur,
      (t) => t.maxEur,
    );
    const pctEur = (lotEur * tier.pct) / 100;
    const minEur = tier.minPerCc * engineCc;
    return pctEur >= minEur
      ? { eur: pctEur, note: `${tier.pct}% таможенной стоимости` }
      : { eur: minEur, note: `${tier.minPerCc} € за см³ (минимум)` };
  }
  const brackets =
    ageYears <= 5 ? customs.dutyPerCcByAge.y3 : customs.dutyPerCcByAge.y5plus;
  const bracket: DutyPerCcBracket = pickBracket(
    brackets,
    engineCc,
    (b) => b.maxCc,
  );
  return { eur: bracket.eurPerCc * engineCc, note: `${bracket.eurPerCc} € за см³` };
}

/** Recycling fee in RUB (personal use). */
function computeRecyclingRub(
  ageYears: number,
  engineCc: number,
  customs: CustomsConfig,
): number {
  const fee = customs.recyclingFee;
  const small = engineCc <= fee.smallMaxCc;
  if (ageYears < 3) return small ? fee.smallUnder3yRub : fee.largeUnder3yRub;
  return small ? fee.smallFrom3yRub : fee.largeFrom3yRub;
}

/** Clearance fee in RUB by the lot customs value. */
function computeClearanceRub(lotRub: number, customs: CustomsConfig): number {
  return pickBracket(customs.clearanceFeeBrackets, lotRub, (b) => b.maxRub).fee;
}

/**
 * All-in cost of importing the lot: the lot price plus every config cost
 * item, with "formula" items expanded into the computed customs lines
 * (duty, recycling fee, clearance fee). Amounts are rounded per item;
 * the total is the sum of the listed items.
 */
export function computeAllIn(
  lot: LotParams,
  rates: FxRates,
  config: WidgetConfig,
): AllInResult {
  // Every price-derived item depends on these three numbers: if any of them is
  // unusable, the lot price itself is unknown and the whole quote degrades to
  // "on request" rather than propagating a NaN through every line.
  const priceKnown =
    isPositive(lot.priceKrw) &&
    isPositive(rates.krwRub) &&
    isPositive(rates.eurRub);
  const lotRub = priceKnown ? Math.round(lot.priceKrw * rates.krwRub) : 0;
  // Unrounded customs value in EUR for the <3y percent tiers.
  const lotEur = priceKnown ? (lot.priceKrw * rates.krwRub) / rates.eurRub : 0;
  const customs = config.customs;

  // Customs formulas need an age and a positive displacement; EVs follow
  // different rules entirely and are quoted manually (plan decision).
  const precision = priceKnown ? lotPrecision(lot) : "onRequest";
  const canComputeCustoms = precision !== "onRequest";

  const items: CostLine[] = [];
  if (priceKnown) {
    items.push({ id: "lot", label: "Цена лота", rub: lotRub });
  }

  // A cost item the calculator cannot turn into a line must not just vanish:
  // an omitted item is a total that is short by exactly that item, with
  // nothing looking broken. Any such item demotes the quote to "on request".
  let unhandled = false;
  let customsExpanded = false;

  for (const item of config.costItems) {
    if (item.kind === "fixed") {
      if (isAmount(item.value)) {
        items.push({
          id: item.id,
          label: item.label,
          rub: Math.round(item.value),
        });
      } else {
        unhandled = true;
      }
    } else if (item.kind === "percent") {
      if (priceKnown && isAmount(item.value)) {
        items.push({
          id: item.id,
          label: item.label,
          rub: Math.round((lotRub * item.value) / 100),
        });
      } else {
        unhandled = true;
      }
    } else if (
      // Dispatch on the identifier, and expand the customs block at most once:
      // a second recognised formula item would count duty, the recycling fee
      // and the clearance fee twice (the validator rejects such configs).
      item.value === CUSTOMS_FORMULA &&
      canComputeCustoms &&
      !customsExpanded
    ) {
      customsExpanded = true;
      // canComputeCustoms narrows ageYears/engineCc to numbers.
      const ageYears = lot.ageYears as number;
      const engineCc = lot.engineCc as number;
      const duty = computeDutyEur(lotEur, ageYears, engineCc, customs);
      items.push({
        id: "duty",
        label: customs.labels.duty,
        rub: Math.round(duty.eur * rates.eurRub),
        note: duty.note,
      });
      items.push({
        id: "recycling",
        label: customs.labels.recycling,
        rub: Math.round(computeRecyclingRub(ageYears, engineCc, customs)),
      });
      items.push({
        id: "clearance",
        label: customs.labels.clearance,
        rub: Math.round(computeClearanceRub(lotRub, customs)),
      });
    } else {
      // Unknown formula identifier, a duplicate customs item, or customs that
      // are not computable for this lot (EV / missing params).
      unhandled = true;
    }
  }

  // Last line of defence (the "≈ NaN ₽" guard): a single non-finite line would
  // poison the total, so unusable lines are dropped and the quote is demoted to
  // "on request". The returned total is finite by construction.
  const usable = items.filter((item) => Number.isFinite(item.rub));
  const summed = usable.reduce((sum, item) => sum + item.rub, 0);
  const totalRub = Number.isFinite(summed) ? summed : 0;
  const degraded =
    unhandled || usable.length !== items.length || !Number.isFinite(summed);

  // Close to a duty bracket boundary the unknown registration day can still
  // move the lot into another regime: honest "approx" plus a visible reason.
  const notes: string[] = [];
  let finalPrecision: Precision = degraded ? "onRequest" : precision;
  if (customsExpanded && lot.ageNearBracket === true) {
    notes.push(AGE_BRACKET_NOTE);
    if (finalPrecision === "exact") finalPrecision = "approx";
  }

  return { items: usable, totalRub, precision: finalPrecision, notes };
}
