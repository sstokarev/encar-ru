/**
 * Specs catalog: engine power for hybrids and EVs (tks-parity task).
 *
 * The recycling fee (ПП №1291 в ред. №1713) and the EV/sequential-hybrid
 * customs track (акциз руб/л.с.) need power figures that no public encar
 * surface carries (measured, docs/harness/spike-power.md). The operator's
 * source of record is drom.ru's catalog, which publishes both the ICE power
 * and the electric motor's 30-minute power for Korean-market modifications
 * (verified 2026-08-08 on Sonata DN8 HEV, Grandeur GN7 HEV, Ioniq 5).
 *
 * The catalog is a BUILD-TIME snapshot (site/specs-catalog.json, produced by
 * scripts/build-catalog.mjs): drom.ru sends no CORS header and this product
 * has no backend, so the browser can only consume committed data.
 *
 * Matching honesty mirrors the engine's rules (src/calc/customs.ts header):
 * a lot matches only when every surviving candidate agrees on the power
 * figures. No match, or survivors that disagree, yields undefined — the
 * power-dependent lines dash and the total stays a provable floor. A unique
 * match is catalog DATA, not an estimate: the caller keeps `estimated`
 * false.
 */

import type { CarData } from "../encar/types";

/** Powertrain kind for customs routing: series-only hybrids clear like EVs
 * (ТН ВЭД 8703 80 000 5), anything with a mechanical link to the wheels
 * (parallel / series-parallel) clears by displacement under ЕЭК №107. */
export type HybridKind = "parallel" | "sequential";

export interface SpecsEntry {
  /** Lowercase manufacturer token expected inside CarData.title. */
  make: string;
  /** Lowercase model token(s); the longest alias found in the title wins so
   * "ioniq 5" never claims an "ioniq 5 n" entry and vice versa. */
  aliases: string[];
  /** Production window, "YYYYMM"; `to` absent = still produced. */
  from: string;
  to?: string;
  fuel: "hybrid" | "electric";
  /** Present for hybrids only. */
  hybridKind?: HybridKind;
  /** Exact drom displacement, cc; hybrids only (EVs have none). */
  engineCc?: number;
  /** ICE max power, hp; hybrids only. */
  iceHp?: number;
  /** Electric motor 30-minute power, hp — the legal basis for the recycling
   * fee (and акциз on the EV track). */
  electricHp30min: number;
  /** Lowercase trim tokens (drom uses the Korean domestic names, the same
   * vocabulary encar puts into title/grade). Optional refinement only. */
  grades?: string[];
}

export interface SpecsCatalog {
  version: 1;
  /** ISO date the snapshot was taken from drom.ru. */
  generatedAt: string;
  entries: SpecsEntry[];
}

/** The figures a successful match contributes to LotParams. */
export interface MatchedSpec {
  fuel: "hybrid" | "electric";
  hybridKind?: HybridKind;
  iceHp?: number;
  electricHp30min: number;
}

/** encar rounds displacement to marketing values (1999 vs 2000); anything
 * this close is the same engine, anything farther is a different one. */
const CC_TOLERANCE = 30;

/**
 * A car registered up to this many months after its modification stopped
 * production is still plausibly that modification (dealer leftovers); such a
 * closed-window candidate is kept during window refinement and must agree
 * with the in-window survivors, or the match refuses.
 */
const LEFTOVER_GRACE_MONTHS = 6;

/** Whole months between two "YYYYMM" stamps (b >= a). */
function monthsBetween(a: string, b: string): number {
  return (
    (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
    (Number(b.slice(4)) - Number(a.slice(4)))
  );
}

/** True when `token` appears in `text` on word boundaries (space-delimited). */
function hasToken(text: string, token: string): boolean {
  return ` ${text} `.includes(` ${token} `);
}

function isYearMonth(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{6}$/.test(v)) return false;
  const month = Number(v.slice(4));
  return month >= 1 && month <= 12;
}

function isPositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Plausibility bounds: a typo'd catalog cell (kW captured as hp, a dropped
 * digit) must fail validation rather than compute a confident wrong fee.
 */
function isPlausibleHp(v: unknown): v is number {
  return isPositive(v) && v >= 5 && v <= 1500;
}

function isPlausibleCc(v: unknown): v is number {
  return isPositive(v) && v >= 500 && v <= 7000;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);
}

function isValidEntry(e: unknown): e is SpecsEntry {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  if (typeof o.make !== "string" || o.make.length === 0) return false;
  if (!isStringArray(o.aliases) || (o.aliases as string[]).length === 0) return false;
  if (!isYearMonth(o.from)) return false;
  if (o.to !== undefined && (!isYearMonth(o.to) || o.to < (o.from as string))) {
    return false;
  }
  if (!isPlausibleHp(o.electricHp30min)) return false;
  if (o.grades !== undefined && !isStringArray(o.grades)) return false;
  if (o.fuel === "electric") {
    return o.hybridKind === undefined && o.engineCc === undefined && o.iceHp === undefined;
  }
  if (o.fuel !== "hybrid") return false;
  return (
    (o.hybridKind === "parallel" || o.hybridKind === "sequential") &&
    isPlausibleCc(o.engineCc) &&
    isPlausibleHp(o.iceHp)
  );
}

