/**
 * U6 reference table for the real customs calculator (R9-R11).
 *
 * Formulas are data (config), the calculator interprets brackets. Every
 * expected value below is computed by hand in the comments from the tariff
 * table pinned in TEST_CUSTOMS — the test data is independent of
 * DEFAULT_CONFIG so an accidental default edit cannot silently bend the math.
 *
 * Hand-math conventions used throughout:
 *   rates: 1 KRW = 0.05 RUB, 1 EUR = 100 RUB
 *   lotRub = priceKrw * 0.05      lotEur = lotRub / 100 = priceKrw / 2000
 *   fixed items: shipping 220 000 + SBKTS/EPTS 45 000 + broker 85 000 = 350 000
 *   commission: 5% of lotRub
 */
import { describe, expect, it } from "vitest";

import {
  AGE_BRACKET_NOTE,
  computeAgeYears,
  computeAllIn,
  isNearAgeBracket,
  type AllInResult,
  type LotParams,
} from "../src/calc/customs";
import type {
  CostItem,
  CustomsConfig,
  WidgetConfig,
} from "../src/config.default";

const TEST_CUSTOMS: CustomsConfig = {
  asOf: "2026-08",
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
  recyclingFee: {
    smallMaxCc: 3000,
    smallUnder3yRub: 3400,
    smallFrom3yRub: 5200,
    largeUnder3yRub: 970000,
    largeFrom3yRub: 1235000,
  },
  clearanceFeeBrackets: [
    { maxRub: 200000, fee: 1067 },
    { maxRub: 450000, fee: 2134 },
    { maxRub: 1200000, fee: 4269 },
    { maxRub: 2700000, fee: 11746 },
    { maxRub: 4200000, fee: 16524 },
    { maxRub: 5500000, fee: 21344 },
    { maxRub: 7000000, fee: 27540 },
    { fee: 30000 },
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
    {
      id: "shipping",
      label: "Доставка Корея — Владивосток",
      kind: "fixed",
      value: 220000,
    },
    {
      id: "customs",
      label: "Таможенные платежи",
      kind: "formula",
      value: "customs_v1",
    },
    { id: "sbkts", label: "СБКТС и ЭПТС", kind: "fixed", value: 45000 },
    { id: "broker", label: "Брокер и СВХ", kind: "fixed", value: 85000 },
    { id: "commission", label: "Комиссия импортёра", kind: "percent", value: 5 },
  ],
  commissionNote: "",
  customs: TEST_CUSTOMS,
};

const RATES = { krwRub: 0.05, eurRub: 100 };

function compute(lot: LotParams, config: WidgetConfig = CONFIG): AllInResult {
  return computeAllIn(lot, RATES, config);
}

function itemRub(result: AllInResult, id: string): number {
  const item = result.items.find((entry) => entry.id === id);
  if (item === undefined) throw new Error(`item ${id} missing`);
  return item.rub;
}

