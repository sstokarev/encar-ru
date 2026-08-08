/**
 * Real all-in customs calculator (U6, R9-R11).
 *
 * Pure bracket interpreter: every tariff number (duty tiers, recycling fee
 * grid, clearance fee brackets, fixed items, commission percent) lives in the
 * importer config (src/config.default.ts / site/config.json, `asOf` field) —
 * this module only interprets it. Rules implemented for individuals /
 * personal use (Решение Совета ЕЭК № 107, Прил. 2, Табл. 2):
 *
 *  - Duty, age <3y: percent of the customs value (EUR) with a EUR/cc minimum,
 *    tier chosen by customs value (dutyValueTiers).
 *  - Duty, ages 3-5 inclusive / >5: flat EUR per cc (dutyPerCcByAge.y3 /
 *    .y5plus). Both cliffs are MONTH-accurate (36 / 60 months, see
 *    DUTY_BRACKET_MONTHS): "не более 5 лет" ends on the fifth anniversary, not
 *    at the end of the sixth year. Customs age is measured from the END of the
 *    registration month because the DOM never gives the day (computeAgeYears);
 *    near a regime boundary the quote is additionally demoted to "approx" with
 *    AGE_BRACKET_NOTE.
 *  - Recycling fee: displacement class x engine POWER x age (recyclingFee).
 *  - Clearance fee: RUB bracket by lot customs value (clearanceFeeBrackets).
 *
 * THREE WAYS A LINE CAN FAIL, and they are not the same thing:
 *
 *  1. "unknown" cost item — the importer has not priced shipping / broker /
 *     commission yet. The line renders as a DASH, contributes nothing to the
 *     total, and does NOT lower the precision: this is an editorial decision,
 *     not missing data (customer instruction, 2026-08-02).
 *  2. an uncomputable CUSTOMS line — the lot has no displacement (34 of 41
 *     listing rows), no age, or no engine power. That single line becomes a
 *     dash too, and the quote reports precision "partial": the total is a
 *     provable FLOOR ("от N ₽"), not a wall. Refusing to quote a lot price we
 *     do know helps nobody.
 *  3. a MALFORMED item (a quoted "220000" on a fixed item, an unrecognised
 *     formula id, a duplicated customs item) — a config bug. It still degrades
 *     the whole quote to "onRequest", exactly as before.
 *
 * Engine power deserves its own note: since ПП РФ № 1713 (in force
 * 01.12.2025) the recycling fee is looked up by power, and the reduced
 * personal-use rate (5 200 ₽ for a used car) survives only up to 160 hp and
 * 3000 cm³. Above that the same car pays 1.4-6.9 M ₽. Power is not published
 * on the encar listing (measured: docs/harness/spike-power.md), so it comes
 * from the drom.ru specs catalog (src/calc/specs.ts, tks-parity task):
 * powerHp is the ICE figure, electricHp30min the motor's 30-minute figure.
 * A parallel hybrid's fee power is their SUM (ПП №1291, сноска 2 к
 * приложению); with either figure missing the fee line dashes rather than
 * guesses.
 *
 * EVs and SEQUENTIAL hybrids fall outside ЕЭК №107 entirely and compute on
 * their own track (tks.ru parity): пошлина ЕТТ 15% + акциз руб/л.с. + НДС +
 * утильсбор по EV-шкале, all keyed on the 30-minute power — see
 * EvTrackRates. "по запросу" is kept for exactly one case: the lot price
 * itself is unusable (or the config carries a malformed item).
 *
 * Garbage in never becomes a confident number out, and "missing" is not the
 * same thing as "garbage" (R3):
 *
 *  - a param that is ABSENT (no displacement on the row, no power anywhere) is
 *    legitimate missing data: its line dashes and the quote is a floor;
 *  - a param that is PRESENT BUT INVALID — NaN/Infinity, a zero or negative
 *    displacement or power, a negative age — is not data at all but a
 *    half-parsed row, and the whole quote refuses with "onRequest". Rendering
 *    "от N ₽" for such a lot puts a spendable number under nonsense;
 *  - a lot whose PRICE (or FX rate) is unusable can never be partial: there is
 *    no lower bound without a price, whatever the config happens to contain.
 *
 * The produced total is additionally re-checked for finiteness before it is
 * returned. A confidently wrong number is worse for the client than an honest
 * dash.
 */

