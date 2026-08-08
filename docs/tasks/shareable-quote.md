+++
branch = "task/shareable-quote"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/shareable-quote"
size = "normal"
size_why = "the URL is small, but what a shared link promises when reopened later is a product decision"
owns = ["src/page/main.ts", "src/page/share.ts", "site/landing.html", "test/share.test.ts", "test/page.test.ts"]
reads = ["src/page/render.ts", "src/calc/pricing.ts", "docs/harness/pipeline.md"]
accepts = ["operator computes a quote, reloads the page and it is still there, sends the link to himself in Telegram, opens it on his phone and sees the same car and the same total"]
after = ["importer-pricing", "brand-tokens"]
+++

The operator's words, 2026-08-08: «ссылка на рассчёт должна переживать
перезагрузки - ими должна быть возможность делиться». Today the quote lives
only in the tab: reload and it is gone, and he cannot send a client a finished
calculation.

Two traps that decide whether a shared link helps or embarrasses him, and both
are yours to solve rather than discover late:

- **The manual power figure must ride in the URL.** The manager types
  «Мощность, л.с.», and the recycling fee depends on it. A link without it
  reopens with that line dashed and a LOWER «от N ₽» total than the one the
  manager quoted out loud — the client sees a cheaper number than he was told,
  which is worse than seeing none.
- **A shared link re-computes; it does not replay.** There is no backend, so
  the page recalculates from the live FX rate and the current tariff config.
  The same link opened next month legitimately shows a different total. Decide
  with the operator IN YOUR PANE what a client should see then: the fresh
  number with the rate date visible, a warning that the quote was made on
  another date, or something else. Do not silently present a re-computed
  number as the one that was sent.

Both surfaces must carry it: the bare calculator page and the landing. Keep
the URL short enough to survive a Telegram message unbroken, and make it work
when a client opens it cold with no history.
