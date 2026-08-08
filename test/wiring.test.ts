// @vitest-environment jsdom
/**
 * Cross-module wiring: each of these assertions covers a hand-off between two
 * modules that were fixed independently. Every one of them was, at some point,
 * a feature that existed in one module and was silently never called from the
 * other — the unit suites stayed green while the behaviour was inert in the
 * browser.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { init } from "../src/main";
import { toLotDetails } from "../src/scan/params";
import { AGE_BRACKET_NOTE } from "../src/calc/customs";
import { computeQuote } from "../src/calc/pricing";
import { attachBreakdown } from "../src/ui/breakdown";
import { DEFAULT_CONFIG, type WidgetConfig } from "../src/config.default";
import type { ResolvedRates } from "../src/rates/cbr";

const LISTING_HTML = readFileSync(
  resolve("test/fixtures", "listing-desktop.html"),
  "utf8",
);

const NOW = new Date("2026-08-02T00:00:00Z");

function ratesFor(
  config: WidgetConfig,
  extra: Partial<ResolvedRates> = {},
): ResolvedRates {
  return {
    krwRub: config.currency.referenceRates.KRW_RUB,
    eurRub: config.currency.referenceRates.EUR_RUB,
    dateISO: config.currency.updatedAt,
    source: "cbr",
    ...extra,
  };
}

function panelText(rates: ResolvedRates, notes: string[]): string {
  const el = document.createElement("span");
  el.setAttribute("data-intl-currency-amount", "20000000");
  document.body.appendChild(el);
  // The panel renders whatever computeAllIn reports; a near-bracket lot is the
  // production path that fills `notes`.
  attachBreakdown(
    { element: el, krw: 20_000_000 },
    { config: DEFAULT_CONFIG, source: "remote" },
    rates,
    notes.length > 0
      ? { ageYears: 3, engineCc: 1998, fuel: "gasoline", ageNearBracket: true }
      : { ageYears: 4, engineCc: 1998, fuel: "gasoline" },
  );
  const host = document.querySelector("[data-encar-ru-breakdown]");
  const panel = host?.shadowRoot?.querySelector("[data-panel]");
  return panel?.textContent ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  delete window.__encarRu;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("scan -> calc: age near a duty bracket", () => {
  it("marks a lot registered two months short of 3 years", () => {
    // 2023-09 read on 2026-08-02: 34 months from the end of the reg month.
    const details = toLotDetails(
      { regYear: 2023, regMonth: 9, engineCc: 1998, estimated: false },
      NOW,
    );
    expect(details.ageNearBracket).toBe(true);
  });

  it("leaves a lot in the middle of a regime unmarked", () => {
    const details = toLotDetails(
      { regYear: 2022, regMonth: 3, engineCc: 1998, estimated: false },
      NOW,
    );
    expect(details.ageNearBracket).toBe(false);
  });

  it("downgrades an otherwise exact quote to approximate", () => {
    const near = toLotDetails(
      { regYear: 2023, regMonth: 9, engineCc: 1998, fuel: "gasoline", estimated: false },
      NOW,
    );
    const result = computeQuote(
      // The power is supplied by hand: the DOM never carries one, and without
      // it the recycling line dashes and the quote is a floor whatever the age
      // says. This assertion is about the age wiring, so the lot has to be
      // otherwise complete for the exact -> approx downgrade to be visible.
      { priceKrw: 20_000_000, ...near, powerHp: 150 },
      ratesFor(DEFAULT_CONFIG),
      DEFAULT_CONFIG,
    );
    expect(result.precision).toBe("approx");
    expect(result.notes).toContain(AGE_BRACKET_NOTE);
  });
});

describe("calc/rates -> breakdown: notes reach the panel", () => {
  it("prints the age-bracket caveat", () => {
    expect(panelText(ratesFor(DEFAULT_CONFIG), [AGE_BRACKET_NOTE])).toContain(
      "границе таможенного режима",
    );
  });

  it("prints a distinct marker when a live rate was rejected", () => {
    const text = panelText(ratesFor(DEFAULT_CONFIG, { rejected: true }), []);
    expect(text).toContain("не прошёл проверку");
  });

  it("says nothing about a rejected rate on a healthy one", () => {
    expect(panelText(ratesFor(DEFAULT_CONFIG), [])).not.toContain(
      "не прошёл проверку",
    );
  });
});

describe("config/rates -> badge: provenance reaches the listing", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = LISTING_HTML;
  });

  async function runInit(configOk: boolean): Promise<void> {
    vi.stubGlobal(
      "fetch",
      configOk
        ? vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => DEFAULT_CONFIG,
          } as unknown as Response)
        : vi.fn().mockRejectedValue(new TypeError("network down")),
    );
    init();
    // Two microtask drains: config then rates.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  function degradedCount(): number {
    return document.querySelectorAll("[data-encar-ru-badge][data-degraded]")
      .length;
  }

  it("marks every badge as degraded when nothing could be fetched", async () => {
    await runInit(false);
    const badges = document.querySelectorAll("[data-encar-ru-badge]");
    expect(badges.length).toBeGreaterThan(0);
    expect(degradedCount()).toBe(badges.length);
  });
});
