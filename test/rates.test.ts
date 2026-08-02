// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RATES_CACHE_KEY,
  resolveRates,
  type ResolvedRates,
} from "../src/rates/cbr";
import { CONFIG_URL } from "../src/config";
import { DEFAULT_CONFIG, type WidgetConfig } from "../src/config.default";
import { attachBreakdown, BREAKDOWN_ATTR } from "../src/ui/breakdown";
import { init } from "../src/main";

function readFixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

const CARD_HTML = readFixture("card-fem.html");

const TEST_RATES_URL = "https://rates.test/daily_json.js";

/** Fixed clock: every anchor/cache window in the module is date-based. */
const NOW = new Date(2026, 7, 2, 12, 0, 0); // 2026-08-02

/** Recently edited reference rates anchor the ±30% plausibility check (KTD2). */
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

/**
 * Same rates, but edited by hand well over a year ago: the reference is no
 * longer evidence of what today's rate looks like, so it may not veto the
 * mirror (the "stale anchor rejects every correct rate forever" defect).
 */
const STALE_ANCHOR_CONFIG: WidgetConfig = {
  ...TEST_CONFIG,
  currency: {
    referenceRates: { KRW_RUB: 0.055, EUR_RUB: 90 },
    updatedAt: "2025-01-10",
  },
};

/** Every call passes the mirror URL explicitly — no dev globals ship (R-sec). */
function resolve_(config: WidgetConfig): Promise<ResolvedRates> {
  return resolveRates(config, TEST_RATES_URL);
}

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
  // Only Date is faked: the module's cache/anchor windows are date-based,
  // while the tests below still rely on real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  delete window.__encarRu;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("resolveRates: mirror tier", () => {
  it("resolves cbr rates with the payload date and writes the cache", async () => {
    const today = localISO(new Date());
    const mock = stubRatesFetchOk(cbrPayload({ dateISO: today }));

    const rates = await resolve_(TEST_CONFIG);

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
    const rates = await resolve_(TEST_CONFIG);
    expect(rates.krwRub).toBeCloseTo(0.066, 10);
  });

  it("exposes the payload date as-is (weekend: last published rate)", async () => {
    stubRatesFetchOk(cbrPayload({ dateISO: "2026-07-31" }));
    const rates = await resolve_(TEST_CONFIG);
    expect(rates.source).toBe("cbr");
    expect(rates.dateISO).toBe("2026-07-31");
  });

  it("aborts a hung mirror fetch after 3s and falls back", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
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

    const pending = resolve_(TEST_CONFIG);
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

    const rates = await resolve_(TEST_CONFIG);
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
    const rates = await resolve_(TEST_CONFIG);
    expect(rates.source).toBe("config");
  });

  it("marks a rejected mirror response distinctly from a plain fallback", async () => {
    stubRatesFetchOk(cbrPayload({ eurValue: 200 }));
    expect((await resolve_(TEST_CONFIG)).rejected).toBe(true);

    stubRatesFetchFail();
    // Network down is not a rejected rate: the UI must not cry "anomaly".
    expect((await resolve_(TEST_CONFIG)).rejected).toBeFalsy();

    stubRatesFetchOk(cbrPayload());
    expect((await resolve_(TEST_CONFIG)).rejected).toBeFalsy();
  });

  it("accepts a drifted CBR rate once the config anchor is stale", async () => {
    // The real KRW rate has drifted to 0.09 (+64% vs the year-old constant).
    // With the old logic every correct response was rejected forever and the
    // client kept computing from the stale 0.055.
    stubRatesFetchOk(cbrPayload({ krwValue: 90, eurValue: 140 }));
    const rates = await resolve_(STALE_ANCHOR_CONFIG);
    expect(rates.source).toBe("cbr");
    expect(rates.krwRub).toBeCloseTo(0.09, 10);
    expect(rates.eurRub).toBeCloseTo(140, 10);
  });

  it("still rejects absurd rates when no anchor can be trusted", async () => {
    // 200 RUB per KRW is not a drift, it is a broken payload.
    stubRatesFetchOk(cbrPayload({ krwValue: 200_000 }));
    const rates = await resolve_(STALE_ANCHOR_CONFIG);
    expect(rates.source).toBe("config");
    expect(rates.rejected).toBe(true);
  });

  it("anchors on the last accepted live rate, not on the config constant", async () => {
    // Live anchor 0.09 persisted 3 days ago; the config anchor is stale.
    seedCache({
      krwRub: 0.09,
      eurRub: 140,
      dateISO: "2026-07-30",
      storedISO: localISO(new Date(NOW.getTime() - 3 * 86_400_000)),
    });
    // 0.055 is within the absolute range but -39% off the live anchor.
    stubRatesFetchOk(cbrPayload({ krwValue: 55, eurValue: 140 }));
    const rates = await resolve_(STALE_ANCHOR_CONFIG);
    expect(rates.source).toBe("cache");
    expect(rates.rejected).toBe(true);
    expect(rates.krwRub).toBeCloseTo(0.09, 10);
  });
});

