/**
 * U6 reference table for the real customs calculator (R9-R11).
 *
 * Formulas are data (config), the calculator interprets brackets. Every
 * expected value below is computed by hand in the comments from the tariff
 * table pinned in TEST_CUSTOMS — the test data is independent of
 * DEFAULT_CONFIG so an accidental default edit cannot silently bend the math.
 * The REAL shipped tables are pinned separately in test/config-file.test.ts.
 *
 * Hand-math conventions used throughout:
 *   rates: 1 KRW = 0.05 RUB, 1 EUR = 100 RUB
 *   lotRub = priceKrw * 0.05      lotEur = lotRub / 100 = priceKrw / 2000
 *   cost items shipping / sbkts / broker / commission are "unknown": they
 *   render as a dash and add NOTHING to the total, so
 *   total = lot + duty + recycling + clearance.
 */
import { describe, expect, it } from "vitest";

import {
  AGE_BRACKET_NOTE,
  UNKNOWN_COST_NOTE,
  computeAgeYears,
  computeAllIn,
  isNearAgeBracket,
  isUnknownLine,
  type AllInResult,
  type LotParams,
} from "../src/calc/customs";
import type {
  CostItem,
  CustomsConfig,
  WidgetConfig,
} from "../src/config.default";

const TEST_CUSTOMS: CustomsConfig = {
  asOf: "2026-01-01",
  labels: {
    duty: "Таможенная пошлина",
    recycling: "Утилизационный сбор",
    clearance: "Сбор за таможенное оформление",
  },
  dutyValueTiers: [
    { maxEur: 8500, pct: 54, minPerCc: 2.5 },
    { maxEur: 16700, pct: 48, minPerCc: 3.5 },
    { maxEur: 42300, pct: 48, minPerCc: 5.5 },
    { maxEur: 84500, pct: 48, minPerCc: 7.5 },
    { maxEur: 169000, pct: 48, minPerCc: 15 },
    { pct: 48, minPerCc: 20 },
  ],
  dutyPerCcByAge: {
    y3: [
      { maxCc: 1000, eurPerCc: 1.5 },
      { maxCc: 1500, eurPerCc: 1.7 },
      { maxCc: 1800, eurPerCc: 2.5 },
      { maxCc: 2300, eurPerCc: 2.7 },
      { maxCc: 3000, eurPerCc: 3.0 },
      { eurPerCc: 3.6 },
    ],
    y5plus: [
      { maxCc: 1000, eurPerCc: 3.0 },
      { maxCc: 1500, eurPerCc: 3.2 },
      { maxCc: 1800, eurPerCc: 3.5 },
      { maxCc: 2300, eurPerCc: 4.8 },
      { maxCc: 3000, eurPerCc: 5.0 },
      { eurPerCc: 5.7 },
    ],
  },
  // Deliberately round synthetic amounts: the point of these tests is the
  // lookup (displacement class -> power bracket -> age), not the ruble values.
  recyclingFee: {
    reduced: { maxCc: 3000, maxHp: 160, under3yRub: 3400, from3yRub: 5200 },
    classes: [
      {
        maxCc: 2000,
        powerBrackets: [
          { maxHp: 160, under3yRub: 800000, from3yRub: 1400000 },
          { maxHp: 190, under3yRub: 900000, from3yRub: 1500000 },
          { under3yRub: 1000000, from3yRub: 1600000 },
        ],
      },
      {
        maxCc: 3000,
        powerBrackets: [
          { maxHp: 160, under3yRub: 2250000, from3yRub: 3400000 },
          { under3yRub: 2300000, from3yRub: 3500000 },
        ],
      },
      {
        powerBrackets: [
          { maxHp: 160, under3yRub: 3290000, from3yRub: 4325000 },
          { under3yRub: 3300000, from3yRub: 4400000 },
        ],
      },
    ],
  },
  clearanceFeeBrackets: [
    { maxRub: 200000, fee: 1231 },
    { maxRub: 450000, fee: 2462 },
    { maxRub: 1200000, fee: 4924 },
    { maxRub: 2700000, fee: 13541 },
    { maxRub: 4200000, fee: 18465 },
    { maxRub: 5500000, fee: 21344 },
    { maxRub: 10000000, fee: 49240 },
    { fee: 73860 },
  ],
};

