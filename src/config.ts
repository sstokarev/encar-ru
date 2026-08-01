/**
 * Importer config loading (U2, KTD1): fetch site config.json from GitHub
 * Pages with a hard timeout; on any failure (network, HTTP error, malformed
 * payload) fall back to the embedded DEFAULT_CONFIG. The result carries its
 * source so the breakdown can mark embedded (possibly stale) data.
 */

import {
  DEFAULT_CONFIG,
  type CostItem,
  type WidgetConfig,
} from "./config.default";

export type {
  ClearanceFeeBracket,
  CostItem,
  CostItemKind,
  CustomsConfig,
  DutyPerCcBracket,
  DutyValueTier,
  MessengerConfig,
  MessengerType,
  RecyclingFeeConfig,
  WidgetConfig,
} from "./config.default";

// TODO(U4): must match the final GitHub Pages domain of this repo.
export const CONFIG_URL = "https://sstokarev.github.io/encar-ru/config.json";

const FETCH_TIMEOUT_MS = 3000;

export type ConfigSource = "remote" | "embedded";

export interface LoadedConfig {
  config: WidgetConfig;
  source: ConfigSource;
}

declare global {
  interface Window {
    /** Test/dev override for the remote config URL. */
    __encarRuConfigUrl?: string;
  }
}

function isCostItem(value: unknown): value is CostItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["id"] === "string" &&
    typeof item["label"] === "string" &&
    (item["kind"] === "fixed" ||
      item["kind"] === "percent" ||
      item["kind"] === "formula") &&
    (typeof item["value"] === "number" || typeof item["value"] === "string")
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates an ascending bracket array: every entry passes `isEntry`, every
 * entry but the last carries a finite upper bound under `maxKey`, and the
 * last entry is open-ended (no bound) so bracket lookup always resolves.
 */
function isBracketArray(
  value: unknown,
  maxKey: string,
  isEntry: (entry: Record<string, unknown>) => boolean,
): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((raw, index) => {
    if (typeof raw !== "object" || raw === null) return false;
    const entry = raw as Record<string, unknown>;
    const last = index === value.length - 1;
    const bound = entry[maxKey];
    if (last ? bound !== undefined : !isFiniteNumber(bound)) return false;
    return isEntry(entry);
  });
}

/** Structural validation of the customs tariff section (U6, R10). */
function isCustomsConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const customs = value as Record<string, unknown>;
  const labels = customs["labels"] as Record<string, unknown> | undefined;
  const byAge = customs["dutyPerCcByAge"] as
    | Record<string, unknown>
    | undefined;
  const fee = customs["recyclingFee"] as Record<string, unknown> | undefined;
  const isPerCc = (entry: Record<string, unknown>): boolean =>
    isFiniteNumber(entry["eurPerCc"]) && entry["eurPerCc"] > 0;
  return (
    typeof customs["asOf"] === "string" &&
    typeof labels === "object" &&
    labels !== null &&
    typeof labels["duty"] === "string" &&
    typeof labels["recycling"] === "string" &&
    typeof labels["clearance"] === "string" &&
    isBracketArray(
      customs["dutyValueTiers"],
      "maxEur",
      (entry) =>
        isFiniteNumber(entry["pct"]) &&
        entry["pct"] > 0 &&
        isFiniteNumber(entry["minPerCc"]) &&
        entry["minPerCc"] >= 0,
    ) &&
    typeof byAge === "object" &&
    byAge !== null &&
    isBracketArray(byAge["y3"], "maxCc", isPerCc) &&
    isBracketArray(byAge["y5plus"], "maxCc", isPerCc) &&
    typeof fee === "object" &&
    fee !== null &&
    isFiniteNumber(fee["smallMaxCc"]) &&
    isFiniteNumber(fee["smallUnder3yRub"]) &&
    isFiniteNumber(fee["smallFrom3yRub"]) &&
    isFiniteNumber(fee["largeUnder3yRub"]) &&
    isFiniteNumber(fee["largeFrom3yRub"]) &&
    isBracketArray(
      customs["clearanceFeeBrackets"],
      "maxRub",
      (entry) => isFiniteNumber(entry["fee"]) && entry["fee"] >= 0,
    )
  );
}

/** Structural validation: a malformed remote payload must not reach the UI. */
function isValidConfig(value: unknown): value is WidgetConfig {
  if (typeof value !== "object" || value === null) return false;
  const cfg = value as Record<string, unknown>;
  const messenger = cfg["messenger"] as Record<string, unknown> | undefined;
  const currency = cfg["currency"] as Record<string, unknown> | undefined;
  const rates = currency?.["referenceRates"] as
    | Record<string, unknown>
    | undefined;
  return (
    typeof cfg["version"] === "number" &&
    typeof messenger === "object" &&
    messenger !== null &&
    (messenger["type"] === "telegram" || messenger["type"] === "whatsapp") &&
    typeof messenger["address"] === "string" &&
    messenger["address"].length > 0 &&
    typeof rates === "object" &&
    rates !== null &&
    typeof rates["KRW_RUB"] === "number" &&
    rates["KRW_RUB"] > 0 &&
    typeof rates["EUR_RUB"] === "number" &&
    typeof currency?.["updatedAt"] === "string" &&
    Array.isArray(cfg["costItems"]) &&
    cfg["costItems"].every(isCostItem) &&
    isCustomsConfig(cfg["customs"]) &&
    typeof cfg["commissionNote"] === "string"
  );
}

/**
 * Loads the importer config. Never rejects: any failure path resolves to the
 * embedded default with source "embedded".
 */
export async function loadConfig(): Promise<LoadedConfig> {
  const url = window.__encarRuConfigUrl ?? CONFIG_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!isValidConfig(data)) throw new Error("invalid config shape");
    return { config: data, source: "remote" };
  } catch {
    return { config: DEFAULT_CONFIG, source: "embedded" };
  } finally {
    clearTimeout(timer);
  }
}
