---
title: "feat: Standalone calc page (site/calc.html)"
type: feat
status: completed
date: 2026-08-08
origin: docs/tasks/calc-page.md
---

# feat: Standalone calc page (site/calc.html)

## Summary

A standalone GitHub Pages page: the client pastes an encar listing URL and sees
the car's photos, specs, the full all-in RUB cost table, and a "написать в
Telegram" button with a prefilled draft (lot URL + computed total). Reuses the
tariff engine (`src/calc/customs.ts`), config pipeline (`src/config.ts`,
`site/config.json`) and FX resolution (`src/rates/cbr.ts`) unchanged. Car data
comes from the `src/encar/` client being built in a parallel task against the
frozen contract in `src/encar/types.ts`; until it lands, the page builds
against a fixture-backed adapter implementing the same contract.

## Problem Frame

The current product is an overlay widget injected into encar.com. The operator
is changing the pitch: the client should not need an extension or bookmarklet —
just a link they can open, paste a listing URL into, and get the full quote
plus a one-tap Telegram handoff. Everything price-related already exists and is
tested; the new work is a page shell, a CarData→LotParams mapping, and a build
entry.

## Requirements

- R1: Paste an encar listing URL → page shows photo(s), specs, full RUB cost
  table (accepts scenario in the brief).
- R2: Cost table is produced by `computeAllIn` with the loaded config and
  resolved rates — same numbers, same dash/precision semantics as the widget
  (brief: "reuse, do not rebuild").
- R3: Telegram button opens `t.me/<config messenger.address>` with a prefilled
  draft containing the lot URL and the computed total.
- R4: Power (мощность) is absent from CarData — the recycling-fee line renders
  per the engine's existing dash semantics; do not block on the power spike.
- R5: Second esbuild entry; the page deploys as static files with the rest of
  `site/`.
- R6: Page must build and function with the encar client absent (fixture
  adapter), and swap to the real module with a one-file change on merge.

## Assumptions (headless run)

- The encar client had not landed on `origin/main` at plan time (`src/encar/`
  holds only `types.ts`); the fixture adapter path is real work, not a hedge.
- Page visual language follows `site/index.html` (system-ui, cards, `#c00`
  accent) — not the widget's Shadow-DOM/Pretendard styling, which imitates
  encar. No new dependencies; vanilla TS + esbuild like the rest of the repo.
- `fuelName` in CarData may arrive Korean or English; the mapper handles known
  tokens of both and leaves fuel `undefined` otherwise (degrades precision
  honestly, never guesses).
- The prefilled draft wording is composed on the page (the widget's
  `buildOrderLink` has a fixed message without a total, and `src/ui/` is not
  owned by this task).

## Key Technical Decisions

- **KTD1 — Fixture adapter behind the contract.** `src/page/encar-adapter.ts`
  exports `fetchCar: EncarFetch` and `parseListingUrl: ParseListingUrl`
  (types from `src/encar/types.ts`). Today: a local URL parser + a fixture
  `CarData` served for any recognized URL, visibly marked "демо-данные" in the
  UI. When the client lands: the adapter becomes a re-export of
  `src/encar/index.ts` — the only file that changes. Rationale: esbuild
  resolves imports statically, so importing a not-yet-existing module would
  break the build; a stub `src/encar/index.ts` would collide with the parallel
  task's merge.
- **KTD2 — Local URL parser now, client's parser later.** Recognizes fem/www
  detail URLs (`/cars/detail/<id>`, existing `DETAIL_LOT_ID_RE` semantics in
  `src/scan/params.ts`) and the legacy `carid=<id>` query form; returns null
  otherwise. Lives in the adapter so the swap removes it wholesale.
- **KTD3 — CarData→LotParams mapping reuses the engine's age semantics.**
  `yearMonth` ("YYYYMM") → `computeAgeYears` / `isNearAgeBracket` (exported by
  `src/calc/customs.ts`), `displacementCc` → `engineCc`, fuel mapped by token
  table. `powerHp` stays undefined (R4). `estimated` false: CarData is API
  data, not DOM heuristics.
- **KTD4 — Page-owned Telegram link builder.** Same encoding discipline as
  `src/ui/order-button.ts` (encode address AND text); message: greeting, car
  title, lot URL, computed total rendered with `formatRub` semantics (the "от"
  / "≈" prefix carries over so the draft never overstates precision; under
  "onRequest" the draft carries no number).
- **KTD5 — Build.** `package.json` gains
  `build:page: esbuild src/page/main.ts --bundle --format=iife --outfile=site/calc.js --minify`;
  `build` runs widget + page so the operator's single `npm run build` (per
  `docs/harness/project.md`) produces everything.
