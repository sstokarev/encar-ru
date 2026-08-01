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

export interface CostItem {
  id: string;
  /** User-facing Russian label. */
  label: string;
  kind: CostItemKind;
  /**
   * fixed   -> RUB amount;
   * percent -> percent of the lot RUB price;
   * formula -> formula identifier, computed for real in U6 (mock stage
   *            renders an honest placeholder, KTD7).
   */
  value: number | string;
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
      label: "Доставка до Владивостока",
      kind: "fixed",
      value: 120000,
    },
    {
      id: "customs-duty",
      label: "Таможенная пошлина и утильсбор",
      kind: "formula",
      value: "customs_duty_v1",
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
  commissionNote:
    "Суммы предварительные: точный расчёт подтверждает менеджер перед заказом.",
};