const CONFIG: WidgetConfig = {
  version: 1,
  messenger: { type: "telegram", address: "importer" },
  currency: {
    referenceRates: { KRW_RUB: 0.05, EUR_RUB: 100 },
    updatedAt: "2026-08-01",
  },
  costItems: [
    { id: "shipping", label: "Доставка Корея — Владивосток", kind: "unknown" },
    {
      id: "customs",
      label: "Таможенные платежи",
      kind: "formula",
      value: "customs_v1",
    },
    { id: "sbkts", label: "СБКТС и ЭПТС", kind: "unknown" },
    { id: "broker", label: "Брокер и СВХ", kind: "unknown" },
    { id: "commission", label: "Комиссия импортёра", kind: "unknown" },
  ],
  commissionNote: "",
  customs: TEST_CUSTOMS,
};

const RATES = { krwRub: 0.05, eurRub: 100 };

/** A fully specified lot: age, displacement AND power are all known. */
const FULL_LOT: LotParams = {
  priceKrw: 20_000_000,
  ageYears: 2,
  engineCc: 2000,
  powerHp: 150,
  fuel: "gasoline",
};

function compute(lot: LotParams, config: WidgetConfig = CONFIG): AllInResult {
  return computeAllIn(lot, RATES, config);
}

function line(result: AllInResult, id: string): AllInResult["items"][number] {
  const item = result.items.find((entry) => entry.id === id);
  if (item === undefined) throw new Error(`item ${id} missing`);
  return item;
}

function itemRub(result: AllInResult, id: string): number {
  const rub = line(result, id).rub;
  if (rub === undefined) throw new Error(`item ${id} has no amount`);
  return rub;
}

function isDash(result: AllInResult, id: string): boolean {
  return isUnknownLine(line(result, id));
}

describe("computeAgeYears", () => {
  const NOW = new Date(2026, 7, 1); // 2026-08-01

  /** The age expressed in the unit the decree counts in: whole months. */
  const months = (year: number, month: number, now: Date = NOW): number =>
    computeAgeYears(year, month, now) * 12;

  it("counts the anniversary from the END of the registration month", () => {
    // The DOM gives year+month only. A car registered 2023-08-31 is NOT yet
    // three years old on 2026-08-01, so the anniversary month itself may not
    // buy the cheaper 3-5y regime: 35 months until the month has fully passed.
    expect(months(2023, 8)).toBe(35);
    // One month later the whole anniversary month is behind us => 36 months.
    expect(months(2023, 8, new Date(2026, 8, 1))).toBe(36);
    // 2023-09 -> 2026-08: still short of the anniversary.
    expect(months(2023, 9)).toBe(34);
    expect(months(2020, 7)).toBe(72);
    expect(months(2020, 8)).toBe(71);
    expect(months(2026, 1)).toBe(6);
  });

  it("keeps the age month-accurate instead of flooring it to whole years", () => {
    // Flooring made every car in its SIXTH year (60-71 months) look exactly
    // five years old and buy the cheaper "3-5 years" duty bracket. The value
    // is years, but a real number: 71 months is 5.92 years, not 5.
    expect(computeAgeYears(2020, 8, NOW)).toBeCloseTo(71 / 12, 10);
    expect(computeAgeYears(2020, 8, NOW)).toBeGreaterThan(5);
    // Whole-year boundaries stay exact, so the cliff comparisons are safe.
    expect(computeAgeYears(2020, 7, NOW)).toBe(6);
    expect(computeAgeYears(2023, 8, new Date(2026, 8, 1))).toBe(3);
  });

  it("never returns a negative age", () => {
    expect(computeAgeYears(2027, 1, NOW)).toBe(0);
  });
});

/**
 * Решение 107 п.3 is "более 3, но не более 5 лет" and п.4 is "более 5". Both
 * boundaries fall inside a year, so a floored age cannot express them: with
 * `ageYears <= 5` every car in its sixth year was charged the cheaper 3-5
 * rate — up to 383 008 RUB understated on a 2 L car, always in the direction
 * that costs the importer money.
 */
