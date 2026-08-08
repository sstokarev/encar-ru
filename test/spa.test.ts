// @vitest-environment jsdom
/**
 * Soft-navigation regressions (U11).
 *
 * Both encar front-ends are SPAs — www.encar.com routes its search list through
 * the URL hash, fem.encar.com opens car screens with pushState — and neither
 * reloads the document. Two failures follow from that, and both put a WRONG
 * number in front of the client rather than no number:
 *
 *  1. the page rewrites a price inside the SAME element (React updating the
 *     node instead of replacing it). The annotation marker still says "done",
 *     so the scan skipped the element and the previous car's badge stayed;
 *  2. the route changes with almost no DOM movement — an attribute update on
 *     the price and nothing the MutationObserver reports as an added node. No
 *     rescan ran at all, so the badge kept the old car's total and, on a
 *     detail screen, the breakdown never appeared.
 *
 * Live check on 2026-08-02 (www.encar.com search list, page 1 -> page 2 with no
 * reload) is what made this concrete: the shipped build annotated 42 rows and
 * then 0 after paging.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { init } from "../src/main";
import { badgeText as renderBadgeText } from "../src/ui/badge";
import { computeQuote } from "../src/calc/pricing";
import { DEFAULT_CONFIG } from "../src/config.default";
import { ANNOTATED_ATTR } from "../src/scan/scanner";
import { refreshStale } from "../src/scan/refresh";

/** Config-tier rates: no network in the tests, so these are what resolve. */
const RATES = { krwRub: 0.055, eurRub: 90 };

/** Two macrotask ticks flush the config + rates chain with fetch stubbed out. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Covers the 100 ms observer debounce plus the promise chain. */
async function settleObserver(): Promise<void> {
  await new Promise((r) => setTimeout(r, 400));
  await settle();
}

/** Covers the URL poll (700 ms) plus the chain — no DOM mutation involved. */
async function settleUrlWatch(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000));
  await settle();
}

function badgeHosts(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-encar-ru-badge]"),
  ];
}

function badgeText(host: HTMLElement): string {
  return host.shadowRoot?.querySelector("span")?.textContent ?? "";
}

/** What the badge must read for a lot of `krw` with no params known. */
function expectedText(krw: number): string {
  return renderBadgeText(
    computeQuote({ priceKrw: krw }, RATES, DEFAULT_CONFIG),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("a price rewritten in place (U11)", () => {
  it("re-badges the element instead of keeping the previous car's total", async () => {
    document.body.innerHTML =
      '<div id="row"><span class="prc"><strong>2,500</strong>만원</span></div>';
    init();
    await settle();

    expect(badgeHosts().length).toBe(1);
    expect(badgeText(badgeHosts()[0]!)).toBe(expectedText(25_000_000));

    // The SPA renders another car into the same node.
    const price = document.querySelector(".prc")!;
    price.textContent = "1,000만원";
    await settleObserver();

    const hosts = badgeHosts();
    // Exactly one badge: the stale one is removed, not stacked on top of.
    expect(hosts.length).toBe(1);
    expect(badgeText(hosts[0]!)).toBe(expectedText(10_000_000));
    expect(price.getAttribute(ANNOTATED_ATTR)).toBe("10000000");
  });

  it("leaves an untouched price alone (no badge churn on rescans)", async () => {
    document.body.innerHTML =
      '<div><span class="prc"><strong>2,500</strong>만원</span></div>';
    init();
    await settle();

    const host = badgeHosts()[0]!;
    window.__encarRu?.rescan();
    await settle();

    // Same node, not a rebuilt one.
    expect(badgeHosts()[0]).toBe(host);
    expect(badgeText(host)).toBe(expectedText(25_000_000));
  });
});

describe("client-side route change (U11)", () => {
  it("re-annotates a detail screen whose price changed without any added node", async () => {
    window.history.replaceState(null, "", "/cars/detail/1");
    document.body.innerHTML =
      '<div id="box"><span data-intl-currency-amount="25000000">2,500</span>' +
      '<span data-intl-currency-unit="">만원</span></div>';
    init();
    await settle();

    expect(badgeText(badgeHosts()[0]!)).toBe(expectedText(25_000_000));
    expect(
      document.querySelectorAll("[data-encar-ru-breakdown]").length,
    ).toBe(1);

    // Soft navigation to another car: fem pushes a new URL and updates the
    // price attribute in place. Nothing is ADDED to the DOM, so the
    // MutationObserver reports nothing — only the URL watcher can notice.
    const price = document.querySelector("[data-intl-currency-amount]")!;
    price.setAttribute("data-intl-currency-amount", "10000000");
    price.textContent = "1,000";
    window.history.pushState(null, "", "/cars/detail/2");
    await settleUrlWatch();

    expect(badgeHosts().length).toBe(1);
    expect(badgeText(badgeHosts()[0]!)).toBe(expectedText(10_000_000));
    const controls = document.querySelectorAll("[data-encar-ru-breakdown]");
    expect(controls.length).toBe(1);
    expect(controls[0]!.shadowRoot?.textContent).toContain(
      expectedText(10_000_000),
    );
  });
});

describe("refreshStale in isolation", () => {
  it("keeps pre-U11 badges (marker '1') rather than rebuilding them", () => {
    document.body.innerHTML =
      '<span class="prc" data-encar-ru="1"><strong>2,500</strong>만원</span>';
    const price = document.querySelector(".prc")!;
    expect(refreshStale(document)).toEqual([]);
    expect(price.hasAttribute(ANNOTATED_ATTR)).toBe(true);
  });

  it("does not detach while the price is momentarily unparseable", () => {
    document.body.innerHTML =
      '<span class="prc" data-encar-ru="25000000"></span>';
    const price = document.querySelector(".prc")!;
    expect(refreshStale(document)).toEqual([]);
    expect(price.getAttribute(ANNOTATED_ATTR)).toBe("25000000");
  });

  it("resets the element the scope itself is", () => {
    document.body.innerHTML =
      '<span class="prc" data-encar-ru="25000000"><strong>1,000</strong>만원</span>';
    const price = document.querySelector<HTMLElement>(".prc")!;
    expect(refreshStale(price)).toEqual([price]);
    expect(price.hasAttribute(ANNOTATED_ATTR)).toBe(false);
  });
});
