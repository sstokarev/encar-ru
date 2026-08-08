---
title: "feat: Weekly tariff watch that proposes, never lands"
status: active
created: 2026-08-08
type: feat
origin: docs/tasks/rates-watch.md
---

# feat: Weekly tariff watch that proposes, never lands

## Summary

A scheduled job fetches the published tariff sources, extracts the numbers
`site/config.json` actually uses, compares them, and on a difference opens a PR
carrying the diff and the quoted source text. A human accepts. Nothing about the
config is ever edited by the job.

The brief assumed one source (`tks.ru/auto/calc/`) carrying "the numbers". It does
not: that page has no rate figures at all — only the calculator form, prose, and
decree citations. Reconnaissance (2026-08-08) found the numbers elsewhere, and
found that **one of the three config blocks cannot be watched by number at all**.
The plan is built around that asymmetry rather than hiding it.

---

## Problem Frame

Tariff numbers live in `src/config.default.ts` / `site/config.json` behind an
`asOf` date and nobody watches them. The 01.12.2025 recycling-fee reform (ПП
№1713) landed by hand. The operator's words: «каждый год ткс будет менять
утильсбор с 1 января — нужно забирать актуальный всегда оттуда».

Two failure modes bound the design:

- **A silent auto-update** makes the page quote a wrong price to a paying client.
  So: detect and propose, never land.
- **A client-side parse of legal prose** breaks in front of that client. So: the
  parse runs in CI, and its breakage is a red build, not a quiet pass.

A third, subtler one drives the exit-code design: **a parse that silently yields
nothing must never read as "config is fine."** An extractor that matched zero
rows and a config that matches the source produce the same "0 differences" unless
the code distinguishes them.

---

## What the sources actually carry (measured 2026-08-08)

| Config block | Source | Extractable? |
|---|---|---|
| `customs.dutyValueTiers`, `customs.dutyPerCcByAge` | `law.tks.ru/document/714355/` (Решение ЕЭК 107), utf-8, real `<table>` | **yes** |
| `customs.clearanceFeeBrackets` | `law.tks.ru/document/778729` (ПП 1637 ред. 1638), utf-8, **prose paragraphs** | **yes** |
| `customs.recyclingFee` (утильсбор) | — nothing on tks.ru carries the enacted ПП 1291 ред. 1713 grid | **no** |
| any of the above, "did the law move" | `publication.pravo.gov.ru/api/Documents` JSON, no key, no JS gate | signal only |

Supporting facts that shape the code:

- **Charset varies per page.** `/auto/calc/` is cp1251; `/auto/` and `law.tks.ru`
  are utf-8. Charset comes from the `Content-Type` header, never a constant.
- **`www.tks.ru/auto/2000000008/` still prints the superseded ПП 342 clearance
  grid.** It is a usable second source for duty and a *wrong* one for clearance.
  The watch must never read clearance from it.
- **Superseded `law.tks.ru` pages self-label «Недействующая редакция»** and link
  to the successor id. That string is a first-class staleness signal: our pinned
  document id going stale is itself a change worth a PR.
- **The authority feed's `q` parameter is silently dropped** — filtering is
  client-side over `complexName`. `PageSize` is an enum (30 and 200 valid).
  Page 1 spans roughly seven weeks, so a long outage loses events.
- `site/config.json` is byte-equal to `DEFAULT_CONFIG` (pinned by
  `test/config-file.test.ts`), so the script reads the JSON and never imports TS.

---

## Requirements

- **R1** Weekly schedule (not annual) plus manual dispatch. 01.12.2025 proves
  changes miss the 1-January story.
- **R2** Compare extracted numbers against `site/config.json`; never write to it.
- **R3** On a difference: open a PR carrying the diff and the quoted source text.
- **R4** Three distinct outcomes — clean, changed, broken — that can never be
  mistaken for one another.