describe("computeAgeYears", () => {
  const NOW = new Date(2026, 7, 1); // 2026-08-01

  it("counts the anniversary from the END of the registration month", () => {
    // The DOM gives year+month only. A car registered 2023-08-31 is NOT yet
    // three years old on 2026-08-01, so the anniversary month itself may not
    // buy the cheaper 3-5y regime: 2 years until the month has fully passed.
    expect(computeAgeYears(2023, 8, NOW)).toBe(2);
    // One month later the whole anniversary month is behind us => 3 years.
    expect(computeAgeYears(2023, 8, new Date(2026, 8, 1))).toBe(3);
    // 2023-09 -> 2026-08: still short of the anniversary => 2 years.
    expect(computeAgeYears(2023, 9, NOW)).toBe(2);
    expect(computeAgeYears(2020, 7, NOW)).toBe(6);
    expect(computeAgeYears(2020, 8, NOW)).toBe(5);
    expect(computeAgeYears(2026, 1, NOW)).toBe(0);
  });

  it("never returns a negative age", () => {
    expect(computeAgeYears(2027, 1, NOW)).toBe(0);
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
      priceKrw: 20_000_000,
      ageYears,
      engineCc: 2000,
      fuel: "gasoline",
      ageNearBracket: isNearAgeBracket(2023, 8, NOW),
    });
    expect(itemRub(result, "duty")).toBe(700_000);
  });

  it("degrades an exact lot to approx with a Russian note near a boundary", () => {
    const lot: LotParams = {
      priceKrw: 20_000_000,
      ageYears: 2,
      engineCc: 2000,
      fuel: "gasoline",
    };
    const plain = compute(lot);
    expect(plain.precision).toBe("exact");
    expect(plain.notes).toEqual([]);

    const near = compute({ ...lot, ageNearBracket: true });
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
        priceKrw: c.lotEur * 2000,
        ageYears: 2,
        engineCc: c.cc,
        fuel: "gasoline",
      });
      expect(result.precision).toBe("exact");
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
        priceKrw: PRICE,
        ageYears: c.age,
        engineCc: c.cc,
        fuel: "gasoline",
      });
      expect(itemRub(result, "duty")).toBe(c.dutyRub);
    });
  }

  it("exactly 3 years old uses the 3-5y bracket, not value tiers", () => {
    // 2000cc age 3 -> 2.7 EUR/cc => 5400 EUR = 540,000 RUB. The <3y value
    // tier for lotEur 5000 would give max(54%*5000=2700, 2.5*2000=5000) EUR
    // = 500,000 RUB — a different number, so the bracket choice is provable.
    const result = compute({
      priceKrw: PRICE,
      ageYears: 3,
      engineCc: 2000,
      fuel: "gasoline",
    });
    expect(itemRub(result, "duty")).toBe(540000);
  });
});

describe("recycling fee (personal use)", () => {
  const PRICE = 10_000_000;
  const at = (age: number, cc: number): number =>
    itemRub(
      compute({ priceKrw: PRICE, ageYears: age, engineCc: cc, fuel: "gasoline" }),
      "recycling",
    );

  it("<=3000cc: 3400 under 3y, 5200 from 3y", () => {
    expect(at(2, 3000)).toBe(3400);
    expect(at(3, 3000)).toBe(5200);
    expect(at(6, 1500)).toBe(5200);
  });

  it(">3000cc: config placeholder values", () => {
    expect(at(2, 3001)).toBe(970000);
    expect(at(6, 3001)).toBe(1235000);
  });
});

describe("customs clearance fee brackets (by lot RUB value)", () => {
  // priceKrw = lotRub * 20 at 0.05 RUB/KRW (exact, no rounding involved).
  const cases: Array<{ lotRub: number; fee: number }> = [
    { lotRub: 200000, fee: 1067 },
    { lotRub: 200001, fee: 2134 },
    { lotRub: 450000, fee: 2134 },
    { lotRub: 1200000, fee: 4269 },
    { lotRub: 1200001, fee: 11746 },
    { lotRub: 7000000, fee: 27540 },
    { lotRub: 7000001, fee: 30000 },
  ];

  for (const c of cases) {
    it(`lot ${c.lotRub} RUB -> fee ${c.fee}`, () => {
      const result = compute({
        priceKrw: c.lotRub * 20,
        ageYears: 4,
        engineCc: 1000,
        fuel: "gasoline",
      });
      expect(itemRub(result, "clearance")).toBe(c.fee);
    });
  }
});

describe("all-in total", () => {
  it("sums lot, fixed items, customs items and commission", () => {
    // 20,000,000 KRW, age 2, 2000cc:
    //   lot        = 20,000,000 * 0.05          = 1,000,000
    //   duty       = max(48%*10,000, 3.5*2000) EUR = 7,000 EUR = 700,000
    //   recycling  = 3,400 (<3y, <=3000cc)
    //   clearance  = 4,269 (lot 1,000,000 <= 1,200,000)
    //   fixed      = 220,000 + 45,000 + 85,000  = 350,000
    //   commission = 5% * 1,000,000             = 50,000
    //   total      = 2,107,669
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      engineCc: 2000,
      fuel: "gasoline",
    });
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
    expect(result.totalRub).toBe(2_107_669);
  });

  it("hybrid with a known displacement computes like a combustion car", () => {
    // 1600cc age 4 -> y3 bracket 2.5 EUR/cc = 4000 EUR = 400,000 RUB.
    const result = compute({
      priceKrw: 10_000_000,
      ageYears: 4,
      engineCc: 1600,
      fuel: "hybrid",
    });
    expect(result.precision).toBe("exact");
    expect(itemRub(result, "duty")).toBe(400000);
  });

  it("commission change in config changes the total by the expected delta", () => {
    const tenPct: WidgetConfig = {
      ...CONFIG,
      costItems: CONFIG.costItems.map((item) =>
        item.kind === "percent" && item.id === "commission"
          ? { ...item, value: 10 }
          : item,
      ),
    };
    const lot: LotParams = {
      priceKrw: 20_000_000,
      ageYears: 2,
      engineCc: 2000,
      fuel: "gasoline",
    };
    const base = compute(lot);
    const raised = compute(lot, tenPct);
    // lotRub 1,000,000: 5% -> 50,000, 10% -> 100,000.
    expect(raised.totalRub - base.totalRub).toBe(50_000);
  });
});