import {
  CUSTOMS_FORMULA,
  type CustomsConfig,
  type DutyPerCcBracket,
  type DutyValueTier,
  type RecyclingDisplacementClass,
  type RecyclingPowerBracket,
  type WidgetConfig,
} from "../config.default";

export type FuelType = "gasoline" | "diesel" | "lpg" | "hybrid" | "electric";

export interface LotParams {
  priceKrw: number;
  /** Customs age in full years (computeAgeYears); undefined when unknown. */
  ageYears?: number;
  /** Engine displacement in cc; undefined for EV or when unknown. */
  engineCc?: number;
  /**
   * Engine power in hp — the third axis of the recycling fee since
   * 01.12.2025. The encar listing does not publish it, so it is normally
   * undefined and the fee line degrades to a dash; a manager-entered value
   * (or a future detail-page extraction) turns the line back into a number.
   */
  powerHp?: number;
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
  /**
   * Electric motor 30-minute power in hp (drom.ru specs catalog,
   * src/calc/specs.ts). The legal power basis for EVs and sequential hybrids
   * (акциз, утильсбор), and the second addend of a parallel hybrid's
   * recycling-fee power (ICE + 30-min electric, ПП №1291 ред. №1713).
   */
  electricHp30min?: number;
  /**
   * Powertrain kind for customs routing (specs catalog): "sequential"
   * (series-only, ТН ВЭД 8703 80 000 5) clears like an EV; "parallel"
   * (mechanical link, incl. series-parallel) clears under ЕЭК №107 by
   * displacement. Absent for non-hybrids or when the catalog has no match —
   * a hybrid without a kind keeps its power lines dashed.
   */
  hybridKind?: "parallel" | "sequential";
}

export interface FxRates {
  /** RUB per 1 KRW. */
  krwRub: number;
  /** RUB per 1 EUR. */
  eurRub: number;
}

interface CostLineBase {
  id: string;
  /** User-facing Russian label. */
  label: string;
  /** Optional detail for spot-checking: the applied rate, or why it is a dash. */
  note?: string;
}

/** A line carrying a real, rounded RUB amount. */
export interface ComputedCostLine extends CostLineBase {
  rub: number;
  unknown?: false;
}

/**
 * A line with NO amount: the UI renders UNKNOWN_DASH in place of the figure.
 *
 * `rub` is ABSENT rather than zero — a zero would sum silently into the total
 * and read as "free" on screen, which is precisely the failure this kind
 * exists to prevent. Consumers may branch either on `rub === undefined` or on
 * the explicit `unknown` flag (isUnknownLine).
 */
export interface UnknownCostLine extends CostLineBase {
  rub?: undefined;
  unknown: true;
}

export type CostLine = ComputedCostLine | UnknownCostLine;

/** True for a line the UI must render as a dash rather than as money. */
export function isUnknownLine(line: CostLine): line is UnknownCostLine {
  return line.unknown === true;
}

/** What the UI prints in place of an unknown line's amount. */
export const UNKNOWN_DASH = "—";

/**
 * exact     — all customs lines computed from full lot params;
 * approx    — same, but computed from partially estimated params (U7);
 * partial   — at least one customs line could not be computed; the total is a
 *             provable floor and must be rendered as "от N ₽";
 * onRequest — the lot price itself is unusable or the config carries a
 *             malformed item: no total may be shown.
 */
export type Precision = "exact" | "approx" | "partial" | "onRequest";

export interface AllInResult {
  items: CostLine[];
  /**
   * Sum of the COMPUTED lines only. Unknown (dashed) lines never contribute,
   * so under "partial" this is a floor, and under "onRequest" it covers the
   * known items only and must not be displayed.
   */
  totalRub: number;
  precision: Precision;
  /** User-facing Russian notes for the breakdown (may be empty). */
  notes: string[];
}

