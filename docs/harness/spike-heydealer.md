# Spike: heydealer.com as an engine-power source (ПП №1713)

Measured 2026-08-08, residential IP, no auth unless stated. Every number below
comes from a live request made today; nothing is quoted from documentation,
because heydealer publishes none.

**TL;DR: no.** heydealer does hold Korean-domestic power figures and they are
good — where drom and heydealer both have a number for the same car, the ICE
figure agrees 13/13 on hybrids. But the two things the fee needs, it cannot
give:

1. **It answers per-MODEL, never per-lot.** Nothing keyed on VIN or the Korean
   plate is public — the plate lookup (「번호판 시세조회」) sits behind the app's
   phone login (`401 로그인 후 사용해주세요`). The only public power figure lives
   inside heydealer's own for-sale listings — **3,892 cars today** against
   encar's **150,564** — and it is a trim-catalog value, not a measurement of
   that car.
2. **The surface that carries power sends no CORS header.** `www.heydealer.com`
   returns no `access-control-allow-origin` at all. The surface that *is*
   CORS-open (`api.heydealer.com/.../car_meta/`, reflects any Origin with
   credentials) carries **zero** spec fields — no power, no displacement.
   So it is the drom.ru situation again: build-time snapshot or nothing.

And for the two fuels that actually need help it is worse than nothing:

- **Hybrids: 0%.** heydealer's `max_power` for a hybrid is the ICE figure only.
  All 48 hybrid listings sampled carry no motor number of any kind. One of the
  two required figures, never both.
- **EVs: 0%, and dangerous.** heydealer publishes PEAK output, not the
  30-minute rating. Across 14 EV rows it runs **1.18×–5.70×** drom's
  `electricHp30min` for the same car. Every heydealer EV figure sampled
  (204–385 마력) is above the 160 hp line; drom's 30-minute figures for those
  same cars (39–194) mostly sit below it.
- **Petrol and diesel: the number is right, the key is not.** 30 rows checked
  against drom's Korean-market tables: 29 agree — but only 13 uniquely, and on
  **11 of 30 (37%)** the (model, displacement) key we can actually build admits
  drom values on both sides of 160 hp.

---

## 1. What is actually public

| Surface | Auth | CORS | Carries power? |
|---|---|---|---|
| `www.heydealer.com/market/cars/{hash}` (SSR HTML) | none | **no ACAO header** | **yes** — `"max_power":"250 마력"` |
| `api.heydealer.com/v2/customers/web/car_meta/*` | none | reflects any Origin, `allow-credentials: true` | **no** |
| `market-api.heydealer.com/v2/customers/web/market/*` | server bootstrap auth | reflects any Origin | 500 without it |
| `api.heydealer.com/v2/customers/*` (sell side, plate lookup) | **401** `로그인 후 사용해주세요` | reflects any Origin | unknown |
| `/total-info` (「번호판만 입력하면 끝!」) | — | — | marketing page + QR into the app |

The catalog tree is complete and free: `brands/` → 79 brands →
`model_groups/` → 1,031 groups → `models/` (with `start_date`/`end_date` as
`YYYYMM`) → `grades/` → `details/`. Walked end to end. Every node returns
`Allow: GET, HEAD, OPTIONS` and **not one numeric spec field** — verified on
`car_meta/details/ByXaO3/` (쏘나타 하이브리드 DN8 모던): the whole body is
`hash_id, name, grade_detail, full_name, year_group, transmission`.

`max_power` therefore exists in exactly one place: denormalized onto a
for-sale car record, rendered by the market UI as
`e.detail_info.max_power ? … : "정보 없음"` (chunk `35n_seemeljmi.js`).

## 2. Question 1 — can we get there from what we hold?

encar hands us make, model, grade, year-month, displacement, fuel, mileage,
VIN and the plate. Measured, one key at a time:

- **VIN** — no public heydealer endpoint takes it. None found.
- **Plate (`vehicleNo`)** — this is heydealer's headline feature
  (「번호판으로 쉽게 시세조회 · 100만대 데이터로 정확하게」) and it is app-only.
  `/v2/customers/` and `/v2/customers/cars/` both answer `401`.
