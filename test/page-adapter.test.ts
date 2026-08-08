/**
 * U1: the adapter is the page's only data dependency. After the encar client
 * landed it must be a faithful re-export of the contract entry points — the
 * client's own behavior is covered in src/encar/client.test.ts.
 */
import { describe, expect, it } from "vitest";

import { fetchCarData, parseListingUrl as clientParse } from "../src/encar";
import { fetchCar, parseListingUrl, SOURCE } from "../src/page/encar-adapter";

describe("encar adapter", () => {
  it("declares the real client so the page shows no demo banner", () => {
    expect(SOURCE).toBe("client");
  });

  it("re-exports the client's entry points unchanged", () => {
    expect(parseListingUrl).toBe(clientParse);
    expect(fetchCar).toBe(fetchCarData);
  });

  it("still recognizes both live listing URL forms through the re-export", () => {
    expect(
      parseListingUrl("https://fem.encar.com/cars/detail/41756847?pageid=dc"),
    ).toBe("41756847");
    expect(
      parseListingUrl("http://www.encar.com/dc/dc_cardetailview.do?carid=12345"),
    ).toBe("12345");
    expect(parseListingUrl("https://example.com/cars/detail/123")).toBeNull();
  });
});
