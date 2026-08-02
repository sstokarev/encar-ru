// @vitest-environment jsdom
/**
 * Full-pipeline regression tests (the gap that let "≈ NaN ₽" ship).
 *
 * The unit suites exercised the scanner, the dictionary and the calculator in
 * isolation, so the real browser sequence was never covered:
 *
 *   init() -> scan -> badge -> applyDictionary() rewrites the very row text the
 *   scanner reads -> our own DOM writes trip the MutationObserver -> rescan.
 *
 * On that second pass the Korean patterns ("16/09식", "디젤") are gone, so lot
 * params silently vanish and any badge rendered from then on degrades — or,
 * worse, renders a non-finite number. These tests pin the whole sequence.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { init } from "../src/main";
import { badgeText as renderBadgeText } from "../src/ui/badge";
import { computeAllIn, type LotParams } from "../src/calc/customs";
import { DEFAULT_CONFIG } from "../src/config.default";
import { extractListingParams } from "../src/scan/params";
import { applyDictionary } from "../src/translate/apply";

const LISTING_HTML = readFileSync(
  resolve("test/fixtures", "listing-desktop.html"),
  "utf8",
);

const RATES = { krwRub: 0.055, eurRub: 90 };

function loadFixture(html: string): void {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html")
    .body.innerHTML;
}

/** Two macrotask ticks flush the config + rates chain with fetch stubbed out. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Longer wait: covers the 100 ms MutationObserver debounce plus the chain. */
async function settleObserver(): Promise<void> {
  await new Promise((r) => setTimeout(r, 400));
  await settle();
}

function badgeHosts(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-encar-ru-badge]"),
  );
}

function badgeText(host: HTMLElement): string {
  return host.shadowRoot?.querySelector("span")?.textContent ?? "";
}

/** Badge text keyed by the price element, so rows can be compared by identity. */
function badgeTexts(): string[] {
  return badgeHosts().map(badgeText);
}

