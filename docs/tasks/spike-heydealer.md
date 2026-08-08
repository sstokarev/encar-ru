+++
branch = "task/spike-heydealer"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/spike-heydealer"
size = "small"
size_why = "read-only research; the deliverable is a measured report, not code"
owns = ["docs/harness/spike-heydealer.md"]
reads = ["docs/harness/spike-power.md", "src/calc/customs.ts", "src/encar/types.ts", "docs/harness/pipeline.md"]
after = []
+++

The operator's words, 2026-08-08: «мощность можно взять с сайта heydealer -
отдельную задачу поресёрчить, можно ли, и насколько надёжно».

What is already measured, do not redo it: engine power for cars exists nowhere
on encar's public surfaces (`docs/harness/spike-power.md` — `spec.horsePower`
is trucks only, `jatoVehicleId` resolves nowhere public). The drom.ru route
works but only as a BUILD-TIME snapshot, because drom sends no CORS header and
this product has no backend; the catalog built so far is 31 entries, hybrids
and EVs, Hyundai and Kia only.

Answer two questions with numbers, not impressions:

1. **Can we get there from what we hold?** The encar API gives make, model,
   grade, year-month, displacement, fuel, mileage, VIN and the Korean plate.
   Which of those does heydealer accept as a key, and does it answer per-LOT
   (this exact car) or per-MODEL (a catalog row)? Per-lot would beat the drom
   route outright; per-model is another catalog and competes on coverage.
2. **How reliable, stated as coverage.** Sample enough real encar lots to put
   a number on it, split by fuel: petrol, diesel, hybrid, electric. For
   hybrids the law needs BOTH the ICE power and the 30-minute electric power —
   report them separately, since one without the other does not close the
   recycling fee. Note whether the figure is the KOREAN domestic rating and
   whether it agrees with drom for the same car where both have it;
   disagreement between two sources is itself a finding.

Also record what it would cost to depend on it: CORS, auth, rate limits,
whether the numbers sit in a stable machine-readable place or in prose that
reflows, and what breaks silently when they change it.

Why the bar is high: at 160 hp the recycling fee jumps from 5 200 RUB to
1.4-6.9 M RUB. A source that is usually right is not usable unless we can tell
WHEN it is wrong. Say plainly if the answer is no — a measured negative is
what `spike-power` delivered and it saved the next three days.

No product code. The report is the deliverable.
