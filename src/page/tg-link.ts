/**
 * Telegram draft link of the calc page (U3, R3).
 *
 * Same encoding discipline as src/ui/order-button.ts: BOTH the address and
 * the text are percent-encoded, so a stray "?"/"#"/"/" in a hand-edited
 * config can never rewrite the link or drop the draft. The draft carries the
 * lot URL and the computed total with its honest precision marker ("≈"/"от");
 * under "onRequest" no number is quoted at all — a draft with a figure the
 * page refused to display would overstate what we know.
 */

import type { AllInResult } from "../calc/customs";
import type { MessengerConfig } from "../config";
import { formatRub } from "../ui/badge";

/** Total line of the draft: an honest number or the on-request marker. */
function totalLine(allIn: AllInResult): string {
  return allIn.precision === "onRequest"
    ? "Итого: расчёт по запросу"
    : `Итого в РФ: ${formatRub(allIn.totalRub, allIn.precision)}`;
}

/**
 * Messenger deep link with the prefilled draft (car title, lot URL, total).
 * Telegram by config; the WhatsApp branch mirrors the widget's order button
 * so a config switch keeps working here too.
 */
export function buildDraftLink(
  messenger: MessengerConfig,
  carTitle: string,
  lotUrl: string,
  allIn: AllInResult,
): string {
  const text = [
    `Здравствуйте! Хочу заказать автомобиль: ${carTitle}`,
    lotUrl,
    totalLine(allIn),
  ].join("\n");
  const encoded = encodeURIComponent(text);
  const address = encodeURIComponent(messenger.address);
  return messenger.type === "telegram"
    ? `https://t.me/${address}?text=${encoded}`
    : `https://wa.me/${address}?text=${encoded}`;
}