/**
 * Printed whenever the breakdown contains at least one dashed cost item, so
 * the client reads the total as what it is.
 */
export const UNKNOWN_COST_NOTE =
  "Итого — это цена лота и таможенные платежи. Доставка, оформление и комиссия показаны прочерком и в сумму не входят: их подтверждает менеджер.";

/** Printed when a customs line could not be computed for this lot. */
export const PARTIAL_CUSTOMS_NOTE =
  "Часть таможенных платежей не рассчитывается по данным объявления — итог показан как минимальная сумма.";

/** Reasons a customs line is a dash; shown as the line's own note. */
const NEED_LOT_PARAMS_NOTE = "нужны объём двигателя и год выпуска";
const NEED_POWER_NOTE = "нужна мощность двигателя (л.с.)";
const NEED_HYBRID_POWER_NOTE =
  "для гибрида нужна суммарная мощность ДВС и электромотора";
const NEED_EV_POWER_NOTE =
  "нужна 30-минутная мощность электромотора (л.с.)";
const VAT_NEEDS_EXCISE_NOTE = "считается после акциза (нужна мощность)";
const NEED_AGE_NOTE = "нужен год выпуска";

/**
 * EV / sequential-hybrid track (tks.ru parity): ЕЭК №107 единые ставки do
 * not cover ТН ВЭД 8703 80 000 3 (BEV) / 8703 80 000 5 (REEV), so a физлицо
 * pays the совокупный таможенный платёж instead: пошлина (ЕТТ, ad valorem)
 * + акциз (руб/л.с. of the motor's 30-minute power, ст.193 НК РФ) + НДС on
 * (стоимость + пошлина + акциз), plus утильсбор on its own EV grid and the
 * regular clearance fee.
 *
 * RATES LIVE HERE, NOT IN CONFIG, TEMPORARILY: src/config.default.ts /
 * site/config.json are owned by the live task/importer-pricing (architect
 * ruling 2026-08-08); migrating these tables into CustomsConfig is a planned
 * follow-up dispatch. The engine stays a bracket interpreter — every
 * function below takes the tables as parameters, and only computeAllIn
 * defaults to these constants.
 */
export interface ExciseBracket {
  /** Inclusive upper bound in hp; the last bracket omits it (open-ended). */
  maxHp?: number;
  rubPerHp: number;
}

export interface EvTrackRates {
  /** ISO date the encoded rules came into force (provenance, not a switch). */
  asOf: string;
  /** ЕТТ ЕАЭС ad valorem duty, % of the customs value. */
  dutyPct: number;
  /** НДС, % of (customs value + duty + акциз). */
  vatPct: number;
  /** Акциз on cars by power, руб за 1 л.с. (ст.193 НК РФ). */
  exciseBrackets: ExciseBracket[];
  /** Утильсбор for EVs/sequential hybrids by 30-minute power. */
  recycling: {
    reduced: RecyclingReducedEvRate;
    brackets: RecyclingPowerBracket[];
  };
}

export interface RecyclingReducedEvRate {
  /** The личное-пользование reduced rate holds up to this 30-min power. */
  maxHp: number;
  under3yRub: number;
  from3yRub: number;
}

/**
 * Values as of 2026-08-08 (verification pass in test/calc.test.ts pins the
 * boundaries; sources inline below).
 */