beforeEach(() => {
  // No network: embedded config + config-tier rates (KRW_RUB 0.055, EUR_RUB 90).
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("full pipeline: scan -> dictionary -> rescan (listing)", () => {
  it("never renders a non-finite number and keeps values across a rescan", async () => {
    loadFixture(LISTING_HTML);
    init();
    await settle();

    const before = badgeTexts();
    expect(before.length).toBeGreaterThan(0);

    // (a) no badge may ever contain "NaN" / "Infinity".
    for (const text of before) {
      expect(text).not.toMatch(/NaN|Infinity/);
      expect(text).toMatch(/^(≈ \d{1,3}( \d{3})* ₽|по запросу)$/);
    }

    // (c) a healthy majority of rows must show a real price, not the marker.
    const numeric = before.filter((t) => t.startsWith("≈ "));
    expect(numeric.length).toBeGreaterThan(before.length / 2);

    // The dictionary has rewritten the rows by now: rescan the translated DOM
    // the way the MutationObserver does.
    window.__encarRu?.rescan();
    await settle();

    // ... and once more through a real DOM mutation.
    const marker = document.createElement("div");
    marker.textContent = "새로운 내용";
    document.body.appendChild(marker);
    await settleObserver();

    // (b) identical badge values before and after the rescan.
    expect(badgeTexts()).toEqual(before);
    for (const text of badgeTexts()) {
      expect(text).not.toMatch(/NaN|Infinity/);
    }
  });

  it("re-renders a price cell inside an already translated row with the same total", async () => {
    loadFixture(LISTING_HTML);
    init();
    await settle();

    // Pick a row that currently shows a real price and whose price cell the
    // site can re-render on its own (photo ads re-bind span.val on paging).
    const priced = badgeHosts().find((host) =>
      badgeText(host).startsWith("≈ "),
    );
    expect(priced).toBeDefined();
    const priceEl = priced!.closest("[data-encar-ru]");
    expect(priceEl).not.toBeNull();
    const cell = priceEl!.parentElement;
    expect(cell).not.toBeNull();
    const before = badgeText(priced!);
    const digits = priceEl!.querySelector("strong")?.textContent ?? "";
    expect(digits).not.toBe("");

    // The row text is already Russian at this point (our dictionary ran);
    // encar replaces only the price cell, so the fresh price element must be
    // annotated from the row's ORIGINAL params, not from the rewritten text.
    cell!.innerHTML = `<span class="prc"><strong>${digits}</strong>만원</span>`;
    await settleObserver();

    const rerendered = Array.from(
      cell!.querySelectorAll<HTMLElement>("[data-encar-ru-badge]"),
    );
    expect(rerendered.length).toBe(1);
    expect(badgeText(rerendered[0]!)).not.toMatch(/NaN|Infinity/);
    expect(badgeText(rerendered[0]!)).toBe(before);
  });
});

describe("listing params survive our own translation", () => {
  it("still reads year, fuel and displacement after applyDictionary", async () => {
    loadFixture(LISTING_HTML);
    const el = document.querySelector(".prc");
    expect(el).not.toBeNull();
    const before = extractListingParams(el!);
    expect(before.regYear).toBeDefined();

    applyDictionary(document);

    const after = extractListingParams(el!);
    expect(after).toEqual(before);
  });
});

describe("computeAllIn refuses to produce a non-finite total", () => {
  const bad: Array<{ name: string; lot: LotParams }> = [
    { name: "NaN age", lot: { priceKrw: 20_000_000, ageYears: NaN, engineCc: 2000 } },
    { name: "NaN cc", lot: { priceKrw: 20_000_000, ageYears: 4, engineCc: NaN } },
    { name: "NaN price", lot: { priceKrw: NaN, ageYears: 4, engineCc: 2000 } },
    {
      name: "Infinity price",
      lot: { priceKrw: Infinity, ageYears: 4, engineCc: 2000 },
    },
    {
      name: "undefined age and cc",
      lot: { priceKrw: 20_000_000 } as LotParams,
    },
    {
      name: "negative age",
      lot: { priceKrw: 20_000_000, ageYears: -3, engineCc: 2000 },
    },
    { name: "zero cc", lot: { priceKrw: 20_000_000, ageYears: 4, engineCc: 0 } },
    {
      name: "negative cc",
      lot: { priceKrw: 20_000_000, ageYears: 4, engineCc: -2000 },
    },
    { name: "zero price", lot: { priceKrw: 0, ageYears: 4, engineCc: 2000 } },
    {
      name: "negative price",
      lot: { priceKrw: -20_000_000, ageYears: 4, engineCc: 2000 },
    },
  ];

  for (const { name, lot } of bad) {
    it(`${name} degrades to "onRequest" with a finite total`, () => {
      const result = computeAllIn(lot, RATES, DEFAULT_CONFIG);
      expect(result.precision).toBe("onRequest");
      expect(Number.isFinite(result.totalRub)).toBe(true);
      for (const item of result.items) {
        expect(Number.isFinite(item.rub)).toBe(true);
      }
    });
  }

  it("non-finite FX rates degrade instead of poisoning every item", () => {
    const lot: LotParams = {
      priceKrw: 20_000_000,
      ageYears: 4,
      engineCc: 2000,
    };
    for (const rates of [
      { krwRub: NaN, eurRub: 90 },
      { krwRub: 0.055, eurRub: NaN },
      { krwRub: 0, eurRub: 90 },
    ]) {
      const result = computeAllIn(lot, rates, DEFAULT_CONFIG);
      expect(result.precision).toBe("onRequest");
      expect(Number.isFinite(result.totalRub)).toBe(true);
    }
  });
});

describe("badge never renders a non-finite number", () => {
  it('shows "по запросу" instead of NaN/Infinity', () => {
    expect(renderBadgeText({ totalRub: NaN, precision: "approx" })).toBe(
      "по запросу",
    );
    expect(renderBadgeText({ totalRub: NaN, precision: "exact" })).toBe(
      "по запросу",
    );
    expect(renderBadgeText({ totalRub: Infinity, precision: "approx" })).toBe(
      "по запросу",
    );
    // Healthy values are untouched.
    expect(renderBadgeText({ totalRub: 1_687_875, precision: "exact" })).toBe(
      "1 687 875 ₽",
    );
  });
});
