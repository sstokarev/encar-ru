# Report: task/calc-page

PR: https://github.com/sstokarev/encar-ru/pull/5 (task/calc-page -> main)
Plan: docs/plans/2026-08-08-002-feat-calc-page-plan.md

## Delivered

`site/calc.html` + `src/page/*` (adapter, lot mapping, tg-link, render, main)
+ `build:page` esbuild entry. Paste an encar listing URL -> photos, specs,
all-in RUB table, Telegram draft button. Engine, config, FX, formatting
reused unchanged; precision/dash semantics preserved (recycling fee dashes —
no power in listing data, per brief).

Built against a fixture first; swapped to the real encar client the same day
it landed on main (adapter re-export, one file, as planned in KTD1).

## Verification

- npm test: 16 files, 345 passing (46 new); npm run build green.
- Live acceptance: operator ran the accepts scenario against a real listing
  (Kia K7 2.2 Diesel, /cars/detail/41756847) at the worktree build and
  confirmed "Работает, открывай PR".
- Code review: 9 reviewers (correctness, testing, maintainability, standards,
  security, adversarial, frontend-races + agent-native, learnings). 0 P0/P1.
  Applied: novalidate form (browser type=url swallowed submits before our
  error path), no-referrer photos (hotlink 403 would empty the gallery),
  zero displacement/seats treated as absent, "Первая регистрация" label
  (yearMonth is registration, not manufacture), month-validated date format,
  own-key dictionary lookup, English compound hybrid fuel names, loading
  card + stale-response/provenance/photo-error tests.

## Notes

- `.gitignore` touched outside `owns`: one line ignoring `site/calc.js`,
  mirroring `site/widget.js`. Flagged in the PR body.
- Known cosmetic gap: some Korean spec values (e.g. color "쥐색", body
  "대형차") have no EXACT_MAP entry and render raw. Dictionary additions are
  a shared-file change; left out of scope.
- Re-listed cars: the readside API may answer with a different vehicle record
  than the requested id (documented in the client); page shows the returned
  record. Advisory-level, not fixed.

Proposals filed: calc-page-shared-render-helpers
