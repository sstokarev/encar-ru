# Report: task/rates-watch

PR: https://github.com/sstokarev/encar-ru/pull/6 (task/rates-watch -> main)
Plan: docs/plans/2026-08-08-003-feat-rates-watch-plan.md

## The brief's premise did not survive contact with the source

The brief said to fetch `tks.ru/auto/calc/`, extract the numbers our config
uses, and compare. **That page carries no rate numbers at all.** Measured
2026-08-08: 200, cp1251, ~108 KB, and its content is the calculator form, prose
about the import procedure, and citations of the decrees. The «с 23 августа»
banner the brief quotes is inside an HTML comment — as is the reCAPTCHA block.
There is nothing on it to compare against.

So the watch reads the decrees instead, and tks stays what the brief called it:
a signal, and a second opinion.

| Config block | Source | Watched |
|---|---|---|
| `dutyValueTiers`, `dutyPerCcByAge` | `law.tks.ru/document/833411` (Решение ЕЭК 107), real tables | by number |
| same, cross-check | `www.tks.ru/auto/2000000008/`, ASCII pseudo-tables | by number, disagreement reported |
| `clearanceFeeBrackets` | `law.tks.ru/document/778729` (ПП 1637 ред. 1638), prose | by number |
| **`recyclingFee` (утильсбор)** | — nothing publishes the enacted ПП 1291 ред. 1713 grid readably | **by signal only** |

Two findings from the reconnaissance are worth the architect's attention on
their own:

- **The obvious page for Решение 107 was already stale.**
  `law.tks.ru/document/714355` carries a «Недействующая редакция» banner and
  points at `833411`. The watch would have been pinned to last year's law on
  day one. Both pinned pages are now checked for that banner every run.
- **`www.tks.ru/auto/2000000008/` still prints the clearance grid of ПП № 342**,
  superseded twice over. It parses cleanly, which is what makes it dangerous.
  Clearance is never read from it, and the code says so where someone might
  "fix" it.

## The утильсбор gap, stated rather than hidden

`customs.recyclingFee` is the block the operator actually asked about — «каждый
год ткс будет менять утильсбор с 1 января». No page found publishes the enacted
grid in a form a `curl` job can read: tks.ru carries neither the 20 000 ₽ base
rate nor the 3 400 / 5 200 ₽ reduced rates, `law.tks.ru` has no internal search,
and the official portal publishes acts as-published, never consolidated.

Two signals stand in, and **every run prints the gap**, clean runs included:

1. the official decree feed (`publication.pravo.gov.ru/api/Documents` — a real
   JSON API, no key, no JS gate), filtered for amendments to the watched
   decrees and for `утилизацион`;
2. an **`asOf` staleness check** — if the config's `asOf` predates the most
   recent 1 January, the annual indexation happened and nobody re-derived the
   grid. This is the only check that catches the operator's stated worry
   without depending on a decree title matching a pattern.

Known false negatives are written into `docs/harness/rates-source.md` rather
than left implicit.

## Three outcomes

| Outcome | Exit | CI |
|---|---|---|
| `ok` | 0 | records the reading on main |
| `changed` | 0 | opens/updates one PR with the diff and the quoted source |
| `broken` | 1 | job red, nothing written |

`broken` is the point of the whole thing: an extractor that matched nothing and
a config that is correct both produce "0 differences". Each band of brackets
must land inside a trustworthy range (4–10), not merely above a floor — a floor
on the total let a page that appends a historical scale, or loses one section
header, pass while comparing numbers from the wrong table.

## Verification

- `npm test`: 17 files, **411 passing** (66 new). `npm run build` green. All
  three harness selftests OK.
- **Live dry run against the real sources returns `ok`** — all 18 duty brackets
  and all 8 clearance brackets reproduce the shipped config exactly. That is
  the check that proves the extractors read reality rather than merely parsing
  something.
- Live run with a deliberately mutated config returns `changed`, naming
  `customs.clearanceFeeBrackets[0].fee: config 9999 → source 1231`.
- No test touches the network; fixtures are trimmed captures of the real pages.

## Code review

Seven reviewers (correctness, adversarial, security, reliability, testing,
maintainability, project-standards). Applied:

- **`--force-with-lease` would have failed from the second run onward.**
  Reproduced by the reliability reviewer in a throwaway bare repo:
  `actions/checkout` never fetches the proposal branch, so the lease has
  nothing to compare against and git refuses with "stale info". The job would
  have gone red every week after the first change. Now the branch is fetched
  explicitly — and, because the lease then always passes, the job refuses to
  force-push over a branch whose last commit is not the bot's.
- **A vacuous test of my own**: `expect(matches.every(…)).toBe(true)` over an
  always-empty array. It could not fail. Replaced with a direct assertion.
  Exactly the failure this task exists to prevent, in the test file.
- **A tautological fixture**: the clearance fixture had been trimmed to only
  the eight matching clauses, so the "stops at the export paragraph" test
  proved nothing. The fixture now carries the real export scale (1067, 2134, …)
  and the 9054 clause after it.
- Per-band bracket ranges replacing the one-sided floor on the total.
- A missing clause terminator now reads as `broken` instead of silently
  swallowing the export scale and the appendices.
- The duty cross-check no longer reads a missing primary reading as agreement.
- Fetch timeout (30 s) and one retry, plus `timeout-minutes: 15` — a hung
  legacy portal held the weekly concurrency slot, and a lone transient 5xx
  turned the job red for nothing.
- Fetch failures and extractor crashes are now reported as different things.
- Quoted source text is markdown-defused and the eoNumber is digits-only: the
  decree feed is read over plain HTTP because **https on that host does not
  answer** (measured — connect timeout), and that text lands in a PR body a
  human trusts. The PR body is capped below GitHub's limit.
- `gh pr view --state open`, so a later change is never edited into a merged PR.
- A future `asOf` is `broken`, not permanently fresh.
- `main()` is exported and tested: exit codes, `--dry-run`, `GITHUB_OUTPUT`, the
  refusal to write on a broken run, and a body file that exists even when the
  config cannot be read.

Not applied, deliberately: **splitting `scripts/check-rates.mjs`** (≈1 100
lines; the maintainability reviewer's P1). The split it proposes creates files
under `scripts/rates-watch/`, outside this brief's `owns`, and the file is one
cohesive job with section banners and narrow internal dependencies. If the
architect wants it split, it is a clean follow-up task with a wider `owns`.

## Notes

- Paths touched outside `owns`, flagged per the `calc-page` precedent:
  `docs/plans/2026-08-08-003-feat-rates-watch-plan.md`,
  `docs/reports/rates-watch.md`, `docs/proposals/…`, and six trimmed fixtures
  under `test/fixtures/rates/`. `site/config.json` and `src/config.default.ts`
  are untouched — verified in the diff and at runtime (the script only ever
  reads the config).
- A clean run records its reading to `main` (one bot-authored log line in
  `docs/harness/rates-source.md`). Without it the feed's window check would cry
  wolf every week after a quiet stretch, silenceable only by merging an empty
  PR. The push is best-effort; a protected `main` degrades the watch instead of
  breaking it.
- The first real run will almost certainly be `changed`, not `ok`: the
  observation block ships empty, so every currently-matching decree in the feed
  is new to it.

Proposals filed: deploy-redeploys-on-docs-only-commits
