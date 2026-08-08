/**
 * Public surface of the encar client (the contract in ./types): exactly the
 * two entry points the calc page builds against.
 */

export { fetchCarData, parseListingUrl } from "./client";
export type { CarData, EncarFetch, ParseListingUrl } from "./types";
