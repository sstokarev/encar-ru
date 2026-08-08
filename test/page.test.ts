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

function pageDom(): Document {
  document.body.innerHTML = `
    <form data-calc-form>
      <input data-calc-url type="url">
      <input data-calc-power type="number">
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
  config?: LoadedConfig["config"];
  /** Overrides fetchCar entirely (deferred-promise tests). */
  fetchImpl?: (vehicleId: string) => Promise<CarData>;
}

function setup(options: SetupOptions = {}): {
  doc: Document;
  submit: (url: string) => Promise<void>;
  submitNoWait: (url: string) => void;
  drain: () => Promise<void>;
  result: HTMLElement;
  button: HTMLButtonElement;
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
      if (options.fetchImpl !== undefined) return options.fetchImpl(vehicleId);
      return options.failFetch === true
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(options.car ?? FIXTURE_CAR);
    },
    loadConfig: () =>
      Promise.resolve({
        config: options.config ?? DEFAULT_CONFIG,
        source: options.source ?? "remote",
      }),
    resolveRates: () => Promise.resolve(options.rates ?? RATES),
    demo: options.demo ?? false,
  };
  initCalcPage(doc, deps);
  const input = doc.querySelector<HTMLInputElement>("[data-calc-url]");
  const form = doc.querySelector<HTMLFormElement>("[data-calc-form]");
  const result = doc.querySelector<HTMLElement>("[data-calc-result]");
  const button = doc.querySelector<HTMLButtonElement>("[data-calc-submit]");
  if (input === null || form === null || result === null || button === null) {
    throw new Error("page dom incomplete");
  }
  const power = doc.querySelector<HTMLInputElement>("[data-calc-power]");
  const submitNoWait = (url: string, powerHp = ""): void => {
    input.value = url;
    if (power !== null) power.value = powerHp;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
  };
  const drain = async (): Promise<void> => {
    // Two microtask-chained awaits inside the handler; drain generously.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    doc,
    result,
    button,
    fetchCalls,
    submitNoWait,
    drain,
    submit: async (url: string, powerHp = "") => {
      submitNoWait(url, powerHp);
      await drain();
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

  it("shows the loading card and disables the button while in flight", async () => {
    let release: (car: CarData) => void = () => {};
    const { result, button, submitNoWait, drain } = setup({
      fetchImpl: () => new Promise((resolve) => (release = resolve)),
    });
    submitNoWait(LOT_URL);
    expect(button.disabled).toBe(true);
    expect(result.hasAttribute("data-loading")).toBe(true);
    expect(result.querySelector("[data-loading-card]")).not.toBeNull();
    release(FIXTURE_CAR);
    await drain();
    expect(button.disabled).toBe(false);
    expect(result.hasAttribute("data-loading")).toBe(false);
    expect(result.querySelector("[data-loading-card]")).toBeNull();
    expect(result.querySelector("[data-result]")).not.toBeNull();
  });

  it("discards a stale response that resolves after a newer submit", async () => {
    const pending: Array<(car: CarData) => void> = [];
    const { result, button, submitNoWait, drain } = setup({
      fetchImpl: () => new Promise((resolve) => pending.push(resolve)),
    });
    submitNoWait(LOT_URL);
    // A second submit while the first hangs (programmatic path: the disabled
    // button does not stop dispatched submit events).
    submitNoWait(LOT_URL);
    const [first, second] = pending;
    if (first === undefined || second === undefined) throw new Error("no fetches");
    second({ ...FIXTURE_CAR, title: "Newer Car" });
    await drain();
    expect(result.querySelector("[data-title]")?.textContent).toBe("Newer Car");
    // The stale first response must not overwrite the newer render.
    first({ ...FIXTURE_CAR, title: "Stale Car" });
    await drain();
    expect(result.querySelector("[data-title]")?.textContent).toBe("Newer Car");
    expect(button.disabled).toBe(false);
  });

  it("renders the preliminary-rate and rejected-rate provenance notes", async () => {
    const { result, submit } = setup({
      rates: { ...RATES, source: "config", rejected: true },
    });
    await submit(LOT_URL);
    expect(result.querySelector("[data-preliminary-rate]")?.textContent).toContain(
      "2026-08-08",
    );
    expect(result.querySelector("[data-rejected-rate]")).not.toBeNull();
  });

  it("skips the photo block, zero specs and dashes nothing extra for a sparse car", async () => {
    const { result, submit } = setup({
      car: { ...FIXTURE_CAR, photoUrls: [], displacementCc: 0, seatCount: 0 },
    });
    await submit(LOT_URL);
    expect(result.querySelector("[data-photos]")).toBeNull();
    const specs = result.querySelector("[data-specs]")?.textContent ?? "";
    expect(specs).not.toContain("0 см³");
    expect(specs).not.toContain("Мест");
  });

  it("removes a photo that fails to load", async () => {
    const { result, submit } = setup();
    await submit(LOT_URL);
    const thumb = result.querySelector("[data-photo-thumb]");
    expect(thumb).not.toBeNull();
    thumb?.dispatchEvent(new Event("error"));
    expect(result.querySelector("[data-photo-thumb]")).toBeNull();
    expect(
      result
        .querySelector("[data-photo-main]")
        ?.getAttribute("referrerpolicy"),
    ).toBe("no-referrer");
  });

  it("turns the dashed recycling line into a number when power is entered", async () => {
    // No public encar surface publishes engine power (docs/harness/
    // spike-power.md), so without this field the утильсбор line can only dash
    // and every quote is a floor. With it the page finally quotes a price.
    const { result, submit } = setup();
    await submit(LOT_URL, "150");
    const table = result.querySelector("[data-cost-table]");
    const rowText = (id: string): string =>
      table?.querySelector(`[data-item-id="${id}"]`)?.textContent ?? "";
    expect(rowText("recycling")).toContain("₽");
    expect(rowText("recycling")).not.toContain("—");
    // "approx", not "exact": this fixture registered 09.2021 sits within two
    // months of the 5-year duty cliff, and the unknown registration DAY can
    // still move it. What matters here is that it stopped being a FLOOR.
    expect(table?.getAttribute("data-precision")).toBe("approx");
    const total = table?.querySelector('[data-row="total"]')?.textContent ?? "";
    expect(total).toContain("≈");
    expect(total).not.toContain("от ");
  });

  it("leaves the line dashed when the field is left empty", async () => {
    // Empty is "not entered", never zero: a zero would read as a real power
    // and buy the 5 200 ₽ льгота for a car nobody measured.
    const { result, submit } = setup();
    await submit(LOT_URL, "");
    const table = result.querySelector("[data-cost-table]");
    expect(
      table?.querySelector('[data-item-id="recycling"]')?.textContent,
    ).toContain("—");
    expect(table?.getAttribute("data-precision")).toBe("partial");
  });

  it("refuses the quote when the entered power is impossible", async () => {
    // Supplied-but-impossible is not missing data: the engine's own R3 rule
    // takes such a lot to «по запросу» rather than quoting around it.
    const { result, submit } = setup();
    await submit(LOT_URL, "-150");
    const table = result.querySelector("[data-cost-table]");
    expect(table?.getAttribute("data-precision")).toBe("onRequest");
  });

  it("prices the Korean costs in WON, inside the customs value", async () => {
    const { result, submit } = setup();
    await submit(LOT_URL, "150");
    const table = result.querySelector("[data-cost-table]");
    const rowText = (id: string): string =>
      table?.querySelector(`[data-item-id="${id}"]`)?.textContent ?? "";
    // 25,900,000 KRW car and 2,500,000 KRW of Korean costs, both at 0.05.
    expect(rowText("lot")).toContain("1 295 000");
    expect(rowText("korea")).toContain("125 000");
    expect(rowText("broker")).toContain("116 000");
    expect(rowText("commission")).toContain("₽");
  });

  it("says out loud that the bank rate is not the CBR rate", async () => {
    const { result, submit } = setup();
    await submit(LOT_URL);
    const notes = result.querySelector("[data-notes]")?.textContent ?? "";
    expect(notes).toContain("курсу ЦБ РФ");
    expect(notes).toContain("Банк переводит по своему курсу");
  });

  it("labels the button for a whatsapp messenger config", async () => {
    const { result, submit } = setup({
      config: {
        ...DEFAULT_CONFIG,
        messenger: { type: "whatsapp", address: "+79990001122" },
      },
    });
    await submit(LOT_URL);
    const anchor = result.querySelector<HTMLAnchorElement>(
      "[data-messenger-button]",
    );
    expect(anchor?.textContent).toBe("Написать в WhatsApp");
    expect(anchor?.href.startsWith("https://wa.me/")).toBe(true);
  });
});
