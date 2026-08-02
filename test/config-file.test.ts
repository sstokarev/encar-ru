/**
 * The deployed config file is a product surface: site/config.json is what
 * every client loads, and DEFAULT_CONFIG is the embedded copy used when the
 * fetch fails. Nothing verified either, so an importer typo (or a drift
 * between the two) silently reverted every client to the embedded tariffs
 * with a green deploy.
 *
 * This suite pins both: the shipped file must pass the very validator
 * loadConfig() applies, and it must match DEFAULT_CONFIG field for field —
 * which is what the "keep in sync manually" comment asks for.
 *
 * It also covers isValidConfig itself: every field the validator waves
 * through ends up in a money formula or in the "Заказать" deep link.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isValidConfig } from "../src/config";
import { DEFAULT_CONFIG, type WidgetConfig } from "../src/config.default";

const SITE_CONFIG_PATH = resolve("site/config.json");

function readSiteConfig(): unknown {
  return JSON.parse(readFileSync(SITE_CONFIG_PATH, "utf8")) as unknown;
}

/** Last entry of a non-empty array (the open-ended bracket). */
function last<T>(items: readonly T[]): T {
  return items[items.length - 1]!;
}

/** Deep clone of DEFAULT_CONFIG, mutable for the "one bad field" cases. */
function draft(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;
}

describe("site/config.json", () => {
  it("passes the same validator loadConfig applies", () => {
    expect(isValidConfig(readSiteConfig())).toBe(true);
  });

  it("matches the embedded DEFAULT_CONFIG field for field", () => {
    expect(readSiteConfig()).toEqual(
      JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as WidgetConfig,
    );
  });
});