- **make / model / grade** — these *do* join. On an 800-lot encar sample the
  brand name matched heydealer's catalog 799/800, and the model-group name
  matched 100% for petrol, diesel and hybrid (electric 50% before
  normalization, purely because encar treats 아이오닉5 as a model-group while
  heydealer nests it as a model under 아이오닉). **But this join lands in
  `car_meta`, which has no power.**

**Per-lot or per-model?** Per-model, and precisely: model + grade + year-group.
In a 218-car sample there were 32 (model, grade) pairs holding more than one
car. 30 pairs reported an identical `max_power` for every car in them — that is
a catalog lookup, not a per-car reading. The 2 that differed were facelift
splits inside one grade name:

| model | grade | 2018 | 2020 |
|---|---|---|---|
| 더 뉴 레이 | 럭셔리 | 78 마력 | 76 마력 |

| model | grade | 2022 | 2024 |
|---|---|---|---|
| 아이오닉5 | 롱 레인지 AWD | 305 마력 | 325 마력 |

So a name-level join silently picks the wrong facelift. Note the second row:
305 vs 325 — both above 160 hp, so harmless here; but it is the same mechanism
that would pick 146 instead of 160 on a DN8 (see §5).

## 3. Question 2 — coverage, by fuel

**Field presence** where a listing exists at all — 218 detail pages, sampled
across heydealer's own fuel filter:

| fuel | n | `max_power` present |
|---|---|---|
| gasoline | 60 | 60 (100%) |
| diesel | 56 | 56 (100%) |
| hybrid | 48 | 48 (100%) |
| plug-in hybrid | 3 | 3 (100%) |
| electric | 51 | 48 (94%) |
| **all** | **218** | **215 (98.6%)** |

Always the same shape: `"N 마력"` — a localized string, metric PS, one scalar.
Never kW, never split into ICE + motor. The three EVs without it are a genuine
`"max_power": null` (닛산 리프 ZE1 2019, 봉고3 EV 2023 and — note — **아이오닉9
롱 레인지 2025**, a current flagship): the field is missing from the catalog, not
from the page.

**Reachability** is the number that matters, and it is much smaller. The figure
only exists on cars heydealer is currently selling: **3,892** (crawled all 399
list pages; page 390 is the last with cars). 800 real encar lots (200 per fuel,
newest by `ModifiedDate`) joined against that inventory:

| fuel | n | model name hit | model + grade hit |
|---|---|---|---|
| gasoline | 200 | 99.0% | **62.5%** |
| diesel | 200 | 96.0% | **45.5%** |
| hybrid | 200 | 78.0% | **46.5%** |
| electric | 200 | 86.0% | **69.0%** |
| **all** | **800** | **89.8%** | **55.9%** |

(Normalized join — parentheses, spaces and the 디 올 뉴 / 더 뉴 / 올 뉴 / 더 넥스트
prefixes stripped. Raw exact-string join is worse: 72.2% / 44.0%, and 26.2%
once the model year has to agree too.)

Two things to say plainly about that 55.9%:

- It is **not stable**. It is whatever heydealer happens to have in stock this
  week. Nothing pins it; nothing warns when a trim leaves.
- It is an **upper bound on the wrong quantity**. Matching the trim name says
  we found *a* number, not the *right* number — see §2 on facelifts and §5 on
  same-displacement modifications.

## 4. Hybrids and EVs — the fuels the fee actually turns on

The law needs, for a hybrid, BOTH the ICE power and the 30-minute electric
power. Measured against the drom catalog built by `task/tks-parity`
(`site/specs-catalog.json`, Korean-market generations only):

