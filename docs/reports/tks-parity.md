# tks-parity worker report

Branch `task/tks-parity`, 2026-08-08. Full deep cycle ran: brainstorm (operator)
→ plan → work → code review (6 personas, fixes applied) → compound → operator
acceptance PASSED (his word, demo at this worktree with a local uncommitted
`main.ts` wire). PR pending one sequencing blocker, see below.

## What shipped (on the branch)

- **EV / sequential-hybrid customs track** (`src/calc/customs.ts`): пошлина
  ЕТТ 15% + акциз руб/л.с. (ст.193 НК, 2026) + НДС 22% + утильсбор по
  EV-шкале, all keyed on the electric motor's 30-minute power. «по запросу»
  is now price-failures only. Parallel hybrids: утильсбор from ICE + 30-min
  power combined (ПП №1291, сноска 2).
- **Rates primary-verified** against decree texts (rulaws/alta full texts,
  cross-checked): ПП №1291 ред. 06.02.2026 annex (EV grid cell-by-cell),
  ФЗ №425-ФЗ (акциз 2026, НДС 20→22%), Решение ЕЭК №81/№111 (BEV/REEV codes
  split 22.01.2026, 15%, no RU privilege). Operator's two challenges both
  confirmed: no Aug/Sep утильсбор change exists (tks "banners" were ad
  creatives); drom.ru does publish 30-minute power. klerk.ru's "льгота
  отменена" claim REFUTED (its 150k base is раздел II, грузовые).
- **Specs catalog**: `scripts/build-catalog.mjs` (drom.ru offline collector,
  windows-1251, allowlist parsing) → `site/specs-catalog.json` (31 Korean-
  market hybrid/EV modifications) → `src/calc/specs.ts` honest matcher
  (refuse-on-ambiguity, leftover-grace window logic, word-boundary grades,
  plausibility-bounded validator).
- **Page seam** (`src/page/lot.ts`): `loadSpecsCatalog()` +
  `toLotDetails(car, now, catalog?)` enrichment; `SPECS_CATALOG_URL` derived
  from `CONFIG_URL`.
- 454 tests green; 60+ new. Learning doc:
  `docs/solutions/architecture-patterns/build-time-specs-snapshot-honest-matching.md`.

## The one blocker

`test/page.test.ts` (owned by live `task/importer-pricing`) pins the OLD
«EV → по запросу» behavior and is red on this branch — per architect ruling
red-in-flight is fine, red-in-PR is not, and the file becomes mine only
after that branch lands. PR opens after: merge main → rewrite its EV cases
as the new behavior spec → green suite.

## Ready follow-up dispatches (architect)

1. **main.ts wire** (1-3 lines, importer-pricing owns the file today):
   `loadSpecsCatalog()` into the page's `Promise.all`, pass catalog to
   `toLotDetails`. Until then EV/hybrid power lines dash on the live page —
   expected intermediate state.
2. **Config migration**: move `DEFAULT_EV_TRACK_RATES`, excise/VAT labels
   (and ideally the whole customs table) from `customs.ts` constants into
   `CustomsConfig` + `site/config.json` once importer-pricing frees the
   config files. Types are already parameter-shaped for it.
3. **catalog-petrol** (already briefed on main) should reuse the collector +
   matcher + the learning doc above.

## Known honest gaps (explained on-screen, accepted by operator)

- drom has no data for Ioniq 6 / Kona Electric / Genesis Korean gens (empty
  client-side tables) and genuinely ambiguous battery variants (EV6
  Air/Earth; Ioniq 5 most years) → those lots floor with dashes.
- Акциз basis for EVs encoded as 30-min power (converged secondary sources);
  if ФТС practice uses peak ЭПТС power the quote understates — flagged for a
  future tks comparison on a lot whose peak/30-min land in different
  brackets.

Proposals filed: docs/proposals/tsc-broken-object-hasown.md (tsc --noEmit
red on main via Object.hasOwn vs lib; CI never runs tsc so it rots silently).
