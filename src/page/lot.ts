/**
 * CarData -> calculator lot details (U2).
 *
 * The page never re-derives tariff semantics: age comes from the engine's own
 * computeAgeYears / isNearAgeBracket (end-of-month reading, month-accurate
 * duty cliffs), and anything unparseable stays undefined so the engine
 * degrades the quote honestly instead of guessing. powerHp is never set —
 * the API does not publish engine power (brief: the recycling line dashes).
 */

import {
  computeAgeYears,
  isNearAgeBracket,
  type FuelType,
  type LotParams,
} from "../calc/customs";
import { parseFuel } from "../scan/params";
import type { CarData } from "../encar/types";

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
 */
export function toLotDetails(
  car: CarData,
  now: Date = new Date(),
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

  return details;
}
