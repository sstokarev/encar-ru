/**
 * The importer's own pricing model, on top of the tariff engine.
 *
 * src/calc/customs.ts answers "what does the STATE charge for this car" and is
 * deliberately not touched here (it belongs to task/tks-parity). This module
 * answers the other half — "what does the CLIENT pay GlobalCarTrade" — and it
 * exists because the operator's real model, handed over 2026-08-08 as a worked
 * quote, needs two shapes computeAllIn cannot express:
 *
 *  1. a cost priced in WON («расходы по Корее — экспорт, фрахт»), added to the
 *     car price BEFORE the FX conversion, so it lands inside the customs value;
 *  2. a commission that is a step function of the subtotal of every other line,
 *     and therefore can only be computed once the rest of the quote exists.
 *
 * Everything else is delegated: computeQuote folds the WON costs into the
 * price, hands the engine a config carrying only kinds the engine knows, and
 * decorates the result. The engine's honesty rules survive intact — a dashed
 * line still contributes nothing, "partial" is still a floor rendered as
 * «от N ₽», and a malformed config still degrades the whole quote to
 * «по запросу».
 *
 * THE OPERATOR'S QUOTE THIS MODEL REPRODUCES (lot 41599967, now 404 — it lives
 * on only as test/pricing.test.ts):
 *
 *     (44 600 000 + 2 500 000) KRW x 54.2/1000        2 552 820
 *     пошлина 474 216 + утильсбор 1 838 400
 *       + оформление 13 541 = 2 326 157, вверх до 100 2 326 200
 *     брокерские услуги и тариф СВХ                      116 000
 *     комиссия (ladder on 4 995 020)                      50 000
 *     ------------------------------------------------------------
 *                                                      5 045 020
 *
 * FX IS THE CBR RATE, ON PURPOSE AND VISIBLY. The operator's own quote used a
 * bank-transfer rate (54.2 per 1000 KRW against the CBR 51.4926 of that day —
 * a 5.3% markup he actually pays). His instruction, 2026-08-08: «пока бери по
 * ЦБ и явно это пиши под звёздочкой». So the quote converts at CBR and says so
 * (CBR_FX_NOTE) rather than quietly under-quoting by the bank's spread. The
 * duty leg has no choice in the matter either way: customs converts at the CBR
 * rate by law.
 */

import {
  computeAllIn,
  isUnknownLine,
  type AllInResult,
  type CostLine,
  type FxRates,
  type LotParams,
} from "./customs";
import type { CostItem, LadderBracket, WidgetConfig } from "../config.default";

/**
 * The asterisk under the table. Printed on every quote: the client converts at
 * a bank rate that is a few percent worse than the CBR rate we compute with,
 * and the gap (about 38 000 RUB on the operator's own 5 M quote) is real money.
 * Hiding it would make the widget's number look better than the client's bank.
 */
export const CBR_FX_NOTE =
  "* Расчёт по курсу ЦБ РФ. Банк переводит по своему курсу — обычно на несколько процентов дороже, поэтому фактическая сумма перевода будет выше.";

/**
 * Tariff rounding step, RUB. The operator: «мы округляем вверх до нулей», and
 * his own printed line fixes the step at 100 (2 326 157 -> 2 326 200; 10 would
 * give 2 326 160 and 1000 would give 2 327 000).
 */
export const TARIFF_ROUNDING_RUB = 100;

/** Label of the row that carries the rounding, so the +N ₽ is never silent. */
const ROUNDING_LABEL = "Округление тарифа (вверх до 100 ₽)";
const ROUNDING_ID = "tariff-rounding";

/** Id of the engine's converted lot-price line (src/calc/customs.ts). */
const LOT_LINE_ID = "lot";

/** Finite and not negative — the shape a WON amount or a commission may have. */
function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Finite and strictly positive — the only shape a price or an FX rate has. */
function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Structural check of a ladder, mirroring src/config.ts: non-empty, ascending
 * exclusive bounds, last entry open-ended. A config that reached here through
 * loadConfig has already passed it; DEFAULT_CONFIG and tests have not, and a
 * ladder that silently failed to resolve would drop the commission from the
 * total with nothing on screen looking wrong.
 */