describe("duty age cliffs are month-accurate, not floored years", () => {
  const NOW = new Date(2026, 7, 2); // 2026-08-02
  const PRICE = 10_000_000; // lotEur 5 000

  /** Duty RUB for a 2000cc lot registered in (year, month). */
  const dutyFor = (year: number, month: number): number =>
    itemRub(
      compute({
        ...FULL_LOT,
        priceKrw: PRICE,
        engineCc: 2000,
        ageYears: computeAgeYears(year, month, NOW),
      }),
      "duty",
    );

  // <3y value tier: max(54% * 5 000, 2.5 * 2000) EUR = 5 000 EUR = 500 000 RUB.
  const UNDER_3Y_RUB = 500_000;
  // п.3, 2001-2300cc: 2.7 EUR/cc = 5 400 EUR = 540 000 RUB.
  const AGE_3_TO_5_RUB = 540_000;
  // п.4, 2001-2300cc: 4.8 EUR/cc = 9 600 EUR = 960 000 RUB.
  const OVER_5Y_RUB = 960_000;

  it("charges the >5y rate to a car in its sixth year", () => {
    // Registered 2021-01, valued 2026-08-02: 66 full months. Past the fifth
    // anniversary, so п.4 applies. Flooring said "5 years" and billed п.3.
    expect(dutyFor(2021, 1)).toBe(OVER_5Y_RUB);
  });

  it("puts the >5y cliff at 60 months, to the month", () => {
    // 2021-07 -> exactly 60 months: "не более 5 лет" is still п.3.
    expect(dutyFor(2021, 7)).toBe(AGE_3_TO_5_RUB);
    // 2021-06 -> 61 months: past five years, п.4.
    expect(dutyFor(2021, 6)).toBe(OVER_5Y_RUB);
  });

  it("puts the 3y cliff at 36 months, to the month", () => {
    // 2023-08 -> 35 months: still the <3y percent-of-value regime.
    expect(dutyFor(2023, 8)).toBe(UNDER_3Y_RUB);
    // 2023-07 -> 36 months: the flat 3-5y bracket.
    expect(dutyFor(2023, 7)).toBe(AGE_3_TO_5_RUB);
  });
});

describe("age near a duty bracket boundary", () => {
  const NOW = new Date(2026, 7, 1); // 2026-08-01

  it("flags registrations within ~2 months of the 3y and 5y cliffs", () => {
    // 2023-08 -> 35 full months: one month short of the 3y regime change.
    expect(isNearAgeBracket(2023, 8, NOW)).toBe(true);
    // 2023-06 -> 37 months, 2023-10 -> 33 months: inside / outside the window.
    expect(isNearAgeBracket(2023, 6, NOW)).toBe(true);
    expect(isNearAgeBracket(2023, 10, NOW)).toBe(false);
    // 5y cliff: 2021-08 -> 59 months.
    expect(isNearAgeBracket(2021, 8, NOW)).toBe(true);
    expect(isNearAgeBracket(2021, 4, NOW)).toBe(false);
    // Nowhere near a boundary.
    expect(isNearAgeBracket(2016, 9, NOW)).toBe(false);
  });

  it("quotes the <3y regime for a lot registered in the 3y anniversary month", () => {
    // 20,000,000 KRW, 2000cc, registered 2023-08, valued at 2026-08-01.
    // <3y: max(48% * 10,000 EUR, 3.5 * 2000) = 7,000 EUR = 700,000 RUB.
    // 3-5y would be 2.7 * 2000 = 5,400 EUR = 540,000 RUB — the cheaper
    // bracket we cannot prove, so it must NOT be the one quoted.
    const ageYears = computeAgeYears(2023, 8, NOW);
    const result = compute({
      ...FULL_LOT,
      ageYears,
      ageNearBracket: isNearAgeBracket(2023, 8, NOW),
    });
    expect(itemRub(result, "duty")).toBe(700_000);
  });

  it("degrades an exact lot to approx with a Russian note near a boundary", () => {
    const plain = compute(FULL_LOT);
    expect(plain.precision).toBe("exact");
    expect(plain.notes).not.toContain(AGE_BRACKET_NOTE);

    const near = compute({ ...FULL_LOT, ageNearBracket: true });
    expect(near.precision).toBe("approx");
    expect(near.notes).toContain(AGE_BRACKET_NOTE);
    // Same money, only the confidence changes.
    expect(near.totalRub).toBe(plain.totalRub);
  });
});

