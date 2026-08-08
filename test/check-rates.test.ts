/**
 * The tariff watch is the only thing standing between a decree nobody read and
 * a wrong price in front of a paying client. Its failure mode is not a crash —
 * it is a green run that checked nothing, because an extractor that matched
 * zero rows and a config that matches the source produce the same "0
 * differences". Most of this suite exists to pin that distinction.
 *
 * Fixtures under test/fixtures/rates/ are trimmed captures of the real pages
 * (2026-08-08), so the extractors are exercised against the sources' actual
 * markup — including the law page that splits "куб. см" across two cells and
 * the decree that states its scale three times over. No test touches the
 * network: every run is driven through an injected fetch.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTHORITY_FEED_URL,
  OBSERVATIONS_BEGIN,
  OBSERVATIONS_END,
  QUOTE_LIMIT,
  RECYCLING_GAP_NOTE,
  checkAsOfStaleness,
  clampQuote,
  compareClearance,
  compareDuty,
  compareSources,
  decodeBody,
  isSupersededEdition,
  matchAuthorityItems,
  parseAuthorityFeed,
  parseClearanceFromLaw,
  parseDutyFromLawTables,
  parseDutyFromPre,
  parseRuNumber,
  readObservationBlock,
  renderReport,
  runWatches,
  worstOutcome,
  writeObservationBlock,
} from "../scripts/check-rates.mjs";
import { DEFAULT_CONFIG } from "../src/config.default";

function fixture(name: string): string {
  return readFileSync(resolve("test/fixtures/rates", name), "utf8");
}

const DUTY_LAW = fixture("duty-eek107.html");
const DUTY_LAW_SUPERSEDED = fixture("duty-eek107-superseded.html");
const DUTY_PRE = fixture("duty-auto-pre.html");
const CLEARANCE = fixture("clearance-pp1637.html");
const CLEARANCE_SUPERSEDED = fixture("clearance-pp1637-superseded.html");
const FEED = fixture("authority-feed.json");

/** The shipped config, which the sources are expected to reproduce exactly. */
const CUSTOMS = DEFAULT_CONFIG.customs;

/** A response the runner accepts, built from a fixture string. */
function respond(body: string, contentType = "text/html; charset=utf-8") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

/** A fetch that answers from a url -> body map and throws on anything else. */
function fetchFrom(bodies: Record<string, string>) {
  return async (url: string) => {
    const body = bodies[url];
    if (body === undefined) throw new Error(`unexpected url ${url}`);
    return respond(body, url.endsWith(".json") ? "application/json" : undefined);
  };
}

const LIVE_URLS = {
  duty: "https://law.tks.ru/document/833411",
  dutyCross: "https://www.tks.ru/auto/2000000008/",
  clearance: "https://law.tks.ru/document/778729",
  feed: AUTHORITY_FEED_URL,
};

/** Every watch answering with today's real pages. */
function healthyBodies(): Record<string, string> {
  return {
    [LIVE_URLS.duty]: DUTY_LAW,
    [LIVE_URLS.dutyCross]: DUTY_PRE,
    [LIVE_URLS.clearance]: CLEARANCE,
    [LIVE_URLS.feed]: FEED,
  };
}

/** `asOf` is 2026-01-01, so any clock inside 2026 leaves it fresh. */
const NOW = new Date("2026-08-08T00:00:00Z");

describe("decodeBody", () => {
  it("decodes windows-1251 when the server says so", () => {
    // tks.ru/auto/calc/ is cp1251 while law.tks.ru is utf-8; a hardcoded
    // encoding turns every Cyrillic anchor into mojibake and every extractor
    // silently finds nothing.
    const bytes = new Uint8Array([0xd1, 0xf2, 0xe0, 0xe2, 0xea, 0xe0]);
    expect(decodeBody(bytes.buffer, "text/html; charset=windows-1251")).toBe("Ставка");
  });

  it("defaults to utf-8 when no charset is declared", () => {
    const bytes = new TextEncoder().encode("Ставка");
    expect(decodeBody(bytes.buffer, "text/html")).toBe("Ставка");
  });

  it("falls back to utf-8 rather than throwing on an unknown charset", () => {
    const bytes = new TextEncoder().encode("Ставка");
    expect(decodeBody(bytes.buffer, "text/html; charset=x-made-up")).toBe("Ставка");
  });
});