- **R5** The утильсбор gap is stated in every run's output, not silently omitted.
- **R6** Report disagreement between tks (the operator's reference) and the
  primary source as a finding in its own right.
- **R7** Every extractor is testable offline from a captured fixture.

---

## Key Technical Decisions

### KTD1 — The source map is the observation log, and its git diff is the PR diff

`docs/harness/rates-source.md` carries a machine-maintained block between
`<!-- rates-watch:begin -->` / `<!-- rates-watch:end -->` markers holding the last
observed extraction per watch, plus the human-written prose about what is watched
and why. The job rewrites only that block.

This is what makes a "PR with the diff" possible without touching a file the job
must not own: the diff of the observation block *is* the change. The PR body adds
the quoted source text and the human's to-do (re-derive the config numbers).

Rejected: committing a dated report file per run (a new path each run, outside
this task's ownership, and it accumulates forever), and opening an issue instead
of a PR (the brief asks for a PR, and a PR carries a reviewable diff).

### KTD2 — Watches are declarative; extractors and comparators are pure

A `WATCHES` array declares `{id, url, what, extract, expect, minRows}`. `extract`
takes an already-decoded string and returns structured data; comparison is a pure
function of `(extracted, config)`. Only `main()` touches the network, the
filesystem, and `process.exit`. Fetch is injected, so tests drive whole runs
offline.

### KTD3 — Three outcomes, three exit codes, and `broken` is louder than `changed`

| Outcome | Exit | CI does | Meaning |
|---|---|---|---|
| `ok` | 0 | nothing | every watch parsed, everything matches |
| `changed` | 0 | opens/updates the PR | a number moved, a decree landed, or a pinned page went stale |
| `broken` | 1 | **fails the job**, opens no PR | a fetch failed, or an extractor returned fewer than `minRows` |

`minRows` is the load-bearing part: an extractor that finds nothing is `broken`,
never `ok`. A red build is the honest signal that the watch stopped watching — a
green build with "0 differences" from an empty parse is the failure this whole
task exists to prevent.

A `broken` watch does not suppress the others: every watch runs, and the run's
outcome is the worst of them. One dead source must not blind the rest.

### KTD4 — The утильсбор gap is a permanent, printed finding

`customs.recyclingFee` has no number-level watch. Every run's report carries a
section naming that block, why it is unwatched, and what stands in for it:

1. the authority feed filtered for amendments to ПП 1291 and for
   `утилизацион*` in `complexName`;
2. an **`asOf` staleness check** — if `customs.asOf` predates the most recent
   1 January, the annual indexation date has passed without anyone re-deriving
   the grid, and that alone is a `changed` finding.

The staleness check is what actually catches the operator's stated worry. The
feed catches an off-cycle reform like 01.12.2025.

### KTD5 — Duty is read from two sources and the disagreement is a finding

`law.tks.ru/document/714355/` (tables) and `www.tks.ru/auto/2000000008/` (`<pre>`
pseudo-tables) both publish the ЕЭК 107 scale. When they disagree, the run is
`changed` with an explicit "sources disagree" finding rather than picking a
winner (R6). Clearance is read from `law.tks.ru/document/778729` **only** — the
`/auto/` page is known-stale there.

### KTD6 — Number comparison is exact, on integers and scaled decimals

Rates are money and are compared exactly. Parsed decimals (`2,5 евро`) are
normalized to a fixed scale before comparison; no float tolerance, no rounding.
Whitespace normalization handles the sources' nbsp-separated thousands
(`8 500`) and comma decimals.

---

## High-Level Technical Design

```mermaid
flowchart TD
    CFG[site/config.json<br/>read-only] --> CMP
    subgraph watches [WATCHES — pure, injected fetch]
      D1[duty · law.tks.ru/714355] --> CMP{compare}
      D2[duty · tks.ru/auto/2000000008] --> CMP
      C1[clearance · law.tks.ru/778729] --> CMP
      F1[authority feed · publication.pravo.gov.ru] --> CMP
      S1[asOf staleness · clock] --> CMP
    end
    CMP --> R[report: ok | changed | broken]
    R -->|ok| N[exit 0, nothing]
    R -->|broken| X[exit 1 — job fails, no PR]
    R -->|changed| P[rewrite observation block<br/>in docs/harness/rates-source.md]
    P --> PR[branch + gh pr create<br/>body = findings + quoted source]
```

The decision that matters is the `broken` arm: it leaves the observation block
untouched and opens no PR, so a scraper that rotted can never overwrite the last
known-good observation with an empty one.

---

## Implementation Units

### U1. Fetch, decode, and the watch runner skeleton

**Goal** — the spine: charset-aware fetching, an injectable fetch, the watch
loop, and the three-outcome report object.

**Requirements** — R4, R7.

**Dependencies** — none.

**Files** — `scripts/check-rates.mjs`, `test/check-rates.test.ts`.

**Approach** — `decodeBody(arrayBuffer, contentTypeHeader)` picks the encoding
from the header (`TextDecoder` handles `windows-1251` natively in node 22) and
falls back to utf-8 when absent. `runWatches({ watches, config, fetchImpl, now })`
runs every watch, catches per-watch failures into `broken` findings, and returns
`{ outcome, findings, observations }` where `outcome` is the worst of the
per-watch outcomes. No `process.exit`, no I/O in this layer.

**Patterns to follow** — `scripts/build-bookmarklet.mjs` for the doc-comment
header, ESM, and `node:` imports.

**Test scenarios**
- cp1251 bytes with `charset=windows-1251` decode to correct Cyrillic; the same
  bytes with no charset header do not silently produce mojibake findings.
- A watch whose fetch rejects yields outcome `broken`, and the other watches in
  the same run still produce their findings.
- A watch returning HTTP 500 is `broken`, not `ok`.
- Worst-of aggregation: one `changed` + one `ok` is `changed`; one `broken` +
  one `changed` is `broken`.

### U2. Duty extractor (Решение ЕЭК 107) over two sources

**Goal** — parse `dutyValueTiers` and `dutyPerCcByAge` from both published
sources and compare with config.

**Requirements** — R2, R6, R7.

**Dependencies** — U1.

**Files** — `scripts/check-rates.mjs`, `test/check-rates.test.ts`,
`test/fixtures/rates/duty-law-714355.html`, `test/fixtures/rates/duty-auto-2000000008.html`.

**Approach** — two extractors over trimmed captures: a `<table>` reader for
`law.tks.ru/document/714355/` and a `<pre>`/`&brvbar;` reader for
`www.tks.ru/auto/2000000008/`. Both normalize nbsp thousands and comma decimals,
then emit the same shape as the config blocks so comparison is structural. Both
declare `minRows` (6 per-cc brackets per age band, 6 value tiers) so a layout
change fails loudly. Disagreement between the two sources is its own finding.

**Test scenarios**
- Fixture extraction reproduces today's config exactly → outcome `ok`.
- A fixture with `54 процента` changed to `52` produces a `changed` finding
  naming `customs.dutyValueTiers[0].pct`, old and new values.
- A fixture with a table row deleted trips `minRows` → `broken`, not `ok`.
- `2,5` and `2.5` and `2,50` all normalize to the same compared value.
- nbsp-separated `8 500` parses as 8500.
- The two sources disagreeing on one bracket yields a "sources disagree" finding
  and outcome `changed`.

### U3. Clearance-fee extractor (ПП 1637 ред. 1638) with edition-staleness check

**Goal** — parse the eight RUB brackets from the prose, and detect our pinned
document id going superseded.

**Requirements** — R2, R7.

**Dependencies** — U1.

**Files** — `scripts/check-rates.mjs`, `test/check-rates.test.ts`,
`test/fixtures/rates/clearance-law-778729.html`,
`test/fixtures/rates/clearance-superseded.html`.

**Approach** — a prose reader matching `<amount> рубл(ь|я|ей) - за таможенные
операции … <bound> включительно`, ordered ascending, with the last bracket
open-ended. `minRows: 8`. Separately: if the page contains «Недействующая
редакция», the run is `changed` with a finding carrying the successor link — our
pin moved, and a human must re-pin it. Explicitly **not** read from
`www.tks.ru/auto/2000000008/`, which still shows the superseded ПП 342 grid; that
exclusion is stated in a code comment so a later reader does not "fix" it.

**Test scenarios**
- Fixture extraction reproduces today's eight brackets → `ok`.
- A changed amount produces a `changed` finding naming the bracket index.
- A fixture with seven brackets trips `minRows` → `broken`.
- The «Недействующая редакция» fixture yields a `changed` finding quoting the
  marker and the successor document link, even when the eight numbers still match.

### U4. Authority feed, утильсбор gap, and `asOf` staleness

**Goal** — the signal-level watch that stands in for the un-extractable
recycling-fee grid.

**Requirements** — R1, R5, R6.

**Dependencies** — U1.

**Files** — `scripts/check-rates.mjs`, `test/check-rates.test.ts`,
`test/fixtures/rates/authority-feed.json`.

**Approach** — one GET of the Government-decrees feed (`PageSize=200`), then
client-side filtering of `complexName` for (a) the amendment phrase together with
each watched decree's number **and** its date — the number alone collides — and
(b) `утилизацион`. New `eoNumber`s not present in the observation block are
`changed` findings carrying title, date, and
`publication.pravo.gov.ru/document/<eoNumber>`.

Two honesty guards, both printed every run:
- the watermark check — if the oldest item returned is newer than the last
  recorded `publishDateShort`, the feed window skipped past us and the run says
  so rather than reporting "no new decrees";
- the permanent gap notice for `customs.recyclingFee` (KTD4), plus the `asOf`
  staleness check against the most recent 1 January.

**Test scenarios**
- A feed fixture containing an amendment to ПП 1291 dated 26.12.2013 yields a
  `changed` finding; one naming only the bare number `1291` in an unrelated title
  does not.
- A feed whose items are all already in the observation block yields `ok`.
- A feed whose oldest item post-dates the recorded watermark yields a "window
  skipped" finding, not silence.
- `asOf` = 2026-01-01 with clock 2026-08-08 → no staleness finding;
  `asOf` = 2025-12-01 with clock 2026-08-08 → `changed`.
- The report always contains the recycling-fee gap notice, including on an
  otherwise clean run.

### U5. Source map, report rendering, and the observation block rewrite

**Goal** — the human-facing artifacts: the source map document, the PR body, and
the machine-maintained observation block.

**Requirements** — R3, R5.

**Dependencies** — U2, U3, U4.

**Files** — `docs/harness/rates-source.md`, `scripts/check-rates.mjs`,
`test/check-rates.test.ts`.

**Approach** — `renderReport(report)` produces the PR body: what changed, config
path, old → new, the quoted source line (bounded — a few hundred characters, so a
layout change cannot paste a whole page into a PR), the source URL, and the
recycling-fee gap notice. `writeObservations(markdown, observations)` replaces
only the delimited block, preserving the prose around it, and refuses to write at
all when the outcome is `broken`.

`docs/harness/rates-source.md` states, in prose: what each watch reads, why that
URL and not another (including the two exclusions — the calc page carries no
numbers, the `/auto/` page is stale for clearance), the tks-is-a-signal rule, and
the recycling-fee gap.

**Test scenarios**
- The block rewrite preserves surrounding prose byte-for-byte and replaces only
  the delimited region.
- A `broken` outcome leaves the document unmodified.
- A missing marker pair is an error, not a silent append.
- The rendered body for a duty change names the config path, both values, the
  source URL, and quotes the source line.
- A quoted source line longer than the cap is truncated with an ellipsis.
- The gap notice is present in the rendered body of a clean run.

### U6. The scheduled workflow

**Goal** — run it weekly and open the PR.

**Requirements** — R1, R3, R4.

**Dependencies** — U5.

**Files** — `.github/workflows/rates-watch.yml`.

**Approach** — `schedule: cron "0 6 * * 1"` plus `workflow_dispatch`. Steps:
checkout, setup-node 22, `npm ci`, run the script. `permissions: contents: write,
pull-requests: write`. On `changed`: create/force-update a fixed branch
(`rates-watch/proposal`), commit the source-map diff, and `gh pr create` with the
rendered body — reusing one branch means a second unaccepted change updates the
open PR instead of opening a second one. On `broken`: the non-zero exit fails the
job, which is the notification; no PR, no commit. Concurrency group so two runs
never race the branch.

**Test expectation: none** — YAML with no local behavior to assert. Verified by
`workflow_dispatch` reasoning and a local dry run of the script.

---

## Scope Boundaries

**In scope** — the four owned paths, plus small trimmed fixtures under
`test/fixtures/rates/`.

**Out of scope** — `site/config.json` and `src/config.default.ts` (a parallel task
owns them; this job proposes, it does not land). Any change to the calculator
itself. Any live-pull of rates at client runtime.

### Deferred to Follow-Up Work

- A number-level watch for `customs.recyclingFee` — it needs a source that
  publishes the enacted ПП 1291 grid in curl-readable form (the amending decree's
  PDF on publication.pravo.gov.ru is the only candidate found, and PDF extraction
  is its own task).
- Paging the authority feed backwards after a long outage. Today the watermark
  check *reports* the gap; closing it automatically is more machinery than the
  first version earns.
- Watching Решение ЕЭК 107 at its own authority — `docs.eaeunion.org` slugs proved
  unstable (a 301 resolved to a different document), so the EEC scale is watched
  through tks only, and that limitation is written into the source map.

---

## Risks

- **A layout change breaks an extractor.** Mitigated by `minRows` → `broken` →
  red build. Accepted cost: a false red build when a source reformats benignly.
  That is the correct direction to fail.
- **False negatives on the feed filter.** An amendment reaching утильсбор through
  a different base decree, or a Минпромторг/ФТС act, will not match. Stated in the
  source map; the `asOf` staleness check is the backstop that does not depend on
  matching a title.
- **A stale-but-parseable source** (the `/auto/` clearance grid) silently agrees
  with nothing. Mitigated by never reading clearance from it, plus the
  «Недействующая редакция» check on the pages we do pin.
- **PR noise.** One fixed branch, one open PR at a time.

---

## Verification

- `npm test` green, including the new suite, with no network access in tests.
- A local run of the script against the live sources produces `ok` against
  today's config — proving the extractors reproduce the current numbers rather
  than merely parsing something.
- A local run with a deliberately mutated copy of the config produces `changed`
  with the expected finding.
- `python3 harness/test_preflight.py`, `test_boundary.py`, `test_board.py` green.