describe("duty: age <3y value tiers (percent with EUR/cc minimum)", () => {
  // All cases age 2. priceKrw = lotEur * 2000 (see hand-math conventions).
  // Expected duty EUR = max(lotEur * pct/100, minPerCc * cc); RUB = EUR * 100.
  const cases: Array<{
    name: string;
    lotEur: number;
    cc: number;
    dutyRub: number;
  }> = [
    // tier 1 (<=8500, 54%, min 2.5): 8500*0.54=4590 > 2.5*1000=2500
    { name: "tier 1 upper edge, pct wins", lotEur: 8500, cc: 1000, dutyRub: 459000 },
    // tier 2 (8600, 48%, min 3.5): 8600*0.48=4128 > 3.5*1000=3500
    { name: "just above tier 1 switches to 48%", lotEur: 8600, cc: 1000, dutyRub: 412800 },
    // tier 2 min wins: 10000*0.48=4800 < 3.5*2000=7000
    { name: "tier 2, per-cc minimum wins", lotEur: 10000, cc: 2000, dutyRub: 700000 },
    // tier 2 upper edge: 16700*0.48=8016 > 3500
    { name: "tier 2 upper edge", lotEur: 16700, cc: 1000, dutyRub: 801600 },
    // tier 3 (16800, min 5.5): 16800*0.48=8064 > 5500
    { name: "tier 3 lower edge", lotEur: 16800, cc: 1000, dutyRub: 806400 },
    // tier 3 upper edge: 42300*0.48=20304
    { name: "tier 3 upper edge", lotEur: 42300, cc: 1000, dutyRub: 2030400 },
    // tier 4 (42400, min 7.5): 42400*0.48=20352 > 7500
    { name: "tier 4 lower edge", lotEur: 42400, cc: 1000, dutyRub: 2035200 },
    // tier 4: 50000*0.48=24000 > 7.5*3000=22500 (pct still wins)
    { name: "tier 4 with large engine", lotEur: 50000, cc: 3000, dutyRub: 2400000 },
    // tier 5 (84600, min 15): 84600*0.48=40608 > 15*1000=15000
    { name: "tier 5 lower edge", lotEur: 84600, cc: 1000, dutyRub: 4060800 },
    // top tier (169100, min 20): 169100*0.48=81168 > 20*1000=20000
    { name: "open-ended top tier, pct wins", lotEur: 169100, cc: 1000, dutyRub: 8116800 },
    // top tier min wins: 20*5000=100000 > 169100*0.48=81168
    { name: "open-ended top tier, per-cc minimum wins", lotEur: 169100, cc: 5000, dutyRub: 10000000 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = compute({
        ...FULL_LOT,
        priceKrw: c.lotEur * 2000,
        engineCc: c.cc,
      });
      expect(itemRub(result, "duty")).toBe(c.dutyRub);
    });
  }
});

describe("duty: per-cc brackets by age", () => {
  // Fixed price 10,000,000 KRW (lotEur 5000 is irrelevant for per-cc duty).
  // Expected duty RUB = eurPerCc * cc * 100.
  const PRICE = 10_000_000;

  const cases: Array<{ age: number; cc: number; dutyRub: number }> = [
    // age 3-5 (y3): [<=1000:1.5, <=1500:1.7, <=1800:2.5, <=2300:2.7, <=3000:3.0, +:3.6]
    { age: 3, cc: 1000, dutyRub: 150000 }, // 1.5*1000=1500 EUR
    { age: 4, cc: 1001, dutyRub: 170170 }, // 1.7*1001=1701.7 EUR
    { age: 4, cc: 1500, dutyRub: 255000 }, // 1.7*1500=2550 EUR
    { age: 4, cc: 1800, dutyRub: 450000 }, // 2.5*1800=4500 EUR
    { age: 4, cc: 2300, dutyRub: 621000 }, // 2.7*2300=6210 EUR
    { age: 5, cc: 3000, dutyRub: 900000 }, // 3.0*3000=9000 EUR (exactly 5y is still 3-5)
    { age: 4, cc: 3001, dutyRub: 1080360 }, // 3.6*3001=10803.6 EUR
    // age >5 (y5plus): [<=1000:3.0, <=1500:3.2, <=1800:3.5, <=2300:4.8, <=3000:5.0, +:5.7]
    { age: 6, cc: 1000, dutyRub: 300000 }, // 3.0*1000=3000 EUR
    { age: 6, cc: 1500, dutyRub: 480000 }, // 3.2*1500=4800 EUR
    { age: 10, cc: 1800, dutyRub: 630000 }, // 3.5*1800=6300 EUR
    { age: 6, cc: 2300, dutyRub: 1104000 }, // 4.8*2300=11040 EUR
    { age: 7, cc: 3000, dutyRub: 1500000 }, // 5.0*3000=15000 EUR
    { age: 6, cc: 3500, dutyRub: 1995000 }, // 5.7*3500=19950 EUR
  ];

  for (const c of cases) {
    it(`age ${c.age}y, ${c.cc}cc -> ${c.dutyRub} RUB`, () => {
      const result = compute({
        ...FULL_LOT,
        priceKrw: PRICE,
        ageYears: c.age,
        engineCc: c.cc,
      });
      expect(itemRub(result, "duty")).toBe(c.dutyRub);
    });
  }

  it("exactly 3 years old uses the 3-5y bracket, not value tiers", () => {
    // 2000cc age 3 -> 2.7 EUR/cc => 5400 EUR = 540,000 RUB. The <3y value
    // tier for lotEur 5000 would give max(54%*5000=2700, 2.5*2000=5000) EUR
    // = 500,000 RUB — a different number, so the bracket choice is provable.
    const result = compute({ ...FULL_LOT, priceKrw: PRICE, ageYears: 3 });
    expect(itemRub(result, "duty")).toBe(540000);
  });
});

