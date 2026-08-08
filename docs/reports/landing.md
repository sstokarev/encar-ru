# task/landing — report

**Branch:** `task/landing` · **Worktree:** `/Users/stokarev/orca/workspaces/encar-ru/landing`
**Brief:** `docs/tasks/landing.md` · size `deep`

## What shipped

`site/landing.html` — one standalone phone-first page, deployed with the rest
of GitHub Pages, that a client can be sent to cold from a Telegram link. It
mounts the existing calculator by carrying the same `[data-calc-form]` markup
and loading the existing `site/calc.js` bundle; `src/page/main.ts` auto-inits
on any document with that markup, so no new TypeScript and no `package.json`
change were needed.

`test/landing.test.ts` — 14 tests that read the shipped HTML off disk rather
than a synthetic DOM, then drive `initCalcPage` against it with injected
adapter, config and rates.

Files added: `site/landing.html`, `test/landing.test.ts`,
`docs/brainstorms/2026-08-08-landing-requirements.md`,
`docs/plans/2026-08-08-003-feat-landing-page-plan.md`,
`docs/proposals/` (two). Nothing owned by
another task was touched.

## What the operator decided

The brief said the substance is his, not mine. Five questions in this pane,
one at a time, options showing the copy he would see. His answers, and they
are all "less than I offered":

1. **Calculator first.** The input field is the top of the page. No headline
   promise, no company story above it — he rejected all three pitch variants.
2. **«Что входит в цену» is one paragraph, no lists.** He rejected both
   two-column «входит / не входит» layouts, including the one with ruble
   figures on the excluded items: naming a number binds him.
3. **One line under the total.** He rejected a price-fixation promise and a
   «наша комиссия не вырастет» guarantee. The page adds nothing beyond the
   rate footnote the calculator already renders.
4. **Nothing after the Telegram button.** No response-time promise, no deal
   steps — «любой срок рядом с кнопкой — обязательство».
5. **Just «GlobalCarTrade».** No founding year, no car count, no INN, no
   legal entity. The test enforces this as a negative assertion so a later
   edit cannot quietly reintroduce invented credentials.

## What the brainstorm found that the brief did not know

`docs/tasks/importer-pricing.md` left open whether СБКТС/ЭПТС «disappears or
moves» from the operator's quote. Asked here; his answer:

> СБКТС/ЭПТС входит в стоимость фиксированных брокерских услуг

So it moves — the fixed 116 000 RUB broker line already pays for it. The
landing copy says so. The cost table still labels that line «Брокер и СВХ»,
which is `site/config.json`, owned by `task/importer-pricing`. Filed, not
fixed: `docs/proposals/sbkts-lives-inside-the-broker-line.md`.

## Decisions I made that were not his

**A standing Telegram link in the footer.** A client who arrives without an
encar link has no other exit. It is a plain `t.me` href with the address
duplicated from `site/config.json` — the config is not loaded before the
first calculation, so reading it would cost a script, a bundle and a build
entry in a `package.json` another task owns. The in-result button still takes
its address from config through `src/page/tg-link.ts`. Removable in one line
if he does not want it.

**`src/page/landing.ts` was not created.** The brief's `owns` list allowed
for it; the auto-init in `src/page/main.ts` made it unnecessary.

## What the code review caught

Four findings, three fixed here:

- **Invalid `font` shorthand** (`font:1rem inherit`) silently dropped the
  input's font-size, leaving it near 13px — and iOS Safari zooms any input
  under 16px on focus, on the exact phone this page is built for. Fixed. The
  same block is copied in `site/calc.html` and `site/index.html`, which are
  not mine: `docs/proposals/calc-page-invalid-font-shorthand-zooms-ios.md`.
- **The draft note showed on the loading and error cards**, where there is no
  Telegram button to explain. Now gated on the button actually being present.
- **The footer Telegram address could drift** from `site/config.json`. Pinned
  by a test against the shipped config and `DEFAULT_CONFIG`.

The fourth is the merge-order problem below, which is not fixable in my files.

## Blocking: this page must not reach production before `task/importer-pricing`

The prose says the price covers freight, broker, СБКТС/ЭПТС and commission —
the operator's own words. On today's `site/config.json` those four
`costItems` are `kind: "unknown"`, so `computeAllIn` dashes them, drops them
from the total, and `renderNotes` prints `UNKNOWN_COST_NOTE` — «Доставка,
оформление и комиссия показаны прочерком и в сумму не входят» — a few pixels
under my paragraph. The page contradicts itself until `task/importer-pricing`
prices those four lines.

I cannot fix it: `site/config.json` is that task's file, and softening the
copy would overwrite a decision the operator made explicitly. The brief
declared `after = []`; that was wrong, and this is the correction. The
architect was asked (`orca orchestration ask`, 2026-08-08) and did not answer
within ten minutes, so the constraint is recorded here and in the PR body
instead of blocking.

A new test pins the other half of the same seam: every cost item in
`site/config.json` must be named somewhere in the page prose, so a cost line
added later cannot silently stop being described.

## Verification

- `npm test` — 17 files, 359 passed, 0 failed (367 total; 8 skipped, all pre-existing).
- `npm run build` — green, both bundles emitted.
- Local browser check was attempted and abandoned: the Chrome extension
  refused `localhost` and `127.0.0.1` with an error page after two tries. The
  page's behavior is proven by the jsdom suite driving the shipped file; its
  appearance is the operator's acceptance, below.

## Acceptance

Per the brief the operator must watch this at the worktree before a PR opens.

Proposals filed: sbkts-lives-inside-the-broker-line, calc-page-invalid-font-shorthand-zooms-ios.
