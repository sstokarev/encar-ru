/**
 * Data source of the calc page behind the src/encar/types.ts contract (U1).
 *
 * The real encar client (src/encar/) landed, so this is now a thin re-export:
 * the page keeps depending on this module only, so any future source change
 * (another API, a proxy) stays a one-file swap. Until the client landed this
 * file served a fixture CarData; SOURCE drove the page's demo banner and now
 * pins it off.
 */

import { fetchCarData, parseListingUrl as clientParseListingUrl } from "../encar";
import type { EncarFetch, ParseListingUrl } from "../encar/types";

/** Where car data comes from; the UI shows a demo banner for "fixture". */
export const SOURCE: "fixture" | "client" = "client";

export const parseListingUrl: ParseListingUrl = clientParseListingUrl;

export const fetchCar: EncarFetch = fetchCarData;