describe("recycling fee: displacement class x power bracket x age", () => {
  const PRICE = 10_000_000;
  const at = (age: number, cc: number, hp: number): number =>
    itemRub(
      compute({ ...FULL_LOT, priceKrw: PRICE, ageYears: age, engineCc: cc, powerHp: hp }),
      "recycling",
    );

  it("reduced personal-use rate under both caps (<=3000cc, <=160hp)", () => {
    expect(at(2, 2000, 150)).toBe(3400);
    expect(at(6, 2000, 150)).toBe(5200);
    expect(at(6, 3000, 160)).toBe(5200); // both caps are inclusive
    expect(at(6, 2500, 150)).toBe(5200);
  });

  it("above 160 hp the reduced rate is gone (PP 1713, in force 01.12.2025)", () => {
    // 2000cc: <=160hp 800000/1400000, <=190hp 900000/1500000, else 1000000/1600000
    expect(at(6, 2000, 161)).toBe(1500000);
    expect(at(2, 2000, 161)).toBe(900000);
    expect(at(6, 2000, 200)).toBe(1600000);
    expect(at(2, 2000, 200)).toBe(1000000);
  });

  it("above 3000cc there is no reduced rate at any power", () => {
    // 3500cc / 150hp: the >3000cc class, lowest power bracket.
    expect(at(6, 3500, 150)).toBe(4325000);
    expect(at(2, 3500, 150)).toBe(3290000);
  });

  it("picks the displacement class by full displacement", () => {
    // 2001cc leaves the <=2000 class even though the power bracket is the same.
    expect(at(6, 2001, 200)).toBe(3500000);
    expect(at(6, 2000, 200)).toBe(1600000);
  });

  it("renders a dash when the engine power is unknown", () => {
    // Power is not on the encar listing: the 2025 reform made the fee depend
    // on it, so quoting anything here would be a guess between 5 200 RUB and
    // seven figures.
    const result = compute({ ...FULL_LOT, powerHp: undefined });
    expect(isDash(result, "recycling")).toBe(true);
    expect(isDash(result, "duty")).toBe(false);
    expect(isDash(result, "clearance")).toBe(false);
    expect(result.precision).toBe("partial");
  });

  it("renders a dash for a hybrid even when a power figure is known", () => {
    // For a parallel hybrid the decree adds the electric motor's 30-minute
    // power to the ICE power; the listing gives at most one of the two.
    const result = compute({ ...FULL_LOT, fuel: "hybrid" });
    expect(isDash(result, "recycling")).toBe(true);
    expect(isDash(result, "duty")).toBe(false);
    expect(result.precision).toBe("partial");
  });
});

