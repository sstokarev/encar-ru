/**
 * U2: CarData -> calculator lot details. The mapping must reuse the engine's
 * own age semantics (end-of-month, month-accurate cliffs) and degrade
 * honestly: malformed inputs stay undefined, never guessed.
 */
import { describe, expect, it } from "vitest";

import {
  computeAgeYears,
  computeAllIn,
  isUnknownLine,
  lotPrecision,
  type FxRates,
} from "../src/calc/customs";
import { DEFAULT_CONFIG } from "../src/config.default";
import { mapFuel, toLotDetails } from "../src/page/lot";
import type { CarData } from "../src/encar/types";

const NOW = new Date(2026, 7, 8); // 2026-08-08

const RATES: FxRates = { krwRub: 0.05, eurRub: 100 };

function car(overrides: Partial<CarData> = {}): CarData {
  return {
    vehicleId: "1",
    title: "Test Car 2.2",
    priceKrw: 20_000_000,
    yearMonth: "202301",
    mileageKm: 10_000,
    displacementCc: 2199,
    fuelName: "디젤",
    transmissionName: "오토",
    colorName: "흰색",
    seatCount: 5,
    bodyName: "SUV",
    photoUrls: [],
    vin: null,
    ...overrides,
  };
}

describe("toLotDetails", () => {
  it("delegates the age to computeAgeYears (API data, not estimated)", () => {
    const details = toLotDetails(car(), NOW);
    expect(details.ageYears).toBe(computeAgeYears(2023, 1, NOW));
    expect(details.estimated).toBe(false);
    expect(details.engineCc).toBe(2199);
    expect(details.fuel).toBe("diesel");
    expect(details.powerHp).toBeUndefined();
  });

  it("flags an age near the 3-year duty cliff", () => {
    // 2023-08 measured on 2026-08-08 is within the ±2 month bracket window.
    const details = toLotDetails(car({ yearMonth: "202308" }), NOW);
    expect(details.ageNearBracket).toBe(true);
  });

  it.each([["2023"], ["abcdef"], [""], ["202313"], ["202300"]])(
    "leaves the age undefined for malformed yearMonth %j",
    (yearMonth) => {
      const details = toLotDetails(car({ yearMonth }), NOW);
      expect(details.ageYears).toBeUndefined();
      expect(details.ageNearBracket).toBeUndefined();
    },
  );

  it("leaves the displacement undefined when the API sends null", () => {
    const details = toLotDetails(car({ displacementCc: null }), NOW);
    expect(details.engineCc).toBeUndefined();
    expect(lotPrecision(details)).toBe("onRequest");
  });

  it("dashes the recycling fee but computes the duty (no power in the data)", () => {
    const details = toLotDetails(car(), NOW);
    const result = computeAllIn(
      { priceKrw: 20_000_000, ...details },
      RATES,
      DEFAULT_CONFIG,
    );
    expect(result.precision).toBe("partial");
    const recycling = result.items.find((item) => item.id === "recycling");
    expect(recycling !== undefined && isUnknownLine(recycling)).toBe(true);
    const duty = result.items.find((item) => item.id === "duty");
    expect(duty !== undefined && !isUnknownLine(duty)).toBe(true);
  });

  it("keeps the hybrid dash semantics end to end", () => {
    const details = toLotDetails(car({ fuelName: "하이브리드" }), NOW);
    expect(details.fuel).toBe("hybrid");
    const result = computeAllIn(
      { priceKrw: 20_000_000, ...details },
      RATES,
      DEFAULT_CONFIG,
    );
    const recycling = result.items.find((item) => item.id === "recycling");
    expect(recycling !== undefined && isUnknownLine(recycling)).toBe(true);
  });
});

describe("mapFuel", () => {
  it.each([
    ["디젤", "diesel"],
    ["가솔린", "gasoline"],
    ["하이브리드", "hybrid"],
    ["가솔린+전기", "hybrid"],
    ["전기", "electric"],
    ["LPG", "lpg"],
    ["Diesel", "diesel"],
    ["Gasoline", "gasoline"],
    ["Petrol", "gasoline"],
    ["Hybrid", "hybrid"],
    ["Electric", "electric"],
  ])("maps %s to %s", (name, fuel) => {
    expect(mapFuel(name)).toBe(fuel);
  });

  it("returns undefined for an unknown fuel name", () => {
    expect(mapFuel("수소")).toBeUndefined();
  });
});
