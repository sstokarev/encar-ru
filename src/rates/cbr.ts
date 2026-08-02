/**
 * FX rate resolution (U5, KTD2): CBR rates via the cbr-xml-daily.ru mirror
 * with a validated fallback chain "mirror -> localStorage cache -> config
 * reference rates".
 *
 * - KRW is quoted per 1000 units on the mirror; normalized here to RUB per
 *   1 KRW (Value / Nominal). EUR nominal is 1 but is divided the same way.
 * - Every mirror response is checked for plausibility, but the ANCHOR of that
 *   check matters more than the window: anchoring on a hand-edited config
 *   constant inverts the protection once the real rate drifts past ±30% of it
 *   — every correct CBR response is then rejected forever and the client
 *   quotes from a stale number. The anchor is therefore, in order:
 *     1. the last accepted LIVE rate (persisted, no same-day expiry);
 *     2. the config reference rates, but only while they were edited
 *        recently (currency.updatedAt within CONFIG_ANCHOR_MAX_AGE_DAYS);
 *     3. none — a plain absolute sanity range, so a real rate is never
 *        rejected just because every anchor went stale.
 *   A parsed-but-rejected response is surfaced as `rejected` on the result:
 *   "the mirror answered with something anomalous" is a different story for
 *   the client than "the mirror is unreachable".
 * - The cache stays usable for CACHE_MAX_AGE_DAYS and outranks the config
 *   tier: yesterday's real CBR rate beats a hand-edited constant. dateISO is
 *   the rate date carried by the payload — CBR publishes no weekend/holiday
 *   rates, so on those days the payload (and the exposed date) is the last
 *   published rate.
 * - resolveRates never rejects: the config tier always succeeds.
 */

import type { WidgetConfig } from "../config";

export const CBR_RATES_URL = "https://www.cbr-xml-daily.ru/daily_json.js";

/** localStorage key of the rates cache (also the live plausibility anchor). */
export const RATES_CACHE_KEY = "encar-ru:rates";

const FETCH_TIMEOUT_MS = 3000;

/** Maximum allowed relative deviation from the plausibility anchor. */
const MAX_ANCHOR_DEVIATION = 0.3;

/** How long a cached CBR rate may still be quoted (days). */
const CACHE_MAX_AGE_DAYS = 14;

/** How long the last accepted live rate may anchor plausibility (days). */
const LIVE_ANCHOR_MAX_AGE_DAYS = 90;

/** How long a hand-edited config rate may anchor plausibility (days). */
const CONFIG_ANCHOR_MAX_AGE_DAYS = 60;

/**
 * Absolute sanity ranges, wide enough to survive years of drift and narrow
 * enough to catch a broken payload (a mis-parsed nominal, a decimal shift).
 */
const KRW_RUB_RANGE = { min: 0.005, max: 0.5 };
const EUR_RUB_RANGE = { min: 10, max: 1000 };

export type RatesSource = "cbr" | "cache" | "config";

export interface ResolvedRates {
  /** RUB per 1 KRW. */
  krwRub: number;
  /** RUB per 1 EUR. */
  eurRub: number;
  /** Rate date (YYYY-MM-DD): payload date, cache rate date, or config updatedAt. */
  dateISO: string;
  source: RatesSource;
  /**
   * True when the mirror answered but its rates failed the plausibility
   * check, so these rates come from a lower tier. Distinct from the generic
   * "preliminary" marker of the config tier — the UI renders it separately.
   */
  rejected?: boolean;
}

interface RatePair {
  krwRub: number;
  eurRub: number;
}

interface CacheEntry {
  rates: RatePair;
  /** Rate date carried by the cached payload. */
  dateISO: string;
  source: "cbr";
  /** Local calendar day the entry was written (cache and anchor clock). */
  storedISO: string;
}

