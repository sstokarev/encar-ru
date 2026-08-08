/**
 * Data source of the calc page behind the src/encar/types.ts contract (U1).
 *
 * The real encar client is being built in a parallel task. Until it lands on
 * main, this adapter serves a FIXTURE CarData for any recognizable listing
 * URL, and the page renders a visible "демо-данные" banner (SOURCE below).
 *
 * SWAP PROCEDURE when src/encar/index.ts lands: replace the whole body of
 * this file with re-exports of the client's `fetchCar` / `parseListingUrl`
 * and set SOURCE to "client". Nothing else on the page changes — the UI
 * depends only on the contract types.
 */

import type { CarData, EncarFetch, ParseListingUrl } from "../encar/types";

/** Where car data comes from; the UI shows a demo banner for "fixture". */
export const SOURCE: "fixture" | "client" = "fixture";

/** Detail URL of the fem SPA: /cars/detail/<id>. */
const DETAIL_PATH_RE = /\/cars\/detail\/(\d+)/;

/** Hosts that may carry a listing (www, fem, m — any *.encar.com). */
const ENCAR_HOST_RE = /(^|\.)encar\.com$/i;

/**
 * Lot id from a pasted listing URL, null for anything unrecognizable.
 * Recognized forms: the fem detail path (/cars/detail/<id>) and the legacy
 * www query form (carid=<id>), on any encar.com host.
 */
export const parseListingUrl: ParseListingUrl = (url) => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!ENCAR_HOST_RE.test(parsed.hostname)) return null;
  const detail = DETAIL_PATH_RE.exec(parsed.pathname);
  if (detail?.[1] !== undefined) return detail[1];
  const carid = parsed.searchParams.get("carid");
  return carid !== null && /^\d+$/.test(carid) ? carid : null;
};

/** Inline SVG placeholder so the demo photo renders with no network at all. */
function placeholderPhoto(label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">` +
    `<rect width="100%" height="100%" fill="#e8e8ec"/>` +
    `<text x="50%" y="50%" fill="#9a9aa2" font-family="sans-serif" ` +
    `font-size="28" text-anchor="middle" dominant-baseline="middle">` +
    `${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Demo lot: a 2021 Sorento-class diesel SUV, priced 2 590 만원. Realistic
 * enough to exercise every row of the cost table (age 3-5y bracket, known
 * displacement, no power -> dashed recycling fee).
 */
function fixtureCar(vehicleId: string): CarData {
  return {
    vehicleId,
    title: "Kia Sorento 2.2 Diesel Prestige (демо)",
    priceKrw: 25_900_000,
    yearMonth: "202109",
    mileageKm: 48_210,
    displacementCc: 2151,
    fuelName: "디젤",
    transmissionName: "오토",
    colorName: "흰색",
    seatCount: 5,
    bodyName: "SUV",
    photoUrls: [placeholderPhoto("Фото 1 — демо"), placeholderPhoto("Фото 2 — демо")],
    vin: null,
  };
}

export const fetchCar: EncarFetch = (vehicleId) =>
  Promise.resolve(fixtureCar(vehicleId));
