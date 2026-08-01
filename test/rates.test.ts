// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RATES_CACHE_KEY,
  resolveRates,
  type ResolvedRates,
} from "../src/rates/cbr";
import { DEFAULT_CONFIG, type WidgetConfig } from "../src/config.default";
import { attachBreakdown, BREAKDOWN_ATTR } from "../src/ui/breakdown";
import { init } from "../src/main";

function readFixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

const CARD_HTML = readFixture("card-fem.html");

const TEST_CONFIG_URL = "https://config.test/config.json";
const TEST_RATES_URL = "https://rates.test/daily_json.js";

/** Reference rates anchor the ±30% plausibility check (KTD2). */
const TEST_CONFIG: WidgetConfig = {
  version: 1,
  messenger: { type: "telegram", address: "importer" },
  currency: {
    referenceRates: { KRW_RUB: 0.055, EUR_RUB: 90 },
    updatedAt: "2026-07-15",
  },
  costItems: [
    { id: "shipping", label: "Доставка", kind: "fixed", value: 100000 },
  ],
  customs: DEFAULT_CONFIG.customs,
  commissionNote: "Заметка.",
};

/** Local calendar day, mirroring the cache-validity clock of the module. */
function localISO(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

interface CbrPayloadOptions {
  krwValue?: number;
  eurValue?: number;
  dateISO?: string;
}

/** Mirror payload shape: KRW is quoted per 1000 units (Nominal 1000). */
function cbrPayload(options: CbrPayloadOptions = {}): unknown {
  const {
    krwValue = 55.5,
    eurValue = 91.2,
    dateISO = localISO(new Date()),
  } = options;
  return {
    Date: `${dateISO}T11:30:00+03:00`,
    Valute: {
      KRW: { CharCode: "KRW", Nominal: 1000, Value: krwValue },
      EUR: { CharCode: "EUR", Nominal: 1, Value: eurValue },
    },
  };
}

function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

function stubRatesFetchOk(payload: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(okResponse(payload));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubRatesFetchFail(): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockRejectedValue(new TypeError("network down"));
  vi.stubGlobal("fetch", mock);
  return mock;
}

interface SeedCacheOptions {
  krwRub?: number;
  eurRub?: number;
  dateISO?: string;
  storedISO?: string;
}

function seedCache(options: SeedCacheOptions = {}): void {
  const {
    krwRub = 0.056,
    eurRub = 89,
    dateISO = "2026-07-31",
    storedISO = localISO(new Date()),
  } = options;
  localStorage.setItem(
    RATES_CACHE_KEY,
    JSON.stringify({ rates: { krwRub, eurRub }, dateISO, source: "cbr", storedISO }),
  );
}

/** Attaches a breakdown with explicit resolved rates to a synthetic element. */
function attachWithRates(rates: ResolvedRates): HTMLElement {
  const el = document.createElement("span");
  el.setAttribute("data-intl-currency-amount", "6590000");
  document.body.appendChild(el);
  attachBreakdown(
    { element: el, krw: 6_590_000 },
    { config: TEST_CONFIG, source: "remote" },
    rates,
  );
  const host = document.querySelector<HTMLElement>(`[${BREAKDOWN_ATTR}]`);
  if (!host) throw new Error("breakdown was not attached");
  return host;
}

function panelOf(host: HTMLElement): HTMLElement {
  const panel = host.shadowRoot?.querySelector<HTMLElement>("[data-panel]");
  if (!panel) throw new Error("panel not found");
  return panel;
}

beforeEach(() => {
  window.__encarRuRatesUrl = TEST_RATES_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  delete window.__encarRuRatesUrl;
  delete window.__encarRuConfigUrl;
  delete window.__encarRu;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("resolveRates: mirror tier", () => {
  it("resolves cbr rates with the payload date and writes the cache", async () => {
    const today = localISO(new Date());
    const mock = stubRatesFetchOk(cbrPayload({ dateISO: today }));

    const rates = await resolveRates(TEST_CONFIG);

    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0]![0]).toBe(TEST_RATES_URL);
    expect(rates.source).toBe("cbr");
    expect(rates.dateISO).toBe(today);
    expect(rates.krwRub).toBeCloseTo(0.0555, 10);
    expect(rates.eurRub).toBeCloseTo(91.2, 10);

    const raw = localStorage.getItem(RATES_CACHE_KEY);
    expect(raw).not.toBeNull();
    const cached = JSON.parse(raw!) as {
      rates: { krwRub: number; eurRub: number };
      dateISO: string;
      source: string;
      storedISO: string;
    };
    expect(cached.rates.krwRub).toBeCloseTo(0.0555, 10);
    expect(cached.rates.eurRub).toBeCloseTo(91.2, 10);
    expect(cached.dateISO).toBe(today);
    expect(cached.source).toBe("cbr");
    expect(cached.storedISO).toBe(today);
  });

  it("normalizes the per-1000 KRW quote to RUB per 1 KRW", async () => {
    stubRatesFetchOk(cbrPayload({ krwValue: 66.0 }));
    const rates = await resolveRates(TEST_CONFIG);
    expect(rates.krwRub).toBeCloseTo(0.066, 10);
  });

  it("exposes the payload date as-is (weekend: last published rate)", async () => {
    stubRatesFetchOk(cbrPayload({ dateISO: "2026-07-31" }));
    const rates = await resolveRates(TEST_CONFIG);
    expect(rates.source).toBe("cbr");
    expect(rates.dateISO).toBe("2026-07-31");
  });

  it("aborts a hung mirror fetch after 3s and falls back", async () => {
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
    seedCache();

    const pending = resolveRates(TEST_CONFIG);
    await vi.advanceTimersByTimeAsync(3000);
    const rates = await pending;
    expect(rates.source).toBe("cache");
  });
});

describe("resolveRates: plausibility validation (KTD2)", () => {
  it("rejects a KRW rate deviating >30% from the reference and uses the cache", async () => {
    // 0.2 RUB/KRW vs reference 0.055 -> far beyond ±30%.
    stubRatesFetchOk(cbrPayload({ krwValue: 200 }));
    seedCache({ krwRub: 0.056, dateISO: "2026-07-31" });

    const rates = await resolveRates(TEST_CONFIG);
    expect(rates.source).toBe("cache");
    expect(rates.krwRub).toBeCloseTo(0.056, 10);
    expect(rates.dateISO).toBe("2026-07-31");

    // The anomalous response must never overwrite the cache.
    const cached = JSON.parse(localStorage.getItem(RATES_CACHE_KEY)!) as {
      rates: { krwRub: number };
    };
    expect(cached.rates.krwRub).toBeCloseTo(0.056, 10);
  });

  it("rejects an anomalous EUR rate and falls through to config", async () => {
    // EUR 200 vs reference 90 -> invalid; no cache -> config tier.
    stubRatesFetchOk(cbrPayload({ eurValue: 200 }));
    const rates = await resolveRates(TEST_CONFIG);
    expect(rates.source).toBe("config");
  });
});

describe("resolveRates: cache and config tiers", () => {
  it("uses a same-day cache with its own date when the mirror is down", async () => {
    stubRatesFetchFail();
    seedCache({ krwRub: 0.056, eurRub: 89, dateISO: "2026-07-31" });

    const rates = await resolveRates(TEST_CONFIG);
    expect(rates).toEqual({
      krwRub: 0.056,
      eurRub: 89,
      dateISO: "2026-07-31",
      source: "cache",
    });
  });

  it("ignores a cache from a previous calendar day", async () => {
    stubRatesFetchFail();
    const yesterday = localISO(new Date(Date.now() - 24 * 60 * 60 * 1000));
    seedCache({ storedISO: yesterday });

    const rates = await resolveRates(TEST_CONFIG);
    expect(rates.source).toBe("config");
  });

  it("ignores a malformed cache entry", async () => {
    stubRatesFetchFail();
    localStorage.setItem(RATES_CACHE_KEY, "{not json");
    const rates = await resolveRates(TEST_CONFIG);
    expect(rates.source).toBe("config");
  });

  it("falls back to config reference rates with the config date", async () => {
    stubRatesFetchFail();
    const rates = await resolveRates(TEST_CONFIG);
    expect(rates).toEqual({
      krwRub: 0.055,
      eurRub: 90,
      dateISO: "2026-07-15",
      source: "config",
    });
  });
});

describe("breakdown rate annotations", () => {
  it('always shows the rate date line "Курс ЦБ РФ на <date>"', () => {
    const host = attachWithRates({
      krwRub: 0.0555,
      eurRub: 91.2,
      dateISO: "2026-07-31",
      source: "cbr",
    });
    const line = panelOf(host).querySelector("[data-rate-date]");
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain("Курс ЦБ РФ на 2026-07-31");
    expect(panelOf(host).querySelector("[data-preliminary-rate]")).toBeNull();
  });

  it("marks config-tier rates as preliminary after full fallback", async () => {
    stubRatesFetchFail();
    const rates = await resolveRates(TEST_CONFIG);
    expect(rates.source).toBe("config");

    const host = attachWithRates(rates);
    const marker = panelOf(host).querySelector("[data-preliminary-rate]");
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toContain("Курс предварительный");
    expect(marker!.textContent).toContain("2026-07-15");
    // The rate date line is still present.
    expect(
      panelOf(host).querySelector("[data-rate-date]")!.textContent,
    ).toContain("2026-07-15");
  });

  it("converts the lot price with the resolved rate, not the config reference", () => {
    const host = attachWithRates({
      krwRub: 0.06,
      eurRub: 91.2,
      dateISO: "2026-07-31",
      source: "cbr",
    });
    const lotValue = panelOf(host)
      .querySelector('[data-item-id="lot"] [data-value]')!
      .textContent;
    // 6,590,000 KRW * 0.06 = 395,400 (reference 0.055 would give 362,450).
    expect(lotValue).toBe("395 400 ₽");
  });
});

describe("async gate: no RUB before rates resolve", () => {
  it("renders no badge value until the mirror answers", async () => {
    window.__encarRuConfigUrl = TEST_CONFIG_URL;
    let releaseRates: (() => void) | null = null;
    const mock = vi.fn((url: string) => {
      if (url === TEST_CONFIG_URL) {
        return Promise.resolve(okResponse(TEST_CONFIG));
      }
      return new Promise<Response>((resolveFetch) => {
        releaseRates = () => resolveFetch(okResponse(cbrPayload()));
      });
    });
    vi.stubGlobal("fetch", mock);

    const parsed = new DOMParser().parseFromString(CARD_HTML, "text/html");
    document.body.innerHTML = parsed.body.innerHTML;
    // Card pages are detail URLs: full lot params, hence an exact total.
    window.history.replaceState(null, "", "/cars/detail/41756847");
    init();

    // Let the config fetch settle while the rates fetch stays pending.
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector("[data-encar-ru-badge]")).toBeNull();
    expect(releaseRates).not.toBeNull();

    releaseRates!();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-encar-ru-badge]")).not.toBeNull();
    });
    const badge = document.querySelector<HTMLElement>("[data-encar-ru-badge]")!;
    // The badge shows the all-in total at the resolved mirror rate:
    // lot 6,590,000 KRW * 0.0555 = 365,745 + shipping 100,000 (TEST_CONFIG
    // carries no customs formula item) = 465,745 RUB.
    expect(badge.shadowRoot?.querySelector("span")?.textContent).toBe(
      "465 745 ₽",
    );
  });
});
