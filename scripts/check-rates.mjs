/**
 * Weekly tariff watch: detect a change in the published rates, propose it, and
 * never land it (docs/tasks/rates-watch.md).
 *
 * The tariff numbers the widget quotes live in site/config.json behind an
 * `asOf` date. Nobody watched them, and the 01.12.2025 recycling-fee reform
 * landed by hand. This script fetches the published sources, extracts the
 * numbers the config actually uses, compares them, and — on a difference —
 * leaves a diff plus the quoted source text for a human to accept.
 *
 * It NEVER writes site/config.json or src/config.default.ts. A silent
 * auto-update would put a wrong price in front of a paying client; a parse of
 * legal prose belongs in CI, where it breaks in front of us instead.
 *
 * WHAT THE SOURCES ACTUALLY CARRY (measured 2026-08-08). The brief assumed
 * tks.ru/auto/calc/ carried "the numbers". It carries none: only the
 * calculator form, prose, and decree citations. The numbers are elsewhere, and
 * one of the three config blocks has no published, machine-readable source at
 * all:
 *
 *  - DUTY (Решение ЕЭК 107) — law.tks.ru document tables, cross-checked
 *    against the ASCII pseudo-tables on www.tks.ru/auto/2000000008/.
 *  - CLEARANCE FEE (ПП 1637 ред. 1638) — law.tks.ru, as prose paragraphs.
 *    Deliberately NOT read from www.tks.ru/auto/2000000008/, which still
 *    prints the superseded ПП 342 grid: a stale source that parses cleanly is
 *    worse than one that fails.
 *  - RECYCLING FEE (утильсбор, ПП 1291 ред. 1713) — NOT extractable anywhere.
 *    It is watched by SIGNAL only (a decree lands on the official feed; the
 *    config's own `asOf` falls behind the annual 1 January indexation), and
 *    every run prints that gap rather than reporting silence as health.
 *
 * THREE OUTCOMES, AND THEY MUST NEVER BE CONFUSED:
 *
 *  - "ok"      — every watch parsed and everything matched.
 *  - "changed" — a number moved, a decree landed, or a pinned document went
 *                superseded. The workflow opens a PR; a human accepts.
 *  - "broken"  — a fetch failed, or an extractor returned fewer rows than the
 *                source is known to carry. Exit code 1, the job goes red, and
 *                NOTHING is written. An extractor that matched nothing and a
 *                config that matches the source both produce "0 differences";
 *                only `minRows` tells them apart, and getting that wrong is the
 *                exact failure this whole task exists to prevent.
 *
 * A broken watch never silences the others: every watch runs, and the run's
 * outcome is the worst of them.
 *
 * Usage:
 *   node scripts/check-rates.mjs            # check, rewrite the observation
 *                                           # block on a change
 *   node scripts/check-rates.mjs --dry-run  # report only, write nothing
 *   node scripts/check-rates.mjs --body out.md   # also write the PR body
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const CONFIG_PATH = "site/config.json";
export const SOURCE_MAP_PATH = "docs/harness/rates-source.md";

/** Delimiters of the machine-maintained block inside the source map. */
export const OBSERVATIONS_BEGIN = "<!-- rates-watch:observations:begin -->";
export const OBSERVATIONS_END = "<!-- rates-watch:observations:end -->";

/**
 * How much of a source line may be quoted into a PR body. A layout change must
 * not be able to paste a whole page into a pull request.
 */
export const QUOTE_LIMIT = 400;

/* ------------------------------------------------------------ decoding ---- */

/**
 * Decodes a fetched body using the charset the SERVER declared.
 *
 * Not cosmetic: tks.ru serves /auto/calc/ as windows-1251 and law.tks.ru as
 * utf-8. A hardcoded encoding turns every Cyrillic anchor into mojibake, every
 * extractor finds nothing, and the run would report "0 differences" if
 * `minRows` did not exist.
 */
