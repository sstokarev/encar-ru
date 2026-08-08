/**
 * CarData -> calculator lot details (U2), plus the specs-catalog seam
 * (tks-parity task).
 *
 * The page never re-derives tariff semantics: age comes from the engine's own
 * computeAgeYears / isNearAgeBracket (end-of-month reading, month-accurate
 * duty cliffs), and anything unparseable stays undefined so the engine
 * degrades the quote honestly instead of guessing. Power figures come from
 * the drom.ru specs catalog when a confident match exists (src/calc/specs.ts)
 * — the encar API publishes none — and stay undefined otherwise.
 *
 * Wiring note: main.ts is owned by the importer-pricing task right now; it
 * calls toLotDetails(car) today, and the catalog goes live by adding
 * `const catalog = await loadSpecsCatalog()` + passing it as the third
 * argument — a follow-up dispatch once that branch lands.
 */

import {
  computeAgeYears,
  isNearAgeBracket,
  type FuelType,
  type LotParams,
} from "../calc/customs";
import { isValidCatalog, matchSpecs, type SpecsCatalog } from "../calc/specs";
import { CONFIG_URL } from "../config";
import { parseFuel } from "../scan/params";
import type { CarData } from "../encar/types";

/**
 * Deployed next to the page by the same GitHub Pages upload as config.json —
 * derived from CONFIG_URL so a non-prod deploy keeps both on one base
 * instead of silently losing the catalog.
 */
export const SPECS_CATALOG_URL = new URL(
  "specs-catalog.json",
  CONFIG_URL,
).toString();

const CATALOG_FETCH_TIMEOUT_MS = 3000;

/**
 * Fetch and validate the specs catalog; `undefined` on any failure (timeout,
 * HTTP error, corrupt shape) — the page then quotes exactly as it did before
 * the catalog existed: power lines dash, totals stay floors. Same defensive
 * shape as loadConfig (src/config.ts).
 */
export async function loadSpecsCatalog(
  url: string = SPECS_CATALOG_URL,
): Promise<SpecsCatalog | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
      cache: "no-cache",
    });
    if (!response.ok) return undefined;
    const data: unknown = await response.json();
    return isValidCatalog(data) ? data : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** First registration "YYYYMM" as the API sends it. */
const YEAR_MONTH_RE = /^(\d{4})(\d{2})$/;

/**
 * English fuel names the API may send instead of Korean tokens. Order
 * matters, same as the Korean FUEL_TOKENS: a compound "Gasoline+Electric"
 * must resolve to hybrid before the bare "electric" rule can claim it.
 */
const ENGLISH_FUEL: ReadonlyArray<readonly [RegExp, FuelType]> = [
  [/hybrid|gasoline\s*\+\s*electric|electric\s*\+\s*gasoline|diesel\s*\+\s*electric/i, "hybrid"],
  [/electric|\bev\b/i, "electric"],
  [/lpg/i, "lpg"],
  [/diesel/i, "diesel"],
  [/gasoline|petrol/i, "gasoline"],
];

/** Maps the API fuel name (Korean or English) to the calculator fuel type. */
export function mapFuel(fuelName: string): FuelType | undefined {
  const korean = parseFuel(fuelName);
  if (korean !== null) return korean;
  for (const [re, fuel] of ENGLISH_FUEL) {
    if (re.test(fuelName)) return fuel;
  }
  return undefined;
}

/**
 * Calculator lot details for a car. API data is read, not estimated, so
 * `estimated` stays false; a malformed yearMonth leaves the age undefined
 * (customs lines dash / degrade downstream, specs still render).
 *
 * With a catalog present, a hybrid/EV lot is matched against it and a
 * CONFIDENT match contributes the power figures and the hybrid kind (the
 * catalog is snapshot data, not an estimate — `estimated` stays false). No
 * match, an ambiguous match, or no catalog leaves the fields undefined and
 * the quote exactly as before.
 */
export function toLotDetails(
  car: CarData,
  now: Date = new Date(),
  catalog?: SpecsCatalog,
): Omit<LotParams, "priceKrw"> {
  const details: Omit<LotParams, "priceKrw"> = { estimated: false };

  const reg = YEAR_MONTH_RE.exec(car.yearMonth);
  if (reg !== null) {
    const year = Number(reg[1]);
    const month = Number(reg[2]);
    if (month >= 1 && month <= 12) {
      details.ageYears = computeAgeYears(year, month, now);
      details.ageNearBracket = isNearAgeBracket(year, month, now);
    }
  }

  if (
    typeof car.displacementCc === "number" &&
    Number.isFinite(car.displacementCc) &&
    car.displacementCc > 0
  ) {
    details.engineCc = car.displacementCc;
  }

  const fuel = mapFuel(car.fuelName);
  if (fuel !== undefined) details.fuel = fuel;

  if (
    catalog !== undefined &&
    (fuel === "hybrid" || fuel === "electric")
  ) {
    const spec = matchSpecs(car, fuel, catalog);
    if (spec !== undefined) {
      details.electricHp30min = spec.electricHp30min;
      if (spec.iceHp !== undefined) details.powerHp = spec.iceHp;
      if (spec.hybridKind !== undefined) details.hybridKind = spec.hybridKind;
    }
  }

  return details;
}
