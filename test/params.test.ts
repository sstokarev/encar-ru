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

  it("reads encar's hybrid label 가솔린+전기 as hybrid, not electric", () => {
    // The listing prints hybrids as "가솔린+전기"; matching the bare 전기 rule
    // there degrades every gasoline hybrid to "по запросу".
    expect(parseFuel("가솔린+전기")).toBe("hybrid");
    expect(parseFuel("· 전기+가솔린 ·")).toBe("hybrid");
    expect(parseFuel("· 하이브리드 ·")).toBe("hybrid");
  });

  it("keeps bare 전기 electric but never matches inside a compound", () => {
    expect(parseFuel("전기")).toBe("electric");
    expect(parseFuel("전기차")).toBe("electric");
    // 전기형 is a pre-facelift model marker, not a fuel.
    expect(parseFuel("18/07식(19년형) 전기형")).toBeNull();
  });
});

describe("estimateCcFromText", () => {
  it('derives 2199cc from a "2.2" model title', () => {
    expect(estimateCcFromText("올 뉴 K7 2.2 디젤 프레스티지")).toBe(2199);
  });

  it("returns null without a displacement-like number", () => {
    expect(estimateCcFromText("쏘나타 프리미엄")).toBeNull();
  });

  it("rejects ratings and implausible displacements instead of guessing", () => {
    // A "4.5" rating must never become a 4499cc engine (different duty and
    // recycling bracket); anything outside 0.6-6.0 L is not a car engine.
    expect(estimateCcFromText("평점 4.5")).toBeNull();
    expect(estimateCcFromText("4.5점")).toBeNull();
    expect(estimateCcFromText("리뷰 4.9 (128)")).toBeNull();
    expect(estimateCcFromText("6.5 프리미엄")).toBeNull();
    expect(estimateCcFromText("0.5 트림")).toBeNull();
    // Real displacements still resolve.
    expect(estimateCcFromText("올 뉴 K7 2.2 디젤 프레스티지")).toBe(2199);
    expect(estimateCcFromText("1.4 트렌디")).toBe(1399);
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
    // Registered 2016-09, valued 2026-08-02: 118 full months counted from the
    // end of the registration month. The age is NOT floored to whole years —
    // the duty cliffs sit at 36 and 60 months, and flooring hid the second one.
    expect(lot.ageYears! * 12).toBe(118);
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

/** Removes the exact displacement from the inline SPA state of `root`. */
function stripStateDisplacement(root: ParentNode): void {
  for (const script of Array.from(root.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (text.includes("__PRELOADED_STATE__")) {
      script.textContent = text.replace('"displacement":2199,', "");
    }
  }
}

/** Rewrites the dd of the visible spec list entry labelled `label`. */
function setSpec(label: string, value: string): void {
  for (const dt of Array.from(document.querySelectorAll("dt"))) {
    if (!(dt.textContent ?? "").includes(label)) continue;
    const dd = dt.nextElementSibling;
    if (dd?.tagName === "DD") dd.textContent = value;
    return;
  }
  // The fixture has no 배기량 row: add one where the spec list lives.
  const list = document.querySelector("dl") ?? document.body;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  list.append(dt, dd);
}

describe("card title heuristic scope (U7)", () => {
  it("reads the cc from the lot title, not from a rating heading", () => {
    loadFixture(CARD_HTML);
    stripStateDisplacement(document);
    const rating = document.createElement("h2");
    rating.textContent = "평점 4.5";
    document.body.prepend(rating);

    const params = extractCardParams(document, DETAIL_PATH);
    // 4.5 is a rating; the lot title says 2.2.
    expect(params.engineCc).toBe(2199);
    expect(params.estimated).toBe(true);
  });
});

describe("SPA soft navigation (U7, AE1)", () => {
  it("keeps a state bound to the lot in the URL", () => {
    loadFixture(CARD_HTML);
    const params = extractCardParams(document, DETAIL_PATH);
    expect(params.engineCc).toBe(2199);
    expect(params.fuel).toBe("diesel");
    expect(params.estimated).toBe(false);
  });

  it("discards a state left behind by the previous lot", () => {
    loadFixture(CARD_HTML);
    // fem writes __PRELOADED_STATE__ once and never rewrites it on a
    // client-side route change: after a soft navigation the script still
    // describes lot 41756847 while the visible DOM shows the new car.
    setSpec("연식", "20/03식");
    setSpec("연료", "가솔린");
    setSpec("배기량", "1,591cc");

    const params = extractCardParams(document, "/cars/detail/99999999");
    expect(params.regYear).toBe(2020);
    expect(params.regMonth).toBe(3);
    expect(params.fuel).toBe("gasoline");
    expect(params.engineCc).toBe(1591);
    // Nothing here was read from the lot's own data source.
    expect(params.estimated).toBe(true);
  });
});

describe("hybrid rows in the listing fixture (U7)", () => {
  it("resolves 가솔린+전기 rows to hybrid and prices the one with a cc", async () => {
    loadFixture(LISTING_HTML);
    // Rows are captured before the widget runs: our own dictionary rewrites
    // the very tokens matched here.
    const rows = Array.from(document.querySelectorAll("tr")).filter((tr) =>
      (tr.textContent ?? "").includes("가솔린+전기"),
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const priceEl = row.querySelector(".prc");
      expect(priceEl).not.toBeNull();
      expect(extractListingParams(priceEl!).fuel).toBe("hybrid");
    }

    // The 1.6 E-TECH row exposes a displacement in its title, so this hybrid
    // must end up with a real all-in total (a floor: a hybrid's recycling fee
    // needs the combined ICE + electric power, which no listing carries).
    const etech = rows.find((row) =>
      (row.querySelector(".dtl")?.textContent ?? "").includes("E-TECH"),
    );
    expect(etech).toBeDefined();

    await runWidget();
    for (const row of rows) {
      const host = row.querySelector<HTMLElement>("[data-encar-ru-badge]");
      expect(host).not.toBeNull();
      expect(badgeText(host!)).not.toMatch(/NaN|Infinity/);
    }
    const etechBadge = etech!.querySelector<HTMLElement>(
      "[data-encar-ru-badge]",
    );
    expect(etechBadge).not.toBeNull();
    expect(badgeText(etechBadge!)).toMatch(/^от \d{1,3}( \d{3})* ₽$/);
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
    // No year and no displacement: duty and the recycling fee cannot be
    // computed and dash. What IS proven — the lot price (8,000,000 KRW *
    // 0.055 = 440,000) and its clearance fee (2,462) — is quoted as a floor.
    // Refusing to show a price we do know helps nobody.
    expect(badgeText(hosts[0]!)).toBe("от 442 462 ₽");
  });
});

describe("precision wiring (AE1)", () => {
  it("listing badges never claim exact precision", async () => {
    loadFixture(LISTING_HTML);
    await runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      // Either a lower-bound all-in total or the honest marker — never a
      // bare (exact-looking) number.
      expect(badgeText(host)).toMatch(/^(от |по запросу$)/);
    }
    expect(hosts.some((h) => badgeText(h).startsWith("от "))).toBe(true);
  });

  it("card with full params quotes every provable line as a floor", async () => {
    window.history.replaceState(null, "", DETAIL_PATH);
    loadFixture(CARD_HTML);
    await runWidget();

    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    // The badge shows the all-in ("под ключ") total, not the lot price. The
    // card publishes age, fuel and displacement but never engine power, so the
    // recycling fee dashes and the total is a lower bound.
    expect(badgeText(hosts[0]!)).toBe("от 1 314 880 ₽");

    const panel = breakdownPanel();
    expect(panel.getAttribute("data-precision")).toBe("partial");
    // Embedded config, 118 months old (y5plus), 2199cc diesel:
    //   lot 362,450 + duty 4.8*2199*90 = 949,968 + clearance 2,462
    //   -> 1,314,880. Recycling dashes (no power); shipping, sbkts, broker and
    //   the commission are "unknown" items and add nothing.
    expect(totalValue(panel)).toBe("от 1 314 880 ₽");
    // A floor is not an approximation: nothing here may come out LOWER, so the
    // "≈" reason line stays off.
    expect(panel.querySelector("[data-approx-reason]")).toBeNull();
    expect(
      panel.querySelector("[data-pending-note]")?.textContent,
    ).toContain("Утилизационный сбор");
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

  it("card with an estimated cc stays a floor, never an approximation", async () => {
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
    // Estimated 2.2 -> 2199cc lands on the same duty bracket, so the number is
    // unchanged. The marker is "от", not "≈": a quote that is already a floor
    // cannot be described as "might also come out lower" just because one of
    // its inputs was estimated (pinned in test/calc.test.ts — "partial" wins
    // over "approx").
    expect(badgeText(hosts[0]!)).toBe("от 1 314 880 ₽");

    const panel = breakdownPanel();
    expect(panel.getAttribute("data-precision")).toBe("partial");
    expect(totalValue(panel)).toBe("от 1 314 880 ₽");
    expect(panel.querySelector("[data-approx-reason]")).toBeNull();
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
