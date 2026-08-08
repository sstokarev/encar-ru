# Answers to the three importer-pricing blockers (architect, 2026-08-08)

All three are resolved by measurement, not by opinion. Your arithmetic was
right and it is what made the answer findable — the "88.53" you derived as a
hypothesis is a real published number.

## (2) and (3) together: his duty line DOES decompose, and оформление is inside it

CBR reference rates for **15.07.2026**, the date printed on his quote
(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=15/07/2026`, fetched today):

    EUR = 88.5259 RUB (nominal 1)
    KRW = 51.4926 RUB (nominal 1000)

Your hypothesis "then implied EUR/RUB = 88.53" is exactly the published CBR
EUR of that day. Closing the decomposition at 1984 cc (Audi Q5 45 TFSI):

    пошлина      1984 cc x 2.7 EUR/cc x 88.5259  =   474 216 RUB
    утильсбор                                       1 838 400 RUB
    сбор за оформление                                 13 541 RUB
    ------------------------------------------------------------
    total                                           2 326 157 RUB
    his printed line                                2 326 200 RUB
    difference                                             43 RUB  (0.002%)

43 RUB out of 2.3M is rounding, not a missing rule. So:

- **The clearance fee is INSIDE his 2,326,200 line.** Do not suppress it, do
  not add it as a sixth line. His single «Таможенная пошлина 3-5 лет» line is
  our `customs_v1` total, presented as one row.
- **EUR is the CBR rate of the quote date, not a bank rate** — and it must be:
  customs converts duty at the CBR rate by law. Only KRW is his bank rate
  (54.2 vs CBR 51.4926 = a 5.3% bank markup, which is real money he pays and
  the reason the operator asked for the CBR footnote).
- **Displacement 1984 cc** — the figure the numbers imply, matching the Q5 45
  TFSI. Not 1998.

Practical consequence: your fixture reproduces his quote when the FX pair is
pinned at KRW 54.2/1000 and EUR 88.5259, displacement 1984, power 265 hp.
Nothing about the engine's line set changes.

## (1) The accept lot is dead — split the acceptance

Confirmed independently: `GET /v1/readside/vehicle/41599967` -> HTTP 404, 0
bytes. His quote is a historical record of a sold car, so it can never be an
on-screen scenario again.

Split it, and the brief on main now says this:

1. **Regression test (yours, non-negotiable):** a fixture built from his quote
   reproduces **5,045,020 RUB** to the ruble. That test is the operator's own
   language and it must stay green forever.
2. **Live accept scenario:** any of these three lots, verified live today
   (200, full spec, photos). Let the operator pick — all are gasoline and land
   in the 3-5y duty bracket:

   - `42217972` Hyundai Avante 1.6, reg 2023-03, 1598 cc, 2,630만원, 32 photos
   - `42319113` Chevrolet Trailblazer 1.3T, reg 2021-10, 1341 cc, 1,790만원
   - `42512433` Genesis G80 2.5T, reg 2021-04, 2497 cc, 3,200만원, 33 photos

   What he must see: photo, specs, every cost line filled with a number, the
   CBR footnote, and the Telegram button carrying the total.

## On the optional power input — yes, add it

`power-spike` finished and its answer is final, not pending: **no public encar
surface carries engine power for cars** (`spec.horsePower` exists for trucks
only; `jatoVehicleId` resolves nowhere public). Report is on main at
`docs/harness/spike-power.md`.

So a manager-entered «мощность, л.с.» field is not a workaround, it is the
only path that exists today, and `src/calc/customs.ts` already documents
`powerHp` as a manager-entered value. Add it. Note that `task/tks-parity` is
building an offline drom.ru catalog to fill the same field automatically later
— keep your input the manual override, not the only writer, so the two do not
fight when its catalog lands.
