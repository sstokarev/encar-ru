/**
 * Specs catalog matcher (src/calc/specs.ts) + the shipped catalog file.
 *
 * Matching is honesty-first: a match happens only when every surviving
 * candidate agrees on the figures; disagreement or absence yields undefined
 * so the engine dashes power lines instead of guessing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isValidCatalog,
  matchSpecs,
  type SpecsCatalog,
  type SpecsEntry,
} from "../src/calc/specs";
import type { CarData } from "../src/encar/types";

function car(overrides: Partial<CarData>): CarData {
  return {
    vehicleId: "1",
    title: "Hyundai Sonata Smart",
    priceKrw: 20_000_000,
    yearMonth: "202101",
    mileageKm: 50_000,
    displacementCc: null,
    fuelName: "가솔린+전기",
    transmissionName: "AT",
    colorName: "white",
    seatCount: 5,
    bodyName: "sedan",
    photoUrls: [],
    vin: null,
    ...overrides,
  };
}

const SONATA_HEV: SpecsEntry = {
  make: "hyundai",
  aliases: ["sonata"],
  from: "201903",
  to: "202312",
  fuel: "hybrid",
  hybridKind: "parallel",
  engineCc: 1999,
  iceHp: 152,
  electricHp30min: 20,
  grades: ["smart", "premium", "prestige"],
};

const IONIQ5: SpecsEntry = {
  make: "hyundai",
  aliases: ["ioniq 5", "ioniq5"],
  from: "202102",
  fuel: "electric",
  electricHp30min: 76,
};

function catalog(entries: SpecsEntry[]): SpecsCatalog {
  return { version: 1, generatedAt: "2026-08-08", entries };
}

describe("isValidCatalog", () => {
  it("accepts a well-formed catalog", () => {
    expect(isValidCatalog(catalog([SONATA_HEV, IONIQ5]))).toBe(true);
  });

  it("rejects non-objects, wrong version, and malformed entries", () => {
    expect(isValidCatalog(null)).toBe(false);
    expect(isValidCatalog("[]")).toBe(false);
    expect(isValidCatalog({ ...catalog([]), version: 2 })).toBe(false);
    // hybrid without iceHp
    expect(
      isValidCatalog(catalog([{ ...SONATA_HEV, iceHp: undefined } as SpecsEntry])),
    ).toBe(false);
    // EV carrying ICE fields
    expect(
      isValidCatalog(catalog([{ ...IONIQ5, engineCc: 1999 } as SpecsEntry])),
    ).toBe(false);
    // zero power is not data
    expect(
      isValidCatalog(catalog([{ ...IONIQ5, electricHp30min: 0 }])),
    ).toBe(false);
  });

  it("rejects implausible values a typo'd cell could produce", () => {
    // kW captured as hp, dropped digits, impossible months, inverted windows.
    expect(
      isValidCatalog(catalog([{ ...IONIQ5, electricHp30min: 2000 }])),
    ).toBe(false);
    expect(
      isValidCatalog(catalog([{ ...SONATA_HEV, engineCc: 199 }])),
    ).toBe(false);
    expect(
      isValidCatalog(catalog([{ ...SONATA_HEV, from: "201913" }])),
    ).toBe(false);
    expect(
      isValidCatalog(catalog([{ ...SONATA_HEV, from: "202001", to: "201901" }])),
    ).toBe(false);
  });
});

describe("matchSpecs", () => {
  const cat = catalog([SONATA_HEV, IONIQ5]);

  it("matches a hybrid by make+model+cc inside the production window", () => {
    const spec = matchSpecs(
      car({ title: "Hyundai Sonata Smart", displacementCc: 1999 }),
      "hybrid",
      cat,
    );
    expect(spec).toEqual({
      fuel: "hybrid",
      hybridKind: "parallel",
      iceHp: 152,
      electricHp30min: 20,
    });
  });

  it("tolerates encar's rounded displacement (2000 vs 1999)", () => {
    expect(
      matchSpecs(
        car({ title: "Hyundai Sonata Premium", displacementCc: 2000 }),
        "hybrid",
        cat,
      ),
    ).toBeDefined();
  });

  it("refuses a different engine (cc outside tolerance)", () => {
    expect(
      matchSpecs(
        car({ title: "Hyundai Sonata Smart", displacementCc: 2497 }),
        "hybrid",
        cat,
      ),
    ).toBeUndefined();
  });

  it("matches an EV without displacement", () => {
    const spec = matchSpecs(
      car({ title: "Hyundai Ioniq 5 Prestige", yearMonth: "202205", fuelName: "전기" }),
      "electric",
      cat,
    );
    expect(spec).toEqual({ fuel: "electric", electricHp30min: 76 });
  });

  it("does not let a hybrid lot match an EV entry or vice versa", () => {
    expect(
      matchSpecs(car({ title: "Hyundai Ioniq 5" }), "hybrid", cat),
    ).toBeUndefined();
    expect(
      matchSpecs(
        car({ title: "Hyundai Sonata", displacementCc: 1999 }),
        "electric",
        cat,
      ),
    ).toBeUndefined();
  });

  it("refuses registration before production start", () => {
    expect(
      matchSpecs(
        car({ title: "Hyundai Ioniq 5", yearMonth: "202012" }),
        "electric",
        cat,
      ),
    ).toBeUndefined();
  });

  it("keeps a car registered after the production window ended", () => {
    // Production ended 202312; a leftover registered 202403 is still that car.
    expect(
      matchSpecs(
        car({ title: "Hyundai Sonata Smart", displacementCc: 1999, yearMonth: "202403" }),
        "hybrid",
        cat,
      ),
    ).toBeDefined();
  });

  it("prefers the generation whose window contains the registration", () => {
    const oldGen: SpecsEntry = {
      ...SONATA_HEV,
      from: "201501",
      to: "201902",
      iceHp: 156,
      electricHp30min: 18,
    };
    const spec = matchSpecs(
      car({ title: "Hyundai Sonata Smart", displacementCc: 1999, yearMonth: "202101" }),
      "hybrid",
      catalog([oldGen, SONATA_HEV]),
    );
    expect(spec?.iceHp).toBe(152);
  });

  it("prefers the longest model alias", () => {
    const ioniq5n: SpecsEntry = {
      make: "hyundai",
      aliases: ["ioniq 5 n"],
      from: "202307",
      fuel: "electric",
      electricHp30min: 240,
    };
    const spec = matchSpecs(
      car({ title: "Hyundai Ioniq 5 N", yearMonth: "202401" }),
      "electric",
      catalog([IONIQ5, ioniq5n]),
    );
    expect(spec?.electricHp30min).toBe(240);
  });

  it("matches when ambiguous trims agree on the figures", () => {
    const other: SpecsEntry = { ...SONATA_HEV, grades: undefined };
    expect(
      matchSpecs(
        car({ title: "Hyundai Sonata Smart", displacementCc: 1999 }),
        "hybrid",
        catalog([SONATA_HEV, other]),
      ),
    ).toBeDefined();
  });

  it("refuses when surviving candidates disagree on power", () => {
    const stronger: SpecsEntry = { ...SONATA_HEV, iceHp: 180 };
    expect(
      matchSpecs(
        car({ title: "Hyundai Sonata Smart", displacementCc: 1999 }),
        "hybrid",
        catalog([SONATA_HEV, stronger]),
      ),
    ).toBeUndefined();
  });

  it("uses grade tokens to break a tie when they discriminate", () => {
    const smart: SpecsEntry = { ...SONATA_HEV, grades: ["smart"], iceHp: 152 };
    const nLine: SpecsEntry = { ...SONATA_HEV, grades: ["n line"], iceHp: 180 };
    const spec = matchSpecs(
      car({ title: "Hyundai Sonata Smart", displacementCc: 1999 }),
      "hybrid",
      catalog([smart, nLine]),
    );
    expect(spec?.iceHp).toBe(152);
  });

  it("returns undefined on an empty catalog or malformed yearMonth", () => {
    expect(matchSpecs(car({}), "hybrid", catalog([]))).toBeUndefined();
    expect(
      matchSpecs(car({ yearMonth: "garbage" }), "hybrid", cat),
    ).toBeUndefined();
  });

  it("refuses when an open entry and a recently closed twin disagree", () => {
    // The Ioniq 5 shape that produced a wrong-car match in review: an
    // open-ended 76-hp entry and a 103-hp twin closed one month before the
    // registration. The leftover is still plausibly the closed variant, so
    // the match must refuse, not confidently pick the open entry.
    const open: SpecsEntry = { ...IONIQ5, electricHp30min: 76 };
    const closedTwin: SpecsEntry = {
      ...IONIQ5,
      to: "202403",
      electricHp30min: 103,
    };
    expect(
      matchSpecs(
        car({ title: "Hyundai Ioniq 5", yearMonth: "202404", fuelName: "전기" }),
        "electric",
        catalog([open, closedTwin]),
      ),
    ).toBeUndefined();
  });

  it("ignores a long-closed twin once the leftover grace expires", () => {
    const open: SpecsEntry = { ...IONIQ5, electricHp30min: 76 };
    const closedTwin: SpecsEntry = {
      ...IONIQ5,
      to: "202403",
      electricHp30min: 103,
    };
    // 8 months after the twin's window closed: no longer a plausible
    // leftover; the open entry wins alone.
    const spec = matchSpecs(
      car({ title: "Hyundai Ioniq 5", yearMonth: "202411", fuelName: "전기" }),
      "electric",
      catalog([open, closedTwin]),
    );
    expect(spec?.electricHp30min).toBe(76);
  });

  it("matches grade tokens on word boundaries only", () => {
    // The "smart" trim must not fire inside "Smartstream": with the grade
    // tie-break unable to discriminate, differing powers refuse.
    const smart: SpecsEntry = { ...SONATA_HEV, grades: ["smart"], iceHp: 152 };
    const other: SpecsEntry = { ...SONATA_HEV, grades: ["modern"], iceHp: 180 };
    expect(
      matchSpecs(
        car({
          title: "Hyundai Sonata Smartstream Premium",
          displacementCc: 1999,
        }),
        "hybrid",
        catalog([smart, other]),
      ),
    ).toBeUndefined();
  });
});

describe("shipped site/specs-catalog.json", () => {
  const raw: unknown = JSON.parse(
    readFileSync(resolve("site", "specs-catalog.json"), "utf8"),
  );

  it("validates and is non-empty", () => {
    expect(isValidCatalog(raw)).toBe(true);
    expect((raw as SpecsCatalog).entries.length).toBeGreaterThan(0);
  });

  it("is sorted by make, first alias, from — reviewable diffs", () => {
    const entries = (raw as SpecsCatalog).entries;
    const keys = entries.map((e) => `${e.make}|${e.aliases[0]}|${e.from}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("carries the measured reference modifications", () => {
    const entries = (raw as SpecsCatalog).entries;
    // Sonata DN8 2.0 HEV: ICE 152 hp, 30-min electric 20 hp (drom, 2026-08-08).
    const sonata = entries.find(
      (e) => e.aliases.includes("sonata") && e.fuel === "hybrid" && e.from >= "201901",
    );
    expect(sonata?.iceHp).toBe(152);
    expect(sonata?.electricHp30min).toBe(20);
    // Ioniq 5 58 kWh: 30-min power 76 hp (drom, 2026-08-08).
    const ioniq = entries.find(
      (e) => e.aliases.some((a) => a.startsWith("ioniq 5")) && e.fuel === "electric",
    );
    expect(ioniq?.electricHp30min).toBe(76);
  });
});
