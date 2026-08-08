---
title: Build-time data snapshot + refuse-on-ambiguity matching for CORS-blocked sources
date: 2026-08-08
category: architecture-patterns
module: specs-catalog
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "the product is a static browser-only site (GitHub Pages, no backend)"
  - "a needed data source sends no CORS header (drom.ru, most catalog sites)"
  - "matched data feeds a money-bearing calculation where a wrong value costs rubles"
related_components:
  - "src/calc/specs.ts"
  - "scripts/build-catalog.mjs"
  - "site/specs-catalog.json"
tags: [drom-ru, catalog, cors, matching, honesty, windows-1251, scraper]
---

# Build-time data snapshot + refuse-on-ambiguity matching for CORS-blocked sources

## Context

The customs calculator needed engine power (ICE hp + electric 30-minute hp)
that no public encar surface carries (measured: docs/harness/spike-power.md).
The operator's source, drom.ru, publishes both figures for Korean-market
modifications — but sends no CORS header, and the product is a static
GitHub Pages site with no backend. tks-parity task, 2026-08-08.

## Guidance

Snapshot at build time, match in the browser, refuse when unsure:

1. **Collector script** (`scripts/build-catalog.mjs`, node ESM, no deps) is
   run BY HAND; CI never fetches the source. Output is deterministic sorted
   JSON committed to `site/` — it deploys with the site and diffs are
   reviewable. Tests validate the committed file, never the network.
2. **Matcher** (`src/calc/specs.ts`) is a pure function over CarData +
   catalog. A match is returned only when every surviving candidate agrees
   on the figures. No match, ambiguity, corrupt catalog → `undefined` → the
   engine's existing dash/floor semantics.
3. **Wrong-car protection** (found by adversarial review, worth keeping):
   - candidates whose production window closed within 6 months of the
     registration month stay "plausible leftovers" and must AGREE — dropping
     them silently handed a facelift/N-variant lot the wrong entry's power;
   - grade/trim tokens compare on word boundaries (the "smart" trim must not
     fire inside "Smartstream");
   - the validator carries plausibility bounds (hp 5–1500, cc 500–7000,
     month 01–12, from ≤ to) so a typo'd cell fails closed.
4. **Collector parsing is allowlist-first**: «Вид гибрида» values outside
   the three measured ones refuse the modification (wrong kind = wrong LEGAL
   track, not just a wrong number); the production window parses from
   `<title>` only; numbers strip thousands separators before reading.

## Why This Matters

A confidently wrong number is worse than an honest dash — the engine header
doctrine (src/calc/customs.ts) extends to external data: matching mistakes
are silent and directional (a 76-hp match on a 240-hp car understates the
утильсбор by millions). Refusal costs a dash; a wrong match costs money and
trust.

## When to Apply

Any future spec/data source for this product (the catalog-petrol task is the
immediate consumer), and any static-site product needing third-party data:
snapshot offline, commit, validate the committed artifact, and make the
matcher refuse rather than guess.

## Examples

drom.ru specifics measured 2026-08-08 (revalidate on re-run):

- windows-1251 encoding — decode with `TextDecoder("windows-1251")`;
- catalog tree: `/catalog/<brand>/<model>/` → generations `g_<year>_<id>/`
  (filter «Рынок сбыта: Южная Корея») → modification pages with spec rows
  `<td>label</td><td>value</td>`;
- the load-bearing row: «Электродвигатель: 30-минутная мощность, л.с.» —
  present for hybrids AND EVs; «Вид гибрида» sits in header cards, not the
  table;
- newer models (Ioniq 6, Kona Electric, Genesis) render complectation
  tables client-side and the server payload is EMPTY — a coverage gap, not
  a parser bug;
- some families are genuinely ambiguous on drom (EV6 Air/Earth battery
  variants share windows and trims but differ in power) — they dash, and
  that is correct behavior, explain it on-screen.
