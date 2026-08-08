/**
 * Calc page entry (U4): paste an encar listing URL -> photos, specs, the
 * all-in RUB cost table and a messenger button with a prefilled draft.
 *
 * Wiring mirrors the widget (src/main.ts): config first, then rates resolved
 * WITH that config (the config carries the reference-rate fallback tier).
 * The data source is the adapter (src/page/encar-adapter.ts) — fixture today,
 * the real encar client after the parallel task lands; everything here
 * depends only on the src/encar/types.ts contract.
 *
 * Dependencies are injectable for tests; the bottom auto-init only fires on
 * a document that actually carries the page form.
 */

import { computeQuote } from "../calc/pricing";
import { loadConfig, type LoadedConfig } from "../config";
import { resolveRates, type ResolvedRates } from "../rates/cbr";
import type { EncarFetch, ParseListingUrl } from "../encar/types";
import { fetchCar, parseListingUrl, SOURCE } from "./encar-adapter";
import { mapFuel, toLotDetails } from "./lot";
import { renderError, renderLoading, renderResult } from "./render";

export interface PageDeps {
  parseListingUrl: ParseListingUrl;
  fetchCar: EncarFetch;
  loadConfig: () => Promise<LoadedConfig>;
  resolveRates: (config: LoadedConfig["config"]) => Promise<ResolvedRates>;
  /** True renders the demo banner; follows the adapter SOURCE by default. */
  demo: boolean;
}

const DEFAULT_DEPS: PageDeps = {
  parseListingUrl,
  fetchCar,
  loadConfig,
  resolveRates,
  demo: SOURCE === "fixture",
};

/**
 * The optional «мощность, л.с.» field as a LotParams fragment.
 *
 * Empty means "not entered", which is not the same as "zero": it must leave
 * powerHp absent so the recycling line dashes honestly. A typed-in 0 or a
 * negative IS supplied-but-impossible, and the engine's own R3 rule then takes
 * the quote down to «по запросу» — which is why the value is passed through
 * rather than sanitised away here.
 */
function powerOverride(raw: string): { powerHp?: number } {
  const text = raw.trim();
  if (text === "") return {};
  return { powerHp: Number(text.replace(",", ".")) };
}

const BAD_URL_MESSAGE =
  "Не похоже на ссылку encar.com. Скопируйте адрес страницы автомобиля целиком.";
const FETCH_FAILED_MESSAGE =
  "Не удалось загрузить данные автомобиля. Проверьте ссылку и попробуйте ещё раз.";

/**
 * Binds the page form. One in-flight request at a time: the submit button is
 * disabled while loading, and a stale response never overwrites a newer one.
 */
export function initCalcPage(
  doc: Document,
  deps: PageDeps = DEFAULT_DEPS,
): void {
  const form = doc.querySelector<HTMLFormElement>("[data-calc-form]");
  const input = doc.querySelector<HTMLInputElement>("[data-calc-url]");
  const submit = doc.querySelector<HTMLButtonElement>("[data-calc-submit]");
  const result = doc.querySelector<HTMLElement>("[data-calc-result]");
  // Optional by design: the page works without it (the recycling line just
  // dashes as before), so a document that predates the field still binds.
  const powerInput = doc.querySelector<HTMLInputElement>("[data-calc-power]");
  if (form === null || input === null || submit === null || result === null) {
    return;
  }

  let requestSeq = 0;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const lotUrl = input.value.trim();
    // Read now, not in the async body: the client may keep typing while the
    // fetch is in flight, and the quote must describe the form as submitted.
    const power = powerInput === null ? "" : powerInput.value;
    const vehicleId = deps.parseListingUrl(lotUrl);
    if (vehicleId === null) {
      renderError(result, BAD_URL_MESSAGE);
      return;
    }

    const seq = ++requestSeq;
    submit.disabled = true;
    result.setAttribute("data-loading", "");
    renderLoading(result);

    void (async () => {
      try {
        const [car, loaded] = await Promise.all([
          deps.fetchCar(vehicleId),
          deps.loadConfig(),
        ]);
        const rates = await deps.resolveRates(loaded.config);
        if (seq !== requestSeq) return;
        const lot = toLotDetails(car);
        // priceKrw is the CAR price alone: the Korean export/freight costs are
        // WON cost items in the config, and computeQuote folds them in before
        // the FX conversion so they land inside the customs value.
        //
        // A manager-entered power OVERRIDES whatever toLotDetails produced —
        // no public encar surface carries engine power (docs/harness/
        // spike-power.md), and task/tks-parity will start filling the same
        // field from an offline catalog; a typed-in figure is the more
        // specific evidence and must win, not be won over.
        const allIn = computeQuote(
          { priceKrw: car.priceKrw, ...lot, ...powerOverride(power) },
          rates,
          loaded.config,
        );
        renderResult(
          result,
          { car, lotUrl, allIn, loaded, rates, demo: deps.demo },
          mapFuel(car.fuelName),
        );
      } catch {
        if (seq !== requestSeq) return;
        renderError(result, FETCH_FAILED_MESSAGE);
      } finally {
        if (seq === requestSeq) {
          submit.disabled = false;
          result.removeAttribute("data-loading");
        }
      }
    })();
  });
}

// The bundle is loaded by site/calc.html only; in any other document (tests,
// accidental inclusion) the selector guard above turns this into a no-op.
if (typeof document !== "undefined") {
  initCalcPage(document);
}