- **KTD6 — Reuse `loadConfig` + `resolveRates` as-is.** The page runs on the
  Pages origin, where the remote config fetch is same-origin and the CBR
  mirror is already CORS-open (the widget fetches it cross-origin today).
  Provenance markers (embedded config, config-tier rates, rejected rate, rate
  date) are rendered like the widget's breakdown notes.

---

## Implementation Units

### U1. Encar adapter with fixture and URL parser

**Goal:** The page has a data source satisfying the `src/encar/types.ts`
contract with the client module absent.

**Requirements:** R6, R1 (partially — data shape).

**Dependencies:** none.

**Files:** `src/page/encar-adapter.ts`, `test/page-adapter.test.ts`.

**Approach:** Local `parseListingUrl` (fem/www detail path, `carid` query,
null otherwise; tolerate surrounding whitespace). `fetchCar` resolves a
fixture `CarData` (realistic: title, priceKrw in KRW, yearMonth, mileage,
displacement, fuel, photos as placeholder URLs, vin null) and flags itself via
an exported `SOURCE: "fixture" | "client"` constant the UI uses for the
демо-marker. Top-of-file comment states the swap procedure (re-export
`../encar` when it lands).

**Test scenarios:**
- fem detail URL `https://fem.encar.com/cars/detail/41756847` → `"41756847"`.
- www URL with `carid=12345` → `"12345"`.
- Non-encar URL, empty string, garbage → null.
- URL with whitespace padding → parsed.
- `fetchCar` resolves a CarData that passes a structural check against the
  contract (all required fields present, priceKrw positive).

**Verification:** unit tests green; `src/page/main.ts` compiles against the
adapter using only contract types.

### U2. CarData → LotParams mapping

**Goal:** Car data becomes calculator input with the engine's exact age and
degradation semantics.

**Requirements:** R2, R4.

**Dependencies:** none (contract types only).

**Files:** `src/page/lot.ts`, `test/page-lot.test.ts`.

**Approach:** Parse `yearMonth` "YYYYMM" → regYear/regMonth; reject malformed
strings (leave age undefined → engine degrades to onRequest for customs
lines, page still shows specs). Fuel token map: Korean (가솔린, 디젤, LPG,
하이브리드, 전기) and English (gasoline, diesel, lpg, hybrid, electric),
case-insensitive substring match mirroring `src/scan/params.ts` fuel
semantics; unknown → undefined. `ageNearBracket` from `isNearAgeBracket`.
`powerHp` never set.

**Test scenarios:**
- "202301" with a fixed `now` → correct fractional ageYears (delegate math to
  `computeAgeYears`; assert wiring, e.g. non-zero, and `ageNearBracket`
  consistency near 36 months).
- Malformed yearMonth ("2023", "abcdef", "") → ageYears undefined,
  ageNearBracket undefined.
- "디젤" → diesel; "Gasoline" → gasoline; "수소" (unknown) → undefined.
- Hybrid fuel + any params → computeAllIn dashes recycling with the hybrid
  note (integration with the real engine, real DEFAULT_CONFIG).
- displacementCc null → engineCc undefined → precision "onRequest" via
  `lotPrecision`.

**Verification:** unit tests green; mapping needs no imports beyond
`src/calc/customs.ts` and contract types.

### U3. Telegram draft link builder

**Goal:** R3 — deep link with lot URL and computed total.

**Requirements:** R3.

**Dependencies:** U2 (uses AllInResult precision semantics).

**Files:** `src/page/tg-link.ts`, `test/page-tg-link.test.ts`.

**Approach:** `buildDraftLink(messenger, carTitle, lotUrl, allIn)` →
`https://t.me/<addr>?text=<encoded>`. Message (Russian, client-facing):
greeting + "Хочу заказать: <title>" + lot URL + total line using the same
prefix semantics as `formatRub` ("≈"/"от"); when precision is "onRequest" the
total line becomes "расчёт по запросу" instead of a number. WhatsApp branch
mirrors `src/ui/order-button.ts` for config parity.

**Test scenarios:**
- Telegram config → link starts `https://t.me/<address>?text=`, decoded text
  contains lot URL and formatted total.
- Precision "partial" → decoded text contains "от"; "exact" → bare amount;
  "onRequest" → no digits from totalRub, contains "по запросу".
- Address with hostile chars (defense in depth despite config validation) →
  percent-encoded, link host/path shape intact.
- Cyrillic + spaces in text → fully percent-encoded (URL parses back).

**Verification:** unit tests green.

