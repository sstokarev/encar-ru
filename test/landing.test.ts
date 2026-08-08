// @vitest-environment jsdom
/**
 * The landing page (site/landing.html) as it actually ships.
 *
 * Unlike test/page.test.ts, which drives a synthetic DOM, this suite reads the
 * real HTML file off disk. That is the point: the page carries no JavaScript of
 * its own — it works only because its markup matches what initCalcPage queries
 * and because site/calc.js is loaded. A silent drift in either (a renamed data
 * attribute, a form moved out of the page) would leave a live page that simply
 * does nothing, and no other test would notice.
 *
 * The copy assertions pin the operator's decisions of 2026-08-08
 * (docs/brainstorms/2026-08-08-landing-requirements.md), including what the
 * page must NOT claim about the importer.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import type { LoadedConfig } from "../src/config";
import { DEFAULT_CONFIG } from "../src/config.default";
import type { ResolvedRates } from "../src/rates/cbr";
import type { CarData } from "../src/encar/types";
import { initCalcPage, type PageDeps } from "../src/page/main";

// resolve() from the repo root, not import.meta.url: under the jsdom
// environment import.meta.url is not a file: URL and readFileSync rejects it.
const LANDING_HTML = readFileSync(resolve("site/landing.html"), "utf8");

const FIXTURE_CAR: CarData = {
  vehicleId: "42217972",
  title: "Kia Sorento 2.2 Diesel",
  priceKrw: 25_900_000,
  yearMonth: "202109",
  mileageKm: 48_210,
  displacementCc: 2151,
  fuelName: "디젤",
  transmissionName: "오토",
  colorName: "흰색",
  seatCount: 5,
  bodyName: "SUV",
  photoUrls: ["data:image/svg+xml,a", "data:image/svg+xml,b"],
  vin: null,
};

const LOT_URL = "https://fem.encar.com/cars/detail/42217972";

const RATES: ResolvedRates = {
  krwRub: 0.05,
  eurRub: 100,
  dateISO: "2026-08-08",
  source: "cbr",
};

/** The shipped file parsed as a document — head included, scripts inert. */
function parsedPage(): Document {
  return new DOMParser().parseFromString(LANDING_HTML, "text/html");
}

interface SetupOptions {
  failFetch?: boolean;
}

