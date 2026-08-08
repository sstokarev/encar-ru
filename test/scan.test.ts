// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parsePriceText, scanPrices } from "../src/scan/scanner";
import { observeDom } from "../src/scan/observer";
import { extractCardParams, toLotDetails } from "../src/scan/params";
import { computeQuote } from "../src/calc/pricing";
import { badgeText as renderBadgeText } from "../src/ui/badge";
import { DEFAULT_CONFIG } from "../src/config.default";
import { init } from "../src/main";
import {
  emulateBrowserTranslation,
  type TranslationVariant,
} from "./helpers/translate-emulate";

function readFixture(name: string): string {
  // vitest runs with cwd at the project root.
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

const LISTING_HTML = readFixture("listing-desktop.html");
const CARD_HTML = readFixture("card-fem.html");
const DETAIL_PATH = "/cars/detail/41756847";

/** 659만원 — the single price of the card fixture. */
const CARD_KRW = 6_590_000;

/** Rates the config tier yields with the network stubbed out (KTD2). */
const CONFIG_RATES = {
  krwRub: DEFAULT_CONFIG.currency.referenceRates.KRW_RUB,
  eurRub: DEFAULT_CONFIG.currency.referenceRates.EUR_RUB,
};

/**
 * All-in ("под ключ") total the card fixture must headline — derived from the
 * embedded config and the config-tier rate rather than hardcoded, and rendered
 * through the badge's own formatter so the precision marker is part of the
 * expectation. The card publishes age, fuel and displacement but no engine
 * power, so the recycling line dashes and the headline is a floor ("от N ₽").
 */
const CARD_ALL_IN_TEXT = renderBadgeText(
  computeQuote(
    {
      priceKrw: CARD_KRW,
      ...toLotDetails(
        extractCardParams(
          new DOMParser().parseFromString(CARD_HTML, "text/html"),
        ),
      ),
    },
    CONFIG_RATES,
    DEFAULT_CONFIG,
  ),
);

// Ground truth for the desktop listing fixture, established by three
// independent counts (raw-HTML pattern grep, deepest-element DOM walk,
// document.body.textContent regex): 41 priced lots.
//    8  photo ads          -> span.prc            ("659만원")
//    8  premium table rows -> strong.prc in td.prc_hs
//   21  general table rows -> strong.prc in td.prc_hs
//    4  drencar list items -> strong.prc in span.val ("1,830" + "만원")
// NOTE: the unit brief said 40; the fixture actually contains 41 (reported
// as a deviation with evidence).
const LISTING_BADGE_COUNT = 41;

function loadFixture(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
}

/**
 * U5: annotation is gated on config + rates resolution. With fetch stubbed
 * to fail synchronously both settle within microtasks; two macrotask ticks
 * are enough to flush the chain (config tier rates = 0.055 KRW_RUB).
 */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function runWidget(): Promise<void> {
  init();
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

beforeEach(() => {
  // No network in tests: config falls back to embedded defaults and rates to
  // the config tier (reference KRW_RUB 0.055 — the former mock value).
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("price parsing", () => {
  it('parses "1,250만원" as 12,500,000 KRW', () => {
    expect(parsePriceText("1,250만원")).toBe(12_500_000);
  });

  it("parses plain amounts and rejects text without prices", () => {
    expect(parsePriceText("659만원")).toBe(6_590_000);
    expect(parsePriceText("성능기록 · 디젤 · 경기")).toBeNull();
  });
});

describe("desktop listing fixture", () => {
  it(`annotates exactly ${LISTING_BADGE_COUNT} priced lots`, async () => {
    loadFixture(LISTING_HTML);
    await runWidget();
    expect(badgeHosts().length).toBe(LISTING_BADGE_COUNT);
  });

  it("marks every badge host untranslatable and formats RUB", async () => {
    loadFixture(LISTING_HTML);
    await runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBeGreaterThan(0);
    const texts = hosts.map(badgeText);
    for (const host of hosts) {
      expect(host.getAttribute("translate")).toBe("no");
      expect(host.classList.contains("notranslate")).toBe(true);
      // Listing badges show the all-in total as a floor ("от"): the engine
      // power the recycling fee needs is never on a listing row. Rows the
      // calculator cannot quote at all (EVs) show the honest marker instead of
      // an invented number (R3). Never a bare, exact-looking number.
      expect(badgeText(host)).toMatch(/^(от \d{1,3}( \d{3})* ₽|по запросу)$/);
    }
    // The lot price is provable on almost every row, so the listing is not a
    // wall of "по запросу".
    expect(texts.filter((t) => t.startsWith("от ")).length).toBeGreaterThan(
      hosts.length / 2,
    );
  });

  it("adds no duplicate badges when run repeatedly", async () => {
    loadFixture(LISTING_HTML);
    await runWidget();
    await runWidget();
    window.__encarRu?.rescan();
    await settle();
    expect(badgeHosts().length).toBe(LISTING_BADGE_COUNT);
  });
});

describe("fem card fixture", () => {
  it("annotates the main price with the all-in RUB total", async () => {
    // A real card page is a detail URL, so the exact card params apply.
    window.history.replaceState(null, "", DETAIL_PATH);
    loadFixture(CARD_HTML);
    await runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    expect(badgeText(hosts[0]!)).toBe(CARD_ALL_IN_TEXT);
    expect(hosts[0]!.closest("[data-intl-currency]")).not.toBeNull();
  });
});

describe("browser-translated DOM", () => {
  const variants: TranslationVariant[] = ["english-unit", "strip-unit"];
  for (const variant of variants) {
    it(`listing (${variant}) keeps the same badge count`, async () => {
      loadFixture(LISTING_HTML);
      emulateBrowserTranslation(document.body, variant);
      await runWidget();
      expect(badgeHosts().length).toBe(LISTING_BADGE_COUNT);
    });

    it(`card (${variant}) still annotates the main price`, async () => {
      window.history.replaceState(null, "", DETAIL_PATH);
      loadFixture(CARD_HTML);
      emulateBrowserTranslation(document.body, variant);
      await runWidget();
      const hosts = badgeHosts();
      expect(hosts.length).toBe(1);
      // Lot params come from the inline SPA state, which translation never
      // touches: the all-in total is identical to the untranslated page.
      expect(badgeText(hosts[0]!)).toBe(CARD_ALL_IN_TEXT);
    });
  }
});

describe("regex fallback", () => {
  it("finds prices in markup without known price selectors", async () => {
    document.body.innerHTML =
      "<div><b>1,250</b>만원</div><p>즉시구매 660만원</p>";
    await runWidget();
    const texts = badgeHosts().map(badgeText);
    expect(badgeHosts().length).toBe(2);
    // Bare markup exposes no lot params, so duty and the recycling fee dash.
    // Everything the importer charges is still provable, and a proven floor
    // beats a refusal. The Korean costs (2,500,000 KRW) are converted together
    // with the car, and the commission ladder brackets the rest:
    //   (12,500,000 + 2,500,000) * 0.055 = 825,000 + 4,924 clearance
    //     + 116,000 broker -> subtotal 945,924 -> 30,000 commission = 975,924;
    //   (6,600,000 + 2,500,000) * 0.055 = 500,500 + 4,924 + 116,000
    //     -> subtotal 621,424 -> 30,000 = 651,424.
    // No tariff-rounding row: the tariff block is incomplete, and rounding a
    // floor upwards is how it stops being a floor.
    expect(texts).toEqual(["от 975 924 ₽", "от 651 424 ₽"]);
  });
});

describe("dynamic content (MutationObserver)", () => {
  it("annotates nodes inserted after init", async () => {
    document.body.innerHTML =
      '<ul><li><span class="prc"><strong>900</strong>만원</span></li></ul>';
    await runWidget();
    expect(badgeHosts().length).toBe(1);

    const li = document.createElement("li");
    li.innerHTML = '<span class="prc"><strong>1,000</strong>만원</span>';
    document.querySelector("ul")!.appendChild(li);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(badgeHosts().length).toBe(2);
  });
});

describe("zero-price diagnostic", () => {
  it("warns exactly when a page with a body yields no candidates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML =
      '<span class="prc"><strong>500</strong>만원</span>';
    window.__encarRu?.rescan();
    await settle();
    expect(warn).not.toHaveBeenCalled();

    document.body.innerHTML = "<p>주행거리 12345km, 가격 정보 없음</p>";
    window.__encarRu?.rescan();
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[encar-ru] no prices found");
  });

  it("stays silent while rescanning a page whose prices are annotated", async () => {
    // A healthy page yields zero NEW candidates on every later pass (everything
    // is annotated already). Warning there would drown the one signal the
    // diagnostic exists for: encar changing its price markup.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML =
      '<span class="prc"><strong>500</strong>만원</span>';
    await runWidget();
    expect(badgeHosts().length).toBe(1);

    window.__encarRu?.rescan();
    await settle();
    window.__encarRu?.rescan();
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("lease and rent lots (U1)", () => {
  // Markup exactly as encar's own listing template renders it — see the doT
  // sources in test/fixtures/listing-desktop.html, where lease/rent lots wrap
  // the MONTHLY instalment with <em class="txt_month">월</em> and
  // <span class="remain">/N개월</span> inside the same price container.
  const RENT_PHOTO_AD =
    '<li class="ad"><span class="cls"><strong>기아</strong><em>스포티지</em></span>' +
    '<span class="dtl"><strong>2.0 디젤</strong></span>' +
    '<span class="detail"><span class="yer">23/09식</span>' +
    '<span class="ipt">디젤</span></span>' +
    '<span class="val"><em class="txt_leaserent">렌트</em>' +
    '<em class="txt_month">월</em>' +
    '<span class="prc"><strong>66</strong>만원' +
    '<span class="remain">/24개월</span></span></span></li>';
  const LEASE_TABLE_ROW =
    '<table><tbody><tr><td class="inf">' +
    '<span class="dtl">2.2 디젤 프레스티지</span> 16/09식 · 디젤</td>' +
    '<td class="prc_hs"><em class="txt_month">월</em>' +
    '<strong class="prc">66</strong>만원' +
    '<span class="remain">/36개월</span></td></tr></tbody></table>';
  const SALE_TABLE_ROW =
    '<table><tbody><tr><td class="inf">' +
    '<span class="dtl">2.2 디젤 프레스티지</span> 16/09식 · 디젤</td>' +
    '<td class="prc_hs"><strong class="prc">1,830</strong>만원</td>' +
    "</tr></tbody></table>";

  it("finds no price on a rent photo ad or a lease table row", () => {
    document.body.innerHTML = RENT_PHOTO_AD + LEASE_TABLE_ROW;
    // 66만원 is a monthly instalment, not the lot price: quoting it would
    // headline an all-in total ~30x below reality.
    expect(scanPrices(document)).toEqual([]);
  });

  it("badges no lease/rent row and still badges the sale row beside it", async () => {
    document.body.innerHTML = RENT_PHOTO_AD + LEASE_TABLE_ROW + SALE_TABLE_ROW;
    await runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    expect(hosts[0]!.closest("td")?.textContent).toContain("1,830");
  });
});

describe("incremental scanning", () => {
  it("scans only the roots it is given", () => {
    document.body.innerHTML =
      '<div id="a"><span class="prc"><strong>500</strong>만원</span></div>' +
      '<div id="b"><span class="prc"><strong>900</strong>만원</span></div>';
    const a = document.getElementById("a")!;
    expect(scanPrices(document, [a]).map((c) => c.krw)).toEqual([5_000_000]);
    expect(scanPrices(document).map((c) => c.krw)).toEqual([
      5_000_000, 9_000_000,
    ]);
  });

  it("accepts a price element itself as a root", () => {
    document.body.innerHTML =
      '<div id="a"><span class="prc"><strong>500</strong>만원</span></div>';
    const price = document.querySelector<HTMLElement>(".prc")!;
    expect(scanPrices(document, [price]).map((c) => c.krw)).toEqual([
      5_000_000,
    ]);
  });
});

/**
 * Live regression (measured on www.encar.com, 2026-08-02).
 *
 * encar's own ES5 polyfill bundle REPLACES the global Array.from with an
 * array-like-only implementation: it copies indices 0..length-1 and therefore
 * returns [] for anything whose items only come out of Symbol.iterator.
 * Measured in the live page context:
 *
 *   Array.from(new Set(["a","b"])).length   -> 0   (native: 2)
 *   Array.from(new Map([[1,2]])).length     -> 0   (native: 1)
 *   Array.from(document.querySelectorAll(…)) -> 29 (array-like: still fine)
 *   [...new Set(["a","b"])].length           -> 2  (syntax: unaffected)
 *
 * The widget's debounce drained its pending-roots Set through Array.from, so
 * on encar every batch reached the scan as ZERO roots: nothing inserted after
 * activation was ever annotated, while an explicit rescan() (which scans the
 * whole document and passes no roots at all) kept working. Page-owned globals
 * are hostile territory — the widget uses iteration syntax, never Array.from,
 * on anything that is not an array-like DOM collection.
 */
function withEncarArrayFrom(): () => void {
  const native = Array.from;
  const patched = (value: ArrayLike<unknown>): unknown[] => {
    const out: unknown[] = [];
    const length = Number(value?.length ?? 0);
    for (let i = 0; i < length; i += 1) out.push(value[i]);
    return out;
  };
  (Array as { from: unknown }).from = patched;
  return () => {
    (Array as { from: unknown }).from = native;
  };
}

describe("host page that replaced Array.from (encar polyfill)", () => {
  it("still hands the added roots to the scan", async () => {
    const seen: Element[][] = [];
    const observer = observeDom(
      document.body,
      (roots) => {
        seen.push(roots);
      },
      10,
    );

    const restore = withEncarArrayFrom();
    let hostileSetLength = -1;
    try {
      // Proof the emulation reproduces the live breakage before it matters.
      hostileSetLength = Array.from(new Set(["a", "b"])).length;
      const row = document.createElement("div");
      row.innerHTML = '<span class="prc"><strong>900</strong>만원</span>';
      document.body.appendChild(row);
      await new Promise((r) => setTimeout(r, 60));
    } finally {
      restore();
    }
    observer.disconnect();

    expect(hostileSetLength).toBe(0);
    expect(seen.length).toBe(1);
    expect(seen[0]!.length).toBe(1);
  });

  it("badges a lot inserted after activation", async () => {
    document.body.innerHTML =
      '<ul><li><span class="prc"><strong>900</strong>만원</span></li></ul>';
    await runWidget();
    expect(badgeHosts().length).toBe(1);

    // Only the incremental path is exercised under the hostile global, exactly
    // as live: the initial full scan had already succeeded.
    const restore = withEncarArrayFrom();
    try {
      const li = document.createElement("li");
      li.innerHTML = '<span class="prc"><strong>1,000</strong>만원</span>';
      document.querySelector("ul")!.appendChild(li);
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      restore();
    }

    expect(badgeHosts().length).toBe(2);
  });
});

describe("mutation observer scope", () => {
  it("ignores the widget's own hosts and reports the added roots", async () => {
    const seen: Element[][] = [];
    const observer = observeDom(
      document.body,
      (roots) => {
        seen.push(roots);
      },
      10,
    );

    for (const attr of [
      "data-encar-ru-badge",
      "data-encar-ru-breakdown",
      "data-encar-ru-host",
      "data-encar-ru-hint",
    ]) {
      const host = document.createElement("span");
      host.setAttribute(attr, "");
      document.body.appendChild(host);
    }
    await new Promise((r) => setTimeout(r, 60));
    // Our own UI must never wake the scanner up.
    expect(seen).toEqual([]);

    const row = document.createElement("div");
    row.textContent = "새 매물";
    document.body.appendChild(row);
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.length).toBe(1);
    expect(seen[0]!.length).toBe(1);
    expect(seen[0]![0]).toBe(row);
    observer.disconnect();
  });
});