describe("resolveRates: cache and config tiers", () => {
  it("uses a same-day cache with its own date when the mirror is down", async () => {
    stubRatesFetchFail();
    seedCache({ krwRub: 0.056, eurRub: 89, dateISO: "2026-07-31" });

    const rates = await resolve_(TEST_CONFIG);
    expect(rates).toEqual({
      krwRub: 0.056,
      eurRub: 89,
      dateISO: "2026-07-31",
      source: "cache",
    });
  });

  it("prefers a days-old cached CBR rate over the config constant", async () => {
    // Yesterday's real rate beats a hand-edited constant (R-rates).
    stubRatesFetchFail();
    const yesterday = localISO(new Date(NOW.getTime() - 86_400_000));
    seedCache({ krwRub: 0.0575, dateISO: "2026-08-01", storedISO: yesterday });

    const rates = await resolve_(TEST_CONFIG);
    expect(rates.source).toBe("cache");
    expect(rates.krwRub).toBeCloseTo(0.0575, 10);
    expect(rates.dateISO).toBe("2026-08-01");
  });

  it("keeps a cached rate usable for a bounded window only", async () => {
    stubRatesFetchFail();
    const sixDaysAgo = localISO(new Date(NOW.getTime() - 6 * 86_400_000));
    seedCache({ storedISO: sixDaysAgo });
    expect((await resolve_(TEST_CONFIG)).source).toBe("cache");

    localStorage.clear();
    const longAgo = localISO(new Date(NOW.getTime() - 40 * 86_400_000));
    seedCache({ storedISO: longAgo });
    expect((await resolve_(TEST_CONFIG)).source).toBe("config");
  });

  it("ignores a malformed cache entry", async () => {
    stubRatesFetchFail();
    localStorage.setItem(RATES_CACHE_KEY, "{not json");
    const rates = await resolve_(TEST_CONFIG);
    expect(rates.source).toBe("config");
  });

  it("falls back to config reference rates with the config date", async () => {
    stubRatesFetchFail();
    const rates = await resolve_(TEST_CONFIG);
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
    const rates = await resolve_(TEST_CONFIG);
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

/** Polls with real timers (the Date mock must not drive the wait). */
async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("condition never became true");
}

describe("async gate: no RUB before rates resolve", () => {
  it("renders no badge value until the mirror answers", async () => {
    let releaseRates: (() => void) | null = null;
    const mock = vi.fn((url: string) => {
      // The production URLs are used: no dev override globals exist anymore.
      if (url === CONFIG_URL) {
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
    await until(
      () => document.querySelector("[data-encar-ru-badge]") !== null,
    );
    const badge = document.querySelector<HTMLElement>("[data-encar-ru-badge]")!;
    // The badge shows the all-in total at the resolved mirror rate:
    // lot 6,590,000 KRW * 0.0555 = 365,745 + shipping 100,000 (TEST_CONFIG
    // carries no customs formula item) = 465,745 RUB.
    expect(badge.shadowRoot?.querySelector("span")?.textContent).toBe(
      "465 745 ₽",
    );
  });
});
