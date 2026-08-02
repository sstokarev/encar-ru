/**
 * "Order this car" button (U2, R5): a deep link into the importer's
 * messenger with a prefilled message carrying the lot URL and car title.
 * Rendered inside the breakdown panel; opens in a new tab.
 */

import type { MessengerConfig } from "../config";

/**
 * Builds the messenger deep link. The message body (lot URL + car title)
 * is percent-encoded as a single ?text= parameter.
 *
 * The address is encoded too: it comes from a hand-edited config, and a stray
 * "?", "#" or "/" in it would otherwise silently rewrite the link — dropping
 * the prefilled message, or pointing the client at a different account.
 */
export function buildOrderLink(
  messenger: MessengerConfig,
  pageUrl: string,
  carTitle: string,
): string {
  const text = `Здравствуйте! Хочу заказать этот автомобиль: ${carTitle} ${pageUrl}`;
  const encoded = encodeURIComponent(text);
  const address = encodeURIComponent(messenger.address);
  return messenger.type === "telegram"
    ? `https://t.me/${address}?text=${encoded}`
    : `https://wa.me/${address}?text=${encoded}`;
}

/**
 * Creates the order button element for the breakdown panel. The link is
 * built from the document's current URL and title at render time.
 */
export function createOrderButton(
  doc: Document,
  messenger: MessengerConfig,
): HTMLAnchorElement {
  const pageUrl = doc.defaultView?.location.href ?? "";
  const carTitle = doc.title.replace(/\s+/g, " ").trim();

  const anchor = doc.createElement("a");
  anchor.setAttribute("data-order-button", "");
  anchor.textContent = "Заказать этот автомобиль";
  anchor.href = buildOrderLink(messenger, pageUrl, carTitle);
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.setAttribute("referrerpolicy", "no-referrer");
  return anchor;
}
