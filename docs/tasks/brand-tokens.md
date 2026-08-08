+++
branch = "task/brand-tokens"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/brand-tokens"
size = "normal"
size_why = "extracting the real tokens and applying them is the work; the look is the operator's judgment"
owns = ["site/tokens.css", "site/landing.html", "test/landing.test.ts"]
reads = ["site/calc.html", "src/page/render.ts", "docs/harness/pipeline.md"]
accepts = ["operator opens the landing next to globalcartrade.ru on his phone and it reads as the same site, with the label as on his site"]
after = []
+++

The operator's words, 2026-08-08: «задача - оформить калькулятор в
дизайн-токенах сайта. делай не на глаз, возьми стили, шрифты, добавь лейбл
как на сайте». His site: https://globalcartrade.ru/

Not by eye is the whole point: extract the real values from the live site —
fonts and their weights and actual loading, colours, spacing, radii, the
label/logo treatment — and drive the page from them rather than from
approximations that look close on your screen. How you extract them and how
you store them is yours to decide; that is the task, not the brief.

What exists and must not be rebuilt: `site/landing.html` (just merged) already
mounts the working calculator and its copy is the operator's own, settled with
him — restyle it, do not rewrite what it says. `site/calc.html` is the bare
calculator page and belongs to the live `task/importer-pricing`: do NOT touch
it. Leave the tokens in a form that page can adopt in one line afterwards, and
say in your report what that line is.

Traps already paid for: the operator's clients arrive from a Telegram link on
a phone, so the phone is the primary layout; and an input whose computed
font-size is under 16px makes iOS zoom the whole page when a client taps it
(`docs/proposals/calc-page-invalid-font-shorthand-zooms-ios.md`) — whatever
typography you import must not reintroduce that.

Anything about the look that is a judgment call rather than a measurement, ask
him in your pane with the picker, one at a time, showing what he will see.
