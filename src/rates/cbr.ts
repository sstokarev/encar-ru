/**
 * FX rate resolution (U5, KTD2): CBR rates via the cbr-xml-daily.ru mirror
 * with a validated fallback chain "mirror -> localStorage cache -> config
 * reference rates".
 *
 * - KRW is quoted per 1000 units on the mirror; normalized here to RUB per
 *   1 KRW (Value / Nominal). EUR nominal is 1 but is divided the same way.
 * - Every mirror response is validated for plausibility against the config
 *   reference rates: a deviation beyond ±30% on either currency means the
 *   response is treated as invalid and the next tier is used.
 * - The cache entry is valid until the next calendar day (storedISO is the
 *   local day it was written). dateISO is the rate date carried by the
 *   payload — CBR publishes no weekend/holiday rates, so on those days the
 *   payload (and therefore the exposed date) is the last published rate.
 * - resolveRates never rejects: the config tier always succeeds.
 */

import type { WidgetConfig } from "../config";

export const CBR_RATES_URL = "https://www.cbr-xml-daily.ru/daily_json.js";

/** localStorage key of the rates cache. */
export const RATES_CACHE_KEY = "encar-ru:rates";

const FETCH_TIMEOUT_MS = 3000;

/** Maximum allowed relative deviation from the config reference rate. */
const MAX_REFERENCE_DEVIATION = 0.3;

export type RatesSource = "cbr" | "cache" | "config";

export interface ResolvedRates {
  /** RUB per 1 KRW. */
  krwRub: number;
  /** RUB per 1 EUR. */
  eurRub: number;
  /** Rate date (YYYY-MM-DD): payload date, cache rate date, or config updatedAt. */
  dateISO: string;
  source: RatesSource;
}

interface CacheEntry {
  rates: { krwRub: number; eurRub: number };
  /** Rate date carried by the cached payload. */
  dateISO: string;
  source: "cbr";
  /** Local calendar day the entry was written; entry is stale the next day. */
  storedISO: string;
}

declare global {
  interface Window {
    /** Test/dev override for the rates mirror URL. */
    __encarRuRatesUrl?: string;
  }
}

type ReferenceRates = WidgetConfig["currency"]["referenceRates"];

/** Local calendar day as YYYY-MM-DD (cache validity clock). */
function todayISO(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
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

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ParsedPayload {
  krwRub: number;
  eurRub: number;
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

/** True when value is within ±30% of the config reference rate (KTD2). */
function isPlausible(value: number, reference: number): boolean {
  if (!(reference > 0)) return false;
  return Math.abs(value - reference) / reference <= MAX_REFERENCE_DEVIATION;
}

/** Tier 1: fetch + parse + plausibility-validate the mirror. Null on any failure. */
async function fetchMirrorRates(
  reference: ReferenceRates,
): Promise<ResolvedRates | null> {
  const url = window.__encarRuRatesUrl ?? CBR_RATES_URL;
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
    if (parsed === null) return null;
    if (
      !isPlausible(parsed.krwRub, reference.KRW_RUB) ||
      !isPlausible(parsed.eurRub, reference.EUR_RUB)
    ) {
      return null;
    }
    return { ...parsed, source: "cbr" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

/** Tier 2: same-calendar-day cache entry, or null. */
function readCache(): ResolvedRates | null {
  try {
    const raw = localStorage.getItem(RATES_CACHE_KEY);
    if (raw === null) return null;
    const entry: unknown = JSON.parse(raw);
    if (!isCacheEntry(entry)) return null;
    if (entry.storedISO !== todayISO()) return null;
    return {
      krwRub: entry.rates.krwRub,
      eurRub: entry.rates.eurRub,
      dateISO: entry.dateISO,
      source: "cache",
    };
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
 * Resolves the current KRW/EUR rates through the tier chain. Never rejects;
 * the config tier (source "config", marked preliminary in the UI) is the
 * unconditional last resort.
 */
export async function resolveRates(config: WidgetConfig): Promise<ResolvedRates> {
  const fetched = await fetchMirrorRates(config.currency.referenceRates);
  if (fetched !== null) {
    writeCache(fetched);
    return fetched;
  }
  const cached = readCache();
  if (cached !== null) return cached;
  return {
    krwRub: config.currency.referenceRates.KRW_RUB,
    eurRub: config.currency.referenceRates.EUR_RUB,
    dateISO: config.currency.updatedAt,
    source: "config",
  };
}
