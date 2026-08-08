---
title: "feat: The operator's real pricing model (src/calc/pricing.ts)"
type: feat
status: in-progress
date: 2026-08-08
origin: docs/tasks/importer-pricing.md
---

# feat: The operator's real pricing model

## Summary

Four of five cost lines are `unknown` today, so every quote dashes them and the
total reads "от N ₽". The operator handed over his real model on 2026-08-08 as
a worked quote. This task encodes it: Korean export costs priced in WON and
folded into the price BEFORE conversion, a fixed broker line, a commission
ladder on the pre-commission subtotal, no СБКТС line, and a visible CBR
footnote. The tariff engine (`src/calc/customs.ts`) is not touched — it belongs
to the live `task/tks-parity` and, per the architect's measurement, its line set
is already right: the operator's single «Таможенная пошлина 3-5 лет» row IS our
`customs_v1` total (duty + утильсбор + сбор за оформление) presented as one row.

## Problem Frame

`computeAllIn` knows exactly two ways to add money that is not customs: a RUB
`fixed` amount and a `percent` of the lot price. The operator's model needs two
shapes it cannot express:

1. **A cost priced in KRW.** «расходы по Корее (экспорт, фрахт) 2,500,000 KRW»
   is added to the car price and the SUM is converted. It is not a RUB line
   afterwards, and the difference is not cosmetic: folded in before conversion
   it lands inside the customs value, which is where the clearance-fee bracket
   and the <3y duty tiers read it from — and which is legally correct, since the
   customs value includes delivery to the border.
2. **A commission ladder.** A step function of the subtotal of every OTHER line,
   so it can only be computed after the whole rest of the quote exists.

Both are new `costItems` kinds, so `computeAllIn` cannot be the entry point any
more. A new module owns the operator's model and calls the engine underneath.

## Measured inputs (do not re-derive)

His quote, lot 41599967 (Audi Q5 45 TFSI quattro, 1984 cc, 265 hp, reg 01.2023),
now dead at 404 — it survives only as a fixture:

| line | RUB |
|---|---|
| (44,600,000 + 2,500,000) KRW × 54.2/1000 | 2,552,820 |
| «Таможенная пошлина 3-5 лет (физлицо, коммерческий утиль. сбор)» | 2,326,200 |
| «Брокерские услуги + тариф СВХ» | 116,000 |
| «Комиссия GlobalCarTrade» (ladder, subtotal 4,995,020) | 50,000 |
| **his printed total** | **5,045,020** |

CBR on the quote date 15.07.2026: EUR = 88.5259, KRW = 51.4926/1000. His KRW
54.2 is a bank-transfer rate, a 5.3% markup over CBR. Our engine decomposes his
customs row as duty 474,216 + утильсбор 1,838,400 + оформление 13,541 =
**2,326,157** — 43 RUB below his printed 2,326,200, which is his rounding.

## Requirements

- R1: Korean costs are priced in KRW and folded into the price before the FX
  conversion, so they sit inside the customs value.
- R2: The broker line is a fixed 116,000 RUB; the СБКТС/ЭПТС line disappears
  (his quote is «под ключ во Владивостоке»).
- R3: The commission is a ladder on the subtotal of every other computed line:
  <1.5M → 30,000 / 1.5–5.5M → 50,000 / 5.5–9.5M → 75,000 / >9.5M → 100,000.
- R4: FX stays CBR (operator decision, 2026-08-08: «пока бери по ЦБ и явно это
  пиши под звёздочкой»), with a visible footnote that the bank transfer rate the
  client actually pays is higher.
- R5: Engine power reaches the quote from an optional manual «мощность, л.с.»
  field on the calc page — `power-spike` proved no public encar surface carries
  it. The field is an override, not the only writer: `task/tks-parity` will fill
  the same value from an offline catalog later.
- R6: The engine's honesty rules survive untouched — a dashed line still costs
  the total nothing, a partial quote is still a floor, a malformed config still
  degrades to «по запросу».
