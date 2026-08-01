// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  estimateCcFromText,
  extractCardParams,
  extractListingParams,
  parseFuel,
  parseRegistration,
  toLotDetails,
} from "../src/scan/params";
import { lotPrecision } from "../src/calc/customs";
import { scanPrices } from "../src/scan/scanner";
import { init } from "../src/main";

function readFixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

const LISTING_HTML = readFixture("listing-desktop.html");
const CARD_HTML = readFixture("card-fem.html");
const DETAIL_PATH = "/cars/detail/41756847";

/** "Now" pinned inside the fixture's >5y age bucket for stable expectations. */
const NOW = new Date(2026, 7, 2);

function parseDoc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function loadFixture(html: string): void {
  document.body.innerHTML = parseDoc(html).body.innerHTML;
}

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

function breakdownPanel(): HTMLElement {
  const host = document.querySelector<HTMLElement>(
    "[data-encar-ru-breakdown]",
  );
  const panel = host?.shadowRoot?.querySelector<HTMLElement>("[data-panel]");
  if (!panel) throw new Error("breakdown panel not found");
  return panel;
}

function totalValue(panel: HTMLElement): string {
  return (
    panel.querySelector('[data-item-id="total"] [data-value]')?.textContent ??
    ""
  );
}

beforeEach(() => {
  // No network: embedded config + config-tier rates (KRW_RUB 0.055, EUR_RUB 90).
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  delete window.__encarRu;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("parseRegistration", () => {
  it('parses the "16/09식" pattern into year 2016 month 9', () => {
    expect(parseRegistration("16/09식 ")).toEqual({ year: 2016, month: 9 });
  });

  it("parses variants with model-year suffix and old years", () => {
    expect(parseRegistration("18/07식(19년형)")).toEqual({
      year: 2018,
      month: 7,
    });
    expect(parseRegistration("09/12식")).toEqual({ year: 2009, month: 12 });
  });

  it('parses the Korean long form "16년 09월"', () => {
    expect(parseRegistration("연식:16년 09월 ,")).toEqual({
      year: 2016,
      month: 9,
    });
  });

  it("rejects text without a registration and invalid months", () => {
    expect(parseRegistration("성능기록 · 디젤")).toBeNull();
    expect(parseRegistration("16/13식")).toBeNull();
  });
});

describe("parseFuel", () => {
  it("maps Korean fuel tokens", () => {
    expect(parseFuel("디젤")).toBe("diesel");
    expect(parseFuel("· 가솔린")).toBe("gasoline");
    expect(parseFuel("전기")).toBe("electric");
    expect(parseFuel("LPG(일반인 구입)")).toBe("lpg");
  });

  it("prefers hybrid over its base-fuel token", () => {
    expect(parseFuel("가솔린 하이브리드")).toBe("hybrid");
  });

  it("returns null when no token is present", () => {
    expect(parseFuel("192,467km · 충남")).toBeNull();
  });
});

describe("estimateCcFromText", () => {
  it('derives 2199cc from a "2.2" model title', () => {
    expect(estimateCcFromText("올 뉴 K7 2.2 디젤 프레스티지")).toBe(2199);
  });

  it("returns null without a displacement-like number", () => {
    expect(estimateCcFromText("쏘나타 프리미엄")).toBeNull();
  });
});

describe("card fixture params", () => {
  it("extracts full real params from the card page", () => {
    const params = extractCardParams(parseDoc(CARD_HTML));
    expect(params.regYear).toBe(2016);
    expect(params.regMonth).toBe(9);
    expect(params.fuel).toBe("diesel");
    expect(params.engineCc).toBe(2199);
    expect(params.estimated).toBe(false);
  });

  it("full card params convert to an exact-precision lot", () => {
    const lot = toLotDetails(extractCardParams(parseDoc(CARD_HTML)), NOW);
    expect(lot.ageYears).toBe(9);
    expect(lotPrecision(lot)).toBe("exact");
  });

  it("falls back to an estimated cc from the title without hidden JSON", () => {
    const doc = parseDoc(CARD_HTML);
    for (const script of Array.from(doc.querySelectorAll("script"))) {
      const text = script.textContent ?? "";
      if (text.includes("__PRELOADED_STATE__")) {
        script.textContent = text.replace('"displacement":2199,', "");
      }
    }
    const params = extractCardParams(doc);
    expect(params.engineCc).toBe(2199);
    expect(params.estimated).toBe(true);
    expect(lotPrecision(toLotDetails(params, NOW))).toBe("approx");
  });

  it("listing extraction on card price elements does not throw", () => {
    const doc = parseDoc(CARD_HTML);
    for (const candidate of scanPrices(doc)) {
      expect(() => extractListingParams(candidate.element)).not.toThrow();
    }
  });
});

describe("listing fixture params", () => {
  it("extracts year and fuel for the majority of priced rows", () => {
    const doc = parseDoc(LISTING_HTML);
    const candidates = scanPrices(doc);
    expect(candidates.length).toBeGreaterThan(0);

    const extracted = candidates.map((c) => extractListingParams(c.element));
    const withYearAndFuel = extracted.filter(
      (p) => p.regYear !== undefined && p.fuel !== undefined,
    );
    expect(withYearAndFuel.length).toBeGreaterThan(candidates.length / 2);
  });

  it("never yields exact precision for listing rows", () => {
    const doc = parseDoc(LISTING_HTML);
    for (const candidate of scanPrices(doc)) {
      const lot = toLotDetails(extractListingParams(candidate.element), NOW);
      expect(lotPrecision(lot)).not.toBe("exact");
    }
  });

  it("card extraction on the listing page does not throw", () => {
    expect(() => extractCardParams(parseDoc(LISTING_HTML))).not.toThrow();
  });
});

describe("degradation on nonstandard blocks", () => {
  it("degrades to an honest marker instead of throwing", async () => {
    document.body.innerHTML =
      '<div><span class="prc"><strong>800</strong>만원</span>' +
      "<span>연식정보없음 · 미확인</span></div>";
    const el = document.querySelector(".prc")!;
    expect(() => extractListingParams(el)).not.toThrow();

    await runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    // No year and no displacement: the all-in total is not computable, so
    // the badge shows the marker rather than an invented number.
    expect(badgeText(hosts[0]!)).toBe("по запросу");
  });
});

describe("precision wiring (AE1)", () => {
  it("listing badges never claim exact precision", async () => {
    loadFixture(LISTING_HTML);
    await runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      // Either an approximate all-in total or the honest marker — never a
      // bare (exact-looking) number.
      expect(badgeText(host)).toMatch(/^(≈ |по запросу$)/);
    }
    expect(hosts.some((h) => badgeText(h).startsWith("≈ "))).toBe(true);
  });

  it("card with full params computes exactly, without the marker", async () => {
    window.history.replaceState(null, "", DETAIL_PATH);
    loadFixture(CARD_HTML);
    await runWidget();

    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    // The badge shows the all-in ("под ключ") total, not the lot price:
    // exact precision, so no "≈" prefix.
    expect(badgeText(hosts[0]!)).toBe("1 687 875 ₽");

    const panel = breakdownPanel();
    expect(panel.getAttribute("data-precision")).toBe("exact");
    // Embedded config, age 9y (y5plus), 2199cc diesel:
    //   lot 362,450 + shipping 220,000 + duty 4.8*2199*90 = 949,968
    //   + recycling 5,200 + clearance 2,134 + sbkts 45,000 + broker 85,000
    //   + commission 5% = 18,123 -> total 1,687,875.
    expect(totalValue(panel)).toBe("1 687 875 ₽");
    expect(panel.querySelector("[data-approx-reason]")).toBeNull();
  });

  it("badge and breakdown always show the same total for the same lot", async () => {
    window.history.replaceState(null, "", DETAIL_PATH);
    loadFixture(CARD_HTML);
    await runWidget();

    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    // Same rendered string, hence the same number: the badge is the
    // headline of the breakdown it expands into (R1).
    expect(badgeText(hosts[0]!)).toBe(totalValue(breakdownPanel()));
  });

  it("card with an estimated cc degrades to approx with a reason line", async () => {
    window.history.replaceState(null, "", DETAIL_PATH);
    loadFixture(CARD_HTML);
    for (const script of Array.from(document.querySelectorAll("script"))) {
      const text = script.textContent ?? "";
      if (text.includes("__PRELOADED_STATE__")) {
        script.textContent = text.replace('"displacement":2199,', "");
      }
    }
    await runWidget();

    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    expect(badgeText(hosts[0]!)).toBe("≈ 1 687 875 ₽");

    const panel = breakdownPanel();
    expect(panel.getAttribute("data-precision")).toBe("approx");
    // Estimated 2.2 -> 2199cc lands on the same duty bracket: same total,
    // but prefixed as approximate.
    expect(totalValue(panel)).toBe("≈ 1 687 875 ₽");
    expect(
      panel.querySelector("[data-approx-reason]")?.textContent,
    ).toBe("Приблизительно: не все данные лота видны");
  });

  it("an EV card stays on-request per U6", async () => {
    window.history.replaceState(null, "", DETAIL_PATH);
    loadFixture(CARD_HTML);
    for (const script of Array.from(document.querySelectorAll("script"))) {
      const text = script.textContent ?? "";
      if (text.includes("__PRELOADED_STATE__")) {
        script.textContent = text.replace('"fuelName":"디젤"', '"fuelName":"전기"');
      }
    }
    // DOM dt/dd fallback must not resurrect the diesel value.
    for (const dd of Array.from(document.querySelectorAll("dd"))) {
      if ((dd.textContent ?? "").trim() === "디젤") dd.textContent = "전기";
    }
    await runWidget();

    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    // EV customs are quoted manually: the badge shows the short marker, the
    // breakdown its long form — neither invents a number.
    expect(badgeText(hosts[0]!)).toBe("по запросу");
    const panel = breakdownPanel();
    expect(panel.getAttribute("data-precision")).toBe("onRequest");
    expect(totalValue(panel)).toBe("расчёт по запросу");
  });
});