describe("parseRuNumber", () => {
  it("reads comma decimals, space-grouped thousands, and bare integers", () => {
    expect(parseRuNumber("2,5")).toBe(2.5);
    expect(parseRuNumber("8 500")).toBe(8500);
    expect(parseRuNumber("8 500")).toBe(8500);
    expect(parseRuNumber("3")).toBe(3);
  });

  it("refuses anything that is not a clean number", () => {
    // A garbled cell must read as "not parsed", never as NaN quietly compared.
    for (const bad of ["", "—", "2,5,5", "около 3", "3%"]) {
      expect(parseRuNumber(bad)).toBeUndefined();
    }
  });
});

describe("duty extractor (law.tks.ru tables)", () => {
  const observed = parseDutyFromLawTables(DUTY_LAW);

  it("reproduces the shipped duty scale exactly", () => {
    expect(compareDuty(observed, CUSTOMS)).toEqual([]);
  });

  it("finds all 18 brackets across the three age regimes", () => {
    expect(observed.dutyValueTiers).toHaveLength(6);
    expect(observed.dutyPerCcByAge.y3).toHaveLength(6);
    expect(observed.dutyPerCcByAge.y5plus).toHaveLength(6);
  });

  it("reads the upper bound of the bracket whose unit is split across cells", () => {
    // The page really does end this cell at "…не превышает 1 800 куб." with the
    // "см" carried into the next row. A stricter unit match dropped the bound
    // and reported a phantom difference against a correct config.
    expect(observed.dutyPerCcByAge.y3[2]).toEqual({ maxCc: 1800, eurPerCc: 2.5 });
  });

  it("leaves the last bracket of every band open-ended", () => {
    expect(observed.dutyValueTiers[5]?.maxEur).toBeUndefined();
    expect(observed.dutyPerCcByAge.y3[5]?.maxCc).toBeUndefined();
    expect(observed.dutyPerCcByAge.y5plus[5]?.maxCc).toBeUndefined();
  });

  it("reports a moved percent with the config path and both values", () => {
    const moved = parseDutyFromLawTables(
      DUTY_LAW.replace("54 процента от стоимости", "52 процента от стоимости"),
    );
    const findings = compareDuty(moved, CUSTOMS);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.configPath).toBe("customs.dutyValueTiers[0].pct");
    expect(findings[0]!.expected).toBe(54);
    expect(findings[0]!.actual).toBe(52);
  });

  it("reports a moved per-cc rate", () => {
    const moved = parseDutyFromLawTables(
      DUTY_LAW.replace("5,7 евро за 1 куб. см", "6,1 евро за 1 куб. см"),
    );
    const findings = compareDuty(moved, CUSTOMS);
    expect(findings.map((f) => f.configPath)).toContain(
      "customs.dutyPerCcByAge.y5plus[5].eurPerCc",
    );
  });
});

describe("duty cross-check extractor (tks.ru pseudo-tables)", () => {
  const primary = parseDutyFromLawTables(DUTY_LAW);
  const secondary = parseDutyFromPre(DUTY_PRE);

  it("reads the same 18 brackets out of the ASCII tables", () => {
    expect(secondary.dutyValueTiers).toHaveLength(6);
    expect(secondary.dutyPerCcByAge.y3).toHaveLength(6);
    expect(secondary.dutyPerCcByAge.y5plus).toHaveLength(6);
  });

  it("agrees with the decree today", () => {
    expect(compareSources(primary, secondary)).toEqual([]);
  });

  it("reports a disagreement between the two sources as its own finding", () => {
    // tks is the operator's reference and the decree is the authority; when
    // they diverge the watch reports it rather than picking a winner.
    const diverged = parseDutyFromPre(
      DUTY_PRE.replace("1,5 Евро/1 куб.см", "1,9 Евро/1 куб.см"),
    );
    const findings = compareSources(primary, diverged);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("sources disagree");
    expect(findings[0]!.configPath).toBe("customs.dutyPerCcByAge.y3[0].eurPerCc");
  });
});

