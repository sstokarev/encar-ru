/**
 * Embedded fallback copy of the importer config (U2, KTD1).
 *
 * MUST be kept in sync with site/config.json manually: this constant is
 * bundled into widget.js at build time and is used only when the remote
 * config.json cannot be fetched (breakdown then shows the embedded marker).
 *
 * User-facing labels are Russian by design; code and comments stay English.
 */

export type MessengerType = "telegram" | "whatsapp";
export type CostItemKind =
  | "fixed"
  | "percent"
  | "formula"
  | "unknown"
  | "krw"
  | "ladder";

export interface MessengerConfig {
  type: MessengerType;
  /** Telegram username (no @) or WhatsApp phone number in wa.me format. */
  address: string;
}

/**
 * The only formula identifier the calculator recognises: it expands into the
 * whole customs block (duty + recycling fee + clearance fee). A config may
 * carry at most one such item — two would count customs twice.
 */
export const CUSTOMS_FORMULA = "customs_v1";

interface CostItemBase {
  id: string;
  /** User-facing Russian label. */
  label: string;
}

/** RUB amount added as-is. */
export interface FixedCostItem extends CostItemBase {
  kind: "fixed";
  value: number;
}

/** Percent of the lot RUB price. */
export interface PercentCostItem extends CostItemBase {
  kind: "percent";
  value: number;
}

/** Formula identifier (CUSTOMS_FORMULA), expanded by src/calc/customs.ts. */
export interface FormulaCostItem extends CostItemBase {
  kind: "formula";
  value: string;
}

/**
 * A cost the importer has NOT priced yet. It carries no amount at all: the
 * breakdown renders it as a dash and the total simply does not include it.
 *
 * Deliberately distinct from a malformed item (a quoted "220000" on a fixed
 * item): a malformed item is a config bug and still degrades the quote to
 * "по запросу", an "unknown" item is an editorial decision and degrades
 * nothing. `value` is forbidden — an amount here would be shown as a dash and
 * silently dropped from the total, which is the exact failure this kind exists
 * to prevent.
 */
export interface UnknownCostItem extends CostItemBase {
  kind: "unknown";
  value?: undefined;
}

/**
 * A cost priced in WON at the Korean end (export paperwork, freight). It is
 * added to the lot price BEFORE the FX conversion, which is not a cosmetic
 * difference: folded in first it lands inside the CUSTOMS VALUE, which is
 * where the clearance-fee bracket and the <3y duty tiers read the number from
 * — and that is the legally correct place, since the customs value includes
 * delivery to the border. As a RUB line added afterwards it would sit outside
 * every tariff bracket and quote a different (lower) duty on the same car.
 *
 * Interpreted by src/calc/pricing.ts, never by computeAllIn: the engine only
 * ever sees the already-folded price.
 */
export interface KrwCostItem extends CostItemBase {
  kind: "krw";
  /** Amount in KRW. */
  value: number;
}

/**
 * One step of a commission ladder.
 *
 * `underRub` is an EXCLUSIVE upper bound — the only bracket array in this
 * codebase that is, which is why it is not called `maxRub` like the tariff
 * brackets in CustomsConfig. The operator stated the ladder that way («до
 * 1,5 млн» / «1,5-5,5 млн»), so at exactly 1 500 000 the fee is the SECOND
 * step, not the first. A `maxRub` here would quote 30 000 instead of 50 000 on
 * the boundary and nobody would notice until a client landed on it.
 */
export interface LadderBracket {
  /** Exclusive upper bound of the pre-commission subtotal in RUB. */
  underRub?: number;
  /** Commission in RUB. */
  fee: number;
}

/**
 * The importer's commission: a step function of the subtotal of every OTHER
 * line (lot price + Korean costs + customs + broker), so it can only be
 * computed once the rest of the quote exists — which is why it is not a
 * `percent` item and why src/calc/pricing.ts always evaluates it last,
 * whatever position it holds in `costItems`.
 *
 * Brackets on the subtotal BEFORE commission, not on the final total: the
 * latter is self-referential (just under a boundary, adding the smaller
 * commission pushes the total across it, and the rule then disagrees with
 * itself). Architect decision 2026-08-08; one line to flip in pricing.ts.
 */
