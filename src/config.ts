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
  KrwCostItem,
  LadderBracket,
  LadderCostItem,
  MessengerConfig,
  MessengerType,
  PercentCostItem,
  RecyclingDisplacementClass,
  RecyclingFeeConfig,
  RecyclingPowerBracket,
  RecyclingReducedRate,
  UnknownCostItem,
  WidgetConfig,
} from "./config.default";

/**
 * Pages origin of THIS repo (github.com/sstokarev/encar-ru). Changing the repo
 * owner or name moves the statics: this URL, WIDGET_ORIGIN in
 * src/loader/bookmarklet.ts and the extension's host permissions must move with
 * it, otherwise clients keep fetching tariffs from an address nobody publishes.
 */
export const CONFIG_URL = "https://sstokarev.github.io/encar-ru/config.json";

const FETCH_TIMEOUT_MS = 3000;

/**
 * The config a PAGE of this site should try FIRST: the `config.json` sitting
 * next to the page itself.
 *
 * Only ever for our own pages (site/calc.html, site/landing.html). The widget
 * is injected into encar.com, where "next to the page" is
 * `encar.com/config.json` — someone else's origin, quoting someone else's
 * tariffs — so it keeps the absolute CONFIG_URL and never calls this.
 *
 * Why it exists: an operator serving the branch build on localhost was reading
 * the PRODUCTION config, so the page under acceptance showed the OLD cost items
 * («СБКТС и ЭПТС», «Брокер и СВХ» dashed) that the new bundle does not even
 * contain. A page and the config it is deployed beside are one artifact; making
 * the page reach past its own directory to a fixed host makes every build
 * before deploy untestable.
 *
 * Returns null when the page is not served over http(s) — a `file://` open has
 * no usable origin, and its relative fetch would be blocked anyway.
 */
export function sameOriginConfigUrl(href: string): string | null {
  try {
    const page = new URL(href);
    if (page.protocol !== "http:" && page.protocol !== "https:") return null;
    return new URL("config.json", page).href;
  } catch {
    return null;
  }
}

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
    case "unknown":
      // A cost the importer has not priced yet: it renders as a dash and is
      // excluded from the total, so an amount here would be silently dropped.
      return item["value"] === undefined;
    case "krw":
      // A WON amount folded into the price before conversion. Zero is a
      // legitimate "waived this month"; negative is not — it would silently
      // discount the customs value and with it the duty.
      return isFiniteNumber(item["value"]) && item["value"] >= 0;
    case "ladder":
      // Commission steps on the pre-commission subtotal. isBracketArray gives
      // the same guarantees as every tariff bracket: ascending bounds, last
      // entry open-ended, so the lookup always resolves.
      //
      // Fees must be NON-DECREASING, and that is a correctness rule rather than
      // a tidiness one. When a customs line cannot be computed the quote is a
      // FLOOR rendered «от N ₽», and the ladder is handed a subtotal that is
      // itself a lower bound. Only a monotone ladder guarantees the step picked
      // from a floor is at most the real one; a decreasing step would over-quote
      // and hand the client a "minimum" he can beat.
      //
      // Kept in step with isLadder in src/calc/pricing.ts BY HAND. The two must
      // accept exactly the same ladders: a config that passes here and fails
      // there loads as "remote" (no «встроенные тарифы» marker) and then
      // degrades every quote on the site to «по запросу», with nothing on
      // screen saying the two validators disagreed.
      return (
        item["value"] === undefined &&
        isBracketArray(
          item["brackets"],
          "underRub",
          (entry) => isFiniteNumber(entry["fee"]) && entry["fee"] >= 0,
        ) &&
        hasNonDecreasingFees(item["brackets"])
      );
    default:
      return false;
  }
}

/** True for a recognised customs formula item (at most one per config). */
function isCustomsFormulaItem(item: CostItem): boolean {
  return item.kind === "formula" && item.value === CUSTOMS_FORMULA;
}

/** True for a commission ladder item (at most one per config). */
function isLadderItem(item: CostItem): boolean {
  return item.kind === "ladder";
}

/** Ladder fees never step DOWN — see the "ladder" case for why it matters. */
function hasNonDecreasingFees(brackets: unknown): boolean {
  if (!Array.isArray(brackets)) return false;
  let previous = Number.NEGATIVE_INFINITY;
  for (const raw of brackets) {
    const fee = (raw as Record<string, unknown>)["fee"];
    if (!isFiniteNumber(fee) || fee < previous) return false;
    previous = fee;
  }
  return true;
}