describe("isValidConfig: reference rates", () => {
  it("accepts the embedded default", () => {
    expect(isValidConfig(DEFAULT_CONFIG)).toBe(true);
  });

  it("rejects a non-positive or non-finite EUR_RUB", () => {
    for (const bad of [0, -90, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cfg = draft();
      (cfg["currency"] as { referenceRates: Record<string, number> })
        .referenceRates["EUR_RUB"] = bad;
      expect(isValidConfig(cfg)).toBe(false);
    }
  });

  it("rejects a non-positive or non-finite KRW_RUB", () => {
    for (const bad of [0, -0.055, Number.NaN]) {
      const cfg = draft();
      (cfg["currency"] as { referenceRates: Record<string, number> })
        .referenceRates["KRW_RUB"] = bad;
      expect(isValidConfig(cfg)).toBe(false);
    }
  });
});

describe("isValidConfig: cost items", () => {
  it("rejects a fixed item whose value is a quoted number", () => {
    const cfg = draft();
    (cfg["costItems"] as Array<Record<string, unknown>>).push({
      id: "extra",
      label: "Доп. услуга",
      kind: "fixed",
      value: "220000",
    });
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a percent item with a string value", () => {
    const cfg = draft();
    (cfg["costItems"] as Array<Record<string, unknown>>).push({
      id: "fee",
      label: "Комиссия",
      kind: "percent",
      value: "5",
    });
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("accepts an 'unknown' item and requires it to carry no value", () => {
    const cfg = draft();
    const items = cfg["costItems"] as Array<Record<string, unknown>>;
    items.push({ id: "storage", label: "Хранение", kind: "unknown" });
    expect(isValidConfig(cfg)).toBe(true);
    // An amount on an "unknown" item is a config error: it would be shown as
    // a dash and silently dropped from the total.
    items[items.length - 1]!["value"] = 100000;
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a formula item with a numeric value", () => {
    const cfg = draft();
    const items = cfg["costItems"] as Array<Record<string, unknown>>;
    const formula = items.find((item) => item["kind"] === "formula")!;
    formula["value"] = 1;
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a second recognised formula item (customs counted twice)", () => {
    const cfg = draft();
    const items = cfg["costItems"] as Array<Record<string, unknown>>;
    items.push({
      id: "customs_again",
      label: "Таможенные платежи",
      kind: "formula",
      value: "customs_v1",
    });
    expect(isValidConfig(cfg)).toBe(false);
  });
});

describe("isValidConfig: bracket order", () => {
  it("rejects a reordered duty tier array", () => {
    const cfg = draft();
    const customs = cfg["customs"] as Record<string, unknown>;
    const tiers = customs["dutyValueTiers"] as Array<Record<string, unknown>>;
    [tiers[0], tiers[1]] = [tiers[1]!, tiers[0]!];
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects duplicated bracket bounds", () => {
    const cfg = draft();
    const customs = cfg["customs"] as Record<string, unknown>;
    const brackets = customs["clearanceFeeBrackets"] as Array<
      Record<string, unknown>
    >;
    brackets[1]!["maxRub"] = brackets[0]!["maxRub"];
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a reordered per-cc duty bracket array", () => {
    const cfg = draft();
    const customs = cfg["customs"] as Record<string, unknown>;
    const byAge = customs["dutyPerCcByAge"] as Record<string, unknown>;
    const y3 = byAge["y3"] as Array<Record<string, unknown>>;
    [y3[0], y3[2]] = [y3[2]!, y3[0]!];
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a reordered recycling displacement class array", () => {
    const cfg = draft();
    const fee = recyclingDraft(cfg);
    const classes = fee["classes"] as Array<Record<string, unknown>>;
    [classes[0], classes[1]] = [classes[1]!, classes[0]!];
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a reordered recycling power bracket array", () => {
    const cfg = draft();
    const fee = recyclingDraft(cfg);
    const classes = fee["classes"] as Array<Record<string, unknown>>;
    const brackets = classes[0]!["powerBrackets"] as Array<
      Record<string, unknown>
    >;
    [brackets[0], brackets[1]] = [brackets[1]!, brackets[0]!];
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a recycling reduced rate without its caps", () => {
    const cfg = draft();
    const fee = recyclingDraft(cfg);
    delete (fee["reduced"] as Record<string, unknown>)["maxHp"];
    expect(isValidConfig(cfg)).toBe(false);
  });
});

/** The mutable recyclingFee object of a config draft. */
function recyclingDraft(cfg: Record<string, unknown>): Record<string, unknown> {
  const customs = cfg["customs"] as Record<string, unknown>;
  return customs["recyclingFee"] as Record<string, unknown>;
}

/**
 * The researched tariffs themselves (TASK 1). test/calc.test.ts pins the
 * calculator against its own synthetic table; these cases pin the numbers the
 * clients actually get, so a fat-fingered edit of the shipped table fails CI
 * instead of quietly under-quoting every car.
 */
describe("DEFAULT_CONFIG: researched tariffs", () => {
  const customs = DEFAULT_CONFIG.customs;

  it("is dated by the day the encoded rules came into force", () => {
    // PP RF 1638 (clearance fee) and the +20% utilsbor indexation: 01.01.2026.
    expect(customs.asOf).toBe("2026-01-01");
  });

  it("carries the personal-use duty scale of Reshenie 107, Tabl. 2", () => {
    expect(customs.dutyValueTiers[0]).toEqual({
      maxEur: 8500,
      pct: 54,
      minPerCc: 2.5,
    });
    expect(last(customs.dutyValueTiers)).toEqual({ pct: 48, minPerCc: 20 });
    expect(customs.dutyPerCcByAge.y3.map((b) => b.eurPerCc)).toEqual([
      1.5, 1.7, 2.5, 2.7, 3.0, 3.6,
    ]);
    expect(customs.dutyPerCcByAge.y5plus.map((b) => b.eurPerCc)).toEqual([
      3.0, 3.2, 3.5, 4.8, 5.0, 5.7,
    ]);
  });

  it("carries the 2026 clearance fee scale (PP RF 1638)", () => {
    expect(customs.clearanceFeeBrackets.map((b) => b.fee)).toEqual([
      1231, 2462, 4924, 13541, 18465, 21344, 49240, 73860,
    ]);
    expect(customs.clearanceFeeBrackets.map((b) => b.maxRub)).toEqual([
      200000, 450000, 1200000, 2700000, 4200000, 5500000, 10000000, undefined,
    ]);
  });

  it("carries the power-based recycling fee grid (PP RF 1713, 2026 column)", () => {
    const fee = customs.recyclingFee;
    // Reduced personal-use rate: unindexed 0.17/0.26 x 20 000 RUB, and it
    // survives only up to 160 hp AND 3000 cc.
    expect(fee.reduced).toEqual({
      maxCc: 3000,
      maxHp: 160,
      under3yRub: 3400,
      from3yRub: 5200,
    });
    // Displacement classes: <=1000, <=2000, <=3000, <=3500, open.
    expect(fee.classes.map((c) => c.maxCc)).toEqual([
      1000, 2000, 3000, 3500, undefined,
    ]);
    // The 30 hp power grid, identical for every ICE class above <=1000 cc.
    const main = fee.classes.find((c) => c.maxCc === 2000)!;
    expect(main.powerBrackets.map((b) => b.maxHp)).toEqual([
      160, 190, 220, 250, 280, 310, 340, 370, 400, 430, 460, 500, undefined,
    ]);
    // 1-2 L, <=160 hp: 40.04 / 70.44 x 20 000 RUB.
    expect(main.powerBrackets[0]).toEqual({
      maxHp: 160,
      under3yRub: 800800,
      from3yRub: 1408800,
    });
    // 1-2 L, 160-190 hp: 45.0 / 74.64 x 20 000 RUB.
    expect(main.powerBrackets[1]).toEqual({
      maxHp: 190,
      under3yRub: 900000,
      from3yRub: 1492800,
    });
    // >3500 cc, >500 hp: the top of the grid, 229.08 / 344.28 x 20 000 RUB.
    const largest = last(fee.classes);
    expect(last(largest.powerBrackets)).toEqual({
      under3yRub: 4581600,
      from3yRub: 6885600,
    });
  });

  /**
   * Every fee in ПП РФ 1291 is "base rate x coefficient", the base rate for
   * M1 is 20 000 RUB and every published coefficient has at most TWO decimals.
   * An amount that is not a whole multiple of 20 000 x 0.01 = 200 RUB is
   * therefore not a published number: it is a 2025 amount multiplied by 1.2
   * and left with a third decimal in the implied coefficient, i.e. an
   * arithmetic invention that misquotes the row by up to 80 RUB.
   */
  it("derives every recycling amount from a two-decimal coefficient", () => {
    const fee = customs.recyclingFee;
    const amounts = [
      fee.reduced.under3yRub,
      fee.reduced.from3yRub,
      ...fee.classes.flatMap((cls) =>
        cls.powerBrackets.flatMap((b) => [b.under3yRub, b.from3yRub]),
      ),
    ];
    // 2 reduced + 57 grid cells x (new, used).
    expect(amounts.length).toBe(116);
    for (const amount of amounts) {
      expect({ amount, remainder: amount % 200 }).toEqual({
        amount,
        remainder: 0,
      });
    }
  });

  it("carries the published 2026 coefficients of the rows the 1.2x math bent", () => {
    const fee = customs.recyclingFee;
    const cell = (maxCc: number | undefined, maxHp: number | undefined) => {
      const cls = fee.classes.find((c) => c.maxCc === maxCc)!;
      return cls.powerBrackets.find((b) => b.maxHp === maxHp)!;
    };
    // 112.52 / 170.36 x 20 000.
    expect(cell(3000, 160)).toEqual({
      maxHp: 160,
      under3yRub: 2_250_400,
      from3yRub: 3_407_200,
    });
    // 28.43 x 20 000 (used).
    expect(cell(1000, 190).from3yRub).toBe(568_600);
    // 129.20 / 197.81 x 20 000.
    expect(cell(3500, 160)).toEqual({
      maxHp: 160,
      under3yRub: 2_584_000,
      from3yRub: 3_956_200,
    });
    // 164.53 x 20 000 (new).
    expect(cell(undefined, 160).under3yRub).toBe(3_290_600);
    // 192.88 x 20 000 (new).
    expect(cell(undefined, 370).under3yRub).toBe(3_857_600);
  });
});

describe("the shipped order channel", () => {
  // The address is the one product surface whose breakage is completely
  // silent: a wrong handle opens a real Telegram screen, the client writes,
  // and the importer never learns the order existed. It shipped as the
  // placeholder "encar_ru_import" until the importer noticed (2026-08-02), so
  // both copies are pinned here — the fetched file AND the embedded fallback.
  const EXPECTED = { type: "telegram", address: "globalcartrade" };

  it("is the importer's channel in the deployed config.json", () => {
    const shipped = readSiteConfig() as Record<string, unknown>;
    expect(shipped["messenger"]).toEqual(EXPECTED);
  });

  it("is the same channel in the embedded fallback", () => {
    expect(DEFAULT_CONFIG.messenger).toEqual(EXPECTED);
  });
});

describe("DEFAULT_CONFIG: cost items the importer has not priced yet", () => {
  it("dashes shipping, SBKTS/EPTS, broker and commission", () => {
    const byId = new Map(DEFAULT_CONFIG.costItems.map((i) => [i.id, i]));
    for (const id of ["shipping", "sbkts", "broker", "commission"]) {
      expect(byId.get(id)?.kind).toBe("unknown");
      expect(byId.get(id)).not.toHaveProperty("value");
    }
    expect(byId.get("customs")?.kind).toBe("formula");
  });
});

describe("isValidConfig: messenger address", () => {
  const cases: Array<{ type: string; address: string; valid: boolean }> = [
    { type: "telegram", address: "globalcartrade", valid: true },
    { type: "telegram", address: "Encar123", valid: true },
    { type: "telegram", address: "@encar_ru", valid: false },
    { type: "telegram", address: "ab", valid: false },
    { type: "telegram", address: "encar ru", valid: false },
    { type: "telegram", address: "evil?text=buy", valid: false },
    { type: "telegram", address: "a".repeat(65), valid: false },
    { type: "whatsapp", address: "+79161234567", valid: true },
    { type: "whatsapp", address: "79161234567", valid: true },
    { type: "whatsapp", address: "+7916 123", valid: false },
    { type: "whatsapp", address: "12345", valid: false },
    { type: "whatsapp", address: "+7916123456789012", valid: false },
  ];

  for (const c of cases) {
    it(`${c.type} "${c.address}" -> ${c.valid ? "valid" : "rejected"}`, () => {
      const cfg = draft();
      cfg["messenger"] = { type: c.type, address: c.address };
      expect(isValidConfig(cfg)).toBe(c.valid);
    });
  }
});
