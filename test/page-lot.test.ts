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
import type { SpecsCatalog } from "../src/calc/specs";
import { DEFAULT_CONFIG } from "../src/config.default";
import { loadSpecsCatalog, mapFuel, toLotDetails } from "../src/page/lot";
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

  it("keeps the hybrid dash semantics end to end without a catalog", () => {
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

/** Sonata DN8 HEV shape as the collector emits it (drom, 2026-08-08). */
const CATALOG: SpecsCatalog = {
  version: 1,
  generatedAt: "2026-08-08",
  entries: [
    {
      make: "hyundai",
      aliases: ["sonata"],
      from: "201903",
      to: "202312",
      fuel: "hybrid",
      hybridKind: "parallel",
      engineCc: 1999,
      iceHp: 152,
      electricHp30min: 20,
    },
    {
      make: "hyundai",
      aliases: ["ioniq 5"],
      from: "202102",
      fuel: "electric",
      electricHp30min: 76,
    },
  ],
};

describe("toLotDetails with a specs catalog", () => {
  const HYBRID_CAR = car({
    title: "Hyundai Sonata Smart",
    fuelName: "가솔린+전기",
    displacementCc: 1999,
    yearMonth: "202101",
  });

  it("enriches a matched hybrid with both powers and the kind", () => {
    const details = toLotDetails(HYBRID_CAR, NOW, CATALOG);
    expect(details.powerHp).toBe(152);
    expect(details.electricHp30min).toBe(20);
    expect(details.hybridKind).toBe("parallel");
    // Catalog data is a snapshot reading, not an estimate.
    expect(details.estimated).toBe(false);
    // End to end: the fee line now computes from 152 + 20 = 172 л.с.
    const result = computeAllIn(
      { priceKrw: 20_000_000, ...details },
      RATES,
      DEFAULT_CONFIG,
    );
    const recycling = result.items.find((item) => item.id === "recycling");
    expect(recycling !== undefined && !isUnknownLine(recycling)).toBe(true);
  });

  it("enriches a matched EV with the 30-minute power", () => {
    const details = toLotDetails(
      car({
        title: "Hyundai Ioniq 5 Prestige",
        fuelName: "전기",
        displacementCc: null,
        yearMonth: "202205",
      }),
      NOW,
      CATALOG,
    );
    expect(details.electricHp30min).toBe(76);
    expect(details.powerHp).toBeUndefined();
    expect(details.hybridKind).toBeUndefined();
  });

  it("leaves an unmatched lot exactly as before", () => {
    const details = toLotDetails(
      car({ title: "Kia Ray", fuelName: "가솔린+전기", displacementCc: 998 }),
      NOW,
      CATALOG,
    );
    expect(details.electricHp30min).toBeUndefined();
    expect(details.powerHp).toBeUndefined();
    expect(details.hybridKind).toBeUndefined();
  });

  it("never consults the catalog for a non-electrified lot", () => {
    // A diesel Sonata must not inherit the hybrid's powers.
    const details = toLotDetails(
      car({ title: "Hyundai Sonata Smart", displacementCc: 1999 }),
      NOW,
      CATALOG,
    );
    expect(details.electricHp30min).toBeUndefined();
    expect(details.powerHp).toBeUndefined();
  });
});

describe("loadSpecsCatalog", () => {
  const stubFetch = (impl: () => Promise<Response>): (() => void) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  };

  it("returns a valid catalog", async () => {
    const restore = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify(CATALOG), { status: 200 }),
      ),
    );
    try {
      expect(await loadSpecsCatalog("https://example.test/c.json")).toEqual(
        CATALOG,
      );
    } finally {
      restore();
    }
  });

  it.each([
    ["HTTP error", (): Promise<Response> => Promise.resolve(new Response("", { status: 404 }))],
    ["network failure", (): Promise<Response> => Promise.reject(new Error("offline"))],
    ["corrupt shape", (): Promise<Response> => Promise.resolve(new Response('{"version":2}', { status: 200 }))],
    ["non-JSON body", (): Promise<Response> => Promise.resolve(new Response("<html>", { status: 200 }))],
  ])("degrades to undefined on %s", async (_name, impl) => {
    const restore = stubFetch(impl);
    try {
      expect(
        await loadSpecsCatalog("https://example.test/c.json"),
      ).toBeUndefined();
    } finally {
      restore();
    }
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
    ["Gasoline+Electric", "hybrid"],
    ["electric + gasoline", "hybrid"],
    ["Diesel+Electric", "hybrid"],
  ])("maps %s to %s", (name, fuel) => {
    expect(mapFuel(name)).toBe(fuel);
  });

  it("returns undefined for an unknown fuel name", () => {
    expect(mapFuel("수소")).toBeUndefined();
  });
});
