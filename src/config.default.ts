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
export type CostItemKind = "fixed" | "percent" | "formula";

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
 * `kind` types `value`: a quoted number ("220000") on a fixed item is a config
 * error, not a cost line — the calculator cannot add a string, and silently
 * skipping it hid a whole shipping line from the total.
 */
export type CostItem = FixedCostItem | PercentCostItem | FormulaCostItem;

/**
 * Customs tariff schema (U6, R10-R11): formulas are DATA the importer edits,
 * the calculator (src/calc/customs.ts) only interprets brackets. Every
 * bracket array is ordered ascending and its last entry MUST be open-ended
 * (no max* field) — the config validator enforces this.
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

/** Recycling fee (утильсбор) for personal use, RUB. */
export interface RecyclingFeeConfig {
  /** Displacement bound (inclusive) separating the small and large rates. */
  smallMaxCc: number;
  smallUnder3yRub: number;
  smallFrom3yRub: number;
  /** Placeholder values for >smallMaxCc — editable, confirm with the broker. */
  largeUnder3yRub: number;
  largeFrom3yRub: number;
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
  /** Month the tariff data was last checked against public sources. */
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
  version: 1,
  messenger: {
    type: "telegram",
    address: "encar_ru_import",
  },
  currency: {
    referenceRates: {
      KRW_RUB: 0.055,
      EUR_RUB: 90.0,
    },
    updatedAt: "2026-08-01",
  },
  costItems: [
    {
      id: "shipping",
      label: "Доставка Корея — Владивосток",
      kind: "fixed",
      value: 220000,
    },
    {
      id: "customs",
      label: "Таможенные платежи",
      kind: "formula",
      value: "customs_v1",
    },
    {
      id: "sbkts",
      label: "СБКТС и ЭПТС",
      kind: "fixed",
      value: 45000,
    },
    {
      id: "broker",
      label: "Брокер и СВХ",
      kind: "fixed",
      value: 85000,
    },
    {
      id: "commission",
      label: "Комиссия импортёра",
      kind: "percent",
      value: 5,
    },
  ],
  customs: {
    asOf: "2026-08",
    labels: {
      duty: "Таможенная пошлина",
      recycling: "Утилизационный сбор",
      clearance: "Сбор за таможенное оформление",
    },
    dutyValueTiers: [
      { maxEur: 8500, pct: 54, minPerCc: 2.5 },
      { maxEur: 16700, pct: 48, minPerCc: 3.5 },
      { maxEur: 42300, pct: 48, minPerCc: 5.5 },
      { maxEur: 84500, pct: 48, minPerCc: 7.5 },
      { maxEur: 169000, pct: 48, minPerCc: 15 },
      { pct: 48, minPerCc: 20 },
    ],
    dutyPerCcByAge: {
      y3: [
        { maxCc: 1000, eurPerCc: 1.5 },
        { maxCc: 1500, eurPerCc: 1.7 },
        { maxCc: 1800, eurPerCc: 2.5 },
        { maxCc: 2300, eurPerCc: 2.7 },
        { maxCc: 3000, eurPerCc: 3.0 },
        { eurPerCc: 3.6 },
      ],
      y5plus: [
        { maxCc: 1000, eurPerCc: 3.0 },
        { maxCc: 1500, eurPerCc: 3.2 },
        { maxCc: 1800, eurPerCc: 3.5 },
        { maxCc: 2300, eurPerCc: 4.8 },
        { maxCc: 3000, eurPerCc: 5.0 },
        { eurPerCc: 5.7 },
      ],
    },
    recyclingFee: {
      smallMaxCc: 3000,
      smallUnder3yRub: 3400,
      smallFrom3yRub: 5200,
      largeUnder3yRub: 970000,
      largeFrom3yRub: 1235000,
      comment:
        "Ставки для объёма >3000 см³ — ориентировочные, отредактируйте по актуальным данным брокера.",
    },
    clearanceFeeBrackets: [
      { maxRub: 200000, fee: 1067 },
      { maxRub: 450000, fee: 2134 },
      { maxRub: 1200000, fee: 4269 },
      { maxRub: 2700000, fee: 11746 },
      { maxRub: 4200000, fee: 16524 },
      { maxRub: 5500000, fee: 21344 },
      { maxRub: 7000000, fee: 27540 },
      { fee: 30000 },
    ],
  },
  commissionNote:
    "Суммы предварительные: точный расчёт подтверждает менеджер перед заказом.",
};