describe("customs clearance fee brackets (by lot RUB value)", () => {
  // priceKrw = lotRub * 20 at 0.05 RUB/KRW (exact, no rounding involved).
  const cases: Array<{ lotRub: number; fee: number }> = [
    { lotRub: 200000, fee: 1231 },
    { lotRub: 200001, fee: 2462 },
    { lotRub: 450000, fee: 2462 },
    { lotRub: 1200000, fee: 4924 },
    { lotRub: 1200001, fee: 13541 },
    { lotRub: 10000000, fee: 49240 },
    { lotRub: 10000001, fee: 73860 },
  ];

  for (const c of cases) {
    it(`lot ${c.lotRub} RUB -> fee ${c.fee}`, () => {
      const result = compute({
        ...FULL_LOT,
        priceKrw: c.lotRub * 20,
        ageYears: 4,
        engineCc: 1000,
      });
      expect(itemRub(result, "clearance")).toBe(c.fee);
    });
  }
});

describe("all-in total", () => {
  it("sums lot and customs only; unknown items are dashes", () => {
    // 20,000,000 KRW, age 2, 2000cc, 150 hp:
    //   lot        = 20,000,000 * 0.05          = 1,000,000
    //   duty       = max(48%*10,000, 3.5*2000) EUR = 7,000 EUR = 700,000
    //   recycling  = 3,400 (reduced: <3y, <=3000cc, <=160hp)
    //   clearance  = 4,924 (lot 1,000,000 <= 1,200,000)
    //   shipping / sbkts / broker / commission: unknown -> dash, add nothing
    //   total      = 1,708,324
    const result = compute(FULL_LOT);
    expect(result.precision).toBe("exact");
    expect(result.items.map((item) => item.id)).toEqual([
      "lot",
      "shipping",
      "duty",
      "recycling",
      "clearance",
      "sbkts",
      "broker",
      "commission",
    ]);
    expect(itemRub(result, "lot")).toBe(1_000_000);
    expect(result.totalRub).toBe(1_708_324);
  });

  it("marks the unknown cost items as dashes without degrading precision", () => {
    const result = compute(FULL_LOT);
    for (const id of ["shipping", "sbkts", "broker", "commission"]) {
      expect(isDash(result, id)).toBe(true);
    }
    expect(isDash(result, "lot")).toBe(false);
    expect(result.precision).toBe("exact");
    expect(result.notes).toContain(UNKNOWN_COST_NOTE);
  });

  it("adds nothing for an unknown item however many there are", () => {
    const extra: WidgetConfig = {
      ...CONFIG,
      costItems: [
        ...CONFIG.costItems,
        { id: "storage", label: "Хранение", kind: "unknown" },
        { id: "delivery_rf", label: "Доставка по РФ", kind: "unknown" },
      ],
    };
    expect(compute(FULL_LOT, extra).totalRub).toBe(compute(FULL_LOT).totalRub);
    expect(compute(FULL_LOT, extra).precision).toBe("exact");
  });

  it("still computes percent and fixed items when a config uses them", () => {
    const withMoney: WidgetConfig = {
      ...CONFIG,
      costItems: [
        ...CONFIG.costItems,
        { id: "extra", label: "Доп. услуга", kind: "fixed", value: 10000 },
        { id: "fee", label: "Комиссия", kind: "percent", value: 5 },
      ],
    };
    const result = compute(FULL_LOT, withMoney);
    expect(itemRub(result, "extra")).toBe(10_000);
    expect(itemRub(result, "fee")).toBe(50_000); // 5% of 1,000,000
    expect(result.precision).toBe("exact");
    expect(result.totalRub).toBe(1_708_324 + 10_000 + 50_000);
  });

  it("hybrid with a known displacement computes duty like a combustion car", () => {
    // 1600cc age 4 -> y3 bracket 2.5 EUR/cc = 4000 EUR = 400,000 RUB.
    const result = compute({
      ...FULL_LOT,
      priceKrw: 10_000_000,
      ageYears: 4,
      engineCc: 1600,
      fuel: "hybrid",
    });
    expect(itemRub(result, "duty")).toBe(400000);
  });
});

describe("host page that replaced Array.prototype.reduce (encar polyfill)", () => {
  it("still totals the quote instead of refusing every lot", () => {
    // Measured live on www.encar.com (2026-08-02): its ES5 bundle replaces
    // Array.prototype.reduce with an implementation that ignores the callback
    // and returns the array — `[1,2,3].reduce((s,x)=>s+x,0)` yielded [1,2,3].
    // The total then failed Number.isFinite, so every quote degraded and the
    // entire desktop listing read "по запросу". Globals belong to the host
    // page; only syntax (for-of) is ours.
    const original = Array.prototype.reduce;
    let result: AllInResult;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.prototype as any).reduce = function (this: unknown[]) {
        return this;
      };
      result = compute(FULL_LOT);
    } finally {
      Array.prototype.reduce = original;
    }
    expect(result.precision).toBe("exact");
    expect(Number.isFinite(result.totalRub)).toBe(true);
    // Same number as the untouched run: lot + duty + recycling + clearance.
    expect(result.totalRub).toBe(compute(FULL_LOT).totalRub);
  });
});