function isLadder(brackets: unknown): brackets is LadderBracket[] {
  if (!Array.isArray(brackets) || brackets.length === 0) return false;
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < brackets.length; index += 1) {
    const bracket = brackets[index] as LadderBracket | undefined;
    if (typeof bracket !== "object" || bracket === null) return false;
    if (!isAmount(bracket.fee)) return false;
    const last = index === brackets.length - 1;
    if (last) {
      if (bracket.underRub !== undefined) return false;
    } else {
      if (!isPositive(bracket.underRub) || bracket.underRub <= previous) {
        return false;
      }
      previous = bracket.underRub;
    }
  }
  return true;
}

/**
 * Commission for a pre-commission subtotal. The bound is EXCLUSIVE (see
 * LadderBracket): at exactly 1 500 000 the operator charges the second step.
 */
export function commissionRub(
  brackets: readonly LadderBracket[],
  subtotalRub: number,
): number {
  for (const bracket of brackets) {
    if (bracket.underRub === undefined || subtotalRub < bracket.underRub) {
      return bracket.fee;
    }
  }
  return brackets[brackets.length - 1]!.fee;
}

/** Smallest multiple of `step` that is not below `value`. */
function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** True when `id` names one of the config's own cost items. */
function isConfigItemId(items: readonly CostItem[], id: string): boolean {
  for (const item of items) {
    if (item.id === id) return true;
  }
  return false;
}

/**
 * Sum of the computed lines. A plain loop, never Array.prototype.reduce:
 * www.encar.com ships an ES5 bundle that REPLACES built-ins and whose reduce
 * returns the array itself (measured 2026-08-02, see the customs.ts header).
 */
function sumComputed(items: readonly CostLine[]): number {
  let total = 0;
  for (const item of items) {
    if (!isUnknownLine(item)) total += item.rub;
  }
  return total;
}

interface SplitConfig {
  /** Cost items the engine understands (everything but krw / ladder). */
  engineItems: CostItem[];
  /** WON costs, in config order; folded into the price before conversion. */
  krwItems: { id: string; label: string; krw: number }[];
  /** The single commission ladder, if the config carries a usable one. */
  ladder: { id: string; label: string; brackets: LadderBracket[] } | null;
  /**
   * A krw/ladder item that cannot be interpreted — a config bug, handled
   * exactly like computeAllIn handles a malformed fixed item: the whole quote
   * degrades to «по запросу» rather than losing a line quietly.
   */
  malformed: boolean;
}

function splitConfig(config: WidgetConfig): SplitConfig {
  const split: SplitConfig = {
    engineItems: [],
    krwItems: [],
    ladder: null,
    malformed: false,
  };
  for (const item of config.costItems) {
    if (item.kind === "krw") {
      if (isAmount(item.value)) {
        split.krwItems.push({ id: item.id, label: item.label, krw: item.value });
      } else {
        split.malformed = true;
      }
    } else if (item.kind === "ladder") {
      // A second ladder would charge the commission twice and bracket the
      // second one on a subtotal that already contains the first.
      if (split.ladder !== null || !isLadder(item.brackets)) {
        split.malformed = true;
      } else {
        split.ladder = {
          id: item.id,
          label: item.label,
          brackets: item.brackets,
        };
      }
    } else {
      split.engineItems.push(item);
    }
  }
  return split;
}

/**
 * Splits the engine's single converted price line back into the car and the
 * WON-priced Korean costs.
 *
 * The engine converted their SUM (that is the whole point — the customs value
 * includes the freight), so the parts are re-derived from the same rate and the
 * LAST part absorbs the rounding residual. The displayed rows therefore always
 * add up to exactly the figure customs was computed from; rounding each part
 * independently could leave the table one ruble short of its own subtotal.
 */
function splitPriceLine(
  lotLine: CostLine,
  carPriceKrw: number,
  krwItems: readonly SplitConfig["krwItems"][number][],
  krwRub: number,
): CostLine[] {
  if (isUnknownLine(lotLine) || krwItems.length === 0) return [lotLine];
  const rows: CostLine[] = [
    { id: lotLine.id, label: lotLine.label, rub: Math.round(carPriceKrw * krwRub) },
  ];
  let assigned = (rows[0] as { rub: number }).rub;
  for (let index = 0; index < krwItems.length; index += 1) {
    const item = krwItems[index]!;
    const last = index === krwItems.length - 1;
    const rub = last
      ? lotLine.rub - assigned
      : Math.round(item.krw * krwRub);
    assigned += rub;
    rows.push({ id: item.id, label: item.label, rub });
  }
  return rows;
}