describe("clearance-fee extractor", () => {
  const observed = parseClearanceFromLaw(CLEARANCE);

  it("reproduces the shipped eight brackets exactly", () => {
    expect(observed).toHaveLength(8);
    expect(compareClearance(observed, CUSTOMS)).toEqual([]);
  });

  it("stops at the export paragraph instead of eating the whole decree", () => {
    // The decree states its scale several times over — for exports and inside
    // its appendices. Reading the whole page found 25 clauses where the config
    // has 8 brackets, and the extra 17 price cargo this widget never quotes.
    expect(observed.map((bracket) => bracket.fee)).toEqual([
      1231, 2462, 4924, 13541, 18465, 21344, 49240, 73860,
    ]);
  });

  it("reads the upper bound out of a clause that contains its own periods", () => {
    // "200 тыс. рублей" — terminating the clause at the first "." truncated
    // every bound and reported six phantom differences.
    expect(observed[1]).toEqual({ maxRub: 450000, fee: 2462 });
    expect(observed[7]?.maxRub).toBeUndefined();
  });

  it("reports a moved fee with its bracket index", () => {
    const moved = parseClearanceFromLaw(
      CLEARANCE.replace("13541 рубль", "14000 рублей"),
    );
    const findings = compareClearance(moved, CUSTOMS);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.configPath).toBe("customs.clearanceFeeBrackets[3].fee");
  });

  it("reads the superseded edition's own (different) numbers", () => {
    // Proof the extractor is reading the page rather than recognising the
    // config: the previous edition parses to the previous grid.
    const previous = parseClearanceFromLaw(CLEARANCE_SUPERSEDED);
    expect(previous.map((bracket) => bracket.fee)).toEqual([
      1067, 2134, 4269, 11746, 16524, 21344, 27540, 30000,
    ]);
  });
});

describe("edition staleness", () => {
  it("does not flag a current page whose links mention other superseded acts", () => {
    // The CURRENT edition of ПП 1637 links to another, superseded act and
    // carries the phrase inside that link's `title` attribute. Matching the
    // bare phrase reported this very page — the one we read the fee from — as
    // stale.
    expect(CLEARANCE).toContain("Недействующая редакция");
    expect(isSupersededEdition(CLEARANCE).superseded).toBe(false);
    expect(isSupersededEdition(DUTY_LAW).superseded).toBe(false);
  });

  it("flags a superseded page and names its successor", () => {
    const edition = isSupersededEdition(DUTY_LAW_SUPERSEDED);
    expect(edition.superseded).toBe(true);
    expect(edition.successor).toBe("https://law.tks.ru/document/833411");
    expect(edition.quote).toContain("Недействующая редакция");
  });

  it("flags the superseded clearance edition too", () => {
    expect(isSupersededEdition(CLEARANCE_SUPERSEDED).successor).toBe(
      "https://law.tks.ru/document/778729",
    );
  });
});

