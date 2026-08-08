// @vitest-environment jsdom
/**
 * U4: the calc page end to end on jsdom — paste a URL, see photos, specs,
 * the cost table with the widget's dash/precision semantics, provenance
 * notes and the messenger draft button. Adapter, config and rates are
 * injected; no network.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { LoadedConfig } from "../src/config";
import { DEFAULT_CONFIG } from "../src/config.default";
import type { ResolvedRates } from "../src/rates/cbr";
import type { CarData } from "../src/encar/types";
import { initCalcPage, type PageDeps } from "../src/page/main";

const FIXTURE_CAR: CarData = {
  vehicleId: "41756847",
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

const LOT_URL = "https://fem.encar.com/cars/detail/41756847";

const RATES: ResolvedRates = {
  krwRub: 0.05,
  eurRub: 100,
  dateISO: "2026-08-08",
  source: "cbr",
};

function loadedConfig(source: LoadedConfig["source"] = "remote"): LoadedConfig {
  return { config: DEFAULT_CONFIG, source };
}

function pageDom(): Document {
  document.body.innerHTML = `
    <form data-calc-form>
      <input data-calc-url type="url">
      <button data-calc-submit type="submit">Рассчитать</button>
    </form>
    <div data-calc-result></div>
  `;
  return document;
}

interface SetupOptions {
  car?: CarData;
  failFetch?: boolean;
  source?: LoadedConfig["source"];
  rates?: ResolvedRates;
  demo?: boolean;
}

function setup(options: SetupOptions = {}): {
  doc: Document;
  submit: (url: string) => Promise<void>;
  result: HTMLElement;
  fetchCalls: string[];
} {
  const doc = pageDom();
  const fetchCalls: string[] = [];
  const deps: PageDeps = {
    parseListingUrl: (url) => {
      const match = /\/cars\/detail\/(\d+)/.exec(url);
      return match?.[1] ?? null;
    },
    fetchCar: (vehicleId) => {
      fetchCalls.push(vehicleId);
      return options.failFetch === true
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(options.car ?? FIXTURE_CAR);
    },
    loadConfig: () => Promise.resolve(loadedConfig(options.source)),
    resolveRates: () => Promise.resolve(options.rates ?? RATES),
    demo: options.demo ?? false,
  };
  initCalcPage(doc, deps);
  const input = doc.querySelector<HTMLInputElement>("[data-calc-url]");
  const form = doc.querySelector<HTMLFormElement>("[data-calc-form]");
  const result = doc.querySelector<HTMLElement>("[data-calc-result]");
  if (input === null || form === null || result === null) {
    throw new Error("page dom incomplete");
  }
  return {
    doc,
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

describe("calc page", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders photos, specs, the cost table and the draft button (accepts flow)", async () => {
    const { result, submit } = await Promise.resolve(setup());
    await submit(LOT_URL);

    expect(result.querySelector("[data-photo-main]")).not.toBeNull();
    expect(result.querySelectorAll("[data-photo-thumb]").length).toBe(1);
    expect(result.querySelector("[data-title]")?.textContent).toContain(
      "Sorento",
    );

    const specs = result.querySelector("[data-specs]")?.textContent ?? "";
    expect(specs).toContain("09.2021");
    expect(specs).toContain("48 210 км");
    expect(specs).toContain("2 151 см³");
    expect(specs).toContain("дизель");
    expect(specs).toContain("автомат");

    // Real engine, real default config: lot + duty + clearance computed,
    // recycling dashed (no power in the data) -> the total is a floor.
    const table = result.querySelector("[data-cost-table]");
    expect(table?.getAttribute("data-precision")).toBe("partial");
    const rowText = (id: string): string =>
      table?.querySelector(`[data-item-id="${id}"]`)?.textContent ?? "";
    expect(rowText("lot")).toContain("₽");
    expect(rowText("duty")).toContain("₽");
    expect(rowText("recycling")).toContain("—");
    expect(rowText("clearance")).toContain("₽");
    const total = table?.querySelector('[data-row="total"]')?.textContent ?? "";
    expect(total).toContain("от ");
    expect(total).toContain("₽");

    const anchor = result.querySelector<HTMLAnchorElement>(
      "[data-messenger-button]",
    );
    expect(anchor).not.toBeNull();
    expect(anchor?.target).toBe("_blank");
    expect(anchor?.rel).toContain("noopener");
    const draft = new URL(anchor?.href ?? "").searchParams.get("text") ?? "";
    expect(draft).toContain(LOT_URL);
    expect(draft).toContain("от ");
    expect(result.querySelector("[data-rate-date]")?.textContent).toContain(
      "2026-08-08",
    );
  });

  it("shows an inline error and fetches nothing for an unrecognizable URL", async () => {
    const { result, submit, fetchCalls } = setup();
    await submit("https://example.com/whatever");
    expect(result.querySelector("[data-error]")).not.toBeNull();
    expect(result.querySelector("[data-result]")).toBeNull();
    expect(fetchCalls.length).toBe(0);
  });

  it("replaces a previous result with an error card when the fetch fails", async () => {
    const first = setup();
    await first.submit(LOT_URL);
    expect(first.result.querySelector("[data-result]")).not.toBeNull();

    const second = setup({ failFetch: true });
    await second.submit(LOT_URL);
    expect(second.result.querySelector("[data-error]")).not.toBeNull();
    expect(second.result.querySelector("[data-result]")).toBeNull();
  });

  it("renders the on-request marker for an EV (no numeric total)", async () => {
    const { result, submit } = setup({
      car: { ...FIXTURE_CAR, fuelName: "전기", displacementCc: null },
    });
    await submit(LOT_URL);
    const total =
      result.querySelector('[data-row="total"]')?.textContent ?? "";
    expect(total).toContain("расчёт по запросу");
    expect(total).not.toContain("₽");
  });

  it("marks embedded config and demo data visibly", async () => {
    const { result, submit } = setup({ source: "embedded", demo: true });
    await submit(LOT_URL);
    expect(result.querySelector("[data-embedded-marker]")).not.toBeNull();
    expect(result.querySelector("[data-demo-banner]")).not.toBeNull();
  });

  it("replaces the first result on a second submit instead of appending", async () => {
    const { result, submit } = setup();
    await submit(LOT_URL);
    await submit(LOT_URL);
    expect(result.querySelectorAll("[data-result]").length).toBe(1);
  });
});
