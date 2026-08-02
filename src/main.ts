/**
 * encar-ru overlay widget entry point.
 * Scans the page for KRW prices and annotates each with a RUB badge.
 *
 * U5: annotation is gated on FX rate resolution (mirror -> cache -> config,
 * see src/rates/cbr.ts) — no badge renders a RUB value before the rates are
 * known.
 *
 * U6: badge and breakdown both come from the real customs calculator
 * (src/calc/customs.ts) — the badge shows the all-in total, the breakdown
 * itemises the same number.
 *
 * U7: lot params are extracted from the DOM (src/scan/params.ts). Card pages
 * with full real params compute exactly (badge without "≈"); listings and
 * degraded cards stay approximate or fall back to "по запросу".
 *
 * U9: after every scan pass the ko->ru dictionary is applied to the page
 * (src/translate/apply.ts), and the one-time browser-translation hint is
 * shown once prices have actually been found.
 *
 * Activation must feel immediate: the config fetch and the CBR fetch are
 * started together at init, not chained (they used to cost up to 3 + 3 s
 * before anything appeared on screen).
 *
 * Rescans are incremental: the observer hands over the subtrees that changed
 * and only those are scanned and translated — encar listings mutate all the
 * time, and re-walking the whole document each batch cost ~370 ms at 413 lots.
 */

import { PRICE_ELEMENT_SELECTOR, scanPrices } from "./scan/scanner";
import { observeDom, watchUrl } from "./scan/observer";
import { refreshStale } from "./scan/refresh";
import {
  extractCardParams,
  extractListingParams,
  toLotDetails,
} from "./scan/params";
import { computeAllIn } from "./calc/customs";
import { attachBadge } from "./ui/badge";
import { attachBreakdown, isDetailPage } from "./ui/breakdown";
import { loadConfig, type LoadedConfig, type WidgetConfig } from "./config";
import { DEFAULT_CONFIG } from "./config.default";
import { resolveRates, type ResolvedRates } from "./rates/cbr";
import { applyDictionary, showTranslateHint } from "./translate/apply";

const VERSION = "0.6.0";

interface EncarRuApi {
  version: string;
  rescan: () => void;
}

declare global {
  interface Window {
    __encarRu?: EncarRuApi;
  }
}

/** True when two configs anchor the FX plausibility check identically. */
function sameReferenceRates(a: WidgetConfig, b: WidgetConfig): boolean {
  return (
    a.currency.referenceRates.KRW_RUB === b.currency.referenceRates.KRW_RUB &&
    a.currency.referenceRates.EUR_RUB === b.currency.referenceRates.EUR_RUB
  );
}

/**
 * The price element of the lot the detail page is about. Every other price on
 * such a page (market value block, similar lots, sold lots) belongs to a
 * DIFFERENT car and must be read from its own row.
 */
function mainLotPriceElement(doc: Document): Element | null {
  // fem marks the lot's own price box with the exact KRW amount; otherwise
  // the first price of the page is the lot's own (market value, similar and
  // sold lots all render below it). Innermost element wins, mirroring the
  // scanner, so the result can be compared with a scanned candidate.
  const price =
    doc.querySelector("[data-intl-currency-amount]") ??
    doc.querySelector(PRICE_ELEMENT_SELECTOR);
  if (price === null) return null;
  return price.querySelector(PRICE_ELEMENT_SELECTOR) ?? price;
}

