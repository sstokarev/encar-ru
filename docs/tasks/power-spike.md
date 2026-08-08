+++
branch = "task/power-spike"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/power-spike"
size = "small"
size_why = "read-only research spike; the deliverable is a measured report"
owns = ["docs/harness/spike-power.md"]
reads = ["src/calc/customs.ts", "docs/harness/pipeline.md"]
after = []
+++

Since ПП №1713 the recycling fee is looked up by engine POWER, which the
encar listing DOM and the vehicle API both lack — the fee line dashes on
almost every quote (see the header of src/calc/customs.ts). Find a power
source keyed from what the vehicle API gives us.

Leads, in order: `category.jatoVehicleId` (a JATO catalog id — what encar
endpoint or public surface resolves it?); other api.encar.com readside/
catalog endpoints; the listing page's own spec tab (fem.encar.com) — does it
render power, and from what request? Deliverable: docs/harness/spike-power.md
with MEASURED findings only — endpoint, sample request/response, coverage
guess across fuel types (ICE / hybrid / EV). No product code. Hybrids need
ICE + 30-minute electric power both — note what is and is not obtainable.