export interface LadderCostItem extends CostItemBase {
  kind: "ladder";
  /** Ascending; the last entry carries no bound (open end). */
  brackets: LadderBracket[];
  value?: undefined;
}

/**
 * `kind` types `value`: a quoted number ("220000") on a fixed item is a config
 * error, not a cost line — the calculator cannot add a string, and silently
 * skipping it hid a whole shipping line from the total.
 *
 * WHY "krw" AND "ladder" LIVE HERE AND NOT IN NEW TOP-LEVEL CONFIG KEYS — do
 * not "simplify" this back. The core is BUNDLED into the MV3 extension
 * (docs/harness/project.md), so an installed extension keeps running an OLD
 * validator against the NEW remote site/config.json. A config carrying an
 * unrecognised cost-item KIND fails that old validator outright, and the old
 * client falls back to its embedded copy: today's honest dashes behind the
 * «встроенные тарифы» marker. The same data parked in new top-level keys would
 * be silently ignored instead — the old client would accept the config, see no
 * dashed item, and print an "exact" total missing the Korean costs and the
 * commission (~3.7% low on the operator's own quote). An old client that
 * REJECTS what it does not understand is strictly better than one that
 * accepts it: a confidently wrong number is the single failure this whole
 * module is built to prevent.
 */
export type CostItem =
  | FixedCostItem
  | PercentCostItem
  | FormulaCostItem
  | UnknownCostItem
  | KrwCostItem
  | LadderCostItem;

/**
 * Customs tariff schema (U6, R10-R11): formulas are DATA the importer edits,
 * the calculator (src/calc/customs.ts) only interprets brackets. Every
 * bracket array is ordered ascending and its last entry MUST be open-ended
 * (no max* field) — the config validator enforces this.
 *
 * REGIME MODELLED: personal use by an individual ("единая ставка", ПТД).
 * That is the route the Korean import market actually uses; it is also the
 * conservative one for a used 3-7 year old car, because the combined rate
 * (1.5-5.7 €/cm³) quotes far more than the commercial ЕТТ duty (20% with a
 * 0.32-0.8 €/cm³ floor) before the commercial route's excise + 22% VAT are
 * added. The commercial regime is a separate code path and is NOT implemented.
 */

/** Age <3y duty tier: percent of the customs value with a EUR/cc minimum. */
export interface DutyValueTier {
  /** Upper bound of the customs value in EUR, inclusive; absent = open end. */
  maxEur?: number;
  /** Percent of the customs value (EUR). */
  pct: number;
  /** Minimum duty in EUR per cc of engine displacement. */
  minPerCc: number;
}

/** Flat EUR-per-cc duty bracket (ages 3-5 and >5). */
export interface DutyPerCcBracket {
  /** Upper displacement bound in cc, inclusive; absent = open end. */
  maxCc?: number;
  eurPerCc: number;
}

/**
 * Reduced ("льготный") personal-use recycling fee. Coefficients 0.17 / 0.26
 * of the 20 000 RUB base rate; they are explicitly excluded from the annual
 * indexation, hence the flat 3 400 / 5 200 RUB. Applies ONLY when BOTH caps
 * hold — since 01.12.2025 a personal-use car above the power cap falls onto
 * the commercial grid below.
 */
export interface RecyclingReducedRate {
  /** Displacement cap in cc, inclusive. */
  maxCc: number;
  /** Engine power cap in hp, inclusive. */
  maxHp: number;
  under3yRub: number;
  from3yRub: number;
}

/** One power bracket of the recycling-fee grid, RUB. */
export interface RecyclingPowerBracket {
  /** Upper bound of engine power in hp, inclusive; absent = open end. */
  maxHp?: number;
  under3yRub: number;
  from3yRub: number;
}

