---
date: 2026-08-08
topic: tks-parity
---

# tks.ru parity: EV and hybrid customs calculation

## Summary

The calculator starts computing EV and hybrid lots for физлица at parity with
tks.ru/auto/calc: EVs and sequential hybrids move from «по запросу» to the
пошлина + акциз + НДС track, parallel hybrids get a real утильсбор line from
combined engine power. Power figures come from a pre-built specs catalog
scraped from drom.ru — no manual input on the page.

---

## Problem Frame

Encar is full of Korean hybrids and EVs, and for them the calculator is at
its weakest: EVs render «по запросу» entirely, and hybrids dash the
утильсбор line because the fee needs two power figures (ICE + 30-minute
electric) that the encar listing never publishes. tks.ru answers both cases
with real numbers, so a client comparing us against tks sees us silent
exactly on the cars they came for. The operator's directive: «нам нужно
забрать логику калькулятора с сайта tks.ru».

---

## Key Decisions

- **Физлица only.** The ЮЛ / commercial track (ЕТТ №80 for all car types,
  full утильсбор) is not our audience; the calculator stays single-mode.
- **Power auto-lookup is mandatory, no manual fields.** The operator rejected
  manual power inputs; the quote works from catalog data alone.
- **The specs catalog is pre-built and shipped with the static site.** The
  site is browser-only GitHub Pages; drom.ru cannot be fetched from the
  browser (CORS), so a collector script bakes the catalog into site data and
  refreshes it by re-running.
- **drom.ru is the specs source.** Verified 2026-08-08: its catalog publishes
  «Электродвигатель: 30-минутная мощность, л.с.» for both hybrids and EVs,
  covers Korean-market generations with encar's own trim vocabulary (checked
  on Sonata DN8 HEV, Grandeur GN7 HEV, Ioniq 5).
- **No Aug/Sep 2026 утильсбор change is modeled.** The «с 23 августа / с 1
  сентября» banners on tks.ru are rotating ad creatives, not calculator
  logic (verified 2026-08-08 against tks.ru pages and official sources).
  Next scheduled change: annual indexation 01.01.2027 per ПП №1255.
- **Honesty rules are preserved unchanged.** Dash for a missing line, «от
  N ₽» floors, «по запросу» only for unusable input — per the contract in
  `src/calc/customs.ts`.

---

## Requirements

**Tariff tracks (физлицо, личное пользование)**

- R1. An EV lot computes пошлина (ЕТТ ad valorem) + акциз (руб/л.с.) + НДС
  20% instead of «по запросу»; exact rates are pinned during planning from
  official sources.
- R2. A sequential hybrid computes on the same track as an EV; the catalog's
  hybrid-type field decides sequential vs parallel.
- R3. A parallel hybrid keeps the №107 единые ставки duty by displacement,
  and its утильсбор uses combined power: ICE + 30-minute electric.
- R4. An EV's утильсбор uses the EV grid of ПП №1291 (ред. №1713) keyed by
  30-minute power.
- R5. Every new rate table lives in the importer config with its own `asOf`
  provenance; the engine stays a pure bracket interpreter.

**Specs catalog**

- R6. A pre-built catalog carries, per Korean-market hybrid/EV modification:
  ICE power (hp), electric-motor 30-minute power (hp), hybrid type
  (parallel/sequential), keyed so an encar listing can be matched.
- R7. Matching runs in the browser at quote time from encar listing data
  (model, year-month, displacement, trim); no runtime network calls to
  drom.ru.
- R8. When a lot has no catalog match, or the match is ambiguous across
  modifications with different power, the power-dependent lines dash and the
  total stays a floor «от N ₽».

**Honesty**

- R9. The three failure semantics of `src/calc/customs.ts` (dash / floor /
  onRequest) apply to all new lines unchanged.

---

## Key Flows

- F1. Quoting a hybrid or EV lot
  - **Trigger:** client's encar listing resolves to fuel type hybrid or
    electric.
  - **Steps:** encar data → catalog match (model, year, cc, trim) → track
    selection (R2/R3) → power figures feed акциз and/or утильсбор → cost
    table renders.
  - **Outcome:** full RUB table like tks.ru, or an honest floor when the
    catalog has no answer (R8).

---

## Acceptance Examples

- AE1. **Covers R3, R6.** Given a Sonata DN8 2.0 HEV lot, when quoted, the
  утильсбор line uses ICE 152 hp + 20 hp (30-min) combined, and the total
  matches tks.ru or the difference is explained on-screen.
- AE2. **Covers R1, R4.** Given an Ioniq 5 58 kWh lot, when quoted, the
  table shows пошлина + акциз + НДС and утильсбор by 76 hp (30-min), no
  «по запросу».
- AE3. **Covers R8.** Given a hybrid absent from the catalog, when quoted,
  power-dependent lines dash and the total renders «от N ₽».
- AE4. **Covers R9.** Given a petrol lot, when quoted, the output is
  unchanged from today.

---

## Success Criteria

- The operator compares our quote against tks.ru/auto/calc for 2-3 real
  encar lots (petrol, hybrid, EV) and every line matches or the difference
  is explained on-screen (the brief's acceptance).

---

## Scope Boundaries

- ЮЛ / commercial import mode — out.
- Manual power-input fields on the calculator page — out (operator decision).
- Live drom.ru lookups at runtime — out; the catalog is baked data.
- Modeling an Aug/Sep 2026 утильсбор rate change — out; no such change
  exists.

---

## Dependencies / Assumptions

- drom.ru keeps publishing 30-minute power for Korean-market hybrids/EVs
  (verified 2026-08-08 on three models; coverage of rarer models is a
  planning-time check).
- The 01.04.2026 утильсбор formula changes (Ктп/Кндс/Ка, EAEU gray-import
  clearance) are assumed irrelevant for direct Korea→RF import by физлицо —
  verify during planning.
- The parallel power-spike task may land an encar-side power source; the
  catalog complements rather than blocks on it.
- The catalog module and data may not fit the brief's `owns` list
  (`src/calc`, `src/config.default.ts`) — settle placement during planning,
  asking the architect if a new top-level path is needed.

---

## Outstanding Questions

**Deferred to Planning**

- Exact акциз brackets (ст.193 НК, 2026) and the ЕТТ duty rate/code for
  8703 80 — pin with primary sources.
- НДС and сбор за оформление base composition for the EV track (стоимость +
  пошлина + акциз) — mirror tks.ru methodology and cite it.
- Whether the config's recycling grid already includes the 01.01.2026
  indexation — audit rates against official numbers.
- Catalog build tooling, refresh cadence, and the initial model coverage
  list.