describe("authority feed", () => {
  const items = parseAuthorityFeed(JSON.parse(FEED));

  it("normalises items into eoNumber, title, date and document url", () => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.eoNumber).toMatch(/^\d+$/);
      expect(item.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.url).toContain(item.eoNumber);
    }
  });

  it("matches an amendment that names both the number and the date", () => {
    const matches = matchAuthorityItems([
      {
        eoNumber: "0001202611200001",
        title:
          "Постановление Правительства Российской Федерации от 15.11.2026 № 2101 " +
          '"О внесении изменений в постановление Правительства Российской ' +
          'Федерации от 26 декабря 2013 г. № 1291"',
        published: "2026-11-20",
        url: "http://publication.pravo.gov.ru/document/0001202611200001",
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.decrees).toEqual(["pp-1291"]);
  });

  it("ignores a bare number collision", () => {
    // "1291" alone collides with unrelated decrees and with internal
    // references, so the base decree's date is required too.
    const matches = matchAuthorityItems([
      {
        eoNumber: "0001202611200002",
        title:
          "Постановление Правительства Российской Федерации от 15.11.2026 № 1291 " +
          '"Об утверждении правил предоставления субсидий"',
        published: "2026-11-20",
        url: "http://publication.pravo.gov.ru/document/0001202611200002",
      },
    ]);
    expect(matches).toEqual([]);
  });

  it("catches a reform that never names a base decree, by keyword", () => {
    // ПП 1713 is exactly this shape: the utility-fee reform whose title does
    // not cite ПП 1291 at all.
    const matches = matchAuthorityItems([
      {
        eoNumber: "0001202611200003",
        title:
          "Постановление Правительства Российской Федерации от 15.11.2026 № 2102 " +
          '"Об утилизационном сборе в отношении транспортных средств"',
        published: "2026-11-20",
        url: "http://publication.pravo.gov.ru/document/0001202611200003",
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.keyword).toBe(true);
  });

  it("ignores today's ordinary decrees", () => {
    const matches = matchAuthorityItems(
      items.filter((item) => !/утилизацион/i.test(item.title)),
    );
    expect(matches.every((match) => match.decrees.length > 0)).toBe(true);
  });
});

describe("asOf staleness — the backstop for the unwatched recycling fee", () => {
  it("is quiet while asOf is at or after the last 1 January", () => {
    expect(checkAsOfStaleness({ asOf: "2026-01-01" }, NOW)).toEqual([]);
  });

  it("fires when the annual indexation passed without a re-derivation", () => {
    const findings = checkAsOfStaleness({ asOf: "2025-12-01" }, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.configPath).toBe("customs.asOf");
    expect(findings[0]!.message).toContain("2026-01-01");
  });

  it("uses the previous 1 January before this year's has arrived", () => {
    // On 2026-01-01 itself the boundary is that day, not next year's.
    expect(checkAsOfStaleness({ asOf: "2026-01-01" }, new Date("2026-01-01T00:00:00Z")))
      .toEqual([]);
    expect(
      checkAsOfStaleness({ asOf: "2025-06-01" }, new Date("2025-12-31T00:00:00Z")),
    ).toEqual([]);
  });

  it("treats an unparseable asOf as broken, not as fresh", () => {
    const findings = checkAsOfStaleness({ asOf: "soon" }, NOW);
    expect(findings[0]!.kind).toBe("broken");
  });
});

describe("worstOutcome", () => {
  it("never lets a broken watch read as a clean run", () => {
    expect(worstOutcome("ok", "changed")).toBe("changed");
    expect(worstOutcome("changed", "broken")).toBe("broken");
    expect(worstOutcome("broken", "ok")).toBe("broken");
    expect(worstOutcome("ok", "ok")).toBe("ok");
  });
});

describe("runWatches", () => {
  it("reports ok when every source reproduces the shipped config", async () => {
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(healthyBodies()),
      now: NOW,
    });
    expect(report.outcome).toBe("ok");
    expect(report.watches.flatMap((watch) => watch.findings)).toEqual([]);
  });

  it("is broken — not ok — when an extractor finds nothing", async () => {
    // The failure this whole job exists to prevent: an empty parse and a
    // correct config both produce "0 differences".
    const bodies = healthyBodies();
    bodies[LIVE_URLS.duty] = "<html><body>под реконструкцией</body></html>";
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
    });
    expect(report.outcome).toBe("broken");
    const duty = report.watches.find((watch) => watch.id === "duty-eek107");
    expect(duty!.outcome).toBe("broken");
    expect(duty!.findings[0]!.message).toContain("NOT checked");
  });

  it("is broken when the clearance prose loses a bracket", async () => {
    const bodies = healthyBodies();
    bodies[LIVE_URLS.clearance] = CLEARANCE.replace(
      /73860 рублей - за таможенные операции/,
      "73860 условных единиц - за нечто иное",
    );
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
    });
    expect(report.outcome).toBe("broken");
  });

  it("is broken on a failed fetch, and the other watches still run", async () => {
    const bodies = healthyBodies();
    delete bodies[LIVE_URLS.clearance];
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
    });
    expect(report.outcome).toBe("broken");
    expect(report.watches.find((watch) => watch.id === "duty-eek107")!.outcome).toBe(
      "ok",
    );
  });

  it("is broken on a non-200 response", async () => {
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        headers: { get: () => "text/html" },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
      now: NOW,
    });
    expect(report.outcome).toBe("broken");
    expect(report.watches.every((watch) => watch.outcome === "broken")).toBe(true);
  });

  it("is changed when a published number moves", async () => {
    const bodies = healthyBodies();
    bodies[LIVE_URLS.clearance] = CLEARANCE.replace("1231 рубль", "1300 рублей");
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
    });
    expect(report.outcome).toBe("changed");
    const finding = report.watches
      .flatMap((watch) => watch.findings)
      .find((item) => item.configPath === "customs.clearanceFeeBrackets[0].fee");
    expect(finding!.actual).toBe(1300);
  });

  it("is changed when a pinned document goes superseded, numbers or not", async () => {
    const bodies = healthyBodies();
    bodies[LIVE_URLS.duty] = DUTY_LAW_SUPERSEDED;
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
    });
    expect(report.outcome).toBe("changed");
    const finding = report.watches
      .flatMap((watch) => watch.findings)
      .find((item) => item.message.includes("superseded edition"));
    expect(finding!.message).toContain("833411");
  });

  it("reports a new watched decree once and stays quiet on the next run", async () => {
    const feed = JSON.parse(FEED) as { items: Record<string, unknown>[] };
    feed.items.unshift({
      eoNumber: "0001202611200001",
      complexName:
        "Постановление Правительства Российской Федерации от 15.11.2026 № 2101 " +
        '"О внесении изменений в постановление Правительства Российской ' +
        'Федерации от 26 декабря 2013 г. № 1291"',
      publishDateShort: "2026-11-20T00:00:00",
    });
    const bodies = healthyBodies();
    bodies[LIVE_URLS.feed] = JSON.stringify(feed);

    const first = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
    });
    expect(first.outcome).toBe("changed");
    expect(
      first.watches
        .find((watch) => watch.id === "authority-feed")!
        .findings[0]!.message,
    ).toContain("pp-1291");

    const second = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
      previousObservations: first.observations,
    });
    expect(second.outcome).toBe("ok");
  });

  it("says so when the feed window skipped past the last reading", async () => {
    // Page 1 spans about seven weeks. A longer outage loses events, and
    // "no new decrees" would then be a lie rather than an observation.
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(healthyBodies()),
      now: NOW,
      previousObservations: { "authority-feed": { watermark: "2020-01-01", seen: [] } },
    });
    expect(report.outcome).toBe("changed");
    expect(
      report.watches
        .find((watch) => watch.id === "authority-feed")!
        .findings.some((item) => item.message.includes("skipped past us")),
    ).toBe(true);
  });

  it("fires the asOf backstop even when every source matches", async () => {
    const stale = {
      ...DEFAULT_CONFIG,
      customs: { ...DEFAULT_CONFIG.customs, asOf: "2025-03-01" },
    };
    const report = await runWatches({
      config: stale,
      fetchImpl: fetchFrom(healthyBodies()),
      now: NOW,
    });
    expect(report.outcome).toBe("changed");
    expect(report.watches.find((watch) => watch.id === "asof-staleness")).toBeDefined();
  });
});

