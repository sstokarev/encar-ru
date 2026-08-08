# Worker report — task/spike-heydealer

Research spike, no product code. The measured artifact is
`docs/harness/spike-heydealer.md`; this file is the short version.

## Answer

**No — heydealer cannot carry the recycling-fee power figure.**

1. **Keying: per-MODEL, never per-lot.** Nothing public takes a VIN or a
   Korean plate. heydealer's own headline feature (「번호판 시세조회」) is behind
   the app's phone login — `/v2/customers/` answers `401 로그인 후 사용해주세요`.
   The only public power figure is `max_power` on a for-sale listing, and it is
   a trim-catalog value: 30 of 32 (model, grade) groups in a 218-car sample
   reported an identical figure for every car in the group; the 2 that split
   split on facelift year, not on the car.
2. **The surface with power is CORS-closed.** `www.heydealer.com` sends no
   `access-control-allow-origin` at all. The CORS-open surface
   (`api.heydealer.com/.../car_meta/*`, reflects any Origin with credentials)
   has **zero** spec fields — no power, no displacement. Same wall as drom.ru,
   so it buys nothing drom does not already buy.

## Coverage, by fuel

Field presence where a listing exists (n=218): 98.6% overall — gasoline 100%,
diesel 100%, hybrid 100%, PHEV 100%, EV 94%. Always `"N 마력"`, one scalar.

Reachable coverage is the smaller number: the figure only exists on cars
heydealer is selling — **3,892 today** vs encar's **150,564**. 800 real encar
lots (200 per fuel) joined against that inventory, normalized names:

| fuel | model hit | model + grade hit |
|---|---|---|
| gasoline | 99.0% | 62.5% |
| diesel | 96.0% | 45.5% |
| hybrid | 78.0% | 46.5% |
| electric | 86.0% | 69.0% |
| all (n=800) | 89.8% | **55.9%** |

It drifts with their stock and nothing warns when a trim leaves.

## Hybrids and EVs — 0% either way

- **Hybrid:** `max_power` is the ICE figure only — 13/13 agreement with drom's
  `iceHp`. All 48 hybrid listings sampled carry **no motor figure of any kind**
  (`electric_efficiency` null, no other field). One of the two required
  numbers, never both.
- **EV:** `max_power` is PEAK output, not the 30-minute rating —
  **1.18×–5.70×** drom's `electricHp30min` across 14 rows. Every heydealer EV
  figure sampled (204–385 마력) is above 160 hp; the 30-minute figures for the
  same cars (39–194) mostly sit below it.

## Petrol/diesel — right number, wrong key

30 rows checked against drom's Korean-market tables: 29 agree, but only 13
uniquely, and **11 of 30 (37%)** have drom values on both sides of the 160 hp
line at the (model, displacement) granularity we can actually join on
(쏘나타 뉴 라이즈 2.0 = 146/151/153/160/163/168; 디 올 뉴 투싼 1.6 = 136/180).
At a cliff worth 5 200 ₽ vs 1.4–6.9 M ₽, a source that is usually right and
gives no way to know when it is wrong is not usable.

## Cost to depend on it

No rate limiting seen (~1,600 requests to `www`, ~200 to the API today, zero
non-200, zero 429; `robots.txt` is `Allow: /`) — but the ToS Art. 15 §9–10
explicitly forbids crawling and redistribution without consent, the value is a
localized string inside a Next.js flight payload behind build-hashed chunks,
and every failure mode (field rename, unit change, client-side move, the car
selling) is silent.

## Worth keeping

- heydealer as a cheap **cross-check** on a drom-built catalog (13/13 on
  hybrid ICE), not as a source.
- `api.heydealer.com/v2/customers/web/car_meta/*` — free, no-auth, CORS-open
  Korean model tree (79 brands, 1,031 model groups, models with
  `start_date`/`end_date` in `YYYYMM`) that joins to encar's
  Manufacturer/ModelGroup at ~100% after trivial normalization. Useful if a
  future task needs to normalize encar titles into generations.

Files: `docs/harness/spike-heydealer.md` (the measured artifact),
`docs/reports/spike-heydealer.md` (this file). No product code touched.

Proposals filed: none