/** Mounts the shipped body into jsdom and binds the calculator to it. */
function setup(options: SetupOptions = {}): {
  submit: (url: string) => Promise<void>;
  result: HTMLElement;
  fetchCalls: string[];
} {
  document.body.innerHTML = parsedPage().body.innerHTML;

  const fetchCalls: string[] = [];
  const deps: PageDeps = {
    parseListingUrl: (url) => /\/cars\/detail\/(\d+)/.exec(url)?.[1] ?? null,
    fetchCar: (vehicleId) => {
      fetchCalls.push(vehicleId);
      return options.failFetch === true
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(FIXTURE_CAR);
    },
    loadConfig: (): Promise<LoadedConfig> =>
      Promise.resolve({ config: DEFAULT_CONFIG, source: "remote" }),
    resolveRates: () => Promise.resolve(RATES),
    demo: false,
  };
  initCalcPage(document, deps);

  const form = document.querySelector<HTMLFormElement>("[data-calc-form]");
  const input = document.querySelector<HTMLInputElement>("[data-calc-url]");
  const result = document.querySelector<HTMLElement>("[data-calc-result]");
  if (form === null || input === null || result === null) {
    throw new Error("landing.html is missing the calculator markup");
  }

  return {
    result,
    fetchCalls,
    submit: async (url: string) => {
      input.value = url;
      form.dispatchEvent(new Event("submit", { cancelable: true }));
      // Two microtask-chained awaits inside the handler; drain generously.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("landing page markup", () => {
  it("carries every selector initCalcPage binds to", () => {
    const page = parsedPage();
    for (const selector of [
      "[data-calc-form]",
      "[data-calc-url]",
      "[data-calc-submit]",
      "[data-calc-result]",
    ]) {
      expect(page.querySelector(selector), selector).not.toBeNull();
    }
  });

  it("loads the calculator bundle", () => {
    const script = parsedPage().querySelector("script[src]");
    expect(script?.getAttribute("src")).toBe("calc.js");
  });

  it("is phone-first: viewport meta and no fixed-width layout", () => {
    const page = parsedPage();
    const viewport = page.querySelector('meta[name="viewport"]');
    expect(viewport?.getAttribute("content")).toContain("width=device-width");
  });

  it("keeps the form above the result and the prose below it", () => {
    const page = parsedPage();
    const form = page.querySelector("[data-calc-form]");
    const result = page.querySelector("[data-calc-result]");
    const prose = page.querySelector("section");
    expect(form).not.toBeNull();
    expect(result).not.toBeNull();
    expect(prose).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING === 4: the argument comes later in the tree.
    expect(form?.compareDocumentPosition(result as Node)).toBe(4);
    expect(result?.compareDocumentPosition(prose as Node)).toBe(4);
  });
});

describe("landing page copy", () => {
  const text = (): string =>
    parsedPage().body.textContent?.replace(/\s+/gu, " ") ?? "";

  it("names СБКТС and ЭПТС among what the price already covers", () => {
    expect(text()).toContain("СБКТС и ЭПТС, наша комиссия");
  });

  it("draws the boundary at delivery and registration", () => {
    const body = text();
    expect(body).toContain("довезти машину до вашего города");
    expect(body).toContain("не входит в сумму");
  });

  it("explains the prefilled draft and signs with the importer's name", () => {
    const body = text();
    expect(body).toContain("подставятся в сообщение сами");
    expect(body).toContain("GlobalCarTrade");
  });

  it("claims nothing unverifiable about the importer", () => {
    const body = text();
    for (const claim of ["ИНН", "ООО", "лет на рынке", "машин привезли"]) {
      expect(body, claim).not.toContain(claim);
    }
    // No car-count or founding-year boasts: any bare 4-digit year or a
    // "500 машин"-shaped claim would be a credential the page cannot back.
    expect(body).not.toMatch(/\b(?:19|20)\d{2}\s*год/u);
    expect(body).not.toMatch(/\d+\s*(?:машин|автомобил)/u);
  });

  it("offers Telegram before any calculation happens", () => {
    const link = parsedPage().querySelector<HTMLAnchorElement>(
      'a[href*="t.me/"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("Telegram");
  });

  it("keeps the footer address in step with the config it duplicates", () => {
    // The footer link fires before any config load, so its address is written
    // into the HTML. That copy can drift: this pins it to the shipped config
    // so a changed handle cannot leave cold traffic on a dead one.
    const site = JSON.parse(
      readFileSync(resolve("site/config.json"), "utf8"),
    ) as { messenger: { address: string } };
    const href = parsedPage()
      .querySelector<HTMLAnchorElement>('a[href*="t.me/"]')
      ?.getAttribute("href");
    expect(href).toBe(`https://t.me/${site.messenger.address}`);
    expect(site.messenger.address).toBe(DEFAULT_CONFIG.messenger.address);
  });

  it("mentions every cost line the config prices", () => {
    // The prose claims the total is all-in. If a cost item is ever added to
    // the config, this fails until the paragraph names it too — the page must
    // not quietly stop describing something the client is charged for.
    const site = JSON.parse(
      readFileSync(resolve("site/config.json"), "utf8"),
    ) as { costItems: { id: string }[] };
    const wordFor: Readonly<Record<string, string>> = {
      // "korea" is what task/importer-pricing renamed "shipping" to when the
      // freight became a WON-priced item. The COPY already says «фрахт» — only
      // this map needed the new id.
      korea: "фрахт",
      shipping: "фрахт",
      customs: "пошлина",
      sbkts: "СБКТС",
      broker: "брокер",
      commission: "комиссия",
    };
    const body = text().toLowerCase();
    for (const item of site.costItems) {
      const word = wordFor[item.id];
      expect(word, `no landing copy pinned for cost item "${item.id}"`)
        .toBeDefined();
      expect(body, item.id).toContain((word as string).toLowerCase());
    }
  });
});

describe("landing page calculator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the full quote and a draft carrying the lot URL", async () => {
    const { submit, result, fetchCalls } = setup();
    await submit(LOT_URL);

    expect(fetchCalls).toEqual(["42217972"]);
    expect(result.querySelector("[data-title]")?.textContent).toContain(
      "Kia Sorento",
    );
    expect(result.querySelector("[data-cost-table]")).not.toBeNull();
    expect(result.querySelector('[data-row="total"]')).not.toBeNull();

    const draft = result.querySelector<HTMLAnchorElement>(
      "[data-messenger-button]",
    );
    expect(draft?.getAttribute("href")).toContain("t.me/");
    // tg-link.ts encodes the whole draft in one pass, so the lot URL appears
    // percent-encoded inside the text parameter.
    expect(draft?.getAttribute("href")).toContain(encodeURIComponent(LOT_URL));
  });

  it("rejects a non-encar link without touching the network", async () => {
    const { submit, result, fetchCalls } = setup();
    await submit("не ссылка");

    expect(fetchCalls).toEqual([]);
    expect(result.querySelector("[data-error]")?.textContent).toContain(
      "encar.com",
    );
  });

  it("shows an error card instead of an empty result when the fetch fails", async () => {
    const { submit, result } = setup({ failFetch: true });
    await submit(LOT_URL);

    expect(result.querySelector("[data-error]")).not.toBeNull();
    expect(result.querySelector("[data-result]")).toBeNull();
  });
});