describe("cost items the calculator cannot handle", () => {
  const LOT: LotParams = {
    priceKrw: 20_000_000,
    ageYears: 2,
    engineCc: 2000,
    fuel: "gasoline",
  };

  function withItems(items: CostItem[]): WidgetConfig {
    return { ...CONFIG, costItems: items };
  }

  it("does not silently drop a fixed item whose value is a quoted number", () => {
    // A hand-edited config with "220000" instead of 220000: the shipping line
    // used to vanish and the total was 220,000 RUB too low, silently.
    const quoted = withItems([
      {
        id: "shipping",
        label: "Доставка Корея — Владивосток",
        kind: "fixed",
        value: "220000",
      } as unknown as CostItem,
    ]);
    const result = compute(LOT, quoted);
    expect(result.items.some((item) => item.id === "shipping")).toBe(false);
    expect(result.precision).toBe("onRequest");
  });

  it("treats an unknown formula identifier as not computable", () => {
    const unknown = withItems([
      { id: "customs", label: "Таможенные платежи", kind: "formula", value: "customs_v2" },
    ]);
    const result = compute(LOT, unknown);
    expect(result.items.some((item) => item.id === "duty")).toBe(false);
    expect(result.precision).toBe("onRequest");
  });

  it("expands the customs block once even with a duplicated formula item", () => {
    const doubled = withItems([
      { id: "customs", label: "Таможенные платежи", kind: "formula", value: "customs_v1" },
      { id: "customs2", label: "Таможенные платежи 2", kind: "formula", value: "customs_v1" },
    ]);
    const result = compute(LOT, doubled);
    const ids = result.items.map((item) => item.id);
    expect(ids.filter((id) => id === "duty").length).toBe(1);
    expect(ids.filter((id) => id === "recycling").length).toBe(1);
    // The second (unusable) item must be visible as a degradation, not hidden.
    expect(result.precision).toBe("onRequest");
  });
});

describe("degradation to 'on request'", () => {
  it("EV lists only known items and marks the total on request", () => {
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      fuel: "electric",
    });
    expect(result.precision).toBe("onRequest");
    expect(result.items.map((item) => item.id)).toEqual([
      "lot",
      "shipping",
      "sbkts",
      "broker",
      "commission",
    ]);
    // Known items only: 1,000,000 + 350,000 + 50,000.
    expect(result.totalRub).toBe(1_400_000);
  });

  it("EV stays on request even when a displacement is present", () => {
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      engineCc: 100,
      fuel: "electric",
    });
    expect(result.precision).toBe("onRequest");
  });

  it("hybrid without displacement is on request", () => {
    const result = compute({
      priceKrw: 20_000_000,
      ageYears: 2,
      fuel: "hybrid",
    });
    expect(result.precision).toBe("onRequest");
    expect(result.items.some((item) => item.id === "duty")).toBe(false);
  });

  it("unknown age or displacement is on request", () => {
    expect(
      compute({ priceKrw: 20_000_000, engineCc: 2000, fuel: "gasoline" })
        .precision,
    ).toBe("onRequest");
    expect(
      compute({ priceKrw: 20_000_000, ageYears: 2, fuel: "gasoline" }).precision,
    ).toBe("onRequest");
  });
});
