// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { runLoader, WIDGET_ORIGIN, type LoaderWindow } from "../src/loader/bookmarklet";

/** Formats a date the same way the loader must: YYYYMMDD, zero-padded. */
function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

/** Builds a minimal fake window over the real jsdom document. */
function makeWin(hostname: string): LoaderWindow {
  return { location: { hostname }, document };
}

function scriptTags(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script"));
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("bookmarklet loader", () => {
  it("does nothing on a non-encar host", () => {
    runLoader(makeWin("example.com"));
    runLoader(makeWin("google.com"));
    runLoader(makeWin("notencar.com")); // ends with "encar.com" but is not encar
    expect(scriptTags()).toHaveLength(0);
  });

  it("appends the core script with origin and fresh v=YYYYMMDD on *.encar.com", () => {
    runLoader(makeWin("fem.encar.com"));

    const tags = scriptTags();
    expect(tags).toHaveLength(1);
    const src = tags[0]!.src;
    expect(src).toBe(`https://${WIDGET_ORIGIN}/widget.js?v=${todayStamp()}`);
  });

  it("works on the apex encar.com host too", () => {
    runLoader(makeWin("encar.com"));
    expect(scriptTags()).toHaveLength(1);
  });

  it("second invocation adds no second tag and calls rescan()", () => {
    const win = makeWin("fem.encar.com");
    runLoader(win);
    expect(scriptTags()).toHaveLength(1);

    // Core has loaded by now and exposed the API on window.
    const rescan = vi.fn();
    win.__encarRu = { rescan };

    runLoader(win);

    expect(scriptTags()).toHaveLength(1);
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("does not stack script tags while the core is still loading", () => {
    // No __encarRu yet (script requested but not executed): still idempotent.
    const win = makeWin("fem.encar.com");
    runLoader(win);
    runLoader(win);
    expect(scriptTags()).toHaveLength(1);
  });
});
