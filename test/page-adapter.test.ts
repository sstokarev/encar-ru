/**
 * U1: the fixture adapter behind the src/encar/types.ts contract — URL
 * recognition and the demo CarData shape the page builds against until the
 * real encar client lands.
 */
import { describe, expect, it } from "vitest";

import { fetchCar, parseListingUrl, SOURCE } from "../src/page/encar-adapter";

describe("parseListingUrl", () => {
  it("extracts the lot id from a fem detail URL", () => {
    expect(
      parseListingUrl("https://fem.encar.com/cars/detail/41756847"),
    ).toBe("41756847");
  });

  it("keeps working with query and hash noise", () => {
    expect(
      parseListingUrl(
        "https://fem.encar.com/cars/detail/41756847?pageid=dc&listAdvType=pic#detail",
      ),
    ).toBe("41756847");
  });

  it("extracts the lot id from the legacy carid query form", () => {
    expect(
      parseListingUrl(
        "http://www.encar.com/dc/dc_cardetailview.do?method= read&carid=12345",
      ),
    ).toBe("12345");
  });

  it("tolerates surrounding whitespace", () => {
    expect(
      parseListingUrl("  https://fem.encar.com/cars/detail/777 \n"),
    ).toBe("777");
  });

  it.each([
    ["non-encar host", "https://example.com/cars/detail/123"],
    ["encar look-alike host", "https://encar.com.evil.io/cars/detail/123"],
    ["encar page without a lot", "https://www.encar.com/index.do"],
    ["non-numeric carid", "https://www.encar.com/dc/view.do?carid=abc"],
    ["not a URL at all", "just some text"],
    ["empty string", ""],
  ])("returns null for %s", (_name, url) => {
    expect(parseListingUrl(url)).toBeNull();
  });
});

describe("fetchCar (fixture)", () => {
  it("declares itself a fixture so the page shows the demo banner", () => {
    expect(SOURCE).toBe("fixture");
  });

  it("resolves a contract-complete CarData for the requested id", async () => {
    const car = await fetchCar("41756847");
    expect(car.vehicleId).toBe("41756847");
    expect(car.title).not.toBe("");
    expect(car.priceKrw).toBeGreaterThan(0);
    expect(car.yearMonth).toMatch(/^\d{6}$/);
    expect(car.mileageKm).toBeGreaterThan(0);
    expect(car.displacementCc).toBeGreaterThan(0);
    expect(car.fuelName).not.toBe("");
    expect(car.photoUrls.length).toBeGreaterThan(0);
    for (const url of car.photoUrls) {
      expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    }
  });
});