describe("renderReport", () => {
  it("names the config path, both values, the source and the quoted text", async () => {
    const bodies = healthyBodies();
    bodies[LIVE_URLS.clearance] = CLEARANCE.replace("1231 рубль", "1300 рублей");
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(bodies),
      now: NOW,
    });
    const body = renderReport(report);
    expect(body).toContain("customs.clearanceFeeBrackets[0].fee");
    expect(body).toContain("1231");
    expect(body).toContain("1300");
    expect(body).toContain("https://law.tks.ru/document/778729");
  });

  it("carries the recycling-fee gap notice even on a clean run", async () => {
    // A block nobody watches by number must never be indistinguishable from a
    // block that matched.
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: fetchFrom(healthyBodies()),
      now: NOW,
    });
    expect(renderReport(report)).toContain(RECYCLING_GAP_NOTE);
  });

  it("refuses to let a broken run read as a verdict about the config", async () => {
    const report = await runWatches({
      config: DEFAULT_CONFIG,
      fetchImpl: async () => {
        throw new Error("network down");
      },
      now: NOW,
    });
    const body = renderReport(report);
    expect(body).toContain("BROKEN");
    expect(body).toContain("No conclusion about the");
  });
});

describe("clampQuote", () => {
  it("bounds a quoted source line so a layout change cannot paste a page", () => {
    const clamped = clampQuote("а".repeat(QUOTE_LIMIT * 2));
    expect(clamped).toHaveLength(QUOTE_LIMIT + 1);
    expect(clamped.endsWith("…")).toBe(true);
  });

  it("leaves a short line alone", () => {
    expect(clampQuote("  Недействующая  редакция.  ")).toBe("Недействующая редакция.");
  });
});

