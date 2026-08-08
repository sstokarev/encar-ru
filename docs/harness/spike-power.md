# Spike: engine power for the recycling fee (ПП №1713)

Measured 2026-08-08, from a residential IP, no auth unless stated. Sample car:
vehicleId 41756847 (Kia K7 2.2 diesel 2016, the card-fem.html fixture car).

**TL;DR: no public encar surface exposes engine power for passenger cars.**
Trucks get `spec.horsePower` from the same vehicle API; cars do not, and no
probed endpoint resolves `category.jatoVehicleId` into a spec. The fee line
stays dashed unless we buy/borrow an external lookup keyed by the VIN or plate
number — both of which the vehicle API does return.

## Lead 1: `category.jatoVehicleId`

- Present for cars (`7647345201607051013` — trailing digits embed yyyymm+seq)
  and EVs (`832501620220512`, shorter format). Confirmed live on
  `GET https://api.encar.com/v1/readside/vehicle/41756847?include=CATEGORY,SPEC`
  (200, CORS `*`, no auth).
- Zero usages in the fem frontend: grepped all 19 webpack bundles of
  fem.encar.com/cars/detail — the string `jatoVehicleId` never appears.
- No resolver endpoint found. Probed and 404:
  `/v1/readside/vehicles/car/{id}`, `/v1/readside/catalog/vehicle/{jatoId}`,
  `/v1/readside/jato/{jatoId}`, `/v1/readside/vehicle/{id}/spec`.
- JATO data does exist server-side: `GET /v1/readside/vehicle/ev-battery/{id}`
  returns a `jatoBatteryInfo` block for EVs that have it (found 1 of 30 recent
  EV listings, id 42487331). Fields are battery-only: batteryType,
  controlSystem, thermalManagementSystem, otaUpdateSystem, v2lSupport,
  compositeEfficiency. **No motor power.**
- The legacy car DB on www.encar.com is JATO-keyed (`/common/combo/jatoYr.json`
  serves model years, public), but its spec/catalog views are gone:
  `db_carsinfo.do?method=carList` → 404; `method=newpricePopV2` (token minted
  publicly via `POST https://api.encar.com/autogate/v1/access/page/token`,
  body `{"validMinutes":30,"origin":"..."}`) renders "결과 없음" for the
  sample model and its markup has no spec fields at all.

## Lead 2: other api.encar.com endpoints

- `GET /v1/readside/vehicle/{id}?include=SPEC` — car spec block:
  mileage, displacement, transmissionName, fuelCd/fuelName, colorName,
  seatCount, tradeType, bodyName. No power.
- **Trucks are the exception.** `GET /v1/readside/vehicle/42494245?include=SPEC`
  (Kia Bongo III, found via `GET /search/truck/list/mobile?count=true&q=(And.Hidden.N.)&sr=|MobileModifiedDate|0|3&inav=|Metadata|Sort`):

  ```json
  "spec": { "type": "TRUCK", "displacement": 2497, "fuelName": "디젤",
            "horsePower": 133, ... }
  ```

  The fem UI renders it ("배기량 · 마력") only in its TRUCK branch
  (chunk 57576, the sole hit for 마력/horsePower across all bundles).
- Server-driven detail `GET /v1/readside/ui-components/vehicle/{id}/name/{name}`
  answers 200 with `{"success":false,"message":"This transaction has been
  restricted by traffic limits."}` for every name tried — same message the
  SSR fixture recorded, so the block is systemic, not per-IP throttling we
  triggered. Unverifiable; nothing suggests it carries power (the rendered
  page shows none).
- `GET /v1/readside/inspection/vehicle/{id}` — performance-inspection sheet;
  only 출력 hit is "발전기 출력" (alternator status). No engine power.
- `GET /v1/readside/record/vehicle/{id}`, `/v1/readside/diagnosis/vehicle/{id}`
  — 404 for the sample car.
- New-car price API (public, no token):
  `GET https://m.encar.com/newprice/api.do?method=detailview&mnfccd=002&mdlcd=122&clshdcd=005&clsdtcd=&year=2016&trns=A/T`
  → EUC-KR JSON, joins cleanly on the vehicle API's own codes
  (manufacturerCd/modelCd/gradeCd/gradeDetailCd/formYear + transmission).
  Returns new price (33,700,000 KRW) and equipment lists (`defaultitem`,
  `selectitem`). The powertrain is prose ("R2.2 디젤 + 8단 자동변속기") —
  **no numeric power**.

## Lead 3: fem.encar.com listing page

- Mobile SSR HTML of `/cars/detail/41756847`: no 출력/마력/kW/hp anywhere.
- All 19 JS bundles the page loads: the car spec tab renders 차량번호, 연식,
  주행거리, 배기량, 연료, 변속기 … — power is not in the render path for
  cars. Closed: the spec tab cannot be a source.

## Coverage guess by fuel type

| Fuel | Power obtainable from encar? | Notes |
|------|------------------------------|-------|
| ICE car | **No (0%)** | nothing public carries it |
| Hybrid | **No (0%)** | need ICE hp + 30-min electric kW; encar has neither, not even one of the two |
| EV | **No (0%)** | ev-battery block is battery-only; EVs are a separate fee code path anyway (ЕЭК №35) |
| Truck | Yes (~100%) | `spec.horsePower`, out of product scope |

## What IS obtainable, for a future task

The vehicle API publicly returns `vin` ("KNALB41ABGA037686") and `vehicleNo`
("18부0551") for every listing. Korean registry / insurance-history services
and VIN-decode catalogs key on exactly these and do carry rated power; encar's
own sell-side flow queries such providers (`/estimate/vehicle/v1/ts/detail`,
`/estimate/vehicle/v1/infotech/detail` — auth-gated, dealer/seller context).
Any real power source will be external and per-lot, joined on VIN/plate, or an
external trim catalog joined on category codes/names. Both are new-scope
decisions (paid APIs, terms of use), not product code for this spike.

Proposals filed: none
