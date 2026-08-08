/**
 * Offline drom.ru specs collector -> site/specs-catalog.json (tks-parity).
 *
 * Why a build-time snapshot: the recycling fee and the EV/sequential-hybrid
 * customs track need power figures (ICE hp + electric 30-minute hp) that no
 * public encar surface carries (docs/harness/spike-power.md), drom.ru sends
 * no CORS header, and this product is a static GitHub Pages site with no
 * backend. So this script is run BY HAND when coverage needs a refresh, the
 * JSON is committed, and CI/tests only validate the committed file
 * (test/specs.test.ts) — CI never talks to drom.ru.
 *
 * Walk, per model in MODELS: catalog index -> generation pages (kept only
 * when «Рынок сбыта: Южная Корея» — encar sells the Korean domestic market)
 * -> modification pages for hybrid/EV mods -> spec table rows (windows-1251,
 * measured 2026-08-08):
 *
 *   Объем двигателя, куб.см                          -> engineCc
 *   Максимальная мощность, л.с. (кВт) при об./мин.   -> iceHp   ("152 (112) / 6000")
 *   Электродвигатель: 30-минутная мощность, л.с.     -> electricHp30min
 *   Вид гибрида                                      -> hybridKind
 *     (Параллельный / Последовательно-параллельный -> parallel: a mechanical
 *      link to the wheels keeps the lot under ЕЭК №107 by displacement;
 *      Последовательный -> sequential: clears like an EV, ТН ВЭД 8703 80)
 *
 * Modifications of one generation+powertrain collapse into one catalog entry
 * (trim names become `grades`, production windows union). Output is sorted
 * and deterministic so re-runs produce reviewable diffs.
 *
 * Usage: node scripts/build-catalog.mjs [--only make/model]
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_PATH = resolve("site", "specs-catalog.json");
const BASE = "https://www.drom.ru/catalog";
/** Polite crawl: one request at a time, fixed pause between requests. */
const PAUSE_MS = 250;

/**
 * Initial coverage (operator scope: Korean hybrids/EVs on encar). `aliases`
 * are the lowercase tokens expected inside an encar English title.
 * `allElectric` models fetch every modification; others only mods whose name
 * hints hybrid/EV.
 */
const MODELS = [
  { make: "hyundai", path: "hyundai/sonata", aliases: ["sonata"] },
  { make: "hyundai", path: "hyundai/grandeur", aliases: ["grandeur"] },
  { make: "hyundai", path: "hyundai/tucson", aliases: ["tucson"] },
  { make: "hyundai", path: "hyundai/santa_fe", aliases: ["santa fe", "santafe"] },
  { make: "hyundai", path: "hyundai/kona", aliases: ["kona"] },
  { make: "hyundai", path: "hyundai/ioniq_5", aliases: ["ioniq 5", "ioniq5"], allElectric: true },
  // Ioniq 6 South-Korea generations exist on drom but their complectation
  // tables are empty (checked 2026-08-08) — kept for a future re-run.
  { make: "hyundai", path: "hyundai/ioniq_6", aliases: ["ioniq 6", "ioniq6"], allElectric: true },
  { make: "hyundai", path: "hyundai/kona_electric", aliases: ["kona electric", "kona"], allElectric: true },
  { make: "kia", path: "kia/k5", aliases: ["k5"] },
  { make: "kia", path: "kia/k8", aliases: ["k8"] },
  { make: "kia", path: "kia/niro", aliases: ["niro"] },
  { make: "kia", path: "kia/sorento", aliases: ["sorento"] },
  { make: "kia", path: "kia/sportage", aliases: ["sportage"] },
  { make: "kia", path: "kia/ev6", aliases: ["ev6", "ev 6"], allElectric: true },
  { make: "kia", path: "kia/ev9", aliases: ["ev9", "ev 9"], allElectric: true },
  { make: "genesis", path: "genesis/g80", aliases: ["g80"] },
  { make: "genesis", path: "genesis/gv60", aliases: ["gv60"], allElectric: true },
  { make: "genesis", path: "genesis/gv70", aliases: ["gv70"] },
];