describe("cost items the calculator cannot handle", () => {
  function withItems(items: CostItem[]): WidgetConfig {
    return { ...CONFIG, costItems: items };
  }

  it("does not silently drop a fixed item whose value is a quoted number", () => {
    // A hand-edited config with "220000" instead of 220000: the shipping line
    // used to vanish and the total was 220,000 RUB too low, silently. A
    // malformed item is NOT the same thing as a deliberate "unknown" one.
    const quoted = withItems([
      {
        id: "shipping",
        label: "Доставка Корея — Владивосток",
        kind: "fixed",
        value: "220000",
      } as unknown as CostItem,
    ]);
    const result = compute(FULL_LOT, quoted);
    expect(result.items.some((item) => item.id === "shipping")).toBe(false);
    expect(result.precision).toBe("onRequest");
  });

  it("treats an unknown formula identifier as not computable", () => {
    const unknown = withItems([
      { id: "customs", label: "Таможенные платежи", kind: "formula", value: "customs_v2" },
    ]);
    const result = compute(FULL_LOT, unknown);
    expect(result.items.some((item) => item.id === "duty")).toBe(false);
    expect(result.precision).toBe("onRequest");
  });

  it("expands the customs block once even with a duplicated formula item", () => {
    const doubled = withItems([
      { id: "customs", label: "Таможенные платежи", kind: "formula", value: "customs_v1" },
      { id: "customs2", label: "Таможенные платежи 2", kind: "formula", value: "customs_v1" },
    ]);
    const result = compute(FULL_LOT, doubled);
    const ids = result.items.map((item) => item.id);
    expect(ids.filter((id) => id === "duty").length).toBe(1);
    expect(ids.filter((id) => id === "recycling").length).toBe(1);
    // The second (unusable) item must be visible as a degradation, not hidden.
    expect(result.precision).toBe("onRequest");
  });
});

describe("partial quotes (an uncomputable customs line is a dash, not a wall)", () => {
  it("quotes a partial total when the displacement is unknown", () => {
    // 34 of 41 listing rows have no displacement. The lot price and the
    // clearance fee are still provable, so the quote is a floor, not a
    // "по запросу": 1,000,000 + 4,924.
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      fuel: "gasoline",
    });
    expect(result.precision).toBe("partial");
    expect(isDash(result, "duty")).toBe(true);
    expect(isDash(result, "recycling")).toBe(true);
    expect(isDash(result, "clearance")).toBe(false);
    expect(result.totalRub).toBe(1_004_924);
  });

  it("quotes a partial total when the age is unknown", () => {
    const result = compute({
      priceKrw: 20_000_000,
      engineCc: 2000,
      powerHp: 150,
      fuel: "gasoline",
    });
    expect(result.precision).toBe("partial");
    expect(isDash(result, "duty")).toBe(true);
    expect(isDash(result, "recycling")).toBe(true);
    expect(result.totalRub).toBe(1_004_924);
  });

  it("keeps every dash out of the total and gives it no amount at all", () => {
    const result = compute({ priceKrw: 20_000_000, fuel: "gasoline" });
    const dashed = result.items.filter(isUnknownLine);
    expect(dashed.length).toBeGreaterThan(0);
    // A dash carries no figure: a zero would sum in silently and read as
    // "free" on screen.
    for (const item of dashed) expect(item.rub).toBeUndefined();
    let summed = 0;
    for (const item of result.items) {
      if (!isUnknownLine(item)) summed += item.rub;
    }
    expect(result.totalRub).toBe(summed);
  });

  it("estimated params stay partial, not approx, when customs are incomplete", () => {
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      estimated: true,
      fuel: "gasoline",
    });
    expect(result.precision).toBe("partial");
  });

  it("approx survives when every customs line is computable", () => {
    const result = compute({ ...FULL_LOT, estimated: true });
    expect(result.precision).toBe("approx");
  });
});

