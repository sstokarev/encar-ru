/**
 * Encar readside client: listing URL -> vehicleId -> CarData (the contract in
 * ./types). Measured live 2026-08-08: the endpoint answers 200 with
 * `access-control-allow-origin: *` and no auth, so a plain browser fetch works.
 *
 * - `advertisement.price` is quoted in 만원 (10,000 KRW units) — the same
 *   convention the overlay scanner handles — and is normalized to KRW here.
 * - `photos[].path` is relative; the absolute base was verified by fetching a
 *   real image (200, image/jpeg) from PHOTO_BASE_URL. Photos are sorted by
 *   `code` so exterior shots ("001", "002", …) render before option close-ups.
 * - The API may answer with a DIFFERENT vehicleId than requested (a re-listed
 *   car keeps its old photo set and readside record); the payload's own id is
 *   the one exposed, falling back to the requested id.
 */

import type { CarData } from "./types";

export const VEHICLE_API_BASE = "https://api.encar.com/v1/readside/vehicle/";

/** Verified live: `${PHOTO_BASE_URL}${photos[].path}` serves image/jpeg. */
export const PHOTO_BASE_URL = "https://ci.encar.com";

const FETCH_TIMEOUT_MS = 10_000;

/** 만원 -> KRW. */
const MANWON_IN_KRW = 10_000;

/**
 * Vehicle id from an encar listing URL, or null when the string is not a
 * recognizable listing. Both live URL forms are supported:
 *   - fem.encar.com/cars/detail/<id>            (current SPA)
 *   - www.encar.com/dc/dc_cardetailview.do?carid=<id>  (legacy)
 * Host matching is suffix-based (encar.com and subdomains) so the parser does
 * not silently claim ids from foreign sites with lookalike paths.
 */
export function parseListingUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "encar.com" && !host.endsWith(".encar.com")) return null;

  const detail = parsed.pathname.match(/\/cars\/detail\/(\d+)/);
  if (detail) return detail[1]!;

  if (/\/dc_cardetailview\.do$/i.test(parsed.pathname)) {
    for (const [key, value] of parsed.searchParams) {
      if (key.toLowerCase() === "carid" && /^\d+$/.test(value)) return value;
    }
  }
  return null;
}

/** Non-empty trimmed string, or null. */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Finite non-negative number, or null. */
function asCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Absolute photo URLs, exterior codes first; malformed entries are dropped. */
function mapPhotos(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: { code: string; path: string }[] = [];
  for (const item of value) {
    const photo = asRecord(item);
    const path = asText(photo?.["path"]);
    if (path === null || !path.startsWith("/")) continue;
    entries.push({ code: asText(photo?.["code"]) ?? "￿", path });
  }
  entries.sort((a, b) => a.code.localeCompare(b.code));
  return entries.map((entry) => `${PHOTO_BASE_URL}${entry.path}`);
}

/**
 * Maps a readside payload to CarData; null when the payload is missing any
 * field the calc page cannot work without (price, mileage, yearMonth, title).
 */
function mapPayload(data: unknown, requestedId: string): CarData | null {
  const payload = asRecord(data);
  const spec = asRecord(payload?.["spec"]);
  const category = asRecord(payload?.["category"]);
  const advertisement = asRecord(payload?.["advertisement"]);
  if (!payload || !spec || !category || !advertisement) return null;

  const priceManwon = asCount(advertisement["price"]);
  const mileageKm = asCount(spec["mileage"]);
  const yearMonth = asText(category["yearMonth"]);
  const title = [
    asText(category["manufacturerEnglishName"]),
    asText(category["modelGroupEnglishName"]),
    asText(category["gradeEnglishName"]),
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
  if (
    priceManwon === null ||
    mileageKm === null ||
    yearMonth === null ||
    title === ""
  ) {
    return null;
  }

  const payloadId = payload["vehicleId"];
  const vehicleId =
    typeof payloadId === "number" || typeof payloadId === "string"
      ? String(payloadId)
      : requestedId;

  return {
    vehicleId,
    title,
    priceKrw: priceManwon * MANWON_IN_KRW,
    yearMonth,
    mileageKm,
    displacementCc: asCount(spec["displacement"]),
    fuelName: asText(spec["fuelName"]) ?? "",
    transmissionName: asText(spec["transmissionName"]) ?? "",
    colorName: asText(spec["colorName"]) ?? "",
    seatCount: asCount(spec["seatCount"]),
    bodyName: asText(spec["bodyName"]) ?? "",
    photoUrls: mapPhotos(payload["photos"]),
    vin: asText(payload["vin"]),
  };
}

/**
 * Fetches and maps one vehicle. Rejects on network failure, a non-2xx status,
 * or a payload missing the fields the calc page cannot work without — the
 * page's single error path ("could not load this listing") handles all three.
 */
export async function fetchCarData(vehicleId: string): Promise<CarData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${VEHICLE_API_BASE}${encodeURIComponent(vehicleId)}`,
      { signal: controller.signal, referrerPolicy: "no-referrer" },
    );
    if (!response.ok) {
      throw new Error(`encar readside HTTP ${response.status}`);
    }
    const mapped = mapPayload(await response.json(), vehicleId);
    if (mapped === null) {
      throw new Error("encar readside payload is missing required fields");
    }
    return mapped;
  } finally {
    clearTimeout(timer);
  }
}