/** Local calendar day as YYYY-MM-DD (cache validity clock). */
function todayISO(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole days between the given ISO day and today; null when the string is not
 * a date. Negative for a future date (clock skew), which counts as fresh.
 */
function ageDays(iso: string): number | null {
  if (!DATE_ISO_RE.test(iso)) return null;
  const then = Date.parse(`${iso}T00:00:00Z`);
  const now = Date.parse(`${todayISO()}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.round((now - then) / 86_400_000);
}

/** True when the ISO day is at most `maxDays` old (future dates are fresh). */
function isFresh(iso: string, maxDays: number): boolean {
  const age = ageDays(iso);
  return age !== null && age <= maxDays;
}

/** RUB per 1 unit from a mirror Valute entry, or null when malformed. */
function normalizedQuote(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const quote = value as Record<string, unknown>;
  const rate = quote["Value"];
  const nominal = quote["Nominal"];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  if (typeof nominal !== "number" || !Number.isFinite(nominal) || nominal <= 0) {
    return null;
  }
  return rate / nominal;
}

interface ParsedPayload extends RatePair {
  dateISO: string;
}

/** Extracts normalized KRW/EUR rates and the rate date from the mirror JSON. */
function parsePayload(data: unknown): ParsedPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const payload = data as Record<string, unknown>;
  const valute = payload["Valute"] as Record<string, unknown> | undefined;
  const krwRub = normalizedQuote(valute?.["KRW"]);
  const eurRub = normalizedQuote(valute?.["EUR"]);
  const date = payload["Date"];
  if (krwRub === null || eurRub === null || typeof date !== "string") {
    return null;
  }
  const dateISO = date.slice(0, 10);
  if (!DATE_ISO_RE.test(dateISO)) return null;
  return { krwRub, eurRub, dateISO };
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  const rates = entry["rates"] as Record<string, unknown> | undefined;
  return (
    typeof rates === "object" &&
    rates !== null &&
    typeof rates["krwRub"] === "number" &&
    rates["krwRub"] > 0 &&
    typeof rates["eurRub"] === "number" &&
    rates["eurRub"] > 0 &&
    typeof entry["dateISO"] === "string" &&
    entry["source"] === "cbr" &&
    typeof entry["storedISO"] === "string"
  );
}

/** The persisted last-accepted live rate, whatever its age. */
function readEntry(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(RATES_CACHE_KEY);
    if (raw === null) return null;
    const entry: unknown = JSON.parse(raw);
    return isCacheEntry(entry) ? entry : null;
  } catch {
    return null;
  }
}

function writeCache(rates: ResolvedRates): void {
  const entry: CacheEntry = {
    rates: { krwRub: rates.krwRub, eurRub: rates.eurRub },
    dateISO: rates.dateISO,
    source: "cbr",
    storedISO: todayISO(),
  };
  try {
    localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Quota/private-mode failures must not break rate resolution.
  }
}

/**
 * Preferred anchor: the last accepted LIVE rate. It survives the cache
 * quoting window (the entry has no same-day expiry) and only stops anchoring
 * once it is too old to say anything about today's rate.
 */
function liveAnchor(entry: CacheEntry | null): RatePair | null {
  if (entry !== null && isFresh(entry.storedISO, LIVE_ANCHOR_MAX_AGE_DAYS)) {
    return entry.rates;
  }
  return null;
}

/** Config-tier anchor: trusted only while the constants were edited recently. */
function configAnchor(config: WidgetConfig): RatePair | null {
  const reference = config.currency.referenceRates;
  if (!isFresh(config.currency.updatedAt, CONFIG_ANCHOR_MAX_AGE_DAYS)) {
    return null;
  }
  if (!(reference.KRW_RUB > 0) || !(reference.EUR_RUB > 0)) return null;
  return { krwRub: reference.KRW_RUB, eurRub: reference.EUR_RUB };
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

function withinAnchor(value: number, anchor: number): boolean {
  if (!(anchor > 0)) return false;
  return Math.abs(value - anchor) / anchor <= MAX_ANCHOR_DEVIATION;
}

/** Absolute sanity first, then the ±30% window when an anchor is trusted. */
function isPlausible(parsed: RatePair, anchor: RatePair | null): boolean {
  if (
    !inRange(parsed.krwRub, KRW_RUB_RANGE) ||
    !inRange(parsed.eurRub, EUR_RUB_RANGE)
  ) {
    return false;
  }
  if (anchor === null) return true;
  return (
    withinAnchor(parsed.krwRub, anchor.krwRub) &&
    withinAnchor(parsed.eurRub, anchor.eurRub)
  );
}

type MirrorOutcome =
  | { status: "ok"; rates: ResolvedRates }
  /** Answered, but the rates failed the plausibility check. */
  | { status: "rejected" }
  /** Unreachable, timed out, or unparseable. */
  | { status: "unavailable" };

/** Tier 1: fetch + parse + plausibility-validate the mirror. */
async function fetchMirrorRates(
  url: string,
  anchor: RatePair | null,
): Promise<MirrorOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parsePayload(await response.json());
    if (parsed === null) return { status: "unavailable" };
    if (!isPlausible(parsed, anchor)) return { status: "rejected" };
    return { status: "ok", rates: { ...parsed, source: "cbr" } };
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Tier 2: a cached CBR rate that is still recent enough to quote. */
function usableCache(entry: CacheEntry | null): ResolvedRates | null {
  if (entry === null || !isFresh(entry.storedISO, CACHE_MAX_AGE_DAYS)) {
    return null;
  }
  return {
    krwRub: entry.rates.krwRub,
    eurRub: entry.rates.eurRub,
    dateISO: entry.dateISO,
    source: "cache",
  };
}

/**
 * Resolves the current KRW/EUR rates through the tier chain from `url` (the
 * CBR mirror by default; a parameter rather than a window global so no
 * co-tenant script on encar.com can redirect it). Never rejects; the config
 * tier (source "config", marked preliminary in the UI) is the unconditional
 * last resort.
 */
export async function resolveRates(
  config: WidgetConfig,
  url: string = CBR_RATES_URL,
): Promise<ResolvedRates> {
  const entry = readEntry();
  const anchor = liveAnchor(entry) ?? configAnchor(config);
  const outcome = await fetchMirrorRates(url, anchor);
  if (outcome.status === "ok") {
    writeCache(outcome.rates);
    return outcome.rates;
  }
  const rejected = outcome.status === "rejected";
  const cached = usableCache(entry);
  const fallback: ResolvedRates = cached ?? {
    krwRub: config.currency.referenceRates.KRW_RUB,
    eurRub: config.currency.referenceRates.EUR_RUB,
    dateISO: config.currency.updatedAt,
    source: "config",
  };
  return rejected ? { ...fallback, rejected: true } : fallback;
}