/**
 * Defensive whole-file validation, same posture as isValidConfig
 * (src/config.ts): a corrupt or half-fetched catalog degrades to "no
 * catalog", never to a throw or a wrong match.
 */
export function isValidCatalog(v: unknown): v is SpecsCatalog {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.generatedAt === "string" &&
    Array.isArray(o.entries) &&
    o.entries.every(isValidEntry)
  );
}

/** Longest alias of the entry found in the lowercase title, or 0. */
function aliasHit(title: string, entry: SpecsEntry): number {
  let best = 0;
  for (const alias of entry.aliases) {
    if (alias.length > best && title.includes(alias)) best = alias.length;
  }
  return best;
}

function sameSpec(a: SpecsEntry, b: SpecsEntry): boolean {
  return (
    a.fuel === b.fuel &&
    a.hybridKind === b.hybridKind &&
    a.iceHp === b.iceHp &&
    a.electricHp30min === b.electricHp30min
  );
}

/**
 * Match a listing to its power figures.
 *
 * `fuel` is the caller's already-mapped FuelType (mapFuel lives in the page
 * layer); only "hybrid" and "electric" lots can match. Filters, in order:
 * fuel, make+model alias in title, registration month inside the production
 * window, displacement within CC_TOLERANCE (hybrids). Among survivors, the
 * best (longest) model-alias hit wins first, then grade tokens refine when
 * they discriminate; survivors must agree on the figures or the whole match
 * is refused (see header).
 */
export function matchSpecs(
  car: CarData,
  fuel: "hybrid" | "electric",
  catalog: SpecsCatalog,
): MatchedSpec | undefined {
  const title = car.title.toLowerCase();
  if (!isYearMonth(car.yearMonth)) return undefined;

  let bestHit = 0;
  let candidates: SpecsEntry[] = [];
  for (const entry of catalog.entries) {
    if (entry.fuel !== fuel) continue;
    if (!title.includes(entry.make)) continue;
    const hit = aliasHit(title, entry);
    if (hit === 0) continue;
    // Registration can only happen while (or after) the modification is in
    // production; a pre-production yearMonth excludes the entry. Listings
    // registered after `to` are kept: cars outlive their production run.
    if (car.yearMonth < entry.from) continue;
    if (
      entry.engineCc !== undefined &&
      (car.displacementCc === null ||
        Math.abs(car.displacementCc - entry.engineCc) > CC_TOLERANCE)
    ) {
      continue;
    }
    if (hit > bestHit) {
      bestHit = hit;
      candidates = [entry];
    } else if (hit === bestHit) {
      candidates.push(entry);
    }
  }
  if (candidates.length === 0) return undefined;

  // Production-window refinement. An entry whose window contains the
  // registration month beats an earlier generation the car merely postdates —
  // but a RECENTLY closed window is still plausible (a leftover registers
  // months after production ends), so such candidates are kept and must
  // AGREE with the survivors below. Dropping them silently handed a
  // facelift/N-variant lot the wrong entry's power with "exact" confidence
  // (review finding, 2026-08-08).
  const inWindow = candidates.filter(
    (e) => e.to === undefined || car.yearMonth <= e.to,
  );
  if (inWindow.length > 0) {
    const plausible = candidates.filter(
      (e) =>
        e.to !== undefined &&
        car.yearMonth > e.to &&
        monthsBetween(e.to, car.yearMonth) <= LEFTOVER_GRACE_MONTHS,
    );
    candidates = [...inWindow, ...plausible];
  }

  // Grade refinement, only when it actually discriminates. Tokens compare on
  // word boundaries: the "smart" trim must not match inside "Smartstream".
  if (candidates.length > 1) {
    const byGrade = candidates.filter(
      (e) => e.grades !== undefined && e.grades.some((g) => hasToken(title, g)),
    );
    if (byGrade.length > 0 && byGrade.length < candidates.length) {
      candidates = byGrade;
    }
  }

  const first = candidates[0];
  if (first === undefined) return undefined;
  if (!candidates.every((e) => sameSpec(e, first))) return undefined;

  const spec: MatchedSpec = {
    fuel: first.fuel,
    electricHp30min: first.electricHp30min,
  };
  if (first.hybridKind !== undefined) spec.hybridKind = first.hybridKind;
  if (first.iceHp !== undefined) spec.iceHp = first.iceHp;
  return spec;
}
