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

import { computeAllIn } from "../calc/customs";
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
  if (form === null || input === null || submit === null || result === null) {
    return;
  }

  let requestSeq = 0;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const lotUrl = input.value.trim();
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
        const allIn = computeAllIn(
          { priceKrw: car.priceKrw, ...lot },
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
