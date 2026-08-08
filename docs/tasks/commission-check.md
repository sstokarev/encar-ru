+++
branch = "task/commission-check"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/commission-check"
size = "normal"
size_why = "the caption is one line; proving the ladder picks right on real lots is the work"
owns = ["src/calc/pricing.ts", "src/page/render.ts", "test/pricing.test.ts"]
reads = ["src/calc/customs.ts", "site/config.json", "docs/reports/importer-pricing.md", "docs/harness/pipeline.md"]
accepts = ["operator opens several real lots across price bands and the commission line shows the step he would charge, with no caption under it"]
after = []
+++

The operator's words, 2026-08-08: «комиссия — убери подпись в ценнике. я давал
механику расчёта со ступенями, перепроверь - задачей, пусть ссылки разные
посмотрит».

His ladder, given verbatim on 2026-08-08, bracketed on the subtotal BEFORE
commission (price + Korean costs + tariffs + broker):

    < 1.5M -> 30 000 | 1.5-5.5M -> 50 000 | 5.5-9.5M -> 75 000 | > 9.5M -> 100 000

Two things, and the second is the task.

1. **Remove the caption under the commission row.** He sent a screenshot of
   «минимальная ступень: расчёт ещё неполный» printed under a value of
   50 000 ₽ — which is the SECOND step, not the minimum one. Whatever the code
   means by it, what a client reads is a contradiction. Decide with him IN
   YOUR PANE what the row should show when the subtotal is only a floor and
   the true step could still be higher: the bounded step silently, a range, or
   something else. Do not keep a caption that argues with its own number.

2. **Verify the ladder against real lots, many of them, not one.** Pull actual
   encar listings across the bands and especially just under and just over
   1.5M, 5.5M and 9.5M, and check the step the page prints is the step he
   would charge. His own worked quote (5 045 020, lot 41599967) cannot
   discriminate the boundary rule: both readings give 50 000 there, which is
   exactly why this needs lots that DO discriminate. Pin what you find in
   tests naming the boundary, so the rule stops being folklore.

Watch the interaction with an incomplete quote: when a cost line dashes, the
subtotal is a floor, so the bracket can only be bounded from below — a
confident step under a floor total is a wrong number presented as a right one.
That interaction is the reason this task exists.