export function init(): void {
  const existing = window.__encarRu;
  if (existing) {
    // Double-init guard: re-activation just rescans, never duplicates state.
    existing.rescan();
    return;
  }

  // Config and rates are resolved once and shared by all rescans — and both
  // network calls start NOW, in parallel. The rates only need the config's
  // reference rates for the ±30% plausibility check (KTD2), so they are
  // resolved against the embedded anchors immediately; should the remote
  // config bring different anchors, they are re-resolved against those (rare,
  // and the CBR response is warm by then).
  const configPromise = loadConfig();
  const embeddedRatesPromise = resolveRates(DEFAULT_CONFIG);
  const ratesPromise: Promise<ResolvedRates> = configPromise.then((loaded) =>
    sameReferenceRates(loaded.config, DEFAULT_CONFIG)
      ? embeddedRatesPromise
      : resolveRates(loaded.config),
  );

  const annotate = async (roots?: readonly Element[]): Promise<void> => {
    // U5 gate: nothing is rendered until config AND rates have resolved.
    const [loaded, rates]: [LoadedConfig, ResolvedRates] = await Promise.all([
      configPromise,
      ratesPromise,
    ]);
    const detail = isDetailPage(window.location.href);
    // U11: both encar front-ends are SPAs, so a badged price element can
    // survive into another car with a new number on it. Drop the annotations
    // that no longer describe what the page shows BEFORE scanning, and the
    // scan picks those prices up as if they were new.
    if (roots === undefined) {
      refreshStale(document);
    } else {
      for (const root of roots) refreshStale(root);
    }
    const candidates =
      roots === undefined ? scanPrices(document) : scanPrices(document, roots);

    // Card params describe the single lot of the page and apply to its price
    // element only; every other price is another lot and is read from its own
    // row (U7). The state is re-read on each pass: fem never rewrites it on a
    // soft navigation, so it has to be re-bound to the lot in the URL.
    const mainPriceEl = detail ? mainLotPriceElement(document) : null;
    const mainCandidate =
      mainPriceEl === null
        ? undefined
        : candidates.find((c) => c.element === mainPriceEl);
    const cardLot =
      mainCandidate === undefined
        ? null
        : toLotDetails(extractCardParams(document, window.location.href));

    for (const candidate of candidates) {
      const isMainLot = candidate === mainCandidate;
      const lot =
        isMainLot && cardLot !== null
          ? cardLot
          : toLotDetails(extractListingParams(candidate.element));
      // The badge headlines the all-in ("под ключ") total, not the converted
      // lot price (R1). computeAllIn is pure and cheap, and config/rates are
      // resolved once above, so a per-candidate call costs nothing; the
      // breakdown recomputes from the same inputs and therefore always shows
      // the identical number.
      const allIn = computeAllIn(
        { priceKrw: candidate.krw, ...lot },
        rates,
        loaded.config,
      );
      // P1: a badge computed from embedded tariffs or a non-CBR rate must not
      // look identical to a fresh one — the provenance drives the "~" marker.
      attachBadge(candidate, allIn, {
        configSource: loaded.source,
        ratesSource: rates.source,
      });
      if (isMainLot) {
        // U2: on the car screen the lot's own badge expands into the cost
        // breakdown. Similar/sold lots get a badge and nothing else.
        attachBreakdown(candidate, loaded, rates, lot);
      }
    }

    // U9: the dictionary runs after the scan, so prices are already annotated
    // (and therefore off limits) by the time any text is rewritten. It follows
    // the scan scope: an incremental pass translates only what was added.
    if (roots === undefined) {
      applyDictionary(document);
    } else {
      for (const root of roots) applyDictionary(root);
    }
    if (candidates.length > 0) {
      // One-time hint about full-page browser translation (R12).
      showTranslateHint(document);
    }
  };

  const rescan = (): void => {
    void annotate();
  };

  window.__encarRu = { version: VERSION, rescan };

  const start = (): void => {
    rescan();
    // Observe the Document node itself so a replaced <body> stays covered.
    // Only the changed subtrees are rescanned; a full walk stays reserved for
    // the initial pass and for an explicit rescan() from the API.
    observeDom(document, (roots) => {
      void annotate(roots);
    });
    // U11: a client-side route change is the one event that means "different
    // car" even when the DOM the observer sees barely moves — and on a detail
    // screen it also decides whether the breakdown belongs on the page at all
    // (isDetailPage reads the URL). A soft navigation therefore gets a full
    // pass, not an incremental one.
    watchUrl(window, () => {
      rescan();
    });
  };

  if (document.body) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
}

// Auto-run in the browser; tests call init() themselves after stubbing the
// network. Without this guard the import-time run captures a real fetch to the
// CBR mirror in the shared rates promise, and every later rescan waits on it.
if (typeof window !== "undefined" && !("__vitest_worker__" in globalThis)) {
  init();
}