/**
 * The line between a partial quote and a refusal (R3).
 *
 * MISSING data (no displacement on the row, no power anywhere) is a legitimate
 * partial: that line dashes and the total is a provable floor. A param that is
 * PRESENT BUT INVALID — NaN, Infinity, zero, negative — is not data at all: it
 * is a half-parsed row, and quoting "от N ₽" off it puts a spendable number
 * under a lot whose inputs are nonsense.
 */
describe("present-but-invalid params refuse; missing ones are a floor", () => {
  const invalid: Array<{ name: string; lot: LotParams }> = [
    { name: "NaN age", lot: { ...FULL_LOT, ageYears: Number.NaN } },
    {
      name: "Infinity age",
      lot: { ...FULL_LOT, ageYears: Number.POSITIVE_INFINITY },
    },
    { name: "negative age", lot: { ...FULL_LOT, ageYears: -3 } },
    { name: "NaN displacement", lot: { ...FULL_LOT, engineCc: Number.NaN } },
    { name: "zero displacement", lot: { ...FULL_LOT, engineCc: 0 } },
    { name: "negative displacement", lot: { ...FULL_LOT, engineCc: -2000 } },
    { name: "NaN power", lot: { ...FULL_LOT, powerHp: Number.NaN } },
    { name: "zero power", lot: { ...FULL_LOT, powerHp: 0 } },
    { name: "negative power", lot: { ...FULL_LOT, powerHp: -150 } },
  ];

  for (const { name, lot } of invalid) {
    it(`${name} is refused, never quoted as a floor`, () => {
      const result = compute(lot);
      expect(result.precision).toBe("onRequest");
      expect(Number.isFinite(result.totalRub)).toBe(true);
    });
  }

  it("quotes a floor for params that are simply absent", () => {
    expect(compute({ ...FULL_LOT, ageYears: undefined }).precision).toBe(
      "partial",
    );
    expect(compute({ ...FULL_LOT, engineCc: undefined }).precision).toBe(
      "partial",
    );
    expect(compute({ ...FULL_LOT, powerHp: undefined }).precision).toBe(
      "partial",
    );
  });

  it("refuses an unusable price even when no customs item can catch it", () => {
    // Without a formula item nothing in the config depends on the lot price,
    // so a NaN/zero/negative price sailed through as an "exact" total of the
    // fixed lines. There is no lower bound without a price.
    const noCustoms: WidgetConfig = {
      ...CONFIG,
      costItems: [
        { id: "shipping", label: "Доставка", kind: "fixed", value: 220_000 },
      ],
    };
    for (const priceKrw of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const result = compute({ ...FULL_LOT, priceKrw }, noCustoms);
      expect(result.precision).toBe("onRequest");
    }
    for (const rates of [
      { krwRub: Number.NaN, eurRub: 100 },
      { krwRub: 0.05, eurRub: 0 },
    ]) {
      expect(computeAllIn(FULL_LOT, rates, noCustoms).precision).toBe(
        "onRequest",
      );
    }
  });
});

describe("degradation to 'on request'", () => {
  it("EV stays on request: different rules entirely", () => {
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      fuel: "electric",
    });
    expect(result.precision).toBe("onRequest");
    expect(result.items.some((item) => item.id === "duty")).toBe(false);
  });

  it("EV stays on request even when displacement and power are present", () => {
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      engineCc: 100,
      powerHp: 150,
      fuel: "electric",
    });
    expect(result.precision).toBe("onRequest");
  });

  it("an unusable lot price is on request, not a partial total", () => {
    for (const priceKrw of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = compute({ ...FULL_LOT, priceKrw });
      expect(result.precision).toBe("onRequest");
      expect(result.items.some((item) => item.id === "lot")).toBe(false);
    }
  });

  it("an unusable FX rate is on request", () => {
    const result = computeAllIn(FULL_LOT, { krwRub: 0, eurRub: 100 }, CONFIG);
    expect(result.precision).toBe("onRequest");
  });

  it("never returns a non-finite total", () => {
    for (const lot of [
      FULL_LOT,
      { ...FULL_LOT, engineCc: undefined },
      { ...FULL_LOT, priceKrw: Number.NaN },
      { priceKrw: 20_000_000, fuel: "electric" as const },
    ]) {
      expect(Number.isFinite(compute(lot).totalRub)).toBe(true);
    }
  });
});