/** One displacement class of the recycling-fee grid. */
export interface RecyclingDisplacementClass {
  /** Upper displacement bound in cc, inclusive; absent = open end. */
  maxCc?: number;
  /** Power brackets, ascending; the last one is open-ended. */
  powerBrackets: RecyclingPowerBracket[];
}

/**
 * Recycling fee (утильсбор), RUB.
 *
 * Since ПП РФ от 01.11.2025 № 1713 (in force 01.12.2025) the fee is a
 * three-dimensional lookup — displacement class x engine POWER x age — not a
 * displacement-only pair. Engine power is not on the encar listing, so the
 * calculator dashes this line rather than guessing between 5 200 RUB and
 * seven figures (см. src/calc/customs.ts).
 */
export interface RecyclingFeeConfig {
  reduced: RecyclingReducedRate;
  /** Full (commercial) grid, ascending by displacement; last class open. */
  classes: RecyclingDisplacementClass[];
  /** Free-form importer note (JSON has no comments). */
  comment?: string;
}

/** Clearance fee (сбор за оформление) bracket by lot customs value in RUB. */
export interface ClearanceFeeBracket {
  /** Upper bound of the customs value in RUB, inclusive; absent = open end. */
  maxRub?: number;
  /** Fee in RUB. */
  fee: number;
}

export interface CustomsConfig {
  /** ISO date the encoded rules came into force (not the day they were read). */
  asOf: string;
  /** User-facing Russian labels of the computed customs breakdown items. */
  labels: { duty: string; recycling: string; clearance: string };
  /** Age <3y duty tiers by customs value. */
  dutyValueTiers: DutyValueTier[];
  /** Flat per-cc duty brackets: y3 = 3-5 years inclusive, y5plus = >5. */
  dutyPerCcByAge: { y3: DutyPerCcBracket[]; y5plus: DutyPerCcBracket[] };
  recyclingFee: RecyclingFeeConfig;
  clearanceFeeBrackets: ClearanceFeeBracket[];
}

export interface WidgetConfig {
  version: number;
  messenger: MessengerConfig;
  currency: {
    /** Reference FX rates; also the plausibility anchor for U5 (KTD2). */
    referenceRates: { KRW_RUB: number; EUR_RUB: number };
    /** ISO date the reference rates were last edited. */
    updatedAt: string;
  };
  costItems: CostItem[];
  customs: CustomsConfig;
  /** User-facing Russian disclaimer shown in the breakdown. */
  commissionNote: string;
}

