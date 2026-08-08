+++
branch = "task/encar-client"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/encar-client"
size = "small"
size_why = "one self-contained fetch-and-map module, contract already fixed in types.ts"
owns = ["src/encar/client.ts", "src/encar/index.ts", "src/encar/fixtures", "src/encar/client.test.ts"]
reads = ["src/encar/types.ts", "docs/harness/pipeline.md"]
after = []
+++

The calc page (parallel task) needs car data by listing URL. Implement
`src/encar/` to the contract in `src/encar/types.ts` — parse a listing URL to
a vehicleId, fetch, map to CarData.

Measured 2026-08-08: `GET https://api.encar.com/v1/readside/vehicle/<id>`
returns 200 with `access-control-allow-origin: *`, no auth. Fields seen live:
spec.{mileage,displacement,fuelName,transmissionName,colorName,seatCount,
bodyName}, category.{manufacturerEnglishName,modelGroupEnglishName,
gradeEnglishName,yearMonth}, advertisement.price, photos (34 items, relative
paths), vin. Traps: price is in 만원 — multiply by 10,000 (same convention the
overlay scanner already handles); photo paths are relative — verify the
absolute base by actually rendering one. URL forms to support: fem.encar.com
/cars/detail/<id> and www.encar.com/dc/dc_cardetailview.do?carid=<id>.

Tests: vitest on a captured fixture JSON, no network (see the guard
convention at src/main.ts:214).
