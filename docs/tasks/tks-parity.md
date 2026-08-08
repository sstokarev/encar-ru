+++
branch = "task/tks-parity"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/tks-parity"
size = "deep"
size_why = "tariff scope is a product decision (which tracks matter) and the rules are legally dense"
owns = ["src/calc/customs.ts", "src/calc/specs.ts", "test/calc.test.ts", "test/specs.test.ts", "scripts/build-catalog.mjs", "site/specs-catalog.json", "src/page/lot.ts", "test/page-lot.test.ts", "test/params.test.ts", "test/ui.test.ts"]
reads = ["site/config.json", "docs/harness/pipeline.md"]
accepts = ["operator compares our quote against tks.ru/auto/calc for 2-3 real encar lots (petrol, hybrid, EV) and the lines match or the difference is explained on-screen"]
after = []
+++

The operator's words: «нам нужно забрать логику калькулятора с сайта tks.ru».
Our engine (src/calc/customs.ts) already covers физлица/личное пользование по
ЕЭК №107 + утильсбор + сбор за оформление. Measured deltas against
tks.ru/auto/calc (researched 2026-08-08, results page is reCAPTCHA-gated so
recheck by hand in a browser):

- EVs and sequential hybrids for ФИЗЛИЦ are NOT under №107 единые ставки —
  tks switches them to пошлина (ЕТТ) + акциз (руб/л.с.) + НДС. Encar is full
  of Korean hybrids/EVs; today we print «по запросу» for them.
- Whole ЮЛ/коммерческий track (ЕТТ №80 + акциз ст.193 НК + НДС) — does the
  operator's audience need it at all? Brainstorm question, not a given.
- Утильсбор: tks cites ПП №1291 (+81), our header cites ПП №1713 — reconcile
  which is current before touching rates; tks banners new rates «с 23
  августа» / «с 1 сентября».
- Hybrid inputs need TWO power figures (ICE + 30-min electric) — see the
  parallel power-spike task for what data is obtainable; manual input fields
  are a legitimate fallback.

Scope is yours to settle with the operator in the brainstorm. Keep the
engine's honesty rules: dashes for missing data, floors, «по запросу» only
for unusable input (см. header src/calc/customs.ts).
