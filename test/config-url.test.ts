/**
 * Which config.json each surface loads — the two halves of one rule, pinned
 * together because getting either one wrong is invisible on screen.
 *
 * THE PAGE (site/calc.html, site/landing.html) ships next to its own
 * config.json and must read THAT one. Before this, the page fetched the
 * production URL wherever it was served from, so an operator reviewing a branch
 * build on localhost was shown the new bundle driving the OLD published cost
 * items — dashed «СБКТС и ЭПТС» and «Брокер и СВХ» lines that the new config
 * does not contain. Nothing looked broken; the page was simply not testable
 * before deploy.
 *
 * THE WIDGET is injected into encar.com. "Next to the page" there is
 * encar.com/config.json — someone else's origin, and on a bad day someone
 * else's tariffs. It must keep the absolute URL, always.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONFIG_URL,
  loadConfig,
  loadPageConfig,
  sameOriginConfigUrl,
} from "../src/config";
import { DEFAULT_CONFIG, type WidgetConfig } from "../src/config.default";

const REMOTE: WidgetConfig = {
  ...DEFAULT_CONFIG,
  commissionNote: "Опубликованная конфигурация.",
};

const OWN: WidgetConfig = {
  ...DEFAULT_CONFIG,
  commissionNote: "Конфигурация рядом со страницей.",
};

/** Serves a body per URL; anything unlisted answers 404. */
function stubFetch(bodies: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const mock = vi.fn((url: string) =>
    Object.hasOwn(bodies, url)
      ? Promise.resolve({
          ok: true,
          status: 200,
          json: async () => bodies[url],
        } as unknown as Response)
      : Promise.resolve({ ok: false, status: 404 } as unknown as Response),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sameOriginConfigUrl", () => {
  it("points at the config.json beside the page", () => {
    expect(sameOriginConfigUrl("https://example.com/calc.html")).toBe(
      "https://example.com/config.json",
    );
    expect(sameOriginConfigUrl("http://localhost:8000/calc.html")).toBe(
      "http://localhost:8000/config.json",
    );
  });

  it("stays inside the page's own directory on a project Pages site", () => {
    // github.io serves the repo under a path segment; resolving against the
    // page keeps /encar-ru/ instead of jumping to the domain root.
    expect(
      sameOriginConfigUrl("https://sstokarev.github.io/encar-ru/calc.html"),
    ).toBe(CONFIG_URL);
  });

  it("carries the query and hash of the page over to nothing", () => {
    expect(
      sameOriginConfigUrl("https://example.com/calc.html?lot=1#top"),
    ).toBe("https://example.com/config.json");
  });

  it("refuses a page with no usable origin", () => {
    // file:// has no origin to fetch from and the browser would block it.
    expect(sameOriginConfigUrl("file:///Users/x/site/calc.html")).toBeNull();
    expect(sameOriginConfigUrl("about:blank")).toBeNull();
    expect(sameOriginConfigUrl("")).toBeNull();
    expect(sameOriginConfigUrl("not a url")).toBeNull();
  });
});

describe("the page loads the config it was deployed with", () => {
  it("prefers its own config.json over the published one", async () => {
    const mock = stubFetch({
      "http://localhost:8000/config.json": OWN,
      [CONFIG_URL]: REMOTE,
    });
    const loaded = await loadPageConfig("http://localhost:8000/calc.html");
    expect(loaded.source).toBe("remote");
    expect(loaded.config.commissionNote).toBe(OWN.commissionNote);
    // And it never reached past its own directory.
    expect(mock.mock.calls.map((call) => call[0])).toEqual([
      "http://localhost:8000/config.json",
    ]);
  });

  it("falls back to the published config when it has none of its own", async () => {
    // A page copied somewhere without its config.json still quotes real
    // tariffs rather than dropping silently to the embedded copy.
    const mock = stubFetch({ [CONFIG_URL]: REMOTE });
    const loaded = await loadPageConfig("https://example.com/calc.html");
    expect(loaded.source).toBe("remote");
    expect(loaded.config.commissionNote).toBe(REMOTE.commissionNote);
    expect(mock.mock.calls.map((call) => call[0])).toEqual([
      "https://example.com/config.json",
      CONFIG_URL,
    ]);
  });

  it("falls back when its own config.json is malformed, not just missing", async () => {
    // A half-edited local file must not be preferred over a valid published
    // one just because it answered 200.
    stubFetch({
      "https://example.com/config.json": { version: 2 },
      [CONFIG_URL]: REMOTE,
    });
    const loaded = await loadPageConfig("https://example.com/calc.html");
    expect(loaded.source).toBe("remote");
    expect(loaded.config.commissionNote).toBe(REMOTE.commissionNote);
  });

  it("goes straight to the published config from a file:// open", async () => {
    const mock = stubFetch({ [CONFIG_URL]: REMOTE });
    const loaded = await loadPageConfig("file:///Users/x/site/calc.html");
    expect(loaded.source).toBe("remote");
    expect(mock.mock.calls.map((call) => call[0])).toEqual([CONFIG_URL]);
  });

  it("still ends at the embedded copy when nothing answers", async () => {
    const mock = stubFetch({});
    const loaded = await loadPageConfig("https://example.com/calc.html");
    expect(loaded.source).toBe("embedded");
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("the widget keeps the absolute URL", () => {
  it("loadConfig defaults to the published config, whatever the host page is", async () => {
    // The widget runs on encar.com. A relative fetch there would read
    // encar.com/config.json — someone else's origin.
    const mock = stubFetch({ [CONFIG_URL]: REMOTE });
    const loaded = await loadConfig();
    expect(loaded.source).toBe("remote");
    expect(mock.mock.calls.map((call) => call[0])).toEqual([CONFIG_URL]);
  });

  it("the widget entry never imports the page's same-origin loader", () => {
    // The cheap structural guard: if src/main.ts ever switches to
    // loadPageConfig, every widget on encar.com starts asking encar for
    // tariffs and quietly falls back to embedded data.
    const widget = readFileSync(resolve("src/main.ts"), "utf8");
    expect(widget).toContain("loadConfig");
    expect(widget).not.toContain("loadPageConfig");
  });
});
