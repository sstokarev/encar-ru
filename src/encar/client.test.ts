import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCarData,
  parseListingUrl,
  PHOTO_BASE_URL,
  VEHICLE_API_BASE,
} from "./client";
import type { EncarFetch, ParseListingUrl } from "./types";

// Compile-time contract check: index.ts re-exports exactly these functions,
// so they must satisfy the types the calc page builds against.
const _fetch: EncarFetch = fetchCarData;
const _parse: ParseListingUrl = parseListingUrl;
void _fetch;
void _parse;

/** Captured live 2026-08-08 from GET ${VEHICLE_API_BASE}41344448. */
const FIXTURE: unknown = JSON.parse(
  readFileSync(resolve("src/encar/fixtures/vehicle-41344448.json"), "utf8"),
);

function okResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function stubFetchOk(data: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(okResponse(data));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseListingUrl", () => {
  it("parses the fem SPA detail URL", () => {
    expect(parseListingUrl("https://fem.encar.com/cars/detail/41344448")).toBe(
      "41344448",
    );
  });

  it("survives query, hash, and trailing path segments", () => {
    expect(
      parseListingUrl(
        "https://fem.encar.com/cars/detail/41344448?pageid=fc_carsearch&listAdvType=pic#detail",
      ),
    ).toBe("41344448");
  });

  it("parses the legacy www detail URL via its carid param", () => {
    expect(
      parseListingUrl(
        "http://www.encar.com/dc/dc_cardetailview.do?pageid=dc_carsearch&carid=41344448",
      ),
    ).toBe("41344448");
  });

  it("matches the carid param case-insensitively", () => {
    expect(
      parseListingUrl("https://www.encar.com/dc/dc_cardetailview.do?carId=123"),
    ).toBe("123");
  });

  it("rejects lookalike paths on foreign hosts", () => {
    expect(
      parseListingUrl("https://evil.example.com/cars/detail/41344448"),
    ).toBeNull();
    expect(
      parseListingUrl("https://notencar.com/cars/detail/41344448"),
    ).toBeNull();
  });

  it("rejects encar URLs that are not listings", () => {
    expect(parseListingUrl("https://fem.encar.com/cars/list")).toBeNull();
    expect(
      parseListingUrl("https://www.encar.com/dc/dc_cardetailview.do?carid=abc"),
    ).toBeNull();
    expect(parseListingUrl("https://www.encar.com/")).toBeNull();
  });

  it("rejects strings that are not URLs at all", () => {
    expect(parseListingUrl("41344448")).toBeNull();
    expect(parseListingUrl("")).toBeNull();
  });
});

describe("fetchCarData", () => {
  it("requests the readside endpoint for the given id", async () => {
    const mock = stubFetchOk(FIXTURE);
    await fetchCarData("41344448");
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0]![0]).toBe(`${VEHICLE_API_BASE}41344448`);
  });

  it("maps the captured fixture to the CarData contract", async () => {
    stubFetchOk(FIXTURE);
    const car = await fetchCarData("41344448");

    // The payload carries its own id (a re-listed car keeps its old record).
    expect(car.vehicleId).toBe("41335009");
    expect(car.title).toBe("Genesis GV80 2.5T Gasoline 2WD");
    // advertisement.price 5890 만원 -> KRW.
    expect(car.priceKrw).toBe(58_900_000);
    expect(car.yearMonth).toBe("202503");
    expect(car.mileageKm).toBe(10_742);
    expect(car.displacementCc).toBe(2_497);
    expect(car.fuelName).toBe("가솔린");
    expect(car.transmissionName).toBe("오토");
    expect(car.colorName).toBe("검정색");
    expect(car.seatCount).toBe(5);
    expect(car.bodyName).toBe("SUV");
    expect(car.vin).toBe("KMTHA81BBSU265225");
  });

  it("returns absolute, exterior-first photo URLs", async () => {
    stubFetchOk(FIXTURE);
    const car = await fetchCarData("41344448");

    expect(car.photoUrls).toHaveLength(26);
    for (const url of car.photoUrls) {
      expect(url).toMatch(
        new RegExp(`^${PHOTO_BASE_URL}/carpicture[^ ]+\\.jpg$`),
      );
    }
    // The raw payload leads with an option close-up ("021"); the mapped list
    // must lead with the first exterior shot instead.
    expect(car.photoUrls[0]).toBe(
      `${PHOTO_BASE_URL}/carpicture03/pic4133/41335009_001.jpg`,
    );
  });

  it("rejects on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response),
    );
    await expect(fetchCarData("1")).rejects.toThrow("HTTP 404");
  });

  it("rejects when the payload is missing required fields", async () => {
    const gutted = JSON.parse(JSON.stringify(FIXTURE)) as {
      advertisement: { price?: unknown };
    };
    delete gutted.advertisement.price;
    stubFetchOk(gutted);
    await expect(fetchCarData("41344448")).rejects.toThrow(
      "missing required fields",
    );
  });

  it("rejects on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network down")),
    );
    await expect(fetchCarData("1")).rejects.toThrow("network down");
  });

  it("tolerates optional fields being absent", async () => {
    const sparse = JSON.parse(JSON.stringify(FIXTURE)) as {
      spec: Record<string, unknown>;
      vin?: unknown;
      photos?: unknown;
    };
    delete sparse.spec["displacement"];
    delete sparse.spec["seatCount"];
    delete sparse.vin;
    delete sparse.photos;
    stubFetchOk(sparse);

    const car = await fetchCarData("41344448");
    expect(car.displacementCc).toBeNull();
    expect(car.seatCount).toBeNull();
    expect(car.vin).toBeNull();
    expect(car.photoUrls).toEqual([]);
  });
});
