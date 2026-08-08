---
title: "feat: Standalone landing page for cold Telegram traffic"
status: active
date: 2026-08-08
origin: docs/brainstorms/2026-08-08-landing-requirements.md
task: docs/tasks/landing.md
depth: lightweight
---

# feat: Standalone landing page for cold Telegram traffic

## Summary

One phone-first page, `site/landing.html`, deployed with the rest of GitHub
Pages, that a client can be sent to cold from a Telegram link. It mounts the
existing calculator by reusing the `[data-calc-form]` markup and the built
`site/calc.js` bundle, and wraps it in the copy the operator settled in his
pane on 2026-08-08.

No TypeScript entry and no `package.json` change: `src/page/main.ts` already
auto-initializes on any document carrying the form markup, so including the
existing bundle is the whole wiring.

## Problem frame

`site/calc.html` is a bare calculator with no answer to «кто вы и что входит
в эту цифру». `site/index.html` sells the extension and the bookmarklet, not
the import service. A client arriving cold on a phone has nowhere to land.

## Requirements

Carried from the origin document; all six are the operator's choices.

| ID | Requirement | Origin |
|----|-------------|--------|
| R1 | Input field is the first thing on screen; no headline promise and no company story above it | origin R1 |
| R2 | «Что входит в цену» is one paragraph, no lists; СБКТС/ЭПТС named as included; the boundary is delivery-to-city and registration | origin R2 |
| R3 | Under the total, one line only — the page adds nothing beyond what the calculator already renders | origin R3 |
| R4 | Nothing is promised next to the Telegram button beyond the draft mechanic | origin R4 |
| R5 | The signature is «GlobalCarTrade» — no founding year, car count, INN, or legal entity | origin R5 |
| R6 | A standing Telegram link at the foot, so a client without an encar link is not stuck | origin R6, worker's call |
| R7 | Phone is the primary layout, not the fallback | brief `docs/tasks/landing.md` |

## Key technical decisions

**Reuse `site/calc.js`, add no build entry.** `src/page/main.ts` ends with an
auto-init guarded by the `[data-calc-form]` selector, so any page that ships
the same markup and the same bundle gets a working calculator. `package.json`
is owned by `task/calc-page`; adding a third esbuild entry would collide.
Consequence: `src/page/landing.ts` from the brief's `owns` list is not
created — there is no landing-specific behavior left to write.

**Telegram address is written into the HTML, not read from config.** The
footer link (R6) fires before any calculation, so no config has been loaded
yet. Reading `site/config.json` for one static href would mean a script, a
bundle, and a build entry. The href carries a comment naming
`site/config.json` as the source of truth. The in-result button keeps using
the config value through `src/page/tg-link.ts` — that path is untouched.

**Own stylesheet, same visual language.** `site/landing.html` carries its own
inline `<style>` rather than importing from `site/calc.html` (a file owned by
another task and mid-change). The result-card selectors are copied from
`site/calc.html` because `src/page/render.ts` emits those exact data
attributes; the page-level chrome is landing-specific.

**The test reads the shipped file.** `test/landing.test.ts` loads the real
`site/landing.html` off disk into jsdom rather than a synthetic DOM. That is
what makes it a regression test for the shipped page: if the form markup
drifts from what `initCalcPage` queries, or if the operator's copy is edited
away, the test fails.

## Implementation units

### U1. The page

**Goal.** `site/landing.html` renders the operator's approved page on a phone
and drives the existing calculator.

**Requirements.** R1–R7.

**Dependencies.** None.

**Files.** `site/landing.html` (create).

**Approach.** Document order, top to bottom:

1. Short heading «Расчёт под ключ», the form (`[data-calc-form]`,
   `[data-calc-url]`, `[data-calc-submit]`), the hint «Ссылка с encar.com».
   Nothing above it (R1).
2. `[data-calc-result]` — the calculator writes photos, specs, the cost
   table, the rate footnote and the Telegram button here.
3. «Что входит в цену» — the two paragraphs of R2, verbatim from the origin
   document.
4. Footer: «GlobalCarTrade» (R5) and the standing Telegram link (R6).

Copy the form and result-card CSS from `site/calc.html` so
`src/page/render.ts` output stays styled; keep the `novalidate` attribute and
its comment — browser URL validation swallows the submit otherwise. Load
`calc.js` with a relative src, same as `site/calc.html`.