- R7: A fixture test reproduces the operator's quote to the ruble.

## Approach

### 1. Two new cost-item kinds (`src/config.default.ts`, `src/config.ts`)

```ts
{ kind: "krw",    value: 2_500_000 }                       // added pre-conversion
{ kind: "ladder", brackets: [{ underRub: 1_500_000, fee: 30_000 }, …] }
```

`underRub` is an EXCLUSIVE upper bound, unlike every other bracket array in this
codebase, because the operator stated the ladder that way («<1.5M» / «1.5–5.5M»):
at exactly 1,500,000 the fee is 50,000, not 30,000. Named `underRub` rather than
`maxRub` precisely so the difference is visible at the config site.

Putting these in `costItems` rather than in new top-level config keys is the
**safe degradation** and is the reason `src/config.ts` is in scope: an old
bundled extension (MV3 — the core ships inside the extension, project.md trap 1)
rejects a config whose `costItems` carry an unknown kind and falls back to its
embedded copy, keeping today's honest dashed behaviour behind the «встроенные
тарифы» marker. New top-level keys would instead be silently ignored, and the
old client would print an "exact" total missing 185,500 RUB — 3.7% low, with no
marker. A confidently wrong number is the one failure this codebase refuses.

### 2. `src/calc/pricing.ts` — the operator's model

`computeQuote(lot, rates, config)` returns the same `AllInResult` shape:

1. Sum the `krw` items; fold into `priceKrw` before calling the engine.
2. Call `computeAllIn` with the config stripped of `krw`/`ladder` items, so the
   engine still sees only kinds it knows and its `unhandled` guard keeps meaning
   what it means.
3. Split the engine's single «Цена лота» row back into «Цена лота» and the
   Korean cost lines, with the last one absorbing the rounding residual so the
   split sums EXACTLY to the value customs was computed from.
4. Apply the ladder to the subtotal of the computed lines and append it.
5. Push the CBR footnote onto `notes`.

Degradation rules: a malformed `krw`/`ladder` item degrades to `onRequest` the
same way a malformed fixed item does; on `onRequest` no commission line is
emitted at all (an invented commission on a refused quote is worse than none).
Under `partial` the commission is computed from a floor — the ladder is
monotone non-decreasing, so the total stays a provable floor.

No `Array.prototype.reduce` anywhere: www.encar.com replaces it (customs.ts
header, measured 2026-08-02).

### 3. Wiring

- `src/page/main.ts` (mine): `computeAllIn` → `computeQuote`, read the power
  input, pass `powerHp` only when the operator typed one.
- `site/calc.html`: the optional power field.
- `src/main.ts`, `src/ui/breakdown.ts`: one-line swap to `computeQuote` each.
  Mechanically forced — a `krw` item reaching `computeAllIn` sets `unhandled`
  and would turn every widget quote into «по запросу». Neither file is held by
  a live brief.
- `src/page/lot.ts` and `test/page-lot.test.ts` are NOT touched: they belong to
  the live `task/tks-parity`.

### 4. Tests

- `test/pricing.test.ts` (new): the 41599967 fixture with FX pinned at KRW
  54.2/1000 and EUR 88.5259, 1984 cc, 265 hp — asserts the exact engine total
  and that it sits within 50 RUB of the operator's printed 5,045,020. Plus the
  ladder boundaries, the pre-conversion fold, the rounding-residual split, and
  every degradation path.
- `test/config-file.test.ts`, `test/page.test.ts`: kept green.

## Known deviation (flagged, not hidden)

The brief asks the fixture to reproduce **5,045,020 to the ruble**. It cannot:
the architect's own measurement puts our faithful total at **5,044,977**, 43 RUB
below, because the operator rounded his customs row. The test therefore pins the
real number exactly AND asserts the 50-RUB neighbourhood of his figure, with the
43 RUB named in the test as his rounding. Bending an input to land on 5,045,020
would be fitting the measurement to the answer.
