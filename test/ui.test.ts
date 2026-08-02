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
import { BADGE_GAP_PX, attachBadge, type BadgeTotal } from "../src/ui/badge";
import { computeAllIn } from "../src/calc/customs";
import { buildOrderLink } from "../src/ui/order-button";
import type { ResolvedRates } from "../src/rates/cbr";
import { init } from "../src/main";

/**
 * Calculator result override. The UI is tested against the calculator's
 * *contract*, not against today's implementation: a test can hand
 * attachBreakdown a result with unknown (undetermined) cost items and a
 * partial total, which the calculator does not produce yet. Null — the
 * default, restored after every test — keeps the real implementation, so all
 * other tests still exercise the real math.
 */
const calcOverride = vi.hoisted(() => ({ result: null as unknown }));

vi.mock("../src/calc/customs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/calc/customs")>();
  return {
    ...actual,
    computeAllIn: (...args: Parameters<typeof actual.computeAllIn>) =>
      calcOverride.result ?? actual.computeAllIn(...args),
  };
});

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

/** Headline value rendered inside the merged detail control. */
function toggleValue(host: HTMLElement): string {
  return (
    shadowOf(host).querySelector("[data-toggle-value]")?.textContent ?? ""
  );
}

function styleOf(host: HTMLElement): string {
  return shadowOf(host).querySelector("style")?.textContent ?? "";
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

function rowOf(host: HTMLElement, itemId: string): HTMLElement {
  const row = panelOf(host).querySelector<HTMLElement>(
    `[data-item-id="${itemId}"]`,
  );
  if (!row) throw new Error(`row ${itemId} not found`);
  return row;
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
  window.history.replaceState(null, "", DETAIL_PATH);
});

afterEach(() => {
  calcOverride.result = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  delete window.__encarRu;
  document.body.innerHTML = "";
  document.title = "";
  window.history.replaceState(null, "", "/");
});

