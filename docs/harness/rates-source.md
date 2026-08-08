# Where the tariff numbers come from

`scripts/check-rates.mjs` runs weekly (`.github/workflows/rates-watch.yml`),
reads the sources below, compares them with `site/config.json`, and on a
difference opens a PR. It never edits the config. A human reads the quoted
source text and decides.

This file is both the map and the log: the block at the bottom is rewritten by
the job, so its git diff is what the PR shows.

## The one thing to know first

**`tks.ru/auto/calc/` carries no rate numbers.** Measured 2026-08-08: it is the
calculator form, prose about the import procedure, and citations of the decrees
— nothing to compare against. The calculator's own result is computed
server-side. tks is the operator's reference, so its *text* is watched as a
signal; the numbers come from the decrees themselves.

## What is watched, by number

| Config block | Source | Why this one |
|---|---|---|
| `customs.dutyValueTiers`, `customs.dutyPerCcByAge` | `law.tks.ru/document/833411` — Решение Совета ЕЭК № 107 от 20.12.2017, Прил. 2, Табл. 2 | The decree text itself, as real tables. 18 brackets. |
| same, cross-check | `www.tks.ru/auto/2000000008/` — ASCII pseudo-tables | The operator's own reference. Disagreement between the two is reported as a finding in its own right. |
| `customs.clearanceFeeBrackets` | `law.tks.ru/document/778729` — ПП РФ № 1637 от 28.11.2024 в ред. № 1638 | The decree text, as prose. 8 brackets. |

**`www.tks.ru/auto/2000000008/` is never read for the clearance fee.** It still
prints the grid of ПП № 342, superseded twice over (775 … 30 000 ₽). It parses
cleanly, which is exactly what makes it dangerous: a stale source that fails
loudly is safer than one that agrees with nothing.

Both `law.tks.ru` pages are checked for the «Недействующая редакция» banner. Our
pin going stale is itself a change worth a PR — it means we are reading last
year's law even when every number still matches. This is not hypothetical:
`law.tks.ru/document/714355`, the obvious page for Решение 107, was already
superseded by `833411` when this watch was written.

## What is NOT watched by number

**`customs.recyclingFee` — the утильсбор (ПП РФ № 1291 от 26.12.2013 в ред.
№ 1713).** No page found publishes the enacted grid in a form this job can read:
tks.ru carries neither the 20 000 ₽ base rate nor the 3 400 / 5 200 ₽ reduced
rates, `law.tks.ru` has no internal search (its form posts to Yandex), and the
official portal publishes acts as published, never a consolidated edition.

This is the block the operator cares about most — «каждый год ткс будет менять
утильсбор с 1 января». Two signals stand in for a number-level watch, and every
run prints the gap so silence is never mistaken for health:

1. **The official decree feed** — `publication.pravo.gov.ru/api/Documents`,
   Government decrees, newest 200. Filtered client-side (the API's `q`
   parameter is silently dropped) for titles that amend a watched decree —
   requiring the decree's DATE as well as its number, because "1291" alone
   collides with unrelated acts — and for `утилизацион` anywhere in the title.
2. **`customs.asOf` staleness** — if the config's `asOf` predates the most
   recent 1 January, the annual indexation happened and nobody re-derived the
   grid. This is the only check that catches the operator's stated worry
   without depending on a decree title matching a pattern.

Known false negatives, stated rather than papered over: an amendment that
reaches the fee through a different base decree, or through a Минпромторг/ФТС
act, matches neither filter. The feed's first page spans roughly seven weeks, so
an outage longer than that loses events — the job reports the skipped window
instead of reporting "no new decrees".

Решение ЕЭК 107 is watched through tks only. `docs.eaeunion.org` slugs proved
unstable — a 301 resolved to a different document — so pinning them would give
a watch that quietly reads the wrong law.

## Three outcomes

| Outcome | Exit | What happens | What it means |
|---|---|---|---|
| `ok` | 0 | nothing | every watch parsed, everything matched |
| `changed` | 0 | the observation block is rewritten and a PR opens | a number moved, a decree landed, or a pin went stale |
| `broken` | 1 | the job goes red; nothing is written | a fetch failed or an extractor found fewer rows than the source carries |

`broken` exists because an extractor that matched nothing and a config that is
correct both produce "0 differences". Every extractor declares how many rows its
source is known to carry, and finding fewer is a failure, not a clean run. A
broken run also leaves the observation block untouched, so a rotted scraper can
never overwrite the last known-good reading with an empty one.

## Running it by hand

```
node scripts/check-rates.mjs --dry-run
```

Reports without writing anything. Add `--body out.md` to also write the PR body.

<!-- rates-watch:observations:begin -->

```json
{
  "checkedAt": null,
  "observations": {}
}
```

<!-- rates-watch:observations:end -->
