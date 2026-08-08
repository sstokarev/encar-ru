/**
 * The importer's pricing model (src/calc/pricing.ts).
 *
 * The centrepiece is THE OPERATOR'S OWN QUOTE, reproduced to the ruble. He
 * handed it over on 2026-08-08 for lot 41599967 — an Audi Q5 45 TFSI quattro
 * that has since sold (the encar API answers 404), so the quote survives only
 * here. It is the one regression test written in his language rather than
 * ours: if this suite goes red, the number he prints for a client and the
 * number the page prints have parted company, whatever else is green.
 *
 * Every input below is measured, not chosen to fit:
 *
 *  - 44 600 000 KRW car + 2 500 000 KRW Korean costs, from his quote;
 *  - KRW 54.2 per 1000 — his BANK transfer rate of 15.07.2026 (CBR that day
 *    was 51.4926, the 5.3% gap is the markup the CBR footnote exists to name);
 *  - EUR 88.5259 — the published CBR rate of 15.07.2026, which is the rate
 *    customs converts duty at by law;
 *  - 1984 cc / 265 hp — the Q5 45 TFSI, the figures his duty line implies;
 *  - valued on the quote date, so the car sits at 41 months: the 3-5 year
 *    duty bracket, and far enough from both cliffs to stay "exact".
 */

import { describe, expect, it } from "vitest";

import {
  computeAllIn,
  computeAgeYears,
  isNearAgeBracket,
  isUnknownLine,
  type CostLine,
  type FxRates,
  type LotParams,
} from "../src/calc/customs";
import {
  CBR_FX_NOTE,
  commissionRub,
  computeQuote,
  TARIFF_ROUNDING_RUB,
} from "../src/calc/pricing";
import { isValidConfig } from "../src/config";
import {
  DEFAULT_CONFIG,
  type CostItem,
  type LadderBracket,
  type WidgetConfig,
} from "../src/config.default";

/** The day the operator priced the lot. */
const QUOTE_DAY = new Date(2026, 6, 15);

/** His bank transfer rate and the CBR EUR of that day. */
const QUOTE_RATES: FxRates = { krwRub: 54.2 / 1000, eurRub: 88.5259 };

const CAR_PRICE_KRW = 44_600_000;

/** The Audi Q5 as the calc page would build it from the API plus the field. */
function quoteLot(): LotParams {
  return {
    priceKrw: CAR_PRICE_KRW,
    ageYears: computeAgeYears(2023, 1, QUOTE_DAY),
    ageNearBracket: isNearAgeBracket(2023, 1, QUOTE_DAY),
    engineCc: 1984,
    powerHp: 265,
    fuel: "gasoline",
    estimated: false,
  };
}

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/** Cost items with one replaced by id (or appended when the id is new). */
function withItem(item: CostItem): CostItem[] {
  const items: CostItem[] = [];
  let replaced = false;
  for (const existing of DEFAULT_CONFIG.costItems) {
    if (existing.id === item.id) {
      items.push(item);
      replaced = true;
    } else {
      items.push(existing);
    }
  }
  if (!replaced) items.push(item);
  return items;
}

/** Cost items minus one id. */
function withoutItem(id: string): CostItem[] {
  const items: CostItem[] = [];
  for (const existing of DEFAULT_CONFIG.costItems) {
    if (existing.id !== id) items.push(existing);
  }
  return items;
}