**Hybrid ICE — 13 of 13 rows agree** (8 uniquely; on the 1999 cc rows drom
lists 150/152/156 across the generation and heydealer's value is one of them).
Generations sharing a powertrain are collapsed into one line below:

| heydealer model | cc | heydealer | drom `iceHp` | drom `electricHp30min` | heydealer motor figure |
|---|---|---|---|---|---|
| 디 올 뉴 코나 하이브리드(SX2) | 1580 | 105 마력 | 105 | 14 | — none — |
| 디 올 뉴 그랜저 하이브리드(GN7) | 1598 | 180 마력 | 180 | 50 | — none — |
| 디 올 뉴 싼타페 하이브리드 (MX5) | 1598 | 180 마력 | 180 | 19 / 20 | — none — |
| 디 올 뉴 투싼 하이브리드 (NX4) | 1598 | 180 마력 | 180 | 19 / 20 | — none — |
| 그랜저 IG 하이브리드 | 2359 | 159 마력 | 159 | 41 | — none — |
| LF 쏘나타 하이브리드 | 1999 | 156 마력 | 150 / 152 / 156 | 20 / 25 / 32 | — none — |
| 쏘나타 하이브리드 (YF) | 1999 | 150 마력 | 150 / 152 / 156 | 20 / 25 / 32 | — none — |
| K5 하이브리드 3세대 | 1999 | 152 마력 | 150 / 152 / 156 | 20 / 27 / 37 | — none — |
| K5 하이브리드 2세대 | 1999 | 156 마력 | 150 / 152 / 156 | 20 / 27 / 37 | — none — |

The last column is the point. Across all 48 hybrid listings sampled,
`electric_efficiency` is `null` and no other motor field exists anywhere in the
payload. heydealer gives one of the two numbers, always the same one, and
never the other. **Hybrid coverage for the recycling fee: 0%.**

**EVs — the number is the wrong quantity.** `max_power` on an EV is peak system
output. Compared with drom's `electricHp30min` for the same nameplate:

| model | heydealer grade | year | heydealer | drom 30-min | ratio |
|---|---|---|---|---|---|
| 아이오닉5 | 롱 레인지 AWD | 2024 | 325 마력 | 76 / 103 | 3.16×–4.28× |
| 아이오닉5 | 롱 레인지 AWD | 2022 | 305 마력 | 76 / 103 | 2.96×–4.01× |
| 아이오닉5 | 롱 레인지 | 2022 | 217 마력 | 76 / 103 | 2.11×–2.86× |
| EV6 | 롱 레인지 AWD | 2022–25 | 325 마력 | 57 / 76 / 110 / 194 | 1.68×–5.70× |
| EV6 | 롱 레인지 | 2023–24 | 229 마력 | 57 / 76 / 110 / 194 | 1.18×–4.02× |
| EV9 | 롱 레인지 AWD 어스 | 2024 | 385 마력 | 72 / 136 | 2.83×–5.35× |
| EV9 | 롱 레인지 어스 | 2024 | 204 마력 | 72 / 136 | 1.50×–2.83× |
| 니로 EV | 프레스티지 / 노블레스 | 2019 | 204 마력 | 39 / 50 | 4.08×–5.23× |

Every heydealer EV figure sampled is 204–385 마력, i.e. above 160 hp. The
30-minute figures for the same cars are 39–194, i.e. mostly below it. Wiring
heydealer to the EV path would push essentially every EV lot over the cliff.
**EV coverage for the fee: 0%.**

## 5. Petrol and diesel — where heydealer looks usable, and why it still is not

For plain ICE cars heydealer's figure is the right quantity: the Korean
domestic rating in 마력 (metric PS). drom's Korean-market generations carry the
same quantity, so the two are directly comparable. Pulled drom's
Южная-Корея modification tables for `kia/k5`, `hyundai/sonata`,
`hyundai/tucson`, `kia/sportage` and matched on (generation window,
displacement):

**30 comparable rows: 29 agree, 1 disagrees.** heydealer's ICE numbers are
right. That is not the good news it sounds like:

```
heydealer model             cc  HD hp   drom Korean-market hp   verdict
K5                        1998    165   [165, 271]             agree (drom offers several)
K5                        1998    271   [165, 271]             agree (drom offers several)
K5                        1999    172   [157, 172]             agree (drom offers several)
K5                        1999    157   [157, 172]             agree (drom offers several)
K5 2세대                   1591    180   [180]                  AGREE (unique)
K5 2세대                   1685    141   [141]                  AGREE (unique)
K5 2세대                   1999    168   [151, 153, 168]        agree (drom offers several)
K5 3세대                   1598    180   [180]                  AGREE (unique)
K5 3세대                   1999    160   [146, 151, 160, 163]   agree (drom offers several)
LF 쏘나타                  1999    168   [151, 168]             agree (drom offers several)
LF 쏘나타                  1999    151   [151, 168]             agree (drom offers several)
LF 쏘나타                  2359    193   [193]                  AGREE (unique)
YF 쏘나타                  1998    165   [165, 271]             agree (drom offers several)
YF 쏘나타                  2359    201   [201]                  AGREE (unique)
뉴 투싼 ix                 1995    184   [184]                  AGREE (unique)
더 뉴 K5                   1999    172   [157, 172, 271]        agree (drom offers several)
더 뉴 K5 2세대              1999    163   [146, 151, 160, 163]   agree (drom offers several)
더 뉴 K5 3세대              1598    180   [180]                  AGREE (unique)
더 뉴 투싼 (NX4)            1598    180   [180]                  AGREE (unique)
디 올 뉴 투싼 (NX4)         1598    180   [136, 180]             agree (drom offers several)
쏘나타 (DN8)               1598    180   [180]                  AGREE (unique)
쏘나타 (DN8)               1999    160   [146, 151, 153, 160]   agree (drom offers several)
쏘나타 뉴 라이즈            1999    163   [146, 151, 153, 160, 163, 168]  agree (several)
쏘나타 뉴 라이즈            1999    151   [146, 151, 153, 160, 163, 168]  agree (several)
쏘나타 더 브릴리언트         1999    157   [172]                  DISAGREE (delta 15)
쏘나타 디 엣지(DN8)         1598    180   [180]                  AGREE (unique)
올 뉴 투싼                 1591    177   [177]                  AGREE (unique)
올 뉴 투싼                 1685    141   [141]                  AGREE (unique)
올 뉴 투싼                 1995    186   [185, 186]             agree (drom offers several)
투싼 ix                   1995    184   [184]                  AGREE (unique)
```

Read the third column. Only **13 of 30** rows agree *uniquely* — the other 16
agree only in the sense that heydealer's value is one of several drom lists at
that displacement. And **11 of 30 rows (37%) carry drom values on both sides of
the 160 hp line**: a 쏘나타 뉴 라이즈 2.0 is 146, 151, 153, 160, 163 or 168 hp
depending on the modification; a 디 올 뉴 투싼 1.6 is 136 or 180.

So the failure is not accuracy, it is **the key**. heydealer publishes one
value per grade; encar hands us a `Badge` string like `2.0 CVVL 프레스티지` and,
for 57% of lots, a `BadgeDetail` too — neither of which is heydealer's grade
vocabulary. Whatever we join on, (model, displacement) is the granularity we
can actually guarantee, and at that granularity the answer straddles the cliff
on more than a third of the cars.

That is the problem restated at the fee's own threshold: **146 vs 163 hp is the
difference between 5 200 ₽ and 1.4–6.9 M ₽**, and the join we can build cannot
tell which one this lot is. A source that is usually right and gives no way to
know when it is wrong is not usable — the same bar `spike-power` set.

(The one DISAGREE, 쏘나타 더 브릴리언트 1999 cc: heydealer 157 vs drom 172, may be
my hand-made generation-window mapping rather than either source. It does not
change the conclusion, which rests on the 11 straddling rows, not on it.)

## 6. What it would cost to depend on it

- **CORS — fatal.** `www.heydealer.com` (the only surface with power) sends no
  `access-control-allow-origin` at all; a browser fetch from encar.com is
  blocked. Identical to drom.ru, so identical remedy: a hand-run build-time
  snapshot. `api.heydealer.com` *does* reflect any Origin with credentials —
  but it has no power to give.
- **Auth.** Sell-side and plate lookup: `401`. Not obtainable without a Korean
  phone number and an app login, and even then it is a personal session, not
  an API key.
- **Rate limits — none hit.** ~1,600 requests to `www.heydealer.com` and ~200
  to `api.heydealer.com` today: **zero non-200 responses, zero 429, zero
  blocks**. A 60-request burst at 10 concurrent on the API: 60× 200, p50 1.29 s,
  p95 1.61 s. `robots.txt` is `Allow: /`.
- **Terms of service — explicitly against it.** Art. 15 §9–10 of the customer
  ToS: 「당사의 동의 없이 … 재배포, 무단전재 및 크롤링을 하는 행위를 할 수 없습니다」 and
  「… 기타 크롤링 목적으로 사용해서는 안 되고, 서비스를 이용하여 얻은 정보를 당사의 사전 동의 없이
  복제·재배포할 수 없습니다」. Permissive `robots.txt`, prohibitive contract.
- **Shape — prose-adjacent, not a stable machine-readable field.** The value is
  a localized string with the unit inside it (`"250 마력"`), embedded in a
  Next.js RSC flight payload inside the HTML, behind build-hashed chunk names.
  There is no documented API and no JSON endpoint reachable without their
  server bootstrap auth.
- **What breaks silently.** A rename of `max_power`; a unit switch
  (마력 → kW); a move of the spec block to a client-side fetch; the site's
  own `"정보 없음"` fallback; and — the quiet one — a car simply selling, which
  removes the only carrier of that trim's number. None of these raise an error.
  They return a page that parses to nothing, or to the previous number.

## 7. Verdict

**Do not build on heydealer for the recycling fee.** Ranked reasons:

1. Hybrids and EVs — the fuels the operator asked about — get 0% usable
   coverage: for hybrids one of two required numbers, for EVs the wrong
   quantity by 1.2–5.7×.
2. The power figure is CORS-walled, so it buys nothing drom does not already
   buy: both are build-time snapshots.
3. Reachable coverage is 55.9% of encar lots and drifts with heydealer's stock.
4. Its ICE numbers are correct but unjoinable: on 11 of 30 petrol/diesel rows
   checked (37%), the (model, displacement) key we can actually build admits
   values on both sides of the 160 hp cliff.
5. The ToS forbids exactly the use we would make of it.

**Two things worth keeping from this spike:**

- **heydealer's ICE figures agree with drom 13/13 on hybrids.** That makes
  heydealer a cheap *cross-check* on a drom-built catalog — a second opinion
  when a `build-catalog.mjs` run produces a suspicious number — not a source.
- **`api.heydealer.com/v2/customers/web/car_meta/*` is a free, no-auth,
  CORS-open Korean model tree**: 79 brands, 1,031 model groups, models carrying
  `start_date`/`end_date` as `YYYYMM`, joining to encar's own
  Manufacturer/ModelGroup at ~100% after trivial normalization. If a future
  task needs to normalize encar titles into generations with production
  windows, that endpoint does it for free. (The ToS clause above still applies
  to bulk copying it.)

Nothing here changes `spike-power`'s conclusion. The real power source is still
external and per-lot, joined on VIN or plate — a paid Korean registry or
VIN-decode provider — or a hand-curated catalog like the drom one.

## Appendix — how to reproduce

All measurements are plain HTTP; no product code was written.

```
# catalog tree (public, CORS-open, no power)
curl https://api.heydealer.com/v2/customers/web/car_meta/brands/
curl https://api.heydealer.com/v2/customers/web/car_meta/model_groups/Ne8v1M/
curl https://api.heydealer.com/v2/customers/web/car_meta/details/ByXaO3/

# the only public power figure
curl -s https://www.heydealer.com/market/cars/7lbwopyX | grep -o 'max_power[^,]*'

# CORS: the API reflects any Origin, the HTML host sends nothing
curl -sD- -o/dev/null -H 'Origin: https://www.encar.com' \
  https://api.heydealer.com/v2/customers/web/car_meta/brands/ | grep -i access-control
curl -sD- -o/dev/null -H 'Origin: https://www.encar.com' \
  https://www.heydealer.com/market/cars/7lbwopyX | grep -i access-control   # empty

# the plate lookup is behind the app login
curl -s https://api.heydealer.com/v2/customers/    # 401 로그인 후 사용해주세요

# inventory depth (last page with cars = 390)
curl -s 'https://www.heydealer.com/?page=390' | grep -c 'market/cars/'

# encar side, for the join
curl -sG https://api.encar.com/search/car/list/mobile \
  --data-urlencode 'count=true' \
  --data-urlencode 'q=(And.Hidden.N._.CarType.Y._.FuelType.가솔린+전기.)' \
  --data-urlencode 'sr=|ModifiedDate|0|50'
```

encar totals used for weighting (2026-08-08): 150,564 passenger listings —
gasoline 83,154, diesel 44,734, hybrid 10,607, electric 4,319.

Proposals filed: none
