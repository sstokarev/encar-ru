/**
 * Importer config loading (U2, KTD1): fetch site config.json from GitHub
 * Pages with a hard timeout; on any failure (network, HTTP error, malformed
 * payload) fall back to the embedded DEFAULT_CONFIG. The result carries its
 * source so the breakdown can mark embedded (possibly stale) data.
 */

import {
  CUSTOMS_FORMULA,
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
  FixedCostItem,
  FormulaCostItem,
  MessengerConfig,
  MessengerType,
  PercentCostItem,
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

/**
 * Cost item shape. `kind` types `value`: a fixed/percent item MUST carry a
 * number and a formula item a string. The old "number or string either way"
 * check let a quoted "220000" through, and the calculator then dropped the
 * line without a trace (the total was short by exactly that amount).
 */
function isCostItem(value: unknown): value is CostItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item["id"] !== "string" || typeof item["label"] !== "string") {
    return false;
  }
  switch (item["kind"]) {
    case "fixed":
    case "percent":
      return isFiniteNumber(item["value"]);
    case "formula":
      return typeof item["value"] === "string";
    default:
      return false;
  }
}

/** True for a recognised customs formula item (at most one per config). */
function isCustomsFormulaItem(item: CostItem): boolean {
  return item.kind === "formula" && item.value === CUSTOMS_FORMULA;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Finite and strictly positive — the only shape an FX rate may have. */
function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** Telegram username (no @, no query string) — it lands in a deep link. */
const TELEGRAM_ADDRESS_RE = /^[A-Za-z0-9_]{3,64}$/;
/** WhatsApp phone number, digits with an optional leading plus. */
const WHATSAPP_ADDRESS_RE = /^\+?\d{6,15}$/;

/**
 * Messenger shape validation: the address is interpolated into the "Заказать"
 * deep link, so anything but a plain username / phone number is rejected here
 * rather than encoded away at the use site.
 */
function isValidMessenger(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const messenger = value as Record<string, unknown>;
  const address = messenger["address"];
  if (typeof address !== "string") return false;
  if (messenger["type"] === "telegram") {
    return TELEGRAM_ADDRESS_RE.test(address);
  }
  if (messenger["type"] === "whatsapp") {
    return WHATSAPP_ADDRESS_RE.test(address);
  }
  return false;
}

/**
 * Validates an ascending bracket array: every entry passes `isEntry`, every
 * entry but the last carries a finite upper bound under `maxKey`, the bounds
 * strictly increase (the lookup returns the FIRST admitting bracket, so a
 * reordered array silently quotes the wrong tier), and the last entry is
 * open-ended (no bound) so bracket lookup always resolves.
 */
function isBracketArray(
  value: unknown,
  maxKey: string,
  isEntry: (entry: Record<string, unknown>) => boolean,
): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previous = Number.NEGATIVE_INFINITY;
  return value.every((raw, index) => {
    if (typeof raw !== "object" || raw === null) return false;
    const entry = raw as Record<string, unknown>;
    const last = index === value.length - 1;
    const bound = entry[maxKey];
    if (last) {
      if (bound !== undefined) return false;
    } else {
      if (!isFiniteNumber(bound) || bound <= previous) return false;
      previous = bound;
    }
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

/**
 * Structural validation: a malformed remote payload must not reach the UI.
 * Exported so the deployed site/config.json can be checked against exactly
 * this function in CI (test/config-file.test.ts) instead of only at runtime,
 * where a typo silently downgrades every client to the embedded tariffs.
 */
export function isValidConfig(value: unknown): value is WidgetConfig {
  if (typeof value !== "object" || value === null) return false;
  const cfg = value as Record<string, unknown>;
  const currency = cfg["currency"] as Record<string, unknown> | undefined;
  const rates = currency?.["referenceRates"] as
    | Record<string, unknown>
    | undefined;
  const costItems = cfg["costItems"];
  return (
    typeof cfg["version"] === "number" &&
    isValidMessenger(cfg["messenger"]) &&
    typeof rates === "object" &&
    rates !== null &&
    // Both rates divide or multiply money: zero or negative yields
    // Infinity/NaN or a negative duty, never an honest price.
    isPositiveNumber(rates["KRW_RUB"]) &&
    isPositiveNumber(rates["EUR_RUB"]) &&
    typeof currency?.["updatedAt"] === "string" &&
    Array.isArray(costItems) &&
    costItems.every(isCostItem) &&
    // Two customs formula items would add duty, recycling and clearance twice.
    (costItems as CostItem[]).filter(isCustomsFormulaItem).length <= 1 &&
    isCustomsConfig(cfg["customs"]) &&
    typeof cfg["commissionNote"] === "string"
  );
}

/**
 * Loads the importer config from `url` (the deployed config by default).
 * Never rejects: any failure path resolves to the embedded default with
 * source "embedded".
 *
 * The URL is a parameter rather than a window global on purpose: a global
 * override shipped in the bundle would let any co-tenant script on encar.com
 * (ads, analytics) swap the config and with it every displayed price and the
 * "Заказать" deep link.
 */
export async function loadConfig(
  url: string = CONFIG_URL,
): Promise<LoadedConfig> {
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