export const DEFAULT_EV_TRACK_RATES: EvTrackRates = {
  asOf: "2026-01-01",
  // ЕТТ ЕАЭС for 8703 80 000 3 / 8703 80 000 5 (Решение Коллегии ЕЭК №81 от
  // 23.09.2025, codes split in force 22.01.2026). The 0% privilege quota
  // (Решение Совета ЕЭК №111 от 05.12.2025) covers BY/AM/KG only — for a RU
  // buyer the rate is the plain 15%.
  dutyPct: 15,
  // НДС 22% с 01.01.2026 (ФЗ №425-ФЗ от 28.11.2025). tks.ru may still print
  // 20% on stale pages; 22% is what the border charges.
  vatPct: 22,
  // Акциз на легковые автомобили, ст.193 НК РФ, ставки 2026 (ФЗ №425-ФЗ),
  // руб за 1 л.с. (0,75 кВт). Power basis for this track: the electric
  // motor's 30-minute power.
  exciseBrackets: [
    { maxHp: 90, rubPerHp: 0 },
    { maxHp: 150, rubPerHp: 64 },
    { maxHp: 200, rubPerHp: 613 },
    { maxHp: 300, rubPerHp: 1004 },
    { maxHp: 400, rubPerHp: 1711 },
    { maxHp: 500, rubPerHp: 1771 },
    { rubPerHp: 1829 },
  ],
  // Утильсбор, ПП РФ №1291 в ред. ПП №1713 (01.12.2025) + индексация ПП
  // №1255 c 01.01.2026: льгота физлица/личное пользование 3 400 / 5 200 ₽
  // держится до 80 л.с. 30-минутной мощности; выше — полная EV-шкала.
  // EV/sequential-hybrid grid, приложение к ПП №1291 (ред. 06.02.2026),
  // items 1/3, 2026 column, база 20 000 ₽ (verified against the annex text
  // cell-by-cell, 2026-08-08; ПП №89 от 06.02.2026 не трогает физлиц; the
  // klerk.ru "отмена льготы" claim is refuted — its 150k base is раздел II,
  // грузовые). Brackets by 30-минутная мощность; the льгота 0.17/0.26 row
  // holds to 58,84 кВт = 80 л.с. Above 280 л.с. every annex row repeats the
  // same coefficients, hence one open-ended bracket.
  recycling: {
    reduced: { maxHp: 80, under3yRub: 3400, from3yRub: 5200 },
    brackets: [
      { maxHp: 80, under3yRub: 800800, from3yRub: 1408800 },
      { maxHp: 100, under3yRub: 991200, from3yRub: 1641600 },
      { maxHp: 130, under3yRub: 1317600, from3yRub: 1912800 },
      { maxHp: 160, under3yRub: 1560000, from3yRub: 2227200 },
      { maxHp: 190, under3yRub: 1848000, from3yRub: 2594400 },
      { maxHp: 220, under3yRub: 2193600, from3yRub: 3024000 },
      { maxHp: 250, under3yRub: 2599200, from3yRub: 3523200 },
      { maxHp: 280, under3yRub: 3079200, from3yRub: 4104000 },
      { under3yRub: 3648000, from3yRub: 4780800 },
    ],
  },
};

/** Labels for the EV-track lines (config-bound later, see EvTrackRates). */
const EXCISE_LABEL = "Акциз";
const VAT_LABEL = "НДС";

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
 * True when a lot param was SUPPLIED but cannot be a value: NaN/Infinity, or
 * a zero/negative where only a positive makes sense. `undefined` is not
 * invalid — it is the honest "not published on the page", which downstream
 * turns into a dashed line and a floor. Anything else is a half-parsed row and
 * must take the whole quote down with it.
 */