describe("loadConfig", () => {
  it("returns the remote config with source 'remote' on success", async () => {
    const mock = stubFetchOk(REMOTE_CONFIG);
    const loaded = await loadConfig(TEST_CONFIG_URL);
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0]![0]).toBe(TEST_CONFIG_URL);
    expect(loaded.source).toBe("remote");
    expect(loaded.config).toEqual(REMOTE_CONFIG);
  });

  it("falls back to embedded defaults when fetch fails", async () => {
    stubFetchFail();
    const loaded = await loadConfig(TEST_CONFIG_URL);
    expect(loaded.source).toBe("embedded");
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to embedded defaults on malformed payload", async () => {
    stubFetchOk({ nonsense: true } as unknown as WidgetConfig);
    const loaded = await loadConfig(TEST_CONFIG_URL);
    expect(loaded.source).toBe("embedded");
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to embedded defaults when the customs section is missing", async () => {
    const { customs: _customs, ...withoutCustoms } = REMOTE_CONFIG;
    stubFetchOk(withoutCustoms as unknown as WidgetConfig);
    const loaded = await loadConfig(TEST_CONFIG_URL);
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

    const pending = loadConfig(TEST_CONFIG_URL);
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
  /**
   * Full lot params: the customs formulas compute exactly (U6). Engine power
   * is part of "full" since ПП РФ 1713 made the recycling fee depend on it —
   * without it that line dashes and the total is only a floor.
   */
  const LOT: BreakdownLotDetails = {
    ageYears: 4,
    engineCc: 2000,
    powerHp: 150,
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
    // U6 real math at krwRub 0.05 / eurRub 90 with LOT (age 4, 2000cc, 150hp):
    //   lot 500,000; shipping 100,000; commission 10% = 50,000;
    //   duty 2.7 EUR/cc * 2000 = 5,400 EUR * 90 = 486,000;
    //   recycling 5,200 (>=3y, <=3000cc, <=160hp); clearance 4,924
    //   (lot <= 1,200,000, ПП РФ 1638); total 1,146,124.
    const result = computeAllIn(
      { priceKrw: KRW, ...LOT },
      { krwRub: 0.05, eurRub: 90 },
      CLEAN_CONFIG,
    );
    expect(result.precision).toBe("exact");
    expect(result.totalRub).toBe(1_146_124);

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
    expect(rowValue(host, "clearance")).toBe("4 924 ₽");
    expect(rowValue(host, "total")).toBe("1 146 124 ₽");
    expect(panelOf(host).getAttribute("data-precision")).toBe("exact");
  });

  it("quotes a floor when lot params are unknown, and says which lines are missing", () => {
    const host = attachDirect(CLEAN_CONFIG, KRW);
    toggleOf(host).click();
    const panel = panelOf(host);

    // Duty and the recycling fee are not computable, but they keep their rows
    // as dashes — a dropped row is a total that is short with nothing looking
    // broken. The clearance fee only needs the lot value, so it is a number.
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
    expect(rowValue(host, "duty")).toBe("—");
    expect(rowValue(host, "recycling")).toBe("—");
    // 500,000 + 100,000 + 50,000 + 4,924 clearance = 654,924, a lower bound.
    expect(rowValue(host, "total")).toBe("от 654 924 ₽");
    expect(panel.getAttribute("data-precision")).toBe("partial");
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

    // The control is a block row of its own now, so idempotency is keyed on
    // the price element it annotates, not on DOM proximity.
    const el = document.querySelector<HTMLElement>(
      `[data-intl-currency-amount="${KRW}"]`,
    )!;
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

  /**
   * Contract under construction (calculator side, agent "tariffs"): a cost
   * item may carry no amount, the customs block may be undeterminable, and the
   * total is then a lower bound flagged by precision "partial". The panel must
   * show WHAT is not counted yet instead of quietly dropping the row.
   */
  describe("partial total: undetermined cost items", () => {
    /** A result the calculator cannot produce yet — see calcOverride. */
    function partialResult(): unknown {
      return {
        items: [
          { id: "lot", label: "Цена лота", rub: 500_000 },
          { id: "shipping", label: "Доставка" },
          { id: "customs", label: "Таможня" },
          { id: "commission", label: "Комиссия" },
        ],
        totalRub: 500_000,
        precision: "partial",
        notes: [],
      };
    }

    it("renders an undetermined item as a dash instead of dropping the row", () => {
      calcOverride.result = partialResult();
      const host = attachDirect(CLEAN_CONFIG, KRW);
      toggleOf(host).click();

      const rowIds = Array.from(
        panelOf(host).querySelectorAll("[data-item-id]"),
      ).map((row) => row.getAttribute("data-item-id"));
      expect(rowIds).toEqual([
        "lot",
        "shipping",
        "customs",
        "commission",
        "total",
      ]);
      expect(rowValue(host, "lot")).toBe("500 000 ₽");
      expect(rowValue(host, "shipping")).toBe("—");
      expect(rowValue(host, "customs")).toBe("—");
      // The dashed rows are muted, so the eye reads them as "not counted yet".
      expect(rowOf(host, "shipping").hasAttribute("data-unknown")).toBe(true);
      expect(rowOf(host, "lot").hasAttribute("data-unknown")).toBe(false);
      expect(styleOf(host)).toContain("[data-unknown]");
    });

    it("renders the partial total as a lower bound, never as '≈'", () => {
      calcOverride.result = partialResult();
      const host = attachDirect(CLEAN_CONFIG, KRW);
      toggleOf(host).click();
      expect(rowValue(host, "total")).toBe("от 500 000 ₽");
      expect(panelOf(host).getAttribute("data-precision")).toBe("partial");
      expect(toggleValue(host)).toBe("от 500 000 ₽");
    });

    it("notes in Russian which items the total does not include yet", () => {
      calcOverride.result = partialResult();
      const host = attachDirect(CLEAN_CONFIG, KRW);
      const note =
        panelOf(host).querySelector("[data-pending-note]")?.textContent ?? "";
      expect(note).toContain("Доставка");
      expect(note).toContain("Комиссия");
      expect(note).toContain("Таможня");
      // Cyrillic only: no English leaked into a customer-facing string.
      expect(note).not.toMatch(/[A-Za-z]/);
    });

    it("shows no pending note when every item has an amount", () => {
      const host = attachDirect(CLEAN_CONFIG, KRW, "remote", LOT);
      expect(panelOf(host).querySelector("[data-pending-note]")).toBeNull();
      expect(panelOf(host).querySelector("[data-unknown]")).toBeNull();
    });

    it("keeps the calculator's own notes alongside the pending note", () => {
      calcOverride.result = {
        ...(partialResult() as { items: unknown[] }),
        notes: ["Возраст близок к границе таможенного режима."],
      };
      const host = attachDirect(CLEAN_CONFIG, KRW);
      expect(
        panelOf(host).querySelector("[data-calc-note]")?.textContent,
      ).toBe("Возраст близок к границе таможенного режима.");
      expect(panelOf(host).querySelector("[data-pending-note]")).not.toBeNull();
    });

    it("keeps Esc, outside click and the order button working", () => {
      calcOverride.result = partialResult();
      const host = attachDirect(CLEAN_CONFIG, KRW);
      toggleOf(host).click();
      expect(panelOf(host).hidden).toBe(false);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(panelOf(host).hidden).toBe(true);

      toggleOf(host).click();
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(panelOf(host).hidden).toBe(true);
      expect(panelOf(host).querySelector("[data-order-button]")).not.toBeNull();
      expect(panelOf(host).querySelector("[data-rate-date]")).not.toBeNull();
    });
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
  });

  it("gives every listing badge its own line under the price (U12)", async () => {
    stubFetchOk(REMOTE_CONFIG);
    window.history.replaceState(null, "", "/search/all");
    loadFixture(LISTING_HTML);
    init();
    await vi.waitFor(() => {
      expect(badgeHosts().length).toBeGreaterThan(0);
    });

    for (const host of badgeHosts()) {
      // A row of its own: the RUB price is never wedged in beside the Korean
      // one, where the gap depended on whatever space the price cell had left.
      expect(host.style.display).toBe("block");
      expect(host.style.whiteSpace).toBe("nowrap");
      expect(host.style.float).toBe("none");
      // One constant gap for every row, and the price cell's own alignment.
      expect(host.style.margin).toBe(`${BADGE_GAP_PX}px 0px 0px`);
      expect(host.style.textAlign).toBe("inherit");
      // The number itself must still never be broken away from its 만원 unit.
      expect(splitsPriceText(host)).toBe(false);
    }
  });

  it("badge styles stay inherit-based with a px floor", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    attachBadge(
      { element: el, krw: 10_000_000 },
      { totalRub: 1_145_469, precision: "exact" },
    );
    const badge = badgeHosts()[0]!;
    const css = badge.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(css).toContain("font-size: max(11px, 0.9em)");
    expect(css).toContain("white-space: nowrap");
    // The chip carries no side margin of its own: the gap to the price above
    // is the host's, so it stays the same in every listing shape (U12).
    expect(css).toContain("margin: 0;");
  });

  it("renders the listing chip in encar's design language", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    attachBadge(
      { element: el, krw: 10_000_000 },
      { totalRub: 1_145_469, precision: "exact" },
    );
    const css = badgeHosts()[0]!.shadowRoot?.querySelector("style")
      ?.textContent ?? "";
    // Encar tokens: inherited Pretendard, red accent, 1px separators.
    expect(css).toContain("font-family: inherit");
    expect(css).toContain("#D72E36");
    // The rejected dark-green visual language is gone for good.
    expect(css).not.toContain("#1a6b3c");
  });
});