describe("the observation block", () => {
  const doc = [
    "# Where the numbers come from",
    "",
    "Human prose above.",
    "",
    OBSERVATIONS_BEGIN,
    "",
    "```json",
    '{ "checkedAt": null, "observations": {} }',
    "```",
    "",
    OBSERVATIONS_END,
    "",
    "Human prose below.",
    "",
  ].join("\n");

  it("replaces only the delimited region", () => {
    const written = writeObservationBlock(doc, { duty: { rows: 18 } }, "2026-08-08");
    expect(written.startsWith("# Where the numbers come from\n\nHuman prose above.")).toBe(
      true,
    );
    expect(written.endsWith("Human prose below.\n")).toBe(true);
    expect(written).toContain('"rows": 18');
  });

  it("round-trips through the reader", () => {
    const written = writeObservationBlock(doc, { duty: { rows: 18 } }, "2026-08-08");
    expect(readObservationBlock(written)).toEqual({ duty: { rows: 18 } });
  });

  it("throws rather than appending when the markers are missing", () => {
    // Silently appending would leave the previous observation in place and the
    // diff would show a change that never happened.
    expect(() => writeObservationBlock("# no markers here\n", {}, "2026-08-08")).toThrow(
      /missing the observation markers/,
    );
  });

  it("reads an absent or corrupt block as empty rather than throwing", () => {
    expect(readObservationBlock("# nothing\n")).toEqual({});
    expect(
      readObservationBlock(
        `${OBSERVATIONS_BEGIN}\n\`\`\`json\n{ not json \n\`\`\`\n${OBSERVATIONS_END}`,
      ),
    ).toEqual({});
  });
});

describe("the shipped source map", () => {
  it("carries the markers the job writes into", () => {
    const map = readFileSync(resolve("docs/harness/rates-source.md"), "utf8");
    expect(map).toContain(OBSERVATIONS_BEGIN);
    expect(map).toContain(OBSERVATIONS_END);
    expect(() => writeObservationBlock(map, {}, "2026-08-08")).not.toThrow();
  });

  it("names every url the watches actually fetch", () => {
    // A source map that drifts from the code is worse than none: the next
    // reader would re-pin the wrong page.
    const map = readFileSync(resolve("docs/harness/rates-source.md"), "utf8");
    for (const url of [LIVE_URLS.duty, LIVE_URLS.dutyCross, LIVE_URLS.clearance]) {
      expect(map).toContain(url.replace(/^https?:\/\//, ""));
    }
  });
});
