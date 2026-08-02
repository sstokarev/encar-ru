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
    (cfg["costItems"] as Array<Record<string, unknown>>)[0]!["value"] =
      "220000";
    expect(isValidConfig(cfg)).toBe(false);
  });

  it("rejects a percent item with a string value", () => {
    const cfg = draft();
    const items = cfg["costItems"] as Array<Record<string, unknown>>;
    const percent = items.find((item) => item["kind"] === "percent")!;
    percent["value"] = "5";
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
});

describe("isValidConfig: messenger address", () => {
  const cases: Array<{ type: string; address: string; valid: boolean }> = [
    { type: "telegram", address: "encar_ru_import", valid: true },
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