function byId(items: readonly CostLine[], id: string): CostLine {
  const found = items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no cost line ${id}`);
  return found;
}

function amount(items: readonly CostLine[], id: string): number {
  const line = byId(items, id);
  if (isUnknownLine(line)) throw new Error(`cost line ${id} is a dash`);
  return line.rub;
}

describe("the operator's quote, lot 41599967 (2026-08-08)", () => {
  const result = computeQuote(quoteLot(), QUOTE_RATES, DEFAULT_CONFIG);

  it("prints his total to the ruble", () => {
    expect(result.totalRub).toBe(5_045_020);
  });

  it("quotes it as an exact figure, not a floor and not on request", () => {
    expect(result.precision).toBe("exact");
  });

  it("leaves no line dashed", () => {
    expect(result.items.filter(isUnknownLine)).toEqual([]);
  });

  it("converts car and Korean costs at one rate, as one customs value", () => {
    // 44 600 000 x 54.2/1000 and 2 500 000 x 54.2/1000; his quote adds them
    // before converting, which is why the two rows sum to 2 552 820 exactly.
    expect(amount(result.items, "lot")).toBe(2_417_320);
    expect(amount(result.items, "korea")).toBe(135_500);
    expect(amount(result.items, "lot") + amount(result.items, "korea")).toBe(
      2_552_820,
    );
  });

  it("reproduces his single tariff line as duty + утильсбор + оформление", () => {
    // He prints ONE row, «Таможенная пошлина 3-5 лет (физлицо, коммерческий
    // утиль. сбор)» = 2 326 200. Our engine itemises it; the parts must add up
    // to his figure. The 43 ₽ of rounding rides on the DUTY line — the only
    // converted member of the block — so the утильсбор and the сбор stay the
    // exact figures a client can look up in ПП РФ.
    expect(amount(result.items, "duty")).toBe(474_216 + 43);
    expect(amount(result.items, "recycling")).toBe(1_838_400);
    expect(amount(result.items, "clearance")).toBe(13_541);
    const tariff =
      amount(result.items, "duty") +
      amount(result.items, "recycling") +
      amount(result.items, "clearance");
    expect(tariff).toBe(2_326_200);
  });

  it("shows no rounding row — the operator asked for it gone", () => {
    // «округление убери и просто зашей молча в цену». The rule stays (the total
    // above is his to the ruble); only the row is gone, and the line that
    // absorbed it says so in its note rather than silently disagreeing with a
    // duty the client recomputes from the decree.
    expect(result.items.find((item) => item.id === "tariff-rounding")).toBeUndefined();
    expect(byId(result.items, "duty").note).toContain("округлением тарифа");
  });

  it("charges the fixed broker line and the ladder step he charged", () => {
    expect(amount(result.items, "broker")).toBe(116_000);
    expect(amount(result.items, "commission")).toBe(50_000);
  });

  it("brackets the commission on the subtotal before it", () => {
    // His own subtotal, 4 995 020, is what picks the 50 000 step.
    const subtotal = result.totalRub - amount(result.items, "commission");
    expect(subtotal).toBe(4_995_020);
  });

  it("uses the commercial recycling grid: at 265 hp the льгота is dead", () => {
    // >160 hp, so the 5 200 RUB personal rate cannot apply — his own label
    // says «коммерческий утиль. сбор» for exactly this reason.
    expect(amount(result.items, "recycling")).toBeGreaterThan(1_000_000);
  });

  it("says out loud that the client's bank will charge more", () => {
    expect(result.notes).toContain(CBR_FX_NOTE);
  });
});

describe("WON costs are folded in before the conversion", () => {
  it("puts them inside the customs value, not beside it", () => {
    const quote = computeQuote(quoteLot(), QUOTE_RATES, DEFAULT_CONFIG);
    // The engine sees 47 100 000 KRW, so its clearance-fee bracket is chosen on
    // 2 552 820 RUB. Priced as a RUB line afterwards the customs value would be
    // 2 417 320 — the same bracket here, but the <3y duty tiers are picked on
    // that value too, so the two shapes are not interchangeable.
    const engineOnly = computeAllIn(
      { ...quoteLot(), priceKrw: CAR_PRICE_KRW + 2_500_000 },
      QUOTE_RATES,
      { ...DEFAULT_CONFIG, costItems: withoutItem("korea") },
    );
    expect(amount(quote.items, "clearance")).toBe(
      amount(engineOnly.items, "clearance"),
    );
  });

  it("splits several WON items without ever producing a negative row", () => {
    // The residual was originally dumped on the LAST row, which goes NEGATIVE
    // for about 5% of rate/amount combinations once there are two WON items —
    // a «−1 ₽» line in a cost table. Each row is now the difference of two
    // rounded running totals, which cannot invert.
    const rates: FxRates = { krwRub: 0.0542, eurRub: 88.5259 };
    const quote = computeQuote(
      quoteLot(),
      rates,
      config({
        costItems: [
          { id: "export", label: "Экспортное оформление", kind: "krw", value: 900_005 },
          { id: "freight", label: "Фрахт", kind: "krw", value: 1_599_995 },
          ...withoutItem("korea"),
        ],
      }),
    );
    for (const item of quote.items) {
      if (!isUnknownLine(item)) expect(item.rub).toBeGreaterThanOrEqual(0);
    }
    expect(
      amount(quote.items, "lot") +
        amount(quote.items, "export") +
        amount(quote.items, "freight"),
    ).toBe(Math.round((CAR_PRICE_KRW + 2_500_000) * rates.krwRub));
    // Same WON total as the shipped single item, so the quote is unchanged.
    expect(quote.totalRub).toBe(5_045_020);
  });

  it("drops a zero WON item instead of printing «0 ₽»", () => {
    // A zero amount rendered as money reads as "free" — the exact failure the
    // engine's dash semantics exist to prevent.
    const quote = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({
        costItems: withItem({
          id: "korea",
          label: "Расходы по Корее",
          kind: "krw",
          value: 0,
        }),
      }),
    );
    expect(quote.items.find((item) => item.id === "korea")).toBeUndefined();
    expect(amount(quote.items, "lot")).toBe(2_417_320);
  });

  it("splits the price even when the quote is refused", () => {
    // Both renderers draw every ROW under «по запросу» and replace only the
    // total. An unsplit row would print the car PLUS 2 500 000 KRW of freight
    // under the label «Цена лота» — 5.6% high on the one line the client can
    // check against the encar page at a glance.
    const refused = computeQuote(
      { ...quoteLot(), fuel: "electric" },
      QUOTE_RATES,
      DEFAULT_CONFIG,
    );
    expect(refused.precision).toBe("onRequest");
    expect(amount(refused.items, "lot")).toBe(2_417_320);
    expect(amount(refused.items, "korea")).toBe(135_500);
  });

  it("splits the converted price so the rows sum to what customs used", () => {
    // A rate that makes both parts round: the last WON row absorbs the residual
    // rather than letting the table disagree with its own subtotal.
    const rates: FxRates = { krwRub: 0.0577, eurRub: 88.5259 };
    const quote = computeQuote(quoteLot(), rates, DEFAULT_CONFIG);
    expect(amount(quote.items, "lot") + amount(quote.items, "korea")).toBe(
      Math.round((CAR_PRICE_KRW + 2_500_000) * rates.krwRub),
    );
  });

  it("never manufactures a price out of a broken one", () => {
    // priceKrw 0 is a half-parsed row. Folding 2 500 000 WON into it would
    // hand the engine a plausible price and quote a car nobody priced.
    const quote = computeQuote(
      { ...quoteLot(), priceKrw: 0 },
      QUOTE_RATES,
      DEFAULT_CONFIG,
    );
    expect(quote.precision).toBe("onRequest");
    expect(quote.items.find((item) => item.id === "korea")).toBeUndefined();
  });
});

describe("the tariff rounding rule («округляем вверх до нулей»)", () => {
  it("rounds the tariff block up to the nearest 100, never down", () => {
    expect(TARIFF_ROUNDING_RUB).toBe(100);
    const quote = computeQuote(quoteLot(), QUOTE_RATES, DEFAULT_CONFIG);
    const tariff =
      amount(quote.items, "duty") +
      amount(quote.items, "recycling") +
      amount(quote.items, "clearance");
    expect(tariff % TARIFF_ROUNDING_RUB).toBe(0);
    // Up, never nearest: the client is never quoted less than the real cost.
    expect(tariff).toBeGreaterThan(474_216 + 1_838_400 + 13_541);
    expect(tariff - (474_216 + 1_838_400 + 13_541)).toBeLessThan(
      TARIFF_ROUNDING_RUB,
    );
  });

  it("bends the converted duty, never a statutory amount", () => {
    // Утильсбор and сбор за оформление are exact RUB figures set by decree; a
    // client checking them against ПП РФ must find the published number. The
    // duty is an FX conversion, so it is the one that can absorb the remainder
    // without contradicting a published source.
    const quote = computeQuote(quoteLot(), QUOTE_RATES, DEFAULT_CONFIG);
    expect(amount(quote.items, "recycling")).toBe(1_838_400);
    expect(amount(quote.items, "clearance")).toBe(13_541);
  });

  it("emits no rounding row when the block already lands on 100", () => {
    // A lot whose duty + fee + clearance is already a multiple of 100 must not
    // grow a cosmetic "+0 ₽" row.
    const flat = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({
        customs: {
          ...DEFAULT_CONFIG.customs,
          clearanceFeeBrackets: [{ fee: 13_500 }],
          dutyPerCcByAge: {
            ...DEFAULT_CONFIG.customs.dutyPerCcByAge,
            y3: [{ eurPerCc: 0 + 100 / 1984 / 88.5259 }],
          },
        },
      }),
    );
    const tariff =
      amount(flat.items, "duty") +
      amount(flat.items, "recycling") +
      amount(flat.items, "clearance");
    expect(tariff % TARIFF_ROUNDING_RUB).toBe(0);
    // Nothing to absorb, so the duty line keeps its own note untouched.
    expect(byId(flat.items, "duty").note).not.toContain("округлением");
  });

  it("does not round a floor upwards", () => {
    // No power -> the recycling line dashes -> the total is «от N ₽». Rounding
    // a lower bound up is exactly how it stops being a lower bound.
    const lot = quoteLot();
    delete lot.powerHp;
    const quote = computeQuote(lot, QUOTE_RATES, DEFAULT_CONFIG);
    expect(quote.precision).toBe("partial");
    expect(byId(quote.items, "duty").note).not.toContain("округлением");
    expect(amount(quote.items, "duty")).toBe(474_216);
  });
});

describe("the commission ladder", () => {
  const ladder = [
    { underRub: 1_500_000, fee: 30_000 },
    { underRub: 5_500_000, fee: 50_000 },
    { underRub: 9_500_000, fee: 75_000 },
    { fee: 100_000 },
  ];

  it("follows the operator's steps", () => {
    expect(commissionRub(ladder, 0)).toBe(30_000);
    expect(commissionRub(ladder, 1_499_999)).toBe(30_000);
    expect(commissionRub(ladder, 5_499_999)).toBe(50_000);
    expect(commissionRub(ladder, 9_499_999)).toBe(75_000);
    expect(commissionRub(ladder, 50_000_000)).toBe(100_000);
  });

  it("treats the bound as exclusive: 1 500 000 buys the second step", () => {
    // «до 1,5 млн» / «1,5-5,5 млн» — the boundary belongs to the upper step.
    // With an inclusive bound this would quote 30 000 and be 20 000 short.
    expect(commissionRub(ladder, 1_500_000)).toBe(50_000);
    expect(commissionRub(ladder, 5_500_000)).toBe(75_000);
    expect(commissionRub(ladder, 9_500_000)).toBe(100_000);
  });

  it("brackets on the subtotal before commission, not on the total", () => {
    // A subtotal just under 5 500 000: bracketing on the FINAL total would
    // cross the boundary once the commission is added and quote 75 000, so the
    // rule would disagree with itself. 5 449 999 + 50 000 = 5 499 999 — the
    // near miss that makes the difference visible.
    const subtotal = 5_449_999;
    // The converted car price is a line too; the pad tops it up to `subtotal`.
    const lotRub = Math.round(CAR_PRICE_KRW * QUOTE_RATES.krwRub);
    const quote = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({
        costItems: [
          { id: "pad", label: "Подгонка", kind: "fixed", value: subtotal - lotRub },
          {
            id: "commission",
            label: "Комиссия",
            kind: "ladder",
            brackets: ladder,
          },
        ],
      }),
    );
    expect(quote.totalRub - amount(quote.items, "commission")).toBe(subtotal);
    expect(amount(quote.items, "commission")).toBe(50_000);
    expect(quote.totalRub).toBe(subtotal + 50_000);
  });

  it("is evaluated last whatever its position in the config", () => {
    const first = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({
        costItems: [
          {
            id: "commission",
            label: "Комиссия GlobalCarTrade",
            kind: "ladder",
            brackets: ladder,
          },
          ...withoutItem("commission"),
        ],
      }),
    );
    expect(first.totalRub).toBe(5_045_020);
  });

  it("refuses the whole quote when the ladder is malformed", () => {
    // A non-ascending ladder resolves to the wrong step silently; a config bug
    // must degrade the quote, exactly as a quoted "220000" on a fixed item does.
    const broken = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({
        costItems: withItem({
          id: "commission",
          label: "Комиссия",
          kind: "ladder",
          brackets: [{ underRub: 5_000_000, fee: 1 }, { underRub: 1_000, fee: 2 }, { fee: 3 }],
        }),
      }),
    );
    expect(broken.precision).toBe("onRequest");
  });

  it("refuses every malformed ladder shape, not just an unsorted one", () => {
    const refuses = (brackets: unknown): void => {
      const quote = computeQuote(
        quoteLot(),
        QUOTE_RATES,
        config({
          costItems: withItem({
            id: "commission",
            label: "Комиссия",
            kind: "ladder",
            brackets: brackets as never,
          }),
        }),
      );
      expect(quote.precision).toBe("onRequest");
    };
    refuses([]);
    refuses([{ underRub: 1_500_000, fee: 30_000 }]); // last bracket bounded
    refuses([null, { fee: 1 }]);
    refuses([{ underRub: 1_000, fee: Number.NaN }, { fee: 1 }]);
    refuses([{ underRub: 1_000, fee: -1 }, { fee: 1 }]);
    // Fees that step DOWN break the floor guarantee: under "partial" the
    // ladder is fed a lower-bound subtotal, and only a non-decreasing ladder
    // can promise the step it picks is at most the real one.
    refuses([{ underRub: 1_000, fee: 90_000 }, { fee: 10_000 }]);
  });

  it("accepts exactly the ladders the config validator accepts", () => {
    // A config that passes isValidConfig and then fails isLadder loads as
    // "remote" — no «встроенные тарифы» marker — and degrades every quote on
    // the site to «по запросу» with nothing saying the validators disagreed.
    const cases: LadderBracket[][] = [
      [{ underRub: 1_500_000, fee: 30_000 }, { fee: 100_000 }],
      [{ underRub: 0, fee: 0 }, { fee: 1 }],
      [{ fee: 0 }],
    ];
    for (const brackets of cases) {
      const cfg = config({
        costItems: withItem({
          id: "commission",
          label: "Комиссия",
          kind: "ladder",
          brackets,
        }),
      });
      const accepted = isValidConfig(JSON.parse(JSON.stringify(cfg)));
      const quoted =
        computeQuote(quoteLot(), QUOTE_RATES, cfg).precision !== "onRequest";
      expect([brackets, accepted]).toEqual([brackets, quoted]);
    }
  });

  it("refuses a second ladder rather than charging commission twice", () => {
    const doubled = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({
        costItems: [
          ...DEFAULT_CONFIG.costItems,
          { id: "commission2", label: "Ещё комиссия", kind: "ladder", brackets: ladder },
        ],
      }),
    );
    expect(doubled.precision).toBe("onRequest");
  });

  it("refuses a malformed WON item rather than dropping it from the total", () => {
    const broken = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({
        costItems: withItem({
          id: "korea",
          label: "Расходы по Корее",
          kind: "krw",
          value: Number.NaN,
        }),
      }),
    );
    expect(broken.precision).toBe("onRequest");
  });
});

describe("the seam between the engine and the model", () => {
  it("still calls the engine's converted price row 'lot'", () => {
    // pricing.ts finds the row to split by this id and treats every OTHER
    // engine row as part of the tariff block. Rename it in customs.ts and
    // nothing throws: the price row would be rounded as if it were a tariff and
    // the Korean-costs row would vanish. This is the tripwire for that rename.
    const engineOnly = computeAllIn(quoteLot(), QUOTE_RATES, {
      ...DEFAULT_CONFIG,
      costItems: [],
    });
    expect(engineOnly.items.map((item) => item.id)).toContain("lot");
  });

  it("refuses a config whose item id collides with an engine row", () => {
    // An item called "duty" would take the real duty out of the tariff block
    // (wrong rounding); one called "lot" would duplicate the price row and
    // produce a negative Korean-costs row. Neither throws — both print wrong
    // money — so the validator rejects them at load.
    for (const id of ["lot", "duty", "recycling", "clearance"]) {
      const cfg = JSON.parse(
        JSON.stringify(config({ costItems: withItem({ id, label: "X", kind: "fixed", value: 1 }) })),
      ) as unknown;
      expect([id, isValidConfig(cfg)]).toEqual([id, false]);
    }
  });

  it("refuses a config with no customs item at all", () => {
    // Every other line is priced now, so such a config quotes a car with no
    // duty and reports it as "exact" — millions short, with no dash to show it.
    const cfg = JSON.parse(
      JSON.stringify(config({ costItems: withoutItem("customs") })),
    ) as unknown;
    expect(isValidConfig(cfg)).toBe(false);
  });
});

describe("computeAllIn is no longer safe against the shipped config", () => {
  it("refuses DEFAULT_CONFIG outright — every caller must go through computeQuote", () => {
    // The trap this test exists to make loud: the shipped config now carries
    // "krw" and "ladder" items, which the engine deliberately does not know.
    // Handed to computeAllIn they trip its "unhandled item" guard and the
    // quote silently becomes «расчёт по запросу» — not a crash, not a wrong
    // number, just a page that stops quoting. Any NEW computeAllIn call site
    // reached from the shipped config is that bug; this pins the reason.
    const direct = computeAllIn(quoteLot(), QUOTE_RATES, DEFAULT_CONFIG);
    expect(direct.precision).toBe("onRequest");

    const viaModel = computeQuote(quoteLot(), QUOTE_RATES, DEFAULT_CONFIG);
    expect(viaModel.precision).toBe("exact");
  });
});

describe("the engine's honesty rules survive the model", () => {
  it("keeps an unpriced item a dash that costs the total nothing", () => {
    const withUnknown = computeQuote(
      quoteLot(),
      QUOTE_RATES,
      config({ costItems: withItem({ id: "sbkts", label: "СБКТС", kind: "unknown" }) }),
    );
    const dashes = withUnknown.items.filter(isUnknownLine);
    expect(dashes.map((item) => item.id)).toEqual(["sbkts"]);
    // The dash contributes nothing, so the total is the accepted one again.
    expect(withUnknown.totalRub).toBe(5_045_020);
  });

  it("still floors a lot it cannot fully price, commission included", () => {
    const lot = quoteLot();
    delete lot.powerHp;
    const floor = computeQuote(lot, QUOTE_RATES, DEFAULT_CONFIG);
    const full = computeQuote(quoteLot(), QUOTE_RATES, DEFAULT_CONFIG);
    expect(floor.precision).toBe("partial");
    // The ladder is monotone non-decreasing, so a floor subtotal picks a step
    // no larger than the real one and the total stays a genuine lower bound.
    expect(floor.totalRub).toBeLessThan(full.totalRub);
    expect(amount(floor.items, "commission")).toBeLessThanOrEqual(
      amount(full.items, "commission"),
    );
  });

  it("still refuses an EV outright", () => {
    const ev = computeQuote(
      { ...quoteLot(), fuel: "electric" },
      QUOTE_RATES,
      DEFAULT_CONFIG,
    );
    expect(ev.precision).toBe("onRequest");
    expect(ev.items.find((item) => item.id === "commission")).toBeUndefined();
  });

  it("still refuses a lot whose power was read as nonsense", () => {
    const nonsense = computeQuote(
      { ...quoteLot(), powerHp: -265 },
      QUOTE_RATES,
      DEFAULT_CONFIG,
    );
    expect(nonsense.precision).toBe("onRequest");
  });

  it("adds no commission line to a refused quote", () => {
    const refused = computeQuote(
      { ...quoteLot(), priceKrw: Number.NaN },
      QUOTE_RATES,
      DEFAULT_CONFIG,
    );
    expect(refused.precision).toBe("onRequest");
    expect(refused.items.find((item) => item.id === "commission")).toBeUndefined();
  });
});