/**
 * Ids the CALCULATOR generates for lines the config did not declare: the
 * converted price row and the customs block src/calc/customs.ts expands.
 *
 * A cost item may not claim one. src/calc/pricing.ts separates "the engine
 * invented this row" from "the config asked for this row" by exactly this
 * test, so a config item called "duty" would take the real duty out of the
 * tariff block (wrong rounding), and one called "lot" would produce a
 * duplicated price row and a negative Korean-costs row. Neither throws; both
 * just print wrong money.
 */
const RESERVED_ITEM_IDS = ["lot", "duty", "recycling", "clearance"];

function usesReservedId(items: readonly CostItem[]): boolean {
  for (const item of items) {
    for (const reserved of RESERVED_ITEM_IDS) {
      if (item.id === reserved) return true;
    }
  }
  return false;
}

/** Every entry is a well-formed cost item — see isBracketArray on the loop. */
function allItemsValid(items: readonly unknown[]): boolean {
  for (const item of items) {
    if (!isCostItem(item)) return false;
  }
  return true;
}

/** Count without Array.prototype.filter — the host page replaces built-ins. */
function countItems(
  items: readonly CostItem[],
  match: (item: CostItem) => boolean,
): number {
  let count = 0;
  for (const item of items) {
    if (match(item)) count += 1;
  }
  return count;
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
  // A plain loop, never Array.prototype.every: www.encar.com ships an ES5
  // bundle that REPLACES built-ins, and its `reduce` was measured returning the
  // array itself instead of calling the callback (2026-08-02, see the header of
  // src/calc/customs.ts). The calculator was hardened then; this file was the
  // last one on the money path still trusting a prototype method — and it is
  // the one that decides whether the remote config is used at all, so a broken
  // `every` either waves every malformed tariff through or drops every client
  // to embedded data. Neither is visible on screen.
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
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
    if (!isEntry(entry)) return false;
  }
  return true;
}

/** A recycling-fee cell: a RUB amount for a new car and for a used one. */
function isFeeAmounts(entry: Record<string, unknown>): boolean {
  return (
    isFiniteNumber(entry["under3yRub"]) &&
    entry["under3yRub"] >= 0 &&
    isFiniteNumber(entry["from3yRub"]) &&
    entry["from3yRub"] >= 0
  );
}

/**
 * The reduced personal-use recycling rate. Both caps are mandatory: a missing
 * cap would read as "no limit" and hand a 300 hp car the 5 200 RUB rate.
 */
function isReducedRate(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const reduced = value as Record<string, unknown>;
  return (
    isPositiveNumber(reduced["maxCc"]) &&
    isPositiveNumber(reduced["maxHp"]) &&
    isFeeAmounts(reduced)
  );
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
    isReducedRate(fee["reduced"]) &&
    // Recycling grid (PP RF 1713): displacement classes, each an ascending
    // power-bracket array. Both levels get the same ordering guarantees as
    // every other bracket array — a reordered row quotes the wrong cell.
    isBracketArray(fee["classes"], "maxCc", (entry) =>
      isBracketArray(entry["powerBrackets"], "maxHp", isFeeAmounts),
    ) &&
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
    // for-of, same reason as isBracketArray above.
    allItemsValid(costItems) &&
    // EXACTLY one customs item. Two would add duty, recycling and clearance
    // twice; ZERO would quote a car with no customs at all — and since the
    // operator's model prices every other line, that quote would carry no dash
    // and be reported as "exact" while being millions of roubles short. Before
    // his model landed the same config produced a table of dashes, which is why
    // "at most one" used to be enough.
    countItems(costItems as CostItem[], isCustomsFormulaItem) === 1 &&
    // Two ladders would charge the commission twice, and the second would
    // bracket on a subtotal that already contains the first.
    countItems(costItems as CostItem[], isLadderItem) <= 1 &&
    !usesReservedId(costItems as CostItem[]) &&
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

/**
 * Loads the config for one of THIS site's own pages: its own `config.json`
 * first, the published one as a fallback.
 *
 * The fallback is not decoration. A page opened from `file://`, or one deployed
 * somewhere its `config.json` was not copied to, must still quote real tariffs
 * rather than silently drop to the embedded copy — so a same-origin miss (404,
 * malformed payload, no origin at all) is retried against CONFIG_URL, and only
 * then does the embedded fallback apply. `loadConfig` never rejects, so neither
 * does this.
 *
 * The widget must NOT use this: injected into encar.com it would fetch
 * `encar.com/config.json`. It calls `loadConfig()` and gets CONFIG_URL.
 */
export async function loadPageConfig(
  href: string = typeof location === "undefined" ? "" : location.href,
): Promise<LoadedConfig> {
  const own = sameOriginConfigUrl(href);
  if (own !== null && own !== CONFIG_URL) {
    const loaded = await loadConfig(own);
    if (loaded.source === "remote") return loaded;
  }
  return loadConfig(CONFIG_URL);
}