Phone-first (R7): a single column, `max-width` for desktop rather than a
desktop grid narrowed down; tap targets at least 44 px tall; `viewport` meta
present.

R3 is satisfied by omission — the page prints no extra caveat under the
total, because `commissionNote` from `site/config.json` already renders
there. R4 likewise: only the one-line draft-mechanic note, no timings and no
deal steps.

**Patterns to follow.** `site/calc.html` for the form markup, the
`novalidate` comment, and every `[data-…]` result selector;
`site/index.html` for the page-chrome conventions (`.wrap`, `.card`,
`.muted`, the `#c00` accent).

**Test scenarios.** Covered by U2 — this unit ships no logic of its own.

**Verification.** `npm run build` is green and the page opens with the form
visible without scrolling on a 390 px-wide viewport.

### U2. The test

**Goal.** Pin both halves of the page: that the shipped markup actually
drives `initCalcPage`, and that the operator's copy is still on it.

**Requirements.** R1–R6.

**Dependencies.** U1.

**Files.** `test/landing.test.ts` (create).

**Approach.** Read `site/landing.html` off disk, put its `<body>` into the
jsdom document, then call `initCalcPage(document, deps)` with injected
adapter, config and rates — mirroring the `setup()` helper in
`test/page.test.ts`. The fixture car and rates can be local to the file; do
not export them from `test/page.test.ts`, which another task owns.

**Patterns to follow.** `test/page.test.ts` — `@vitest-environment jsdom`
pragma, injected `PageDeps`, the two-tick `drain()` helper for the handler's
chained awaits.

**Test scenarios.**

- The shipped page carries every selector `initCalcPage` queries
  (`[data-calc-form]`, `[data-calc-url]`, `[data-calc-submit]`,
  `[data-calc-result]`) — a missing one silently makes the page a no-op.
- Full path: submit a valid encar URL against an injected fixture car and
  assert the result region gains the car title, a cost table and a `t.me`
  link carrying the lot URL in its draft.
- Bad URL: submit `не ссылка` and assert the error card renders and no fetch
  fired.
- Fetch failure: the adapter rejects and the error card renders instead of an
  empty result.
- R2 copy: the page text names СБКТС and ЭПТС as included, and names delivery
  to the client's city and ГИБДД registration as outside the sum.
- R4/R5 copy: the page carries the draft-mechanic line and the
  «GlobalCarTrade» signature.
- R5 negative: the page asserts no unverifiable credential — no «ИНН», no
  «ООО», no car-count claim. Guards against a later edit reintroducing
  invented proof.
- R6: a `t.me` link exists in the document before any calculation runs.
- R7: the `viewport` meta tag is present.

**Verification.** `npm test` green, including the pre-existing suites.

## Scope boundaries

**Not in this plan**

- Any edit to `site/calc.html`, `src/page/main.ts`, `src/page/render.ts`,
  `src/page/tg-link.ts`, `site/config.json`, `package.json` — other tasks own
  them. This page imports; it does not change them.
- Replacing or touching `site/index.html`.
- The Tilda embed — `docs/tasks/tilda-embed.md`.
- `src/page/landing.ts`: listed in the brief's `owns` but not needed, since
  the auto-init in `src/page/main.ts` covers the wiring.

**Deferred to follow-up work**

- Relabelling the `broker` cost line so the client sees that СБКТС/ЭПТС are
  paid for — filed as `docs/proposals/sbkts-lives-inside-the-broker-line.md`
  for `task/importer-pricing`, whose file it is.

## Risks

**The cost-table label contradicts the page copy.** The page tells the client
СБКТС and ЭПТС are included; the table line still reads «Брокер и СВХ». Not
fixable here — the label lives in `site/config.json`. The proposal above
carries it; until it lands, the page is right and the table is merely silent,
not wrong.

**`site/calc.js` is a build artifact and gitignored.** The page is only alive
after `npm run build`. Same condition `site/calc.html` already lives under,
so the Pages deploy path is unchanged.

## Open questions

- R6 (the standing Telegram link) is the worker's call, not the operator's.
  It comes out with one line if he does not want it at acceptance.