/**
 * The all-in quote under the importer's model: the tariff engine's result with
 * the WON costs folded in before conversion, the tariff block rounded up to
 * TARIFF_ROUNDING_RUB, and the commission ladder applied.
 *
 * `lot.priceKrw` is the CAR price alone — the Korean costs come from the
 * config, so no caller has to know the model to call this correctly.
 */
export function computeQuote(
  lot: LotParams,
  rates: FxRates,
  config: WidgetConfig,
): AllInResult {
  const split = splitConfig(config);

  // Fold the WON costs in only when there is a real price to fold them into:
  // added to an unusable priceKrw (0, negative, NaN) they would manufacture a
  // plausible-looking price out of a broken row, and the engine would quote it.
  let krwExtra = 0;
  for (const item of split.krwItems) krwExtra += item.krw;
  const priceKnown = isPositive(lot.priceKrw) && isPositive(rates.krwRub);
  const priceKrw = priceKnown ? lot.priceKrw + krwExtra : lot.priceKrw;

  const base = computeAllIn({ ...lot, priceKrw }, rates, {
    ...config,
    costItems: split.engineItems,
  });

  // "по запросу" is terminal: no rounding, no commission, no split. Inventing
  // a commission on a quote we are refusing to show is worse than none.
  if (base.precision === "onRequest" || split.malformed) {
    return {
      items: base.items,
      totalRub: base.totalRub,
      precision: "onRequest",
      notes: [...base.notes, CBR_FX_NOTE],
    };
  }

  // Rebuild the table: split the price line, and find where the tariff block
  // ends. The tariff lines are exactly the ones the engine invented — an item
  // whose id is neither the price line's nor any of the config's own. Matching
  // that way rather than on ("duty", "recycling", "clearance") keeps this
  // correct when task/tks-parity adds the акциз/НДС lines its brief describes.
  const items: CostLine[] = [];
  let tariffSum = 0;
  let tariffComplete = true;
  let tariffCount = 0;
  let lastTariffIndex = -1;
  for (const line of base.items) {
    if (line.id === LOT_LINE_ID) {
      for (const row of splitPriceLine(
        line,
        lot.priceKrw,
        split.krwItems,
        rates.krwRub,
      )) {
        items.push(row);
      }
      continue;
    }
    items.push(line);
    if (!isConfigItemId(config.costItems, line.id)) {
      tariffCount += 1;
      lastTariffIndex = items.length - 1;
      if (isUnknownLine(line)) tariffComplete = false;
      else tariffSum += line.rub;
    }
  }

  // Round the tariff block UP to the nearest 100 RUB — the operator's rule,
  // and the 43 RUB that closes his printed quote. Only when the block is
  // COMPLETE: under "partial" the total is advertised as a lower bound
  // («от N ₽»), and rounding a floor upwards is exactly how a floor stops
  // being one.
  const rounded: CostLine[] = [];
  const roundingRub =
    tariffComplete && tariffCount > 0
      ? ceilTo(tariffSum, TARIFF_ROUNDING_RUB) - tariffSum
      : 0;
  for (let index = 0; index < items.length; index += 1) {
    rounded.push(items[index]!);
    if (index === lastTariffIndex && roundingRub > 0) {
      rounded.push({ id: ROUNDING_ID, label: ROUNDING_LABEL, rub: roundingRub });
    }
  }

  // The commission brackets on the subtotal of everything else. Under
  // "partial" that subtotal is a floor, and the ladder is monotone
  // non-decreasing, so the commission it picks is at most the real one and the
  // total stays a provable floor.
  if (split.ladder !== null) {
    rounded.push({
      id: split.ladder.id,
      label: split.ladder.label,
      rub: commissionRub(split.ladder.brackets, sumComputed(rounded)),
    });
  }

  const totalRub = sumComputed(rounded);
  // Same last line of defence as the engine: a non-finite total is never shown
  // as money, whatever produced it.
  if (!Number.isFinite(totalRub)) {
    return {
      items: rounded,
      totalRub: 0,
      precision: "onRequest",
      notes: [...base.notes, CBR_FX_NOTE],
    };
  }

  return {
    items: rounded,
    totalRub,
    precision: base.precision,
    notes: [...base.notes, CBR_FX_NOTE],
  };
}