describe("detail-page control (layout + encar styling)", () => {
  async function initCard(): Promise<HTMLElement> {
    stubFetchOk(REMOTE_CONFIG);
    loadFixture(CARD_HTML);
    init();
    await vi.waitFor(() => {
      expect(breakdownHost()).not.toBeNull();
    });
    return breakdownHost()!;
  }

  it("inserts its own block-level row under the price block, not inside it", async () => {
    const host = await initCard();
    const price = document.querySelector<HTMLElement>(
      "[data-intl-currency-amount]",
    )!;

    // Never inside the site's fixed-height price line.
    expect(price.closest("[data-intl-currency]")!.contains(host)).toBe(false);
    // A full-width row that follows the block holding the price, so the
    // site's own tab row below reflows instead of being overlapped.
    expect(host.previousElementSibling?.contains(price)).toBe(true);
    expect(host.nextElementSibling).not.toBeNull();
    expect(host.style.display).toBe("block");
    expect(host.style.width).toBe("100%");
    expect(host.style.whiteSpace).toBe("normal");
    expect(host.style.float).toBe("none");
  });

  it("merges the value and the expand affordance into one control", async () => {
    const host = await initCard();
    const badge = badgeHosts()[0]!;
    // The inline badge is absorbed: exactly one visible control remains.
    expect(badge.style.display).toBe("none");
    const toggle = toggleOf(host);
    expect(toggleValue(host)).toBe(
      badge.shadowRoot?.querySelector("span")?.textContent,
    );
    expect(toggleValue(host)).toBe("429 500 ₽");
    // No second "Расчёт" pill next to the number.
    expect(toggle.textContent).not.toContain("Расчёт");
    expect(toggle.querySelector("[data-chevron]")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    expect(panelOf(host).hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("styles control and panel with encar's tokens", async () => {
    const host = await initCard();
    const css = styleOf(host);
    expect(css).toContain("font-family: inherit");
    expect(css).toContain("#D72E36");
    expect(css).toContain("border-radius: 8px");
    expect(css).not.toContain("#1a6b3c");

    const button = css.slice(css.indexOf("[data-order-button]"));
    expect(button).toContain("min-height: 50px");
    expect(button).toContain("font-size: 15px");
    expect(button).toContain("font-weight: 600");
    expect(button).toContain("background: #D72E36");
  });
});

describe("provenance signal (P1)", () => {
  /** Attaches a badge to a fresh element and returns its host. */
  function attach(provenance?: unknown): HTMLElement {
    const el = document.createElement("span");
    document.body.appendChild(el);
    (attachBadge as unknown as (...args: unknown[]) => void)(
      { element: el, krw: 6_590_000 },
      { totalRub: 1_701_437, precision: "approx" },
      provenance,
    );
    const hosts = badgeHosts();
    return hosts[hosts.length - 1]!;
  }

  it("marks a badge built on embedded config and config-tier FX", () => {
    const host = attach({ configSource: "embedded", ratesSource: "config" });
    expect(host.hasAttribute("data-degraded")).toBe(true);
    const title = host.getAttribute("title") ?? "";
    expect(title).toContain("встроенные тарифы");
    expect(title).toContain("курс");
    expect(host.shadowRoot?.querySelector("[data-degraded]")?.textContent).toBe(
      "~",
    );
    // The value the rest of the widget reads stays exactly the total.
    expect(host.shadowRoot?.querySelector("span")?.textContent).toBe(
      "≈ 1 701 437 ₽",
    );
  });

  it("marks cache-tier FX as degraded as well", () => {
    const host = attach({ configSource: "remote", ratesSource: "cache" });
    expect(host.hasAttribute("data-degraded")).toBe(true);
    expect(host.getAttribute("title") ?? "").toContain("курс");
  });

  it("stays unmarked for fresh config + CBR rates, and without provenance", () => {
    const fresh = attach({ configSource: "remote", ratesSource: "cbr" });
    expect(fresh.hasAttribute("data-degraded")).toBe(false);
    expect(fresh.getAttribute("title")).toBeNull();

    const unknown = attach();
    expect(unknown.hasAttribute("data-degraded")).toBe(false);
    expect(unknown.getAttribute("title")).toBeNull();
  });

  it("marks the detail control when the config is embedded", () => {
    const embedded = attachDirect(REMOTE_CONFIG, 10_000_000, "embedded");
    const toggle = toggleOf(embedded);
    expect(toggle.querySelector("[data-degraded]")?.textContent).toBe("~");
    expect(toggle.getAttribute("title") ?? "").toContain("встроенные тарифы");
    embedded.remove();

    const remote = attachDirect(REMOTE_CONFIG, 10_000_000, "remote");
    expect(toggleOf(remote).querySelector("[data-degraded]")).toBeNull();
  });
});

describe("badge total (R1)", () => {
  /** Attaches a badge to a fresh element and returns its rendered text. */
  function badgeLabel(allIn: BadgeTotal): string {
    const el = document.createElement("span");
    document.body.appendChild(el);
    attachBadge({ element: el, krw: 6_590_000 }, allIn);
    const hosts = badgeHosts();
    const host = hosts[hosts.length - 1];
    return host?.shadowRoot?.querySelector("span")?.textContent ?? "";
  }

  it("shows the all-in total, marked according to its precision", () => {
    expect(badgeLabel({ totalRub: 1_701_437, precision: "exact" })).toBe(
      "1 701 437 ₽",
    );
    expect(badgeLabel({ totalRub: 1_701_437, precision: "approx" })).toBe(
      "≈ 1 701 437 ₽",
    );
    // An "onRequest" total covers known items only — showing it would
    // understate the price, so the badge says "по запросу" instead.
    expect(badgeLabel({ totalRub: 620_000, precision: "onRequest" })).toBe(
      "по запросу",
    );
  });

  it("renders a partial sum as a lower bound: 'от N ₽', never '≈'", () => {
    // Some cost items are not determinable yet, so the sum can only grow:
    // "≈" would claim the number can also come out lower.
    const text = badgeLabel({ totalRub: 1_701_437, precision: "partial" });
    expect(text).toBe("от 1 701 437 ₽");
    expect(text).not.toContain("≈");
  });

  it("still refuses to print a non-finite partial total", () => {
    expect(badgeLabel({ totalRub: Number.NaN, precision: "partial" })).toBe(
      "по запросу",
    );
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

  it("percent-encodes the messenger address (P3)", () => {
    // A hand-edited config with a stray ?/#/ must not rewrite the link.
    const link = buildOrderLink(
      { type: "telegram", address: "importer?bad#x/y" },
      URL_IN_TEST,
      TITLE,
    );
    expect(link).toBe(
      `https://t.me/importer%3Fbad%23x%2Fy?text=${encodeURIComponent(TEXT)}`,
    );
    // Exactly one query string, and it is ours.
    expect(link.indexOf("?")).toBe(link.indexOf("?text="));
    expect(link).not.toContain("#x");
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
    // (2016/09, 2199cc diesel, 118 months old -> y5plus): + duty
    // 4.8*2199*90 = 949,968 + clearance 2,462 -> 1,314,880. The recycling fee
    // dashes (a card publishes no engine power) and shipping / sbkts / broker
    // / commission are "unknown" items, so the total is a floor.
    expect(rowValue(host, "lot")).toBe("362 450 ₽");
    expect(rowValue(host, "total")).toBe("от 1 314 880 ₽");
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
