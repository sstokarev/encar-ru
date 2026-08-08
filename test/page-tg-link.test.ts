/**
 * U3: the messenger draft link. The draft must carry the lot URL and the
 * total with its honest precision marker — and no number at all when the
 * quote is "on request".
 */
import { describe, expect, it } from "vitest";

import type { AllInResult } from "../src/calc/customs";
import type { MessengerConfig } from "../src/config";
import { buildDraftLink } from "../src/page/tg-link";

const TG: MessengerConfig = { type: "telegram", address: "globalcartrade" };

function allIn(overrides: Partial<AllInResult> = {}): AllInResult {
  return { items: [], totalRub: 3_456_789, precision: "exact", notes: [], ...overrides };
}

const LOT_URL = "https://fem.encar.com/cars/detail/41756847";

function decodedText(link: string): string {
  const url = new URL(link);
  const text = url.searchParams.get("text");
  expect(text).not.toBeNull();
  return text as string;
}

describe("buildDraftLink", () => {
  it("builds a t.me link whose draft carries the lot URL and the total", () => {
    const link = buildDraftLink(TG, "Kia Sorento", LOT_URL, allIn());
    expect(link.startsWith("https://t.me/globalcartrade?text=")).toBe(true);
    const text = decodedText(link);
    expect(text).toContain("Kia Sorento");
    expect(text).toContain(LOT_URL);
    expect(text).toContain("3 456 789 ₽");
  });

  it("keeps the lower-bound marker on a partial total", () => {
    const text = decodedText(
      buildDraftLink(TG, "Car", LOT_URL, allIn({ precision: "partial" })),
    );
    expect(text).toContain("от 3 456 789 ₽");
  });

  it("keeps the approximation marker on an approx total", () => {
    const text = decodedText(
      buildDraftLink(TG, "Car", LOT_URL, allIn({ precision: "approx" })),
    );
    expect(text).toContain("≈ 3 456 789 ₽");
  });

  it("quotes no number when the quote is on request", () => {
    const text = decodedText(
      buildDraftLink(TG, "Car", LOT_URL, allIn({ precision: "onRequest" })),
    );
    expect(text).toContain("по запросу");
    expect(text).not.toContain("3 456 789");
  });

  it("percent-encodes a hostile address instead of letting it rewrite the link", () => {
    const link = buildDraftLink(
      { type: "telegram", address: "abc?start=evil" },
      "Car",
      LOT_URL,
      allIn(),
    );
    const url = new URL(link);
    expect(url.host).toBe("t.me");
    expect(url.pathname).toBe("/abc%3Fstart%3Devil");
    expect(url.searchParams.get("start")).toBeNull();
  });

  it("builds a wa.me link for a whatsapp config", () => {
    const link = buildDraftLink(
      { type: "whatsapp", address: "+79990001122" },
      "Car",
      LOT_URL,
      allIn(),
    );
    expect(link.startsWith("https://wa.me/%2B79990001122?text=")).toBe(true);
  });
});
