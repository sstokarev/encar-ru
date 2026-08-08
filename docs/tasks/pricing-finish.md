+++
branch = "task/importer-pricing"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/importer-pricing"
size = "small"
size_why = "two changes the operator asked for plus two one-liners from your own proposals"
owns = ["src/calc/pricing.ts", "src/page/render.ts", "src/config.ts", "tsconfig.json", "test/pricing.test.ts", "test/page.test.ts", "test/config-file.test.ts"]
reads = ["docs/reports/importer-pricing.md", "docs/harness/pipeline.md"]
accepts = ["operator opens the page the architect serves him, sees no rounding row, and every line carries a number"]
after = []
+++

Continuation of your own branch — the model is accepted, these are the four
things between it and the PR. The acceptance timeout was my failure, not
yours: you asked on a blocking `ask` and I answered into your inbox with a
separate `send`, which does not release an ask. Reporting `--outcome failed`
rather than claiming a PR was the right call.

1. **Operator, looking at your page: «округление убери и просто зашей молча в
   цену».** Delete the visible «Округление тарифа (вверх до 100 ₽)» row. The
   RULE stays — tariffs still round up to the nearest 100, and the 5 045 020
   pin must still hold — it is absorbed into the tariff line, not shown.
2. **`CONFIG_URL` (src/config.ts:44) makes acceptance impossible.** The page
   fetches the PRODUCTION config wherever it is served from, so he saw your
   new bundle against the old published config — «СБКТС и ЭПТС» and «Брокер и
   СВХ» dashed, items your config does not even have. A page served from the
   same origin as its own config.json must use that one, falling back to
   CONFIG_URL; the widget, injected into encar.com, MUST keep the absolute
   URL. Pin both halves with a test.
3. Your proposal `config-validator-uses-array-builtins`: taken. Replace the
   `.every(...)` at src/config.ts:131 with a plain `for-of`, same as the money
   path already does — the encar host page replaces Array built-ins and you
   measured what that costs on 2026-08-02.
4. Your proposal `tsc-lib-es2022`: taken. Bump `lib` to es2022 in
   tsconfig.json so `npx tsc --noEmit` is clean.

Do NOT ask me for the acceptance and do NOT wait on a timer: finish, push, and
send `worker_done`. I serve the page to the operator myself and carry his
verdict back as a new dispatch if he wants a change.