/** Mod-name hint that a non-allElectric modification is hybrid or electric. */
const ELECTRIFIED_NAME = /hev|phev|hybrid|гибрид|\bev\b|kwh|electric|электро/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decoder = new TextDecoder("windows-1251");

async function fetchPage(url) {
  await sleep(PAUSE_MS);
  const res = await fetch(url, {
    headers: { "user-agent": "encar-ru-catalog-builder (manual run)" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return decoder.decode(new Uint8Array(await res.arrayBuffer()));
}

const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Spec-table rows: <tr><td>label</td><td>value</td></tr>. */
function specRows(html) {
  const rows = new Map();
  const re = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  for (const m of html.matchAll(re)) {
    rows.set(stripTags(m[1]), stripTags(m[2]));
  }
  return rows;
}

function rowByLabel(rows, label) {
  for (const [k, v] of rows) if (k.includes(label)) return v;
  return undefined;
}

/**
 * «Вид гибрида» sits outside the spec table, in the header cards. Only the
 * three values measured 2026-08-08 are recognized; anything else returns
 * undefined and the modification is refused as half-parsed — a misread kind
 * would put the lot on the wrong LEGAL track, not just show a wrong number.
 */
function hybridKindOf(html) {
  const m = /Вид гибрида<\/div><div[^>]*>([^<]+)</.exec(html);
  if (!m) return undefined;
  const kind = m[1].trim().toLowerCase();
  if (kind === "последовательный") return "sequential";
  if (kind === "параллельный" || kind === "последовательно-параллельный") {
    return "parallel";
  }
  return undefined;
}

const num = (s) => {
  if (s === undefined) return undefined;
  // Thousands separators ("1 999", NBSP) must not split the number: strip
  // spaces first, then read the leading digit run.
  const m = /[\d.]+/.exec(s.replace(/[\s ]+/g, "").replace(",", "."));
  if (!m) return undefined;
  const v = Number(m[0]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

/**
 * "(03.2019 - 03.2021)" or "(04.2021 - н.в.)" from the mod page <title> ONLY
 * — a page-global search could capture an unrelated parenthetical (another
 * generation's breadcrumb) and assign a wrong production window.
 */
function productionWindow(html) {
  const title = /<title>([^<]*)<\/title>/.exec(html);
  if (!title) return undefined;
  const m = /\((\d{2})\.(\d{4})\s*-\s*(?:(\d{2})\.(\d{4})|[^)]*)\)/.exec(title[1]);
  if (!m) return undefined;
  const win = { from: `${m[2]}${m[1]}` };
  if (m[3] !== undefined && m[4] !== undefined) win.to = `${m[4]}${m[3]}`;
  return win;
}

/** Trim words of a mod name, minus engine/transmission/drive tokens. */
function gradeTokens(name) {
  // "long range" / "standard" stay: for EVs they are the trim words that
  // separate battery variants with different power.
  const NOISE =
    /^(\d+(\.\d+)?|hev|phev|t-gdi|gdi|mpi|lpi|crdi|smartstream|at|mt|dct|cvt|4wd|2wd|awd|fwd|rwd|квт|kw|kwh|квт\*ч)$/i;
  const words = name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.test(w) && !/\d/.test(w));
  return words;
}

async function collectModel(model) {
  const indexHtml = await fetchPage(`${BASE}/${model.path}/`);
  const genUrls = [
    ...new Set(
      [...indexHtml.matchAll(
        new RegExp(`href="(https://www\\.drom\\.ru/catalog/${model.path}/g_\\d+_\\d+/)"`, "g"),
      )].map((m) => m[1]),
    ),
  ];

  const entries = [];
  for (const genUrl of genUrls) {
    let genHtml;
    try {
      genHtml = await fetchPage(genUrl);
    } catch (e) {
      console.error(`  skip gen ${genUrl}: ${e.message}`);
      continue;
    }
    if (!genHtml.includes("Рынок сбыта: Южная Корея")) continue;

    const mods = [...genHtml.matchAll(
      new RegExp(`href="(https://www\\.drom\\.ru/catalog/${model.path}/(\\d+)/)">([^<]+)`, "g"),
    )];
    for (const [, modUrl, , modName] of mods) {
      const name = modName.trim();
      if (!model.allElectric && !ELECTRIFIED_NAME.test(name)) continue;

      let modHtml;
      try {
        modHtml = await fetchPage(modUrl);
      } catch (e) {
        console.error(`  skip mod ${modUrl}: ${e.message}`);
        continue;
      }
      const rows = specRows(modHtml);
      const electricHp30min = num(rowByLabel(rows, "30-минутная мощность"));
      if (electricHp30min === undefined) continue; // not electrified after all

      const iceHp = num(rowByLabel(rows, "Максимальная мощность, л.с."));
      const engineCc = num(rowByLabel(rows, "Объем двигателя, куб.см"));
      const kind = hybridKindOf(modHtml);
      const win = productionWindow(modHtml);
      if (win === undefined) continue;

      const isHybrid = iceHp !== undefined && engineCc !== undefined && kind !== undefined;
      const entry = {
        make: model.make,
        aliases: model.aliases,
        from: win.from,
        ...(win.to !== undefined ? { to: win.to } : {}),
        fuel: isHybrid ? "hybrid" : "electric",
        ...(isHybrid
          ? { hybridKind: kind, engineCc, iceHp }
          : {}),
        electricHp30min,
        grades: gradeTokens(name),
      };
      if (!isHybrid && (iceHp !== undefined || kind === "parallel")) {
        // An ICE figure without cc (or vice versa) is a half-parsed page, not
        // an EV; refusing beats catalogING a wrong powertrain.
        console.error(`  refuse half-parsed ${modUrl} (${name})`);
        continue;
      }
      entries.push(entry);
      console.error(`  + ${name} [${entry.fuel}] ${entry.from}-${entry.to ?? ""}`);
    }
  }
  return entries;
}

/** Same generation+powertrain -> one entry: union windows, merge grades. */
function aggregate(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const key = [
      e.make, e.aliases[0], e.fuel, e.hybridKind ?? "", e.engineCc ?? "",
      e.iceHp ?? "", e.electricHp30min,
    ].join("|");
    const prev = byKey.get(key);
    if (prev === undefined) {
      byKey.set(key, { ...e, grades: [...new Set(e.grades)] });
      continue;
    }
    if (e.from < prev.from) prev.from = e.from;
    if (prev.to !== undefined && (e.to === undefined || e.to > prev.to)) {
      if (e.to === undefined) delete prev.to;
      else prev.to = e.to;
    }
    prev.grades = [...new Set([...prev.grades, ...e.grades])];
  }
  return [...byKey.values()].map((e) => {
    const { grades, ...rest } = e;
    return grades.length > 0 ? { ...rest, grades: grades.sort() } : rest;
  });
}

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : undefined;

const all = [];
for (const model of MODELS) {
  if (only !== undefined && model.path !== only) continue;
  console.error(`${model.path}:`);
  try {
    all.push(...(await collectModel(model)));
  } catch (e) {
    console.error(`  MODEL FAILED ${model.path}: ${e.message}`);
  }
}

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  entries: aggregate(all).sort((a, b) => {
    const ka = `${a.make}|${a.aliases[0]}|${a.from}`;
    const kb = `${b.make}|${b.aliases[0]}|${b.from}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }),
};

writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 2) + "\n");
console.error(`wrote ${catalog.entries.length} entries -> ${OUT_PATH}`);
