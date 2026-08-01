/**
 * encar-ru overlay widget entry point (U1 mock stage, KTD7).
 * Scans the page for KRW prices and annotates each with a RUB badge.
 */

import { scanPrices } from "./scan/scanner";
import { observeDom } from "./scan/observer";
import { attachBadge } from "./ui/badge";
import { attachBreakdown, isDetailPage } from "./ui/breakdown";
import { loadConfig, type LoadedConfig } from "./config";

const VERSION = "0.1.0";

// TODO(U5/U6): placeholder mock rate. Replace with the CBR-resolved KRW->RUB
// rate (U5) and the real duty/shipping/commission calculator (U6).
const MOCK_RUB_PER_KRW = 0.055;

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

  // Config is loaded lazily, once, on the first detail-page scan (U2).
  let configPromise: Promise<LoadedConfig> | null = null;
  const getConfig = (): Promise<LoadedConfig> => {
    if (configPromise === null) configPromise = loadConfig();
    return configPromise;
  };

  const rescan = (): void => {
    const detail = isDetailPage(window.location.href);
    for (const candidate of scanPrices(document)) {
      attachBadge(candidate, MOCK_RUB_PER_KRW);
      if (detail) {
        // U2: on the car screen the badge expands into the cost breakdown.
        void getConfig().then((loaded) => attachBreakdown(candidate, loaded));
      }
    }
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

init();
