// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config";
import { DEFAULT_CONFIG, type WidgetConfig } from "../src/config.default";
import {
  attachBreakdown,
  isDetailPage,
  BREAKDOWN_ATTR,
  type BreakdownLotDetails,
} from "../src/ui/breakdown";
import { attachBadge } from "../src/ui/badge";
import { computeAllIn } from "../src/calc/customs";
import { buildOrderLink } from "../src/ui/order-button";
import type { ResolvedRates } from "../src/rates/cbr";
import { init } from "../src/main";

function readFixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

const CARD_HTML = readFixture("card-fem.html");
const LISTING_HTML = readFixture("listing-desktop.html");

const TEST_CONFIG_URL = "https://config.test/config.json";
const DETAIL_PATH = "/cars/detail/41756847";

/** Remote config distinct from DEFAULT_CONFIG so the source is provable. */
const REMOTE_CONFIG: WidgetConfig = {
  version: 2,
  messenger: { type: "telegram", address: "remote_importer" },
  currency: {
    referenceRates: { KRW_RUB: 0.05, EUR_RUB: 92 },
    updatedAt: "2026-08-01",
  },
  costItems: [
    { id: "shipping", label: "Доставка", kind: "fixed", value: 100000 },
  ],
  customs: DEFAULT_CONFIG.customs,
  commissionNote: "Тестовая заметка.",
};

function stubFetchOk(config: WidgetConfig): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => config,
  } as unknown as Response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubFetchFail(): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockRejectedValue(new TypeError("network down"));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function loadFixture(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
}

function breakdownHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${BREAKDOWN_ATTR}]`);
}

function shadowOf(host: HTMLElement): ShadowRoot {
  const root = host.shadowRoot;
  if (!root) throw new Error("breakdown host has no shadow root");
  return root;
}

function panelOf(host: HTMLElement): HTMLElement {
  const panel = shadowOf(host).querySelector<HTMLElement>("[data-panel]");
  if (!panel) throw new Error("panel not found");
  return panel;
}

function toggleOf(host: HTMLElement): HTMLButtonElement {
  const btn = shadowOf(host).querySelector<HTMLButtonElement>("button");
  if (!btn) throw new Error("toggle button not found");
  return btn;
}

function closeOf(host: HTMLElement): HTMLButtonElement {
  const btn = shadowOf(host).querySelector<HTMLButtonElement>("[data-close]");
  if (!btn) throw new Error("close button not found");
  return btn;
}

function badgeHosts(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-encar-ru-badge]"),
  );
}

/** True when a 만원 unit node follows the host — i.e. the badge split the price. */
function splitsPriceText(host: HTMLElement): boolean {
  let node: ChildNode | null = host.nextSibling;
  while (node !== null) {
    const text = (node.textContent ?? "").trim();
    if (text !== "") return /^만\s*원$/.test(text);
    node = node.nextSibling;
  }
  return false;
}

function rowValue(host: HTMLElement, itemId: string): string {
  const row = panelOf(host).querySelector(`[data-item-id="${itemId}"]`);
  return row?.querySelector("[data-value]")?.textContent ?? "";
}

/** Rates matching the config reference tier (keeps pre-U5 expected values). */
function ratesFor(config: WidgetConfig): ResolvedRates {
  return {
    krwRub: config.currency.referenceRates.KRW_RUB,
    eurRub: config.currency.referenceRates.EUR_RUB,
    dateISO: config.currency.updatedAt,
    source: "cbr",
  };
}

/** Attaches a breakdown to a synthetic detail-price element. */
function attachDirect(
  config: WidgetConfig,
  krw: number,
  source: "remote" | "embedded" = "remote",
  lot?: BreakdownLotDetails,
): HTMLElement {
  const el = document.createElement("span");
  el.setAttribute("data-intl-currency-amount", String(krw));
  document.body.appendChild(el);
  attachBreakdown(
    { element: el, krw },
    { config, source },
    ratesFor(config),
    lot,
  );
  const host = breakdownHost();
  if (!host) throw new Error("breakdown was not attached");
  return host;
}

beforeEach(() => {
  window.__encarRuConfigUrl = TEST_CONFIG_URL;
  window.history.replaceState(null, "", DETAIL_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  delete window.__encarRuConfigUrl;
  delete window.__encarRu;
  document.body.innerHTML = "";
  document.title = "";
  window.history.replaceState(null, "", "/");
});

describe("loadConfig", () => {
  it("returns the remote config with source 'remote' on success", async () => {
    const mock = stubFetchOk(REMOTE_CONFIG);
    const loaded = await loadConfig();
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0]![0]).toBe(TEST_CONFIG_URL);
    expect(loaded.source).toBe("remote");
    expect(loaded.config).toEqual(REMOTE_CONFIG);
  });

  it("falls back to embedded defaults when fetch fails", async () => {
    stubFetchFail();
    const loaded = await loadConfig();
    expect(loaded.source).toBe("embedded");
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to embedded defaults on malformed payload", async () => {
    stubFetchOk({ nonsense: true } as unknown as WidgetConfig);
    const loaded = await loadConfig();
    expect(loaded.source).toBe("embedded");
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to embedded defaults when the customs section is missing", async () => {
    const { customs: _customs, ...withoutCustoms } = REMOTE_CONFIG;
    stubFetchOk(withoutCustoms as unknown as WidgetConfig);
    const loaded = await loadConfig();
    expect(loaded.source).toBe("embedded");
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it("aborts after the 3s timeout and falls back to embedded", async () => {
    vi.useFakeTimers();
    const mock = vi.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", mock);

    const pending = loadConfig();
    await vi.advanceTimersByTimeAsync(3000);
    const loaded = await pending;
    expect(loaded.source).toBe("embedded");
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });
});

describe("detail page detection", () => {
  it("matches /cars/detail/ URLs only", () => {
    expect(isDetailPage("https://fem.encar.com/cars/detail/41756847")).toBe(
      true,
    );
    expect(isDetailPage("http://localhost/cars/detail/1")).toBe(true);
    expect(isDetailPage("https://fem.encar.com/search/all")).toBe(false);
  });
});

describe("breakdown panel", () => {
  const CLEAN_CONFIG: WidgetConfig = {
    version: 1,
    messenger: { type: "telegram", address: "importer" },
    currency: {
      referenceRates: { KRW_RUB: 0.05, EUR_RUB: 90 },
      updatedAt: "2026-08-01",
    },
    costItems: [
      { id: "shipping", label: "Доставка", kind: "fixed", value: 100000 },
      { id: "commission", label: "Комиссия", kind: "percent", value: 10 },
      { id: "customs", label: "Таможня", kind: "formula", value: "customs_v1" },
    ],
    customs: DEFAULT_CONFIG.customs,
    commissionNote: "Заметка.",
  };
  // 10,000,000 KRW * 0.05 = 500,000 lot; +100,000 fixed; +10% = 50,000
  const KRW = 10_000_000;
  /** Full lot params: the customs formulas compute exactly (U6). */
  const LOT: BreakdownLotDetails = {
    ageYears: 4,
    engineCc: 2000,
    fuel: "gasoline",
  };

  it("tap toggles the panel open and closed", () => {
    const host = attachDirect(CLEAN_CONFIG, KRW);
    const panel = panelOf(host);
    const toggle = toggleOf(host);
    expect(panel.hidden).toBe(true);

    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("lists computed cost items and total for a full-params lot", () => {
    // U6 real math at krwRub 0.05 / eurRub 90 with LOT (age 4, 2000cc):
    //   lot 500,000; shipping 100,000; commission 10% = 50,000;
    //   duty 2.7 EUR/cc * 2000 = 5,400 EUR * 90 = 486,000;
    //   recycling 5,200 (>=3y, <=3000cc); clearance 4,269 (lot <= 1,200,000);
    //   total 1,145,469.
    const result = computeAllIn(
      { priceKrw: KRW, ...LOT },
      { krwRub: 0.05, eurRub: 90 },
      CLEAN_CONFIG,
    );
    expect(result.precision).toBe("exact");
    expect(result.totalRub).toBe(1_145_469);

    const host = attachDirect(CLEAN_CONFIG, KRW, "remote", LOT);
    toggleOf(host).click();
    const panel = panelOf(host);

    const rowIds = Array.from(panel.querySelectorAll("[data-item-id]")).map(
      (row) => row.getAttribute("data-item-id"),
    );
    expect(rowIds).toEqual([
      "lot",
      "shipping",
      "commission",
      "duty",
      "recycling",
      "clearance",
      "total",
    ]);
    expect(rowValue(host, "lot")).toBe("500 000 ₽");
    expect(rowValue(host, "shipping")).toBe("100 000 ₽");
    expect(rowValue(host, "commission")).toBe("50 000 ₽");
    expect(rowValue(host, "duty")).toBe("486 000 ₽");
    expect(rowValue(host, "recycling")).toBe("5 200 ₽");
    expect(rowValue(host, "clearance")).toBe("4 269 ₽");
    expect(rowValue(host, "total")).toBe("1 145 469 ₽");
    expect(panelOf(host).getAttribute("data-precision")).toBe("exact");
  });

  it("marks the total 'on request' when lot params are unknown", () => {
    const host = attachDirect(CLEAN_CONFIG, KRW);
    toggleOf(host).click();
    const panel = panelOf(host);

    // Customs items are not computable: only known items are listed (U6).
    const rowIds = Array.from(panel.querySelectorAll("[data-item-id]")).map(
      (row) => row.getAttribute("data-item-id"),
    );
    expect(rowIds).toEqual(["lot", "shipping", "commission", "total"]);
    expect(rowValue(host, "total")).toBe("расчёт по запросу");
    expect(panel.getAttribute("data-precision")).toBe("onRequest");
  });

  it("marks the total 'on request' for an EV lot", () => {
    const host = attachDirect(CLEAN_CONFIG, KRW, "remote", {
      ageYears: 2,
      fuel: "electric",
    });
    toggleOf(host).click();
    expect(rowValue(host, "total")).toBe("расчёт по запросу");
    expect(
      panelOf(host).querySelector('[data-item-id="duty"]'),
    ).toBeNull();
  });

  it("keeps the breakdown host untranslatable and idempotent", () => {
    const host = attachDirect(CLEAN_CONFIG, KRW);
    expect(host.getAttribute("translate")).toBe("no");
    expect(host.classList.contains("notranslate")).toBe(true);

    const el = host.parentElement!;
    attachBreakdown(
      { element: el, krw: KRW },
      { config: CLEAN_CONFIG, source: "remote" },
      ratesFor(CLEAN_CONFIG),
    );
    expect(document.querySelectorAll(`[${BREAKDOWN_ATTR}]`).length).toBe(1);
  });

  it("renders the embedded-source marker only for embedded configs", () => {
    const embeddedHost = attachDirect(CLEAN_CONFIG, KRW, "embedded");
    expect(
      panelOf(embeddedHost).querySelector("[data-embedded-marker]"),
    ).not.toBeNull();
    embeddedHost.remove();

    const remoteHost = attachDirect(CLEAN_CONFIG, KRW, "remote");
    expect(
      panelOf(remoteHost).querySelector("[data-embedded-marker]"),
    ).toBeNull();
  });

  it("toggle tap target is at least 44x44 px", () => {
    const host = attachDirect(CLEAN_CONFIG, KRW);
    const toggle = toggleOf(host);
    expect(parseInt(toggle.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
    expect(parseInt(toggle.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  describe("overlay presentation (U8)", () => {
    it("renders a dialog header with the title and a 44x44 close button", () => {
      const host = attachDirect(CLEAN_CONFIG, KRW);
      const panel = panelOf(host);
      expect(panel.getAttribute("role")).toBe("dialog");
      expect(panel.getAttribute("aria-label")).toBe("Цена под ключ в РФ");
      expect(
        panel.querySelector("[data-header] [data-title]")?.textContent,
      ).toBe("Цена под ключ в РФ");

      const close = closeOf(host);
      expect(close.getAttribute("aria-label")).toBe("Закрыть");
      expect(parseInt(close.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
      expect(parseInt(close.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    });

    it("the close button closes the open panel", () => {
      const host = attachDirect(CLEAN_CONFIG, KRW);
      toggleOf(host).click();
      expect(panelOf(host).hidden).toBe(false);

      closeOf(host).click();
      expect(panelOf(host).hidden).toBe(true);
      expect(toggleOf(host).getAttribute("aria-expanded")).toBe("false");
    });

    it("Esc closes the panel", () => {
      const host = attachDirect(CLEAN_CONFIG, KRW);
      toggleOf(host).click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(panelOf(host).hidden).toBe(true);
    });

    it("a click outside closes the panel, a click on the widget does not", () => {
      const host = attachDirect(CLEAN_CONFIG, KRW);
      toggleOf(host).click();

      // Shadow-tree clicks are retargeted to the host element.
      host.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(panelOf(host).hidden).toBe(false);

      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(panelOf(host).hidden).toBe(true);
    });

    it("positions the open panel inside the viewport", () => {
      const host = attachDirect(CLEAN_CONFIG, KRW);
      const panel = panelOf(host);
      toggleOf(host).click();
      // Wide viewport (jsdom media queries never match): anchored card with
      // computed coordinates clamped away from the viewport edges.
      const left = parseInt(panel.style.left, 10);
      const top = parseInt(panel.style.top, 10);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(window.innerWidth);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(window.innerHeight);
    });

    it("keeps the stylesheet overlay contract (fixed, z-index, sheet)", () => {
      const host = attachDirect(CLEAN_CONFIG, KRW);
      const css = shadowOf(host).querySelector("style")?.textContent ?? "";
      expect(css).toContain("position: fixed");
      expect(css).toContain("z-index: 2147483000");
      expect(css).toContain("@media (max-width: 599px)");
      expect(css).toContain("env(safe-area-inset-bottom, 0px)");
    });
  });
});

describe("badge placement (U8)", () => {
  it("keeps the fem card price and its 만원 unit together", async () => {
    stubFetchOk(REMOTE_CONFIG);
    loadFixture(CARD_HTML);
    init();
    await vi.waitFor(() => {
      expect(badgeHosts().length).toBe(1);
    });

    const price = document.querySelector<HTMLElement>(
      "[data-intl-currency-amount]",
    )!;
    const unit = price.nextElementSibling!;
    expect(unit.hasAttribute("data-intl-currency-unit")).toBe(true);
    expect(unit.textContent).toBe("만원");
    // Nothing of ours sits inside the price element or between it and the
    // unit: the host page's own price line is untouched.
    expect(price.querySelector("[data-encar-ru-host]")).toBeNull();

    const badge = badgeHosts()[0]!;
    expect(unit.nextElementSibling).toBe(badge);
    expect(badge.nextElementSibling).toBe(breakdownHost());
  });

  it("badge hosts are nowrap inline-blocks that never split a price", async () => {
    stubFetchOk(REMOTE_CONFIG);
    window.history.replaceState(null, "", "/search/all");
    loadFixture(LISTING_HTML);
    init();
    await vi.waitFor(() => {
      expect(badgeHosts().length).toBeGreaterThan(0);
    });

    for (const host of badgeHosts()) {
      expect(host.style.display).toBe("inline-block");
      expect(host.style.whiteSpace).toBe("nowrap");
      expect(host.style.verticalAlign).toBe("middle");
      expect(splitsPriceText(host)).toBe(false);
    }
  });

  it("badge styles stay inherit-based with a px floor", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    attachBadge({ element: el, krw: 10_000_000 }, 0.05);
    const badge = badgeHosts()[0]!;
    const css = badge.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(css).toContain("font-size: max(11px, 0.9em)");
    expect(css).toContain("white-space: nowrap");
    expect(css).toContain("vertical-align: middle");
  });
});

describe("order button deep links", () => {
  const URL_IN_TEST = "http://localhost/cars/detail/41756847";
  const TITLE = "Kia K7 2.2 Diesel";
  const TEXT = `Здравствуйте! Хочу заказать этот автомобиль: ${TITLE} ${URL_IN_TEST}`;

  it("builds a telegram deep link with a percent-encoded lot URL", () => {
    const link = buildOrderLink(
      { type: "telegram", address: "encar_importer" },
      URL_IN_TEST,
      TITLE,
    );
    expect(link).toBe(
      `https://t.me/encar_importer?text=${encodeURIComponent(TEXT)}`,
    );
    expect(link).toContain("http%3A%2F%2Flocalhost%2Fcars%2Fdetail%2F41756847");
  });

  it("builds a whatsapp deep link with a percent-encoded lot URL", () => {
    const link = buildOrderLink(
      { type: "whatsapp", address: "79991234567" },
      URL_IN_TEST,
      TITLE,
    );
    expect(link).toBe(
      `https://wa.me/79991234567?text=${encodeURIComponent(TEXT)}`,
    );
  });

  it("panel contains the order button opening the link in a new tab", () => {
    document.title = TITLE;
    // jsdom origin includes a port (localhost:3000); use the live location.
    const pageUrl = window.location.href;
    const expectedText = `Здравствуйте! Хочу заказать этот автомобиль: ${TITLE} ${pageUrl}`;
    const config: WidgetConfig = {
      version: 1,
      messenger: { type: "whatsapp", address: "79991234567" },
      currency: {
        referenceRates: { KRW_RUB: 0.05, EUR_RUB: 90 },
        updatedAt: "2026-08-01",
      },
      costItems: [],
      customs: DEFAULT_CONFIG.customs,
      commissionNote: "",
    };
    const host = attachDirect(config, 10_000_000);
    const button = panelOf(host).querySelector<HTMLAnchorElement>(
      "[data-order-button]",
    );
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("Заказать этот автомобиль");
    expect(button!.target).toBe("_blank");
    expect(button!.href).toBe(
      `https://wa.me/79991234567?text=${encodeURIComponent(expectedText)}`,
    );
  });
});

