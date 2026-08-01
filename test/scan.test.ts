// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePriceText } from "../src/scan/scanner";
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

function runWidget(): void {
  init();
}

function badgeHosts(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-encar-ru-badge]"),
  );
}

function badgeText(host: HTMLElement): string {
  return host.shadowRoot?.querySelector("span")?.textContent ?? "";
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
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
  it(`annotates exactly ${LISTING_BADGE_COUNT} priced lots`, () => {
    loadFixture(LISTING_HTML);
    runWidget();
    expect(badgeHosts().length).toBe(LISTING_BADGE_COUNT);
  });

  it("marks every badge host untranslatable and formats RUB", () => {
    loadFixture(LISTING_HTML);
    runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host.getAttribute("translate")).toBe("no");
      expect(host.classList.contains("notranslate")).toBe(true);
      expect(badgeText(host)).toMatch(/^≈ \d{1,3}( \d{3})* ₽$/);
    }
  });

  it("adds no duplicate badges when run repeatedly", () => {
    loadFixture(LISTING_HTML);
    runWidget();
    runWidget();
    window.__encarRu?.rescan();
    expect(badgeHosts().length).toBe(LISTING_BADGE_COUNT);
  });
});

describe("fem card fixture", () => {
  it("annotates the main price with the mock RUB value", () => {
    loadFixture(CARD_HTML);
    runWidget();
    const hosts = badgeHosts();
    expect(hosts.length).toBe(1);
    // 659만원 = 6,590,000 KRW; 6,590,000 * 0.055 = 362,450 RUB (mock rate)
    expect(badgeText(hosts[0]!)).toBe("≈ 362 450 ₽");
    expect(hosts[0]!.closest("[data-intl-currency]")).not.toBeNull();
  });
});

describe("browser-translated DOM", () => {
  const variants: TranslationVariant[] = ["english-unit", "strip-unit"];
  for (const variant of variants) {
    it(`listing (${variant}) keeps the same badge count`, () => {
      loadFixture(LISTING_HTML);
      emulateBrowserTranslation(document.body, variant);
      runWidget();
      expect(badgeHosts().length).toBe(LISTING_BADGE_COUNT);
    });

    it(`card (${variant}) still annotates the main price`, () => {
      loadFixture(CARD_HTML);
      emulateBrowserTranslation(document.body, variant);
      runWidget();
      const hosts = badgeHosts();
      expect(hosts.length).toBe(1);
      expect(badgeText(hosts[0]!)).toBe("≈ 362 450 ₽");
    });
  }
});

describe("regex fallback", () => {
  it("finds prices in markup without known price selectors", () => {
    document.body.innerHTML =
      "<div><b>1,250</b>만원</div><p>즉시구매 660만원</p>";
    runWidget();
    const texts = badgeHosts().map(badgeText);
    expect(badgeHosts().length).toBe(2);
    expect(texts).toContain("≈ 687 500 ₽"); // 12,500,000 KRW * 0.055
    expect(texts).toContain("≈ 363 000 ₽"); // 6,600,000 KRW * 0.055
  });
});

describe("dynamic content (MutationObserver)", () => {
  it("annotates nodes inserted after init", async () => {
    document.body.innerHTML =
      '<ul><li><span class="prc"><strong>900</strong>만원</span></li></ul>';
    runWidget();
    expect(badgeHosts().length).toBe(1);

    const li = document.createElement("li");
    li.innerHTML = '<span class="prc"><strong>1,000</strong>만원</span>';
    document.querySelector("ul")!.appendChild(li);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(badgeHosts().length).toBe(2);
  });
});

describe("zero-price diagnostic", () => {
  it("warns exactly when a page with a body yields no candidates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML =
      '<span class="prc"><strong>500</strong>만원</span>';
    window.__encarRu?.rescan();
    expect(warn).not.toHaveBeenCalled();

    document.body.innerHTML = "<p>주행거리 12345km, 가격 정보 없음</p>";
    window.__encarRu?.rescan();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[encar-ru] no prices found");
  });
});
