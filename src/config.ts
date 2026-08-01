/**
 * Importer config loading (U2, KTD1): fetch site config.json from GitHub
 * Pages with a hard timeout; on any failure (network, HTTP error, malformed
 * payload) fall back to the embedded DEFAULT_CONFIG. The result carries its
 * source so the breakdown can mark embedded (possibly stale) data.
 */

import {
  DEFAULT_CONFIG,
  type CostItem,
  type WidgetConfig,
} from "./config.default";

export type {
  CostItem,
  CostItemKind,
  MessengerConfig,
  MessengerType,
  WidgetConfig,
} from "./config.default";

// TODO(U4): must match the final GitHub Pages domain of this repo.
export const CONFIG_URL = "https://stokarev.github.io/encar-ru/config.json";

const FETCH_TIMEOUT_MS = 3000;

export type ConfigSource = "remote" | "embedded";

export interface LoadedConfig {
  config: WidgetConfig;
  source: ConfigSource;
}

declare global {
  interface Window {
    /** Test/dev override for the remote config URL. */
    __encarRuConfigUrl?: string;
  }
}

function isCostItem(value: unknown): value is CostItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["id"] === "string" &&
    typeof item["label"] === "string" &&
    (item["kind"] === "fixed" ||
      item["kind"] === "percent" ||
      item["kind"] === "formula") &&
    (typeof item["value"] === "number" || typeof item["value"] === "string")
  );
}

/** Structural validation: a malformed remote payload must not reach the UI. */
function isValidConfig(value: unknown): value is WidgetConfig {
  if (typeof value !== "object" || value === null) return false;
  const cfg = value as Record<string, unknown>;
  const messenger = cfg["messenger"] as Record<string, unknown> | undefined;
  const currency = cfg["currency"] as Record<string, unknown> | undefined;
  const rates = currency?.["referenceRates"] as
    | Record<string, unknown>
    | undefined;
  return (
    typeof cfg["version"] === "number" &&
    typeof messenger === "object" &&
    messenger !== null &&
    (messenger["type"] === "telegram" || messenger["type"] === "whatsapp") &&
    typeof messenger["address"] === "string" &&
    messenger["address"].length > 0 &&
    typeof rates === "object" &&
    rates !== null &&
    typeof rates["KRW_RUB"] === "number" &&
    rates["KRW_RUB"] > 0 &&
    typeof rates["EUR_RUB"] === "number" &&
    typeof currency?.["updatedAt"] === "string" &&
    Array.isArray(cfg["costItems"]) &&
    cfg["costItems"].every(isCostItem) &&
    typeof cfg["commissionNote"] === "string"
  );
}

/**
 * Loads the importer config. Never rejects: any failure path resolves to the
 * embedded default with source "embedded".
 */
export async function loadConfig(): Promise<LoadedConfig> {
  const url = window.__encarRuConfigUrl ?? CONFIG_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!isValidConfig(data)) throw new Error("invalid config shape");
    return { config: data, source: "remote" };
  } catch {
    return { config: DEFAULT_CONFIG, source: "embedded" };
  } finally {
    clearTimeout(timer);
  }
}
