/**
 * encar-ru overlay widget entry point.
 * Scans the page for KRW prices and annotates each with a RUB badge.
 *
 * U5: annotation is gated on FX rate resolution (mirror -> cache -> config,
 * see src/rates/cbr.ts) — no badge renders a RUB value before the rates are
 * known.
 *
 * U6: the breakdown uses the real customs calculator (src/calc/customs.ts).
 *
 * U7: lot params are extracted from the DOM (src/scan/params.ts). Card pages
 * with full real params compute exactly (badge without "≈"); listings and
 * degraded cards stay approximate or fall back to "расчёт по запросу".
 *
 * U9: after every scan pass the ko->ru dictionary is applied to the page
 * (src/translate/apply.ts), and the one-time browser-translation hint is
 * shown once prices have actually been found.
 */

import { scanPrices } from "./scan/scanner";
import { observeDom } from "./scan/observer";
import {
  extractCardParams,
  extractListingParams,
  toLotDetails,
} from "./scan/params";
import { lotPrecision } from "./calc/customs";
import { attachBadge } from "./ui/badge";
import { attachBreakdown, isDetailPage } from "./ui/breakdown";
import { loadConfig, type LoadedConfig } from "./config";
import { resolveRates, type ResolvedRates } from "./rates/cbr";
import { applyDictionary, showTranslateHint } from "./translate/apply";

const VERSION = "0.3.0";

interface EncarRuApi {
  version: string;
  rescan: () => void;
}

declare global {
  interface Window {
    __encarRu?: EncarRuApi;
  }
}

export function init(): void {
  const existing = window.__encarRu;
  if (existing) {
    // Double-init guard: re-activation just rescans, never duplicates state.
    existing.rescan();
    return;
  }

  // Config and rates are each resolved once and shared by all rescans.
  let configPromise: Promise<LoadedConfig> | null = null;
  const getConfig = (): Promise<LoadedConfig> => {
    if (configPromise === null) configPromise = loadConfig();
    return configPromise;
  };
  // Rates need the config first: its reference rates anchor the ±30%
  // plausibility check (KTD2).
  let ratesPromise: Promise<ResolvedRates> | null = null;
  const getRates = (): Promise<ResolvedRates> => {
    if (ratesPromise === null) {
      ratesPromise = getConfig().then((loaded) => resolveRates(loaded.config));
    }
    return ratesPromise;
  };

  const annotate = async (): Promise<void> => {
    const loaded = await getConfig();
    // U5 gate: nothing is rendered until the rates resolve.
    const rates = await getRates();
    const detail = isDetailPage(window.location.href);
    // Card params describe the single lot of the page; listing params are
    // re-read per price element from its own row (U7).
    const cardLot = detail ? toLotDetails(extractCardParams(document)) : null;
    const candidates = scanPrices(document);
    for (const candidate of candidates) {
      const lot =
        cardLot ?? toLotDetails(extractListingParams(candidate.element));
      attachBadge(candidate, rates.krwRub, lotPrecision(lot));
      if (detail) {
        // U2: on the car screen the badge expands into the cost breakdown.
        attachBreakdown(candidate, loaded, rates, lot);
      }
    }
    // U9: the dictionary runs after the scan, so prices are already annotated
    // (and therefore off limits) by the time any text is rewritten.
    applyDictionary(document);
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
    observeDom(document, rescan);
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
