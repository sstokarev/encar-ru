+++
branch = "task/importer-pricing"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/importer-pricing"
size = "normal"
size_why = "four cost lines plus an FX rule; the model is given, the shape in code is the worker's"
owns = ["site/config.json", "src/config.default.ts", "src/calc/pricing.ts", "test/pricing.test.ts", "src/page/main.ts", "test/page.test.ts"]
reads = ["src/calc/customs.ts", "src/page/render.ts", "docs/harness/pipeline.md"]
accepts = ["operator opens the calc page on a live lot (42217972 / 42319113 / 42512433, his pick) and every cost line carries a number with the CBR footnote visible"]
after = []
+++

The page ships but four of five cost lines are `unknown` and dash out, so the
total is still "от N ₽". The operator handed over his real pricing model
(2026-08-08) as a worked quote. Arithmetic below was re-derived and matches
his figure to the ruble — treat it as measured, not as a hint.

His quote (lot fem.encar.com/cars/detail/41599967, 2.0 petrol 265 hp, 4WD,
registered 01.2023, built 11.2022, 47,800 km):

- Цена авто 44,600,000 KRW + **расходы по Корее (экспорт, фрахт) 2,500,000
  KRW** — shipping is priced in WON and added BEFORE conversion, not as a RUB
  line. Today's config has it as an unknown RUB item; that shape is wrong.
- FX is an **operator-set bank-transfer rate with a date**, not the CBR rate:
  «курс на 15.07.26, 1000 KRW = 54,2 руб., перевод через банк». 47,100,000 x
  54.2/1000 = 2,552,820 RUB exactly.
- Таможенная пошлина 3-5 лет: 2,326,200 RUB, and his own label says «физлицо,
  **коммерческий** утиль. сбор» — at 265 hp the reduced personal rate is dead
  (>160 hp), which is what src/calc/customs.ts already knows. He prints duty
  and утильсбор as ONE line.
- Брокерские услуги + тариф СВХ: **fixed 116,000 RUB**.
- Комиссия GlobalCarTrade: a ladder on the subtotal BEFORE commission —
  <1.5M: 30,000 / 1.5-5.5M: 50,000 / 5.5-9.5M: 75,000 / >9.5M: 100,000.
  Verified: 2,552,820 + 2,326,200 + 116,000 = 4,995,020 -> 50,000 ->
  **5,045,020 RUB**, his printed total.
- There is **no СБКТС/ЭПТС line** — his quote is «под ключ во Владивостоке».
  Ask him in your pane whether it disappears or moves.

Lot 41599967 is DEAD (404, confirmed 2026-08-08) - his quote is a sold car,
so it lives on only as a fixture test that must reproduce 5,045,020 to the
ruble; the live accept uses a fresh lot. His EUR is the CBR rate of the quote
date (88.5259 on 15.07.2026) and his single duty line already contains the
clearance fee - decomposition closes to 43 RUB at 1984 cc. Keep the
engine's honesty rules (dash / floor / «по запросу») intact for lots his
model cannot price.