function isInvalid(
  value: unknown,
  valid: (candidate: unknown) => boolean,
): boolean {
  return value !== undefined && !valid(value);
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
 * Precision the given lot params can support for the DUTY block (U7, R3):
 * duty not computable (missing age/cc on the единые-ставки track) ->
 * "onRequest"; computable
 * from estimated params -> "approx"; otherwise "exact".
 *
 * Deliberately unchanged by the power-based recycling reform: this predicate
 * answers "how good are the lot params", the per-line degradation inside
 * computeAllIn answers "what can actually be quoted".
 *
 * "Missing" covers unusable numbers too: a half-parsed row that yields NaN
 * must degrade exactly like a row that yielded nothing.
 */
export function lotPrecision(
  lot: Omit<LotParams, "priceKrw">,
): Exclude<Precision, "partial"> {
  // EVs and sequential hybrids pay an ad-valorem duty (EV track): the duty
  // block needs nothing beyond the price, so the params never block it.
  const evTrack =
    lot.fuel === "electric" ||
    (lot.fuel === "hybrid" && lot.hybridKind === "sequential");
  const computable =
    evTrack || (isAge(lot.ageYears) && isPositive(lot.engineCc));
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
 *
 * KNOWN GAP — WRONG CLOCK, not just a coarse one. Решение 107 counts age from
 * the DATE OF MANUFACTURE (deemed the 15th of the manufacturing month, or
 * 1 July when only the year is known); this widget reads the FIRST
 * REGISTRATION month, which is all encar publishes. Registration is always
 * later than manufacture — by weeks for a domestic sale, by months for an
 * export unit — so every age computed here is biased YOUNG. Young is
 * conservative at the 3y cliff (the <3y percent regime is the dearer one) and
 * ANTI-CONSERVATIVE at the 5y cliff, where it keeps a car in the cheap 3-5
 * bracket and understates the duty: exactly the direction that costs the
 * importer money. isNearAgeBracket's +/-2 month window flags the common case;
 * the real fix needs a manufacture date from the scan layer, which no listing
 * row carries today. NOT FIXED HERE — recorded so the bias is not mistaken for
 * rounding.
 */
function ageMonths(regYear: number, regMonth: number, now: Date): number {
  return (
    (now.getFullYear() - regYear) * 12 + (now.getMonth() + 1 - regMonth) - 1
  );
}

/**
 * Customs age in years from the first registration (year, month 1-12) to
 * `now`, counted from the END of the registration month (see ageMonths).
 * Never negative.
 *
 * NOT floored. The duty regime boundaries fall inside a year ("более 3, но не
 * более 5 лет"), so a whole-year age cannot express them: flooring made every
 * car in its sixth year (60-71 months) read as exactly 5 and buy the cheaper
 * 3-5 bracket. The value is months/12, and the 36- and 60-month boundaries are
 * exactly representable, so the cliff comparisons in computeDutyEur are safe.
 */
export function computeAgeYears(
  regYear: number,
  regMonth: number,
  now: Date = new Date(),
): number {
  const months = ageMonths(regYear, regMonth, now);
  return months <= 0 ? 0 : months / 12;
}

/**
 * Duty regime boundaries in months: п.1 runs to 36 months, п.3 ("более 3, но
 * не более 5 лет") to 60, п.4 beyond. Months, not years — see computeAgeYears.
 */
const DUTY_BRACKET_MONTHS = { y3: 36, y5: 60 } as const;

/** Duty regime boundaries in months (3 and 5 years). */
const AGE_BRACKET_MONTHS = [DUTY_BRACKET_MONTHS.y3, DUTY_BRACKET_MONTHS.y5] as const;

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

/**
 * Duty in EUR per the age category (boundaries: <3, 3-5 incl., >5).
 *
 * The category is chosen from the age in MONTHS. In whole years the two
 * boundaries are not expressible: an age of "5" covers everything from the
 * fifth anniversary to one day short of the sixth, and п.4 ("более 5 лет")
 * starts in the middle of that span.
 */
function computeDutyEur(
  lotEur: number,
  ageYears: number,
  engineCc: number,
  customs: CustomsConfig,
): DutyEur {
  const months = ageYears * 12;
  if (months < DUTY_BRACKET_MONTHS.y3) {
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
    months <= DUTY_BRACKET_MONTHS.y5
      ? customs.dutyPerCcByAge.y3
      : customs.dutyPerCcByAge.y5plus;
  const bracket: DutyPerCcBracket = pickBracket(
    brackets,
    engineCc,
    (b) => b.maxCc,
  );
  return { eur: bracket.eurPerCc * engineCc, note: `${bracket.eurPerCc} € за см³` };
}

/**
 * Recycling fee in RUB (ПП РФ № 1713, in force 01.12.2025): the reduced
 * personal-use rate when the car is under BOTH caps, otherwise the full grid
 * cell for its displacement class and power bracket.
 */
function computeRecyclingRub(
  ageYears: number,
  engineCc: number,
  powerHp: number,
  customs: CustomsConfig,
): { rub: number; note: string } {
  const fee = customs.recyclingFee;
  // Same 3-year boundary as п.3 of the duty scale, counted in months (the age
  // is not floored, so this really is "36 full months", not "year 3").
  const used = ageYears * 12 >= DUTY_BRACKET_MONTHS.y3;
  const reduced = fee.reduced;
  if (engineCc <= reduced.maxCc && powerHp <= reduced.maxHp) {
    return {
      rub: used ? reduced.from3yRub : reduced.under3yRub,
      note: `льготная ставка (до ${reduced.maxHp} л.с., до ${reduced.maxCc} см³)`,
    };
  }
  const cls: RecyclingDisplacementClass = pickBracket(
    fee.classes,
    engineCc,
    (c) => c.maxCc,
  );
  const bracket: RecyclingPowerBracket = pickBracket(
    cls.powerBrackets,
    powerHp,
    (b) => b.maxHp,
  );
  return {
    rub: used ? bracket.from3yRub : bracket.under3yRub,
    note: `полная шкала (${powerHp} л.с., ${engineCc} см³)`,
  };
}

/** Clearance fee in RUB by the lot customs value. */
function computeClearanceRub(lotRub: number, customs: CustomsConfig): number {
  return pickBracket(customs.clearanceFeeBrackets, lotRub, (b) => b.maxRub).fee;
}

/** Акциз in RUB: bracket rate (руб/л.с.) times the power. */
function computeExciseRub(
  powerHp: number,
  brackets: readonly ExciseBracket[],
): { rub: number; note: string } {
  const bracket = pickBracket(brackets, powerHp, (b) => b.maxHp);
  return {
    rub: bracket.rubPerHp * powerHp,
    note: `${bracket.rubPerHp} ₽ за л.с. × ${powerHp} л.с.`,
  };
}

/**
 * Утильсбор for the EV/sequential-hybrid track: the reduced personal-use
 * rate up to the power cap, the EV grid above it. Same 36-month used/new
 * boundary as the rest of the engine.
 */
function computeEvRecyclingRub(
  ageYears: number,
  powerHp: number,
  rates: EvTrackRates,
): { rub: number; note: string } {
  const used = ageYears * 12 >= DUTY_BRACKET_MONTHS.y3;
  const reduced = rates.recycling.reduced;
  if (powerHp <= reduced.maxHp) {
    return {
      rub: used ? reduced.from3yRub : reduced.under3yRub,
      note: `льготная ставка (до ${reduced.maxHp} л.с. 30-мин. мощности)`,
    };
  }
  const bracket = pickBracket(
    rates.recycling.brackets,
    powerHp,
    (b) => b.maxHp,
  );
  return {
    rub: used ? bracket.from3yRub : bracket.under3yRub,
    note: `шкала для электромобилей (${powerHp} л.с.)`,
  };
}

/** A dashed line: no amount, no contribution to the total. */
function dash(id: string, label: string, note: string): UnknownCostLine {
  return { id, label, unknown: true, note };
}

/**
 * All-in cost of importing the lot: the lot price plus every config cost
 * item, with "formula" items expanded into the customs lines (duty, recycling
 * fee, clearance fee). Each customs line is computed independently, so one
 * missing lot param dashes one line instead of killing the whole quote.
 * Amounts are rounded per item; the total is the sum of the computed lines.
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
  // A lot param that arrived as NaN/Infinity/0/negative is a broken reading,
  // not an absent one: no line of this quote may be shown, not even as a
  // floor. Absent params (undefined) are deliberately NOT listed here.
  const paramsMalformed =
    isInvalid(lot.ageYears, isAge) ||
    isInvalid(lot.engineCc, isPositive) ||
    isInvalid(lot.powerHp, isPositive) ||
    isInvalid(lot.electricHp30min, isPositive);
  const lotRub = priceKnown ? Math.round(lot.priceKrw * rates.krwRub) : 0;
  // Unrounded customs value in EUR for the <3y percent tiers.
  const lotEur = priceKnown ? (lot.priceKrw * rates.krwRub) / rates.eurRub : 0;
  const customs = config.customs;

  // EVs and sequential hybrids fall outside ЕЭК №107 and pay the совокупный
  // платёж instead (EV track, see EvTrackRates); everything else keeps the
  // единые-ставки block. A hybrid with an unknown kind stays on the default
  // track — its duty computes by displacement, its power lines dash.
  const evTrack =
    lot.fuel === "electric" ||
    (lot.fuel === "hybrid" && lot.hybridKind === "sequential");
  const canExpandCustoms = priceKnown;

  const items: CostLine[] = [];
  if (priceKnown) {
    items.push({ id: "lot", label: "Цена лота", rub: lotRub });
  }

  // A cost item the calculator cannot turn into a line must not just vanish:
  // an omitted item is a total that is short by exactly that item, with
  // nothing looking broken. Any such item demotes the quote to "on request".
  // An "unknown" item is NOT such an item — it is a deliberate dash.
  let unhandled = false;
  let customsExpanded = false;
  let customsIncomplete = false;
  let hasDashedItem = false;

  for (const item of config.costItems) {
    if (item.kind === "unknown") {
      // Not priced yet: a dash that costs the quote no confidence at all.
      hasDashedItem = true;
      items.push(dash(item.id, item.label, "уточняет менеджер"));
    } else if (item.kind === "fixed") {
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
      canExpandCustoms &&
      !customsExpanded
    ) {
      customsExpanded = true;
      const ageYears = lot.ageYears;

      if (evTrack) {
        // --- EV / sequential-hybrid track: пошлина + акциз + НДС +
        // утильсбор (EV grid) + оформление. Power basis throughout is the
        // electric motor's 30-minute power.
        const ev = DEFAULT_EV_TRACK_RATES;
        const evPowerHp = lot.electricHp30min;
        const dutyRub = Math.round((lotRub * ev.dutyPct) / 100);
        items.push({
          id: "duty",
          label: customs.labels.duty,
          rub: dutyRub,
          note: `${ev.dutyPct}% таможенной стоимости (ТН ВЭД 8703 80)`,
        });

        if (isPositive(evPowerHp)) {
          const excise = computeExciseRub(evPowerHp, ev.exciseBrackets);
          const exciseRub = Math.round(excise.rub);
          items.push({
            id: "excise",
            label: EXCISE_LABEL,
            rub: exciseRub,
            note: excise.note,
          });
          items.push({
            id: "vat",
            label: VAT_LABEL,
            rub: Math.round(
              ((lotRub + dutyRub + exciseRub) * ev.vatPct) / 100,
            ),
            note: `${ev.vatPct}% (стоимость + пошлина + акциз)`,
          });
        } else {
          // Without the power there is no акциз figure, and a НДС computed
          // on a smaller base would print a number that is not the tax: both
          // lines dash, the total stays a provable floor.
          customsIncomplete = true;
          items.push(dash("excise", EXCISE_LABEL, NEED_EV_POWER_NOTE));
          items.push(dash("vat", VAT_LABEL, VAT_NEEDS_EXCISE_NOTE));
        }

        if (isAge(ageYears) && isPositive(evPowerHp)) {
          const recycling = computeEvRecyclingRub(ageYears, evPowerHp, ev);
          items.push({
            id: "recycling",
            label: customs.labels.recycling,
            rub: Math.round(recycling.rub),
            note: recycling.note,
          });
        } else {
          customsIncomplete = true;
          items.push(
            dash(
              "recycling",
              customs.labels.recycling,
              isPositive(evPowerHp) ? NEED_AGE_NOTE : NEED_EV_POWER_NOTE,
            ),
          );
        }

        items.push({
          id: "clearance",
          label: customs.labels.clearance,
          rub: Math.round(computeClearanceRub(lotRub, customs)),
        });
      } else {
        const engineCc = lot.engineCc;
        const dutyKnown = isAge(ageYears) && isPositive(engineCc);

        if (dutyKnown) {
          const duty = computeDutyEur(lotEur, ageYears, engineCc, customs);
          items.push({
            id: "duty",
            label: customs.labels.duty,
            rub: Math.round(duty.eur * rates.eurRub),
            note: duty.note,
          });
        } else {
          customsIncomplete = true;
          items.push(dash("duty", customs.labels.duty, NEED_LOT_PARAMS_NOTE));
        }

        // A parallel hybrid's fee is looked up on ICE power PLUS the
        // electric motor's 30-minute power (annex сноска 2); the fee line
        // computes only when the catalog delivered both figures and the kind
        // is known to be parallel — otherwise it dashes.
        const hybrid = lot.fuel === "hybrid";
        const iceHp = lot.powerHp;
        const feePowerHp = hybrid
          ? lot.hybridKind === "parallel" &&
            isPositive(iceHp) &&
            isPositive(lot.electricHp30min)
            ? iceHp + lot.electricHp30min
            : undefined
          : iceHp;
        if (dutyKnown && isPositive(feePowerHp)) {
          const recycling = computeRecyclingRub(
            ageYears,
            engineCc,
            feePowerHp,
            customs,
          );
          items.push({
            id: "recycling",
            label: customs.labels.recycling,
            rub: Math.round(recycling.rub),
            note: hybrid
              ? `${recycling.note} — мощность ДВС + электромотора`
              : recycling.note,
          });
        } else {
          customsIncomplete = true;
          items.push(
            dash(
              "recycling",
              customs.labels.recycling,
              hybrid
                ? NEED_HYBRID_POWER_NOTE
                : dutyKnown
                  ? NEED_POWER_NOTE
                  : NEED_LOT_PARAMS_NOTE,
            ),
          );
        }

        // The clearance fee only needs the lot value (priceKnown proved it).
        items.push({
          id: "clearance",
          label: customs.labels.clearance,
          rub: Math.round(computeClearanceRub(lotRub, customs)),
        });
      }
    } else {
      // Unknown formula identifier, a duplicate customs item, or a lot
      // whose price is unusable: a config/lot problem, not a priced-later one.
      unhandled = true;
    }
  }

  // Last line of defence (the "≈ NaN ₽" guard): a single non-finite line would
  // poison the total, so unusable lines are dropped and the quote is demoted to
  // "on request". The returned total is finite by construction.
  // Filtering and summing are done with a plain loop ON PURPOSE. www.encar.com
  // loads an ES5 bundle that REPLACES built-ins, and its Array.prototype.reduce
  // ignores the callback and returns the array itself (measured live
  // 2026-08-02: `[1,2,3].reduce((s,x)=>s+x,0)` yielded `[1,2,3]`). The total
  // then failed Number.isFinite, every quote degraded, and the whole desktop
  // listing read "по запросу" — the honest marker, for a dishonest reason.
  // A for-of loop is syntax: the host page cannot replace it.
  const usable: CostLine[] = [];
  let summed = 0;
  for (const item of items) {
    if (isUnknownLine(item)) {
      usable.push(item);
      continue;
    }
    if (!Number.isFinite(item.rub)) continue;
    usable.push(item);
    summed += item.rub;
  }
  const totalRub = Number.isFinite(summed) ? summed : 0;
  // Refusal beats a floor. An unusable price leaves nothing to bound the total
  // from below (and a config without a customs item would otherwise report the
  // fixed lines as an "exact" quote); a malformed param means the row was read
  // wrong, and a number built on it is worse than no number at all.
  const degraded =
    unhandled ||
    !priceKnown ||
    paramsMalformed ||
    usable.length !== items.length ||
    !Number.isFinite(summed);

  const notes: string[] = [];
  let finalPrecision: Precision;
  if (degraded) {
    finalPrecision = "onRequest";
  } else if (customsIncomplete) {
    // A floor, not a wall: the UI renders this as "от N ₽".
    finalPrecision = "partial";
    notes.push(PARTIAL_CUSTOMS_NOTE);
  } else {
    finalPrecision = lot.estimated === true ? "approx" : "exact";
  }

  // Close to a duty bracket boundary the unknown registration day can still
  // move the lot into another regime: honest "approx" plus a visible reason.
  if (customsExpanded && lot.ageNearBracket === true) {
    notes.push(AGE_BRACKET_NOTE);
    if (finalPrecision === "exact") finalPrecision = "approx";
  }

  if (hasDashedItem) notes.push(UNKNOWN_COST_NOTE);

  return { items: usable, totalRub, precision: finalPrecision, notes };
}
