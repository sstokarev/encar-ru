+++
branch = "task/catalog-petrol"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/catalog-petrol"
size = "normal"
size_why = "the collector and the matcher already exist; this is coverage plus the auto-fill seam"
owns = ["site/specs-catalog.json", "scripts/build-catalog.mjs", "src/calc/specs.ts", "test/specs.test.ts"]
reads = ["src/page/lot.ts", "src/page/main.ts", "site/calc.html", "docs/harness/pipeline.md"]
accepts = ["operator pastes a petrol lot he would actually import, does NOT type the power, and still sees the утильсбор line with a number and a note saying where the figure came from"]
after = ["tks-parity"]
+++

Measured 2026-08-08 on task/tks-parity's branch: `site/specs-catalog.json`
holds 33 entries — 23 hybrid, 10 electric, Hyundai and Kia only, ZERO petrol
or diesel. That is correct for its own task (the law needs two power figures
for hybrids and EVs), but it means the «Мощность, л.с.» field on the calc page
stays a manual entry for ordinary petrol and diesel cars, which is most of the
operator's business — his own worked example is a 265 hp petrol Audi.

The operator asked directly: «зачем пикер мощности двигателя? не можем
забирать по модели и данным авто?». The answer must become yes for the volume
models he imports.

Extend the SAME collector and matcher (do not build a second one) to petrol
and diesel, and make the page auto-fill the power field from the catalog with
the manual entry surviving as an override — a manager who knows better must
still win, and the client must see WHICH source the number came from (catalog
vs typed), because the 160 hp cliff turns a wrong figure into a 1.4-6.9 M RUB
error.

Ask the operator in your pane which models to cover first — he knows what he
actually ships; a catalog padded with cars nobody imports is carrying cost.
Near the 160 hp and 3000 cc cliffs a catalog figure must not be printed as a
point number (see the engine's dash/floor rules).

Blocked until task/tks-parity lands: it owns all four of these paths today.