### U4. Page shell: site/calc.html + src/page/main.ts

**Goal:** The user-facing page: input → fetch → render photos, specs, cost
table, notes, Telegram button.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** U1, U2, U3.

**Files:** `site/calc.html`, `src/page/main.ts`, `src/page/render.ts`,
`test/page.test.ts`.

**Approach:** `calc.html` follows `site/index.html`'s visual language (inline
CSS, cards, #c00, mobile-first, lang=ru) with a form (URL input +
"Рассчитать"), a status region, and a result container; loads `calc.js`.
`main.ts` wires: on submit → `parseListingUrl` (invalid → inline error, no
fetch) → parallel `loadConfig()` + `resolveRates(config)` (sequenced as in
widget wiring: config first, rates need config) + `fetchCar` → render.
`render.ts` builds DOM (no innerHTML with user data): photo block (first photo
large, rest as thumb strip, `loading=lazy`, broken images hidden via onerror),
specs list (title, year "MM.YYYY", mileage "N км" with locale grouping,
displacement "N см³", fuel in Russian, transmission, color, seats, body, VIN
when present), cost table reusing `formatAmountRub`/`formatRub` from
`src/ui/badge.ts` and the widget's row semantics: dashes with per-line notes,
total as "Итого в РФ" with precision prefix or "расчёт по запросу", then
engine notes (`result.notes`), provenance notes (embedded config /
config-tier or rejected rates / rate date), `commissionNote`, and the
Telegram button (U3). Fixture mode (`SOURCE === "fixture"`) renders a visible
"демо-данные" banner. Fetch failure → honest error card, no partial numbers.
Loading state disables the submit button (no double-fetch).

**Test scenarios (jsdom, mocked adapter/config/rates):**
- Covers the brief's accepts: valid URL submit → photo img present, specs
  rendered, cost table has lot/duty/clearance rows with amounts, recycling
  row dashed with the power note, total prefixed "от" (R4 path).
- Invalid URL → error message, no result container, no fetch called.
- Fetch rejection → error card, previous result cleared.
- onRequest quote (EV fixture) → total shows "расчёт по запросу", no numeric
  total.
- Telegram anchor href contains encoded lot URL and total; target=_blank,
  rel=noopener.
- Embedded-config fallback → marker line rendered.
- Second submit replaces the first result (no duplicate nodes).

**Verification:** `npm test` green; manual open of built page renders the
fixture flow end-to-end.

### U5. Build entry and deploy wiring

**Goal:** R5 — the page ships with `site/`.

**Requirements:** R5.

**Dependencies:** U4 (entry exists).

**Files:** `package.json`.

**Approach:** Add `build:page` (esbuild iife → `site/calc.js`, minified);
rename existing build to `build:widget` and make `build` run both. Do NOT add
dependencies. Check `.gitignore` for `site/calc.js` handling consistent with
`site/widget.js` (follow whatever the repo does for the widget bundle).

**Test scenarios:** none — build config; verified by running the build.

**Verification:** `npm run build` produces `site/widget.js` and
`site/calc.js`; `git status` shows no unexpected artifacts.

---

## Scope Boundaries

- In scope: the page, its adapter/mapping/link modules, build entry, tests.
- Out of scope: the real encar client (parallel task), engine power sourcing
  (parallel spike — R4 dashes), any change under `src/ui/`, `src/calc/`,
  `src/config*` (read-only per brief `owns`/`reads`), locale files.
- Deferred to follow-up: swapping the adapter to `src/encar/index.ts` — do it
  in this branch IF the client lands on origin/main before finish (watch
  `git log origin/main`); otherwise it is the explicit next task after merge.
- Outside identity: no backend, no analytics, no URL history.

## Risks & Dependencies

- Parallel client task may land mid-work → merge `origin/main`, swap adapter
  (one file), re-run tests. Low risk by design (KTD1).
- `accepts` scenario (operator pastes a real listing URL) is only fully
  demonstrable with the real client; in fixture mode the flow works but data
  is demo. If the client hasn't landed at finish time, raise via
  `orca orchestration ask` before the PR.
- CarData photo URLs may be blocked by hotlink protection on the Pages
  origin — mitigated by onerror hiding; not solvable in this task.

## Test Strategy

Vitest + jsdom, same style as existing `test/*.test.ts` (fixtures, no network:
adapter/config/rates injected or mocked). New files: `test/page-adapter.test.ts`,
`test/page-lot.test.ts`, `test/page-tg-link.test.ts`, `test/page.test.ts`.
Gate: `npm test` and `npm run build` green (project.md).