describe("integration with the widget entry point", () => {
  it("attaches the breakdown to the card badge with remote config", async () => {
    stubFetchOk(REMOTE_CONFIG);
    loadFixture(CARD_HTML);
    init();

    await vi.waitFor(() => {
      expect(breakdownHost()).not.toBeNull();
    });
    const host = breakdownHost()!;
    toggleOf(host).click();
    // 6,590,000 KRW * 0.05 = 329,500 lot. U7 extracts full card params, so
    // the total is exact; REMOTE_CONFIG has no formula item, hence only the
    // lot and shipping rows: 329,500 + 100,000 = 429,500.
    expect(rowValue(host, "lot")).toBe("329 500 ₽");
    expect(rowValue(host, "shipping")).toBe("100 000 ₽");
    expect(rowValue(host, "total")).toBe("429 500 ₽");
    expect(panelOf(host).querySelector("[data-embedded-marker]")).toBeNull();
  });

  it("uses embedded defaults and shows the marker when fetch fails", async () => {
    stubFetchFail();
    loadFixture(CARD_HTML);
    init();

    await vi.waitFor(() => {
      expect(breakdownHost()).not.toBeNull();
    });
    const host = breakdownHost()!;
    // DEFAULT_CONFIG: lot 6,590,000 * 0.055 = 362,450. U7 card params
    // (2016/09, 2199cc diesel, age >5y): + shipping 220,000 + duty
    // 4.8*2199*90 = 949,968 + recycling 5,200 + clearance 2,134 + sbkts
    // 45,000 + broker 85,000 + commission 5% = 18,123 -> 1,687,875 exact.
    expect(rowValue(host, "lot")).toBe("362 450 ₽");
    expect(rowValue(host, "total")).toBe("1 687 875 ₽");
    expect(
      panelOf(host).querySelector("[data-embedded-marker]"),
    ).not.toBeNull();
  });

  it("does not attach a breakdown outside detail pages", async () => {
    stubFetchOk(REMOTE_CONFIG);
    window.history.replaceState(null, "", "/search/all");
    loadFixture(CARD_HTML);
    init();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-encar-ru-badge]")).not.toBeNull();
    expect(breakdownHost()).toBeNull();
  });
});
