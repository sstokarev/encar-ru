// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config";
import { DEFAULT_CONFIG, type WidgetConfig } from "../src/config.default";
import {
  attachBreakdown,
  computeBreakdown,
  isDetailPage,
  BREAKDOWN_ATTR,
} from "../src/ui/breakdown";
import { buildOrderLink } from "../src/ui/order-button";
import { init } from "../src/main";

function readFixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

const CARD_HTML = readFixture("card-fem.html");

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

function rowValue(host: HTMLElement, itemId: string): string {
  const row = panelOf(host).querySelector(`[data-item-id="${itemId}"]`);
  return row?.querySelector("[data-value]")?.textContent ?? "";
}

/** Attaches a breakdown to a synthetic detail-price element. */
function attachDirect(
  config: WidgetConfig,
  krw: number,
  source: "remote" | "embedded" = "remote",
): HTMLElement {
  const el = document.createElement("span");
  el.setAttribute("data-intl-currency-amount", String(krw));
  document.body.appendChild(el);
  attachBreakdown({ element: el, krw }, { config, source });
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
      { id: "duty", label: "Пошлина", kind: "formula", value: "duty_v1" },
    ],
    commissionNote: "Заметка.",
  };
  // 10,000,000 KRW * 0.05 = 500,000 lot; +100,000 fixed; +10% = 50,000
  const KRW = 10_000_000;

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

  it("lists cost items and total matching the config", () => {
    const model = computeBreakdown(CLEAN_CONFIG, KRW);
    expect(model.lotRub).toBe(500_000);
    expect(model.totalRub).toBe(650_000);

    const host = attachDirect(CLEAN_CONFIG, KRW);
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
      "total",
    ]);
    expect(rowValue(host, "lot")).toBe("500 000 ₽");
    expect(rowValue(host, "shipping")).toBe("100 000 ₽");
    expect(rowValue(host, "commission")).toBe("50 000 ₽");
    expect(rowValue(host, "total")).toBe("650 000 ₽");
    // Formula items are honest placeholders at the mock stage (KTD7).
    expect(rowValue(host, "duty")).not.toMatch(/₽/);
  });

  it("keeps the breakdown host untranslatable and idempotent", () => {
    const host = attachDirect(CLEAN_CONFIG, KRW);
    expect(host.getAttribute("translate")).toBe("no");
    expect(host.classList.contains("notranslate")).toBe(true);

    const el = host.parentElement!;
    attachBreakdown(
      { element: el, krw: KRW },
      { config: CLEAN_CONFIG, source: "remote" },
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
    // 6,590,000 KRW * 0.05 = 329,500 lot; +100,000 shipping = 429,500
    expect(rowValue(host, "lot")).toBe("329 500 ₽");
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
    // DEFAULT_CONFIG: lot 6,590,000*0.055=362,450; +120,000+85,000; +5%=18,123
    expect(rowValue(host, "lot")).toBe("362 450 ₽");
    expect(rowValue(host, "total")).toBe("585 573 ₽");
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