export function decodeBody(buffer, contentType = "") {
  const match = /charset=\s*"?([\w-]+)/i.exec(contentType);
  const charset = (match ? match[1] : "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    // An unknown label is a source change worth seeing, not a crash: decode as
    // utf-8 so the extractor can fail on content rather than on encoding.
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/* --------------------------------------------------------- html helpers ---- */

const ENTITIES = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  brvbar: "|",
};

/** Decodes the handful of entities these sources actually use. */
export function decodeEntities(text) {
  return text
    .replace(/&(nbsp|amp|lt|gt|quot|laquo|raquo|mdash|ndash|brvbar);/g, (_, name) =>
      ENTITIES[name],
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/**
 * Visible text of an HTML fragment, whitespace-collapsed.
 *
 * Tags are dropped rather than parsed: the cells carry `<a title='...'>`
 * attributes whose text must NOT reach the output (see isSupersededEdition —
 * those attributes contain the very phrase the staleness check looks for).
 */
export function textOf(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cell texts of every `<tr>` in the fragment, in document order. */
export function tableRows(html) {
  const rows = [];
  for (const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(textOf);
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Parses a Russian decimal ("2,5", "8 500", "3") into a number.
 *
 * Returns undefined for anything that is not a clean number, so a caller can
 * treat a garbled cell as a parse failure instead of as NaN.
 */
export function parseRuNumber(text) {
  if (typeof text !== "string") return undefined;
  const cleaned = text.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Exact money comparison on a fixed scale. Rates are money: no float
 * tolerance, no rounding to "close enough". The scale absorbs the binary
 * representation of values like 3.6 and nothing else.
 */
export function sameNumber(a, b) {
  if (a === undefined || b === undefined) return a === b;
  return Math.round(a * 1000) === Math.round(b * 1000);
}

/* ------------------------------------------------------ edition staleness -- */

/**
 * True when law.tks.ru is showing a SUPERSEDED edition of this document.
 *
 * The page announces it in an `alert-danger` banner ("Недействующая редакция
 * действующего документа.") followed by a link to the successor. The same
 * phrase also appears inside the `title=` attribute of every outbound link to
 * some other superseded act — on the CURRENT edition of ПП 1637 it appears
 * once, in exactly such an attribute. Matching the bare phrase would therefore
 * report every page as stale; the banner element is the only honest anchor.
 *
 * Our own pin going stale is a change worth a PR: it means the rates we read
 * are last year's, even when every number still matches.
 */
export function isSupersededEdition(html) {
  // Anchored on the banner's OPENING tag and a fixed window after it, not on a
  // matching close: the banner nests divs, and counting closing tags with a
  // regex is how a detector starts lying about which document it is reading.
  const opening = /<div\b[^>]*\balert-danger\b[^>]*>/i.exec(html);
  if (!opening) return { superseded: false };
  const banner = [html.slice(opening.index, opening.index + 800)];
  if (!/Недействующая редакция/.test(textOf(banner[0]))) {
    return { superseded: false };
  }
  const link = /href=["']([^"']*\/document\/\d+[^"']*)["']/i.exec(banner[0]);
  return {
    superseded: true,
    successor: link ? new URL(link[1], "https://law.tks.ru").toString() : undefined,
    quote: clampQuote(
      (/Недействующая редакция[^.]*\./.exec(textOf(banner[0])) ?? [""])[0],
    ),
  };
}

/** Trims a quoted source line to QUOTE_LIMIT, marking the cut. */
export function clampQuote(text) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= QUOTE_LIMIT ? line : `${line.slice(0, QUOTE_LIMIT)}…`;
}

/* ------------------------------------------------------------- extractors -- */

const DUTY_VALUE_TIER =
  /по единой ставке\s+(\d+)\s+процент\S*\s+от стоимости,\s*но не менее\s+([\d.,]+)\s+евро за 1 куб\.?\s*см/i;
const DUTY_PER_CC =
  /по единой ставке в размере\s+([\d.,]+)\s+евро за 1 куб\.?\s*см/i;
const UPPER_EUR = /не превышает\s+([\d\s ]+?)\s*евро/gi;
const UPPER_CC = /не превышает\s+([\d\s ]+?)\s*куб\.?(?:\s*см)?(?=[\s,;.]|$)/gi;

/**
 * Last "не превышает N <unit>" in a condition cell, or undefined when open.
 *
 * The unit's "см" is optional in UPPER_CC on purpose: the law page splits one
 * cell mid-unit, so the third 3-5y bracket really does end at "…не превышает
 * 1 800 куб." with the "см" carried into the NEXT row's cell. Requiring the
 * full unit silently dropped that bracket's upper bound and reported a
 * phantom difference against a config that was correct.
 */
function upperBound(text, pattern) {
  pattern.lastIndex = 0;
  let found;
  for (const match of text.matchAll(pattern)) found = match[1];
  return found === undefined ? undefined : parseRuNumber(found);
}

/**
 * Duty scale (Решение ЕЭК 107, Прил. 2, Табл. 2, пп. 1/3/4) from the
 * law.tks.ru document tables.
 *
 * Sections are recognised from the "прошло … лет" header rows; rate rows are
 * recognised from the rate cell's own wording, so an unrelated table elsewhere
 * on the page cannot contribute rows.
 */
export function parseDutyFromLawTables(html) {
  const tiers = [];
  const perCc = { y3: [], y5plus: [] };
  let section;
  for (const cells of tableRows(html)) {
    const joined = cells.join(" ");
    if (/прошло не более 3 лет/i.test(joined)) {
      section = "new";
      continue;
    }
    if (/прошло более 3 лет, но не более 5 лет/i.test(joined)) {
      section = "y3";
      continue;
    }
    if (/прошло более 5 лет/i.test(joined)) {
      section = "y5plus";
      continue;
    }
    if (section === undefined) continue;
    // The rate is whichever cell states one; the condition is the cell before
    // it. Column counts differ between the sources' tables.
    const rateIndex = cells.findIndex(
      (cell) => DUTY_VALUE_TIER.test(cell) || DUTY_PER_CC.test(cell),
    );
    if (rateIndex < 1) continue;
    const rate = cells[rateIndex];
    const condition = cells[rateIndex - 1];
    const tier = DUTY_VALUE_TIER.exec(rate);
    if (tier && section === "new") {
      tiers.push({
        maxEur: upperBound(condition, UPPER_EUR),
        pct: parseRuNumber(tier[1]),
        minPerCc: parseRuNumber(tier[2]),
      });
      continue;
    }
    const flat = DUTY_PER_CC.exec(rate);
    if (flat && (section === "y3" || section === "y5plus")) {
      perCc[section].push({
        maxCc: upperBound(condition, UPPER_CC),
        eurPerCc: parseRuNumber(flat[1]),
      });
    }
  }
  return { dutyValueTiers: tiers, dutyPerCcByAge: perCc };
}

/**
 * The same duty scale from the ASCII pseudo-tables on www.tks.ru/auto/…
 *
 * Cells are `&brvbar;`-separated and a logical row spans several physical
 * lines, so a row block runs from one `+---+` rule to the next. Sections come
 * from the prose headings above each block.
 */
export function parseDutyFromPre(html) {
  const text = decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/ /g, " ");
  const tiers = [];
  const perCc = { y3: [], y5plus: [] };
  let section;
  let left = [];
  let right = [];
  const flush = () => {
    const condition = left.join(" ").replace(/\s+/g, " ").trim();
    const rate = right.join(" ").replace(/\s+/g, " ").trim();
    left = [];
    right = [];
    if (!condition || !rate) return;
    const tier = /(\d+)\s*%,\s*но не менее\s+([\d.,]+)\s*Евро\/1\s*куб\.?\s*см/i.exec(
      rate,
    );
    if (tier && section === "new") {
      tiers.push({
        maxEur: upperBound(condition, UPPER_EUR),
        pct: parseRuNumber(tier[1]),
        minPerCc: parseRuNumber(tier[2]),
      });
      return;
    }
    const flat = /^([\d.,]+)\s*Евро\/1\s*куб\.?\s*см$/i.exec(rate);
    if (flat && (section === "y3" || section === "y5plus")) {
      perCc[section].push({
        maxCc: upperBound(condition, UPPER_CC),
        eurPerCc: parseRuNumber(flat[1]),
      });
    }
  };
  for (const line of text.split("\n")) {
    if (/Новые автомобили/.test(line)) section = "new";
    else if (/Б\/у автомобили старше 3, но не старше 5 лет/.test(line)) section = "y3";
    else if (/Б\/у автомобили старше 5 лет/.test(line)) section = "y5plus";
    if (/^\s*\+-{3,}/.test(line)) {
      flush();
      continue;
    }
    const cells = line.split("|");
    if (cells.length < 3) continue;
    if (cells[1].trim()) left.push(cells[1].trim());
    if (cells[2].trim()) right.push(cells[2].trim());
  }
  flush();
  return { dutyValueTiers: tiers, dutyPerCcByAge: perCc };
}

// Each bracket opens with its amount; its clause runs to the NEXT amount (or
// to the end of the paragraph). It deliberately does not terminate on the
// first "." — the bounds are written "200 тыс. рублей", and stopping at that
// period truncated every clause before its upper bound and reported six
// phantom differences against a config that matched the decree exactly.
const CLEARANCE_OPENING = /(\d[\d\s ]*)\s+рубл\S*\s*-\s*за таможенные операции/gi;
const CLEARANCE_UPPER = /не превышает\s+([\d\s ]+?)\s*тыс/gi;

/**
 * The one clause that prices an IMPORT declaration.
 *
 * The decree states its scale several times over — for goods leaving Russia,
 * for particular categories, and again inside its appendices. Reading the whole
 * page found 25 "N рублей - за таможенные операции" clauses where the config
 * has 8 brackets, and the extra 17 are real rates for cargo we never quote. The
 * scale ends where the export paragraph begins.
 */
function clearanceImportClause(text) {
  const start = text.indexOf("уплачиваются по следующим ставкам");
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.indexOf("В отношении вывозимых");
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Clearance-fee brackets (ПП 1637 ред. 1638) from the decree's prose.
 *
 * Read ONLY from law.tks.ru. www.tks.ru/auto/2000000008/ carries the same kind
 * of table for the SUPERSEDED ПП 342 and parses perfectly — a source that is
 * confidently wrong. Do not "fix" this by adding it as a second source.
 */
export function parseClearanceFromLaw(html) {
  const text = clearanceImportClause(textOf(html));
  const openings = [...text.matchAll(CLEARANCE_OPENING)];
  return openings.map((opening, index) => {
    const from = opening.index + opening[0].length;
    const to = index + 1 < openings.length ? openings[index + 1].index : text.length;
    const clause = text.slice(from, to);
    const thousands = upperBound(clause, CLEARANCE_UPPER);
    return {
      maxRub: thousands === undefined ? undefined : thousands * 1000,
      fee: parseRuNumber(opening[1]),
    };
  });
}

/* ------------------------------------------------------- authority feed ---- */

/** The Government-decree feed on the official publication portal. */
export const AUTHORITY_FEED_URL =
  "http://publication.pravo.gov.ru/api/Documents" +
  "?PageSize=200&Index=1" +
  "&SignatoryAuthorityId=8005d8c9-4b6d-48d3-861a-2a37e69fccb3" +
  "&DocumentTypes=fd5a8766-f6fd-4ac2-8fd9-66f414d314ac" +
  "&SortedBy=6&SortDestination=1";

/**
 * The decrees whose amendment would move a number in this config, by the words
 * an amending title uses to name them.
 *
 * The number alone is not enough — "1291" collides with unrelated decrees and
 * with internal references — so the base decree's DATE must appear too.
 */
export const WATCHED_DECREES = [
  {
    id: "pp-1291",
    number: "1291",
    date: "26 декабря 2013",
    configPath: "customs.recyclingFee",
    label: "ПП РФ № 1291 — утилизационный сбор",
  },
  {
    id: "pp-1637",
    number: "1637",
    date: "28 ноября 2024",
    configPath: "customs.clearanceFeeBrackets",
    label: "ПП РФ № 1637 — сборы за таможенные операции",
  },
];

/** Free-text catch for reforms that never name a base decree in their title. */
export const AUTHORITY_KEYWORD = /утилизацион/i;

/** Normalised feed items; tolerates the portal's casing of the envelope. */
export function parseAuthorityFeed(payload) {
  const items = payload?.items ?? payload?.Items ?? [];
  return items.map((item) => ({
    eoNumber: String(item.eoNumber ?? ""),
    title: String(item.complexName ?? item.name ?? "").replace(/\s+/g, " ").trim(),
    published: String(item.publishDateShort ?? "").slice(0, 10),
    url: `http://publication.pravo.gov.ru/document/${String(item.eoNumber ?? "")}`,
  }));
}

/** Feed items that amend a watched decree, or that mention the fee by name. */
export function matchAuthorityItems(items, decrees = WATCHED_DECREES) {
  const matches = [];
  for (const item of items) {
    const amends = decrees.filter(
      (decree) =>
        /внесени\S* изменен/i.test(item.title) &&
        item.title.includes(decree.number) &&
        item.title.includes(decree.date),
    );
    const keyword = AUTHORITY_KEYWORD.test(item.title);
    if (amends.length === 0 && !keyword) continue;
    matches.push({
      ...item,
      decrees: amends.map((decree) => decree.id),
      keyword,
    });
  }
  return matches;
}

/* ------------------------------------------------------------ comparison -- */

function finding(kind, message, extra = {}) {
  return { kind, message, ...extra };
}

/** Compares two bracket arrays field by field, in order. */
function compareBrackets(path, observed, expected, fields) {
  const findings = [];
  if (observed.length !== expected.length) {
    findings.push(
      finding(
        "changed",
        `${path}: source now has ${observed.length} brackets, config has ${expected.length}`,
        { configPath: path },
      ),
    );
  }
  const count = Math.min(observed.length, expected.length);
  for (let index = 0; index < count; index += 1) {
    for (const field of fields) {
      const actual = observed[index][field];
      const wanted = expected[index][field];
      if (!sameNumber(actual, wanted)) {
        findings.push(
          finding(
            "changed",
            `${path}[${index}].${field}: config ${format(wanted)} → source ${format(actual)}`,
            { configPath: `${path}[${index}].${field}`, expected: wanted, actual },
          ),
        );
      }
    }
  }
  return findings;
}

function format(value) {
  return value === undefined ? "(open)" : String(value);
}

/** Duty findings against config.customs. */
export function compareDuty(observed, customs) {
  return [
    ...compareBrackets(
      "customs.dutyValueTiers",
      observed.dutyValueTiers,
      customs.dutyValueTiers,
      ["maxEur", "pct", "minPerCc"],
    ),
    ...compareBrackets(
      "customs.dutyPerCcByAge.y3",
      observed.dutyPerCcByAge.y3,
      customs.dutyPerCcByAge.y3,
      ["maxCc", "eurPerCc"],
    ),
    ...compareBrackets(
      "customs.dutyPerCcByAge.y5plus",
      observed.dutyPerCcByAge.y5plus,
      customs.dutyPerCcByAge.y5plus,
      ["maxCc", "eurPerCc"],
    ),
  ];
}

/** Clearance findings against config.customs. */
export function compareClearance(observed, customs) {
  return compareBrackets(
    "customs.clearanceFeeBrackets",
    observed,
    customs.clearanceFeeBrackets,
    ["maxRub", "fee"],
  );
}

/** Findings for a disagreement between two independent readings of the duty. */
export function compareSources(primary, secondary) {
  const findings = [];
  const check = (path, a, b, fields) => {
    if (a.length !== b.length) {
      findings.push(
        finding(
          "changed",
          `sources disagree on ${path}: ${a.length} vs ${b.length} brackets`,
          { configPath: path },
        ),
      );
      return;
    }
    for (let index = 0; index < a.length; index += 1) {
      for (const field of fields) {
        if (!sameNumber(a[index][field], b[index][field])) {
          findings.push(
            finding(
              "changed",
              `sources disagree on ${path}[${index}].${field}: ` +
                `${format(a[index][field])} vs ${format(b[index][field])}`,
              { configPath: `${path}[${index}].${field}` },
            ),
          );
        }
      }
    }
  };
  check("customs.dutyValueTiers", primary.dutyValueTiers, secondary.dutyValueTiers, [
    "maxEur",
    "pct",
    "minPerCc",
  ]);
  check(
    "customs.dutyPerCcByAge.y3",
    primary.dutyPerCcByAge.y3,
    secondary.dutyPerCcByAge.y3,
    ["maxCc", "eurPerCc"],
  );
  check(
    "customs.dutyPerCcByAge.y5plus",
    primary.dutyPerCcByAge.y5plus,
    secondary.dutyPerCcByAge.y5plus,
    ["maxCc", "eurPerCc"],
  );
  return findings;
}

/**
 * The backstop for the block that has no number-level source.
 *
 * The recycling fee is re-indexed on 1 January. If the config's `asOf` predates
 * the most recent 1 January, that indexation happened and nobody re-derived the
 * grid — a finding that needs no decree title to match, and the only check that
 * catches the operator's stated worry on its own.
 */
export function checkAsOfStaleness(customs, now) {
  const asOf = new Date(`${customs.asOf}T00:00:00Z`);
  if (Number.isNaN(asOf.getTime())) {
    return [
      finding("broken", `customs.asOf is not a date: ${String(customs.asOf)}`, {
        configPath: "customs.asOf",
      }),
    ];
  }
  const lastNewYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const boundary =
    now.getTime() >= lastNewYear
      ? lastNewYear
      : Date.UTC(now.getUTCFullYear() - 1, 0, 1);
  if (asOf.getTime() >= boundary) return [];
  return [
    finding(
      "changed",
      `customs.asOf is ${customs.asOf}, before the ${new Date(boundary)
        .toISOString()
        .slice(0, 10)} indexation — the recycling-fee grid has not been ` +
        "re-derived since the annual change took effect",
      { configPath: "customs.asOf" },
    ),
  ];
}

/* ---------------------------------------------------------------- watches -- */

/**
 * Printed on EVERY run, clean ones included. A block nobody watches by number
 * must not be indistinguishable from a block that matched.
 */
export const RECYCLING_GAP_NOTE =
  "`customs.recyclingFee` (утильсбор, ПП РФ № 1291 в ред. № 1713) has NO " +
  "number-level source: no published page carries the enacted grid in a form " +
  "this job can read. It is watched by signal only — the official decree feed " +
  "and the `customs.asOf` staleness check. A change there means a human must " +
  "re-derive the grid by hand.";

/**
 * Every watch: where it reads, what it proves, and how many rows the source is
 * known to carry. `minRows` is what separates "the config matches" from "the
 * extractor found nothing".
 */
export function defaultWatches() {
  return [
    {
      id: "duty-eek107",
      url: "https://law.tks.ru/document/833411",
      what: "customs.dutyValueTiers, customs.dutyPerCcByAge (Решение ЕЭК 107)",
      kind: "html",
      run: ({ body, config }) => {
        const observed = parseDutyFromLawTables(body);
        const rows =
          observed.dutyValueTiers.length +
          observed.dutyPerCcByAge.y3.length +
          observed.dutyPerCcByAge.y5plus.length;
        if (rows < 18) {
          return {
            outcome: "broken",
            findings: [
              finding(
                "broken",
                `duty extractor found ${rows} of the 18 expected brackets — ` +
                  "the page layout moved, the numbers were NOT checked",
              ),
            ],
          };
        }
        const edition = isSupersededEdition(body);
        const findings = compareDuty(observed, config.customs);
        if (edition.superseded) {
          findings.push(
            finding(
              "changed",
              "the pinned duty document is a superseded edition; re-pin it to " +
                `${edition.successor ?? "the successor named on the page"}`,
              { quote: edition.quote },
            ),
          );
        }
        return { outcome: findings.length > 0 ? "changed" : "ok", findings, observed };
      },
    },
    {
      id: "duty-tks-auto",
      url: "https://www.tks.ru/auto/2000000008/",
      what: "cross-check of the duty scale against the operator's own reference",
      kind: "html",
      run: ({ body, previousWatches }) => {
        const observed = parseDutyFromPre(body);
        const rows =
          observed.dutyValueTiers.length +
          observed.dutyPerCcByAge.y3.length +
          observed.dutyPerCcByAge.y5plus.length;
        if (rows < 18) {
          return {
            outcome: "broken",
            findings: [
              finding(
                "broken",
                `duty cross-check found ${rows} of the 18 expected brackets — ` +
                  "the pseudo-table layout moved",
              ),
            ],
          };
        }
        const primary = previousWatches?.["duty-eek107"]?.observed;
        // tks is the operator's reference and the decree is the authority:
        // a disagreement between them is itself worth reporting (brief).
        const findings = primary ? compareSources(primary, observed) : [];
        return { outcome: findings.length > 0 ? "changed" : "ok", findings, observed };
      },
    },
    {
      id: "clearance-pp1637",
      url: "https://law.tks.ru/document/778729",
      what: "customs.clearanceFeeBrackets (ПП РФ № 1637 в ред. № 1638)",
      kind: "html",
      run: ({ body, config }) => {
        const observed = parseClearanceFromLaw(body);
        if (observed.length < 8) {
          return {
            outcome: "broken",
            findings: [
              finding(
                "broken",
                `clearance extractor found ${observed.length} of the 8 expected ` +
                  "brackets — the decree's prose moved, the numbers were NOT checked",
              ),
            ],
          };
        }
        const edition = isSupersededEdition(body);
        const findings = compareClearance(observed, config.customs);
        if (edition.superseded) {
          findings.push(
            finding(
              "changed",
              "the pinned clearance-fee document is a superseded edition; " +
                `re-pin it to ${edition.successor ?? "the successor named on the page"}`,
              { quote: edition.quote },
            ),
          );
        }
        return { outcome: findings.length > 0 ? "changed" : "ok", findings, observed };
      },
    },
    {
      id: "authority-feed",
      url: AUTHORITY_FEED_URL,
      what: "new decrees touching the watched acts (the only утильсбор signal)",
      kind: "json",
      run: ({ body, previousObservations }) => {
        const items = parseAuthorityFeed(JSON.parse(body));
        if (items.length === 0) {
          return {
            outcome: "broken",
            findings: [
              finding("broken", "the decree feed returned no items — it was NOT checked"),
            ],
          };
        }
        const matches = matchAuthorityItems(items);
        const seen = new Set(previousObservations?.["authority-feed"]?.seen ?? []);
        const findings = [];
        for (const match of matches) {
          if (seen.has(match.eoNumber)) continue;
          findings.push(
            finding(
              "changed",
              `new decree ${match.eoNumber} (${match.published}) touches ` +
                `${match.decrees.join(", ") || "the recycling fee by name"} — ` +
                "a human must read it and re-derive the affected numbers",
              { quote: clampQuote(match.title), url: match.url },
            ),
          );
        }
        // The feed's first page spans roughly seven weeks. If its oldest item
        // is newer than what we last recorded, the window moved past us and
        // "no new decrees" would be a lie rather than an observation.
        const oldest = items
          .map((item) => item.published)
          .filter(Boolean)
          .sort()[0];
        const watermark = previousObservations?.["authority-feed"]?.watermark;
        if (watermark && oldest && oldest > watermark) {
          findings.push(
            finding(
              "changed",
              `the decree feed window skipped past us: it now starts at ${oldest}, ` +
                `we last read up to ${watermark} — decrees in that gap were not seen`,
            ),
          );
        }
        return {
          outcome: findings.length > 0 ? "changed" : "ok",
          findings,
          observed: {
            watermark: items.map((item) => item.published).filter(Boolean).sort().pop(),
            seen: matches.map((match) => match.eoNumber),
            matched: matches.length,
          },
        };
      },
    },
  ];
}

/* ---------------------------------------------------------------- runner --- */

const WORSE = { ok: 0, changed: 1, broken: 2 };

/** The worse of two outcomes; a broken watch never reads as a clean run. */
export function worstOutcome(a, b) {
  return WORSE[a] >= WORSE[b] ? a : b;
}

/**
 * Runs every watch. Network access enters only through `fetchImpl`, so a whole
 * run is drivable offline from fixtures.
 */
export async function runWatches({
  config,
  fetchImpl,
  now = new Date(),
  watches = defaultWatches(),
  previousObservations = {},
}) {
  const results = [];
  const observations = {};
  const byId = {};
  let outcome = "ok";

  for (const watch of watches) {
    let result;
    try {
      const response = await fetchImpl(watch.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const body = decodeBody(buffer, response.headers?.get?.("content-type") ?? "");
      result = watch.run({
        body,
        config,
        now,
        previousObservations,
        previousWatches: byId,
      });
    } catch (error) {
      result = {
        outcome: "broken",
        findings: [
          finding(
            "broken",
            `${watch.id}: could not read ${watch.url} — ${String(
              error?.message ?? error,
            )}`,
          ),
        ],
      };
    }
    byId[watch.id] = result;
    if (result.observed !== undefined) observations[watch.id] = result.observed;
    results.push({ id: watch.id, url: watch.url, what: watch.what, ...result });
    outcome = worstOutcome(outcome, result.outcome);
  }

  // Independent of every source: it reads the config and the clock only.
  const staleness = checkAsOfStaleness(config.customs, now);
  if (staleness.length > 0) {
    results.push({
      id: "asof-staleness",
      url: CONFIG_PATH,
      what: "customs.asOf vs the annual 1 January indexation",
      outcome: staleness[0].kind === "broken" ? "broken" : "changed",
      findings: staleness,
    });
    outcome = worstOutcome(outcome, staleness[0].kind === "broken" ? "broken" : "changed");
  }

  return { outcome, watches: results, observations, checkedAt: now.toISOString() };
}

/* --------------------------------------------------------------- reporting - */

/** The PR body (and the console report): what moved, where, and quoted why. */
export function renderReport(report) {
  const lines = [];
  const title =
    report.outcome === "ok"
      ? "Tariff watch: no change"
      : report.outcome === "broken"
        ? "Tariff watch: BROKEN — the sources were not checked"
        : "Tariff watch: the published rates moved";
  lines.push(`# ${title}`, "");
  lines.push(`Checked ${report.checkedAt}.`, "");

  if (report.outcome === "changed") {
    lines.push(
      "This PR proposes nothing by itself: it records what the sources now say.",
      `A human updates \`${CONFIG_PATH}\` and \`src/config.default.ts\` (and their`,
      "`asOf`) after reading the quoted text below.",
      "",
    );
  }
  if (report.outcome === "broken") {
    lines.push(
      "One or more watches could not read their source. **No conclusion about the",
      "config may be drawn from this run** — a watch that matched nothing looks",
      "exactly like a config that is correct.",
      "",
    );
  }

  for (const watch of report.watches) {
    if (watch.findings.length === 0) continue;
    lines.push(`## ${watch.id} — ${watch.outcome}`, "");
    lines.push(`Source: ${watch.url}`, `Covers: ${watch.what}`, "");
    for (const item of watch.findings) {
      lines.push(`- ${item.message}`);
      if (item.url) lines.push(`  - ${item.url}`);
      if (item.quote) lines.push(`  - source text: «${item.quote}»`);
    }
    lines.push("");
  }

  lines.push("## Not watched by number", "", RECYCLING_GAP_NOTE, "");
  lines.push(
    "## Watches that ran",
    "",
    ...report.watches.map(
      (watch) => `- \`${watch.id}\` — ${watch.outcome} (${watch.findings.length} findings)`,
    ),
    "",
  );
  return lines.join("\n");
}

/**
 * Rewrites ONLY the delimited observation block. Its git diff is what the PR
 * shows; the prose around it is the human's and is preserved byte for byte.
 */
export function writeObservationBlock(markdown, observations, checkedAt) {
  const begin = markdown.indexOf(OBSERVATIONS_BEGIN);
  const end = markdown.indexOf(OBSERVATIONS_END);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(
      `${SOURCE_MAP_PATH} is missing the observation markers — refusing to append`,
    );
  }
  const block = [
    OBSERVATIONS_BEGIN,
    "",
    "```json",
    JSON.stringify({ checkedAt, observations }, null, 2),
    "```",
    "",
  ].join("\n");
  return markdown.slice(0, begin) + block + markdown.slice(end);
}

/** Previous observations, or an empty record when the block is fresh. */
export function readObservationBlock(markdown) {
  const begin = markdown.indexOf(OBSERVATIONS_BEGIN);
  const end = markdown.indexOf(OBSERVATIONS_END);
  if (begin < 0 || end < 0 || end < begin) return {};
  const fenced = /```json\s*([\s\S]*?)```/.exec(markdown.slice(begin, end));
  if (!fenced) return {};
  try {
    return JSON.parse(fenced[1]).observations ?? {};
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------- cli -- */

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const bodyIndex = argv.indexOf("--body");
  const bodyPath = bodyIndex >= 0 ? argv[bodyIndex + 1] : undefined;

  const config = JSON.parse(readFileSync(resolve(root, CONFIG_PATH), "utf8"));
  const sourceMapPath = resolve(root, SOURCE_MAP_PATH);
  const sourceMap = readFileSync(sourceMapPath, "utf8");

  const report = await runWatches({
    config,
    fetchImpl: (url) => fetch(url, { headers: { "user-agent": "encar-ru rates-watch" } }),
    previousObservations: readObservationBlock(sourceMap),
  });

  const rendered = renderReport(report);
  console.log(rendered);
  if (bodyPath) writeFileSync(bodyPath, `${rendered}\n`, "utf8");
  if (process.env["GITHUB_OUTPUT"]) {
    writeFileSync(process.env["GITHUB_OUTPUT"], `outcome=${report.outcome}\n`, {
      flag: "a",
    });
  }

  // A broken run writes nothing: it must never overwrite the last known-good
  // observation with an empty one.
  if (report.outcome === "broken") return 1;
  if (report.outcome === "changed" && !dryRun) {
    writeFileSync(
      sourceMapPath,
      writeObservationBlock(sourceMap, report.observations, report.checkedAt),
      "utf8",
    );
  }
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
