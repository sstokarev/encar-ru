+++
branch = "task/calc-page"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/calc-page"
size = "normal"
size_why = "new user-facing page; layout and UX decisions live in this task"
owns = ["site/calc.html", "src/page", "package.json"]
reads = ["src/encar/types.ts", "src/calc/customs.ts", "src/config.ts", "src/config.default.ts", "site/config.json", "docs/harness/pipeline.md"]
accepts = ["operator pastes an encar listing URL on the page and sees the car photo, specs, a full RUB cost table and a Telegram button with a prefilled draft"]
after = []
+++

The operator is changing the pitch: instead of the overlay, a standalone page
(`site/calc.html`, deployed with the rest of GitHub Pages). The client pastes
an encar listing link and sees: car photo(s), characteristics, the full all-in
RUB calculation, and a "написать в Telegram" button.

Reuse, do not rebuild: `src/calc/customs.ts` (the tariff engine — ЕЭК 107,
утильсбор, оформление) and the config pipeline (`src/config.ts`,
`site/config.json` — messenger.address is the Telegram handle; costItems is
the line list). Data comes from `src/encar/` being built in a parallel task
against the contract in `src/encar/types.ts` — if the module is absent in
your worktree, build the UI against a fixture CarData and merge origin/main
when the client task lands (watch `git log origin/main`).

Telegram button: t.me link from config with a prefilled draft containing the
lot URL and the computed total. Build: add a second esbuild entry for the
page. Power (мощность) is not in the data — the recycling-fee line renders
per the engine's existing dash semantics; a parallel spike is hunting a
power source, do not block on it.
