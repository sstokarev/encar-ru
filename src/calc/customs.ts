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
 *    .y5plus). Customs age = full years from first registration to now.
 *  - Recycling fee: fixed RUB by displacement class and age (recyclingFee).
 *  - Clearance fee: RUB bracket by lot customs value (clearanceFeeBrackets).
 *
 * EV (and any lot without a usable displacement or age) degrades honestly:
 * precision "onRequest" — only computable items are listed and the UI shows
 * "расчёт по запросу" instead of a total.
 */

import type {
  CustomsConfig,
  DutyPerCcBracket,
  DutyValueTier,
  WidgetConfig,
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
}

/**
 * Precision the given lot params can support (U7, R3):
 * customs not computable (missing age/cc or an EV) -> "onRequest";
 * computable from estimated params -> "approx"; otherwise "exact".
 */
export function lotPrecision(lot: Omit<LotParams, "priceKrw">): Precision {
  const computable =
    lot.fuel !== "electric" &&
    lot.ageYears !== undefined &&
    lot.engineCc !== undefined &&
    lot.engineCc > 0;
  if (!computable) return "onRequest";
  return lot.estimated === true ? "approx" : "exact";
}

/**
 * Customs age in full years from the first registration (year, month 1-12)
 * to `now`. The registration day is unknown, so the anniversary is counted
 * as reached at the start of the month. Never negative.
 */
export function computeAgeYears(
  regYear: number,
  regMonth: number,
  now: Date = new Date(),
): number {
  let years = now.getFullYear() - regYear;
  if (now.getMonth() + 1 < regMonth) years -= 1;
  return Math.max(0, years);
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
  const lotRub = Math.round(lot.priceKrw * rates.krwRub);
  // Unrounded customs value in EUR for the <3y percent tiers.
  const lotEur = (lot.priceKrw * rates.krwRub) / rates.eurRub;
  const customs = config.customs;

  // Customs formulas need an age and a positive displacement; EVs follow
  // different rules entirely and are quoted manually (plan decision).
  const precision = lotPrecision(lot);
  const canComputeCustoms = precision !== "onRequest";

  const items: CostLine[] = [{ id: "lot", label: "Цена лота", rub: lotRub }];

  for (const item of config.costItems) {
    if (item.kind === "fixed" && typeof item.value === "number") {
      items.push({ id: item.id, label: item.label, rub: Math.round(item.value) });
    } else if (item.kind === "percent" && typeof item.value === "number") {
      items.push({
        id: item.id,
        label: item.label,
        rub: Math.round((lotRub * item.value) / 100),
      });
    } else if (item.kind === "formula" && canComputeCustoms) {
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
    }
    // Formula items that cannot be computed are omitted: under "onRequest"
    // only known items are listed (honest degradation, KTD7 spirit).
  }

  const totalRub = items.reduce((sum, item) => sum + item.rub, 0);
  return { items, totalRub, precision };
}
