/**
 * Contract between the encar-client task and the calc page (fixed 2026-08-08).
 * src/encar/index.ts must export exactly these two entry points; the page
 * builds against this file and never against client internals.
 */
export interface CarData {
  vehicleId: string;
  /** manufacturer + model + grade, English fields where the API has them */
  title: string;
  /** normalized to KRW (the API's advertisement.price is in 만원 = 10,000 KRW) */
  priceKrw: number;
  /** first registration, "YYYYMM" (category.yearMonth) */
  yearMonth: string;
  mileageKm: number;
  displacementCc: number | null;
  fuelName: string;
  transmissionName: string;
  colorName: string;
  seatCount: number | null;
  bodyName: string;
  /** absolute, directly renderable URLs */
  photoUrls: string[];
  vin: string | null;
}

export type EncarFetch = (vehicleId: string) => Promise<CarData>;
/** null when the string is not a recognizable encar listing URL */
export type ParseListingUrl = (url: string) => string | null;