export const DEFAULT_CONFIG: WidgetConfig = {
  // 2 = the operator's real pricing model (2026-08-08): Korean costs in WON
  // folded before conversion, a fixed broker line, a commission ladder, no
  // СБКТС/ЭПТС line. No code reads this number; it dates the schema for the
  // next person diffing a deployed config against the source.
  version: 2,
  messenger: {
    // The importer's real channel (t.me/globalcartrade). This embedded copy is
    // what the "Заказать" button uses when site/config.json cannot be fetched,
    // so it must be kept in step with it — a stale address here sends the
    // client's order to nobody, and silently.
    type: "telegram",
    address: "globalcartrade",
  },
  currency: {
    referenceRates: {
      KRW_RUB: 0.055,
      EUR_RUB: 90.0,
    },
    updatedAt: "2026-08-01",
  },
  // The operator's real model, handed over 2026-08-08 as a worked quote
  // (docs/tasks/importer-pricing.md). Nothing is "unknown" any more: every
  // line carries a number, so the total is a real "под ключ во Владивостоке"
  // figure rather than "lot price + customs" with four dashes.
  //
  // The old "Доставка Корея — Владивосток" line is gone as a RUB item and came
  // back as the "krw" one below — his freight is quoted in WON and converted
  // together with the car. The old "СБКТС и ЭПТС" line is gone outright: his
  // quote is под ключ во Владивостоке and does not charge it separately.
  costItems: [
    {
      id: "korea",
      label: "Расходы по Корее (экспорт, фрахт)",
      kind: "krw",
      value: 2_500_000,
    },
    {
      id: "customs",
      label: "Таможенные платежи",
      kind: "formula",
      value: "customs_v1",
    },
    {
      id: "broker",
      label: "Брокерские услуги и тариф СВХ",
      kind: "fixed",
      value: 116_000,
    },
    {
      id: "commission",
      label: "Комиссия GlobalCarTrade",
      kind: "ladder",
      brackets: [
        { underRub: 1_500_000, fee: 30_000 },
        { underRub: 5_500_000, fee: 50_000 },
        { underRub: 9_500_000, fee: 75_000 },
        { fee: 100_000 },
      ],
    },
  ],
  customs: {
    // The most recent in-force date among the encoded rules: ПП РФ 1638
    // (clearance fee) and the +20% утильсбор indexation both start 01.01.2026.
    // The duty scale itself is older (Решение 107, ред. 24.02.2026 — that
    // amendment is EV-only and touches no ICE rate).
    asOf: "2026-01-01",
    labels: {
      duty: "Таможенная пошлина",
      recycling: "Утилизационный сбор",
      clearance: "Сбор за таможенное оформление",
    },
    // Решение Совета ЕЭК от 20.12.2017 № 107, Приложение 2, Таблица 2, п. 1
    // (cars less than 3 years old): percent of the customs value in EUR with
    // a EUR/cm³ floor, tier chosen by the customs value.
    // Source: prg.kz verbatim quote + tks.ru + alta.ru summary (the EEC's own
    // PDF could not be text-extracted). Combined payment — it replaces import
    // duty, VAT and excise, so nothing else is added on top.
    dutyValueTiers: [
      { maxEur: 8500, pct: 54, minPerCc: 2.5 },
      { maxEur: 16700, pct: 48, minPerCc: 3.5 },
      { maxEur: 42300, pct: 48, minPerCc: 5.5 },
      { maxEur: 84500, pct: 48, minPerCc: 7.5 },
      { maxEur: 169000, pct: 48, minPerCc: 15 },
      { pct: 48, minPerCc: 20 },
    ],
    dutyPerCcByAge: {
      // Решение 107, Прил. 2, Табл. 2, п. 3 — more than 3 but not more than
      // 5 years. Flat EUR/cm³ on the FULL displacement, no "не менее" floor.
      y3: [
        { maxCc: 1000, eurPerCc: 1.5 },
        { maxCc: 1500, eurPerCc: 1.7 },
        { maxCc: 1800, eurPerCc: 2.5 },
        { maxCc: 2300, eurPerCc: 2.7 },
        { maxCc: 3000, eurPerCc: 3.0 },
        { eurPerCc: 3.6 },
      ],
      // Решение 107, Прил. 2, Табл. 2, п. 4 — more than 5 years. There is NO
      // 5-7 / >7 split in the personal-use scale (that split exists only in
      // the commercial ЕТТ), so this bracket runs to any age.
      y5plus: [
        { maxCc: 1000, eurPerCc: 3.0 },
        { maxCc: 1500, eurPerCc: 3.2 },
        { maxCc: 1800, eurPerCc: 3.5 },
        { maxCc: 2300, eurPerCc: 4.8 },
        { maxCc: 3000, eurPerCc: 5.0 },
        { eurPerCc: 5.7 },
      ],
    },
    // ПП РФ от 26.12.2013 № 1291 в ред. ПП РФ от 01.11.2025 № 1713 (в силе с
    // 01.12.2025), 2026 column. Base rate M1 = 20 000 RUB, fee = 20 000 x K.
    // Power brackets step by 22.07 kW = 30 hp at 1 hp = 0.7355 kW; the hp
    // bounds below are exact conversions of the decree's kW bounds
    // (117.68 kW = 160 hp, 139.75 = 190, 161.81 = 220, 183.88 = 250,
    // 205.94 = 280, 228.00 = 310, 250.07 = 340, 272.13 = 370, 294.20 = 400,
    // 316.26 = 430, 338.33 = 460, 367.75 = 500).
    // 2026 amounts = 20 000 RUB x the published 2026 coefficient,
    // cross-validated row by row against four published 2026 tables
    // (renins.ru, ucsol.ru, carwin.ru, top-autoimport.ru).
    // Every coefficient in the decree carries at most TWO decimals, so every
    // amount here is a whole multiple of 20 000 x 0.01 = 200 RUB (pinned in
    // test/config-file.test.ts). Nine amounts used to be the 2025 column
    // multiplied by 1.2, which leaves a third decimal in the implied
    // coefficient and misquotes the row by up to 80 RUB (e.g. 112.524 instead
    // of the published 112.52 for 2001-3000 cm³ / <=160 hp): those are now
    // recomputed from the rounded coefficient, not carried over from the
    // multiplication.
    recyclingFee: {
      // Льготный утильсбор: coefficients 0.17 / 0.26, not indexed since 2014.
      // Both caps are cumulative and both come from ПП 1713: above 160 hp
      // (117.68 kW) OR above 3000 cm³ the commercial grid applies in full.
      reduced: {
        maxCc: 3000,
        maxHp: 160,
        under3yRub: 3400,
        from3yRub: 5200,
      },
      classes: [
        {
          // ICE <= 1000 cm³. Only five power rows: the decree flattens
          // everything above 183.88 kW (250 hp) into one line.
          maxCc: 1000,
          powerBrackets: [
            { maxHp: 160, under3yRub: 297600, from3yRub: 552000 },
            { maxHp: 190, under3yRub: 307200, from3yRub: 568600 },
            { maxHp: 220, under3yRub: 316800, from3yRub: 585600 },
            { maxHp: 250, under3yRub: 324000, from3yRub: 602400 },
            { under3yRub: 345600, from3yRub: 602400 },
          ],
        },
        {
          // ICE 1001-2000 cm³ — the main bracket for Korean imports.
          maxCc: 2000,
          powerBrackets: [
            { maxHp: 160, under3yRub: 800800, from3yRub: 1408800 },
            { maxHp: 190, under3yRub: 900000, from3yRub: 1492800 },
            { maxHp: 220, under3yRub: 952800, from3yRub: 1584000 },
            { maxHp: 250, under3yRub: 1010400, from3yRub: 1677600 },
            { maxHp: 280, under3yRub: 1142400, from3yRub: 1838400 },
            { maxHp: 310, under3yRub: 1291200, from3yRub: 2011200 },
            { maxHp: 340, under3yRub: 1459200, from3yRub: 2203200 },
            { maxHp: 370, under3yRub: 1663200, from3yRub: 2412000 },
            { maxHp: 400, under3yRub: 1896000, from3yRub: 2640000 },
            { maxHp: 430, under3yRub: 2160000, from3yRub: 2892000 },
            { maxHp: 460, under3yRub: 2464800, from3yRub: 3168000 },
            { maxHp: 500, under3yRub: 2808000, from3yRub: 3468000 },
            { under3yRub: 3201600, from3yRub: 3796800 },
          ],
        },
        {
          // ICE 2001-3000 cm³.
          maxCc: 3000,
          powerBrackets: [
            { maxHp: 160, under3yRub: 2250400, from3yRub: 3407200 },
            { maxHp: 190, under3yRub: 2306600, from3yRub: 3456000 },
            { maxHp: 220, under3yRub: 2364000, from3yRub: 3501600 },
            { maxHp: 250, under3yRub: 2402400, from3yRub: 3552000 },
            { maxHp: 280, under3yRub: 2520000, from3yRub: 3660000 },
            { maxHp: 310, under3yRub: 2620800, from3yRub: 3770400 },
            { maxHp: 340, under3yRub: 2726400, from3yRub: 3873600 },
            { maxHp: 370, under3yRub: 2834400, from3yRub: 3981600 },
            { maxHp: 400, under3yRub: 2949600, from3yRub: 4094400 },
            { maxHp: 430, under3yRub: 3067200, from3yRub: 4209600 },
            { maxHp: 460, under3yRub: 3189600, from3yRub: 4327200 },
            { maxHp: 500, under3yRub: 3316800, from3yRub: 4447200 },
            { under3yRub: 3448800, from3yRub: 4572000 },
          ],
        },
        {
          // ICE 3001-3500 cm³.
          maxCc: 3500,
          powerBrackets: [
            { maxHp: 160, under3yRub: 2584000, from3yRub: 3956200 },
            { maxHp: 190, under3yRub: 2635200, from3yRub: 4000800 },
            { maxHp: 220, under3yRub: 2688000, from3yRub: 4044000 },
            { maxHp: 250, under3yRub: 2743200, from3yRub: 4087200 },
            { maxHp: 280, under3yRub: 2810400, from3yRub: 4144800 },
            { maxHp: 310, under3yRub: 2880000, from3yRub: 4248000 },
            { maxHp: 340, under3yRub: 3038400, from3yRub: 4356000 },
            { maxHp: 370, under3yRub: 3206400, from3yRub: 4485600 },
            { maxHp: 400, under3yRub: 3384000, from3yRub: 4620000 },
            { maxHp: 430, under3yRub: 3568800, from3yRub: 4759200 },
            { maxHp: 460, under3yRub: 3765600, from3yRub: 4900800 },
            { maxHp: 500, under3yRub: 3972000, from3yRub: 5049600 },
            { under3yRub: 4190400, from3yRub: 5200800 },
          ],
        },
        {
          // ICE > 3500 cm³.
          powerBrackets: [
            { maxHp: 160, under3yRub: 3290600, from3yRub: 4325800 },
            { maxHp: 190, under3yRub: 3345600, from3yRub: 4389600 },
            { maxHp: 220, under3yRub: 3403200, from3yRub: 4456800 },
            { maxHp: 250, under3yRub: 3460800, from3yRub: 4524000 },
            { maxHp: 280, under3yRub: 3530400, from3yRub: 4627200 },
            { maxHp: 310, under3yRub: 3600000, from3yRub: 4732800 },
            { maxHp: 340, under3yRub: 3727200, from3yRub: 4992000 },
            { maxHp: 370, under3yRub: 3857600, from3yRub: 5268000 },
            { maxHp: 400, under3yRub: 3993600, from3yRub: 5558400 },
            { maxHp: 430, under3yRub: 4132800, from3yRub: 5863200 },
            { maxHp: 460, under3yRub: 4276800, from3yRub: 6187200 },
            { maxHp: 500, under3yRub: 4425600, from3yRub: 6528000 },
            { under3yRub: 4581600, from3yRub: 6885600 },
          ],
        },
      ],
      comment:
        "Утильсбор с 01.12.2025 зависит от мощности двигателя (ПП РФ № 1713). Льгота 3 400 / 5 200 ₽ — только до 160 л.с. и до 3000 см³; выше действует полная шкала. Мощность в объявлении encar не публикуется, поэтому строка показывается прочерком.",
    },
    // ПП РФ от 28.11.2024 № 1637 в ред. ПП РФ от 23.10.2025 № 1638, в силе с
    // 01.01.2026. Charged on the customs value, identically for individuals.
    // The 4 200 001-5 500 000 bracket (21 344 ₽) is the one that did not rise
    // vs 2025; four secondary sources print it, so it is kept as published.
    clearanceFeeBrackets: [
      { maxRub: 200000, fee: 1231 },
      { maxRub: 450000, fee: 2462 },
      { maxRub: 1200000, fee: 4924 },
      { maxRub: 2700000, fee: 13541 },
      { maxRub: 4200000, fee: 18465 },
      { maxRub: 5500000, fee: 21344 },
      { maxRub: 10000000, fee: 49240 },
      { fee: 73860 },
    ],
  },
  commissionNote:
    "Суммы предварительные: точный расчёт подтверждает менеджер перед заказом.",
};
