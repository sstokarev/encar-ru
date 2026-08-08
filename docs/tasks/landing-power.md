+++
branch = "task/landing-power"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/landing-power"
size = "small"
size_why = "one input plus its label on a page that already mounts the calculator"
owns = ["site/landing.html", "test/landing.test.ts"]
reads = ["site/calc.html", "src/page/main.ts", "docs/harness/pipeline.md"]
accepts = ["operator opens the landing, pastes a lot, and the утильсбор line carries a number instead of a dash"]
after = ["importer-pricing"]
+++

Cross-branch gap, found by the architect 2026-08-08 and invisible to either
worker alone. `site/landing.html` has its own markup and carries only
`data-calc-form`, `data-calc-url`, `data-calc-submit`, `data-calc-note`,
`data-calc-result`. The power input the operator needs is
`[data-calc-power]`, read at src/page/main.ts:74 — present in
`site/calc.html` on task/importer-pricing, absent from the landing.

Consequence: after importer-pricing merges, the bare calculator page prices
the recycling fee and THE LANDING STILL DASHES IT, because `initCalcPage`
finds no power element there. The operator saw exactly this and asked which
branch fixes it — the answer must stop being "none".

Add the input to the landing with the same contract and the same wording the
calculator page uses, and pin it with a test that fails when the two pages
drift apart — the drift is the actual defect here, not the missing element.
Note the invalid `font` shorthand defect
(`docs/proposals/calc-page-invalid-font-shorthand-zooms-ios.md`): whatever you
add must compute at 16px or larger or iOS zooms the page when a client taps it.

Blocked until task/importer-pricing lands: the contract it defines is what you
mirror.
