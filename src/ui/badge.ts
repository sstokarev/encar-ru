/**
 * RUB badge rendered in Shadow DOM next to a detected KRW price (KTD5:
 * no frameworks, style isolation via shadow root, DOM text set only through
 * textContent). The host element opts out of browser translation so the
 * badge text is never rewritten.
 */

import { ANNOTATED_ATTR, BADGE_ATTR, type PriceCandidate } from "../scan/scanner";

const BADGE_STYLE = `
  :host {
    all: initial;
  }
  span {
    display: inline-block;
    margin-left: 0.35em;
    padding: 0.05em 0.45em;
    border-radius: 0.6em;
    background: #1a6b3c;
    color: #ffffff;
    font: 600 0.85em/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    white-space: nowrap;
    vertical-align: baseline;
  }
`;

/** Formats a RUB amount as "≈ 12 345 678 ₽" (space-grouped thousands). */
export function formatRub(value: number): string {
  const grouped = String(Math.round(value)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    " ",
  );
  return `≈ ${grouped} ₽`;
}

/**
 * Marks the price element as annotated and appends a Shadow DOM badge with
 * the converted RUB value. Idempotent: a second call for the same element
 * is a no-op thanks to the data-attribute marker.
 */
export function attachBadge(
  candidate: PriceCandidate,
  rubPerKrw: number,
): void {
  const el = candidate.element;
  if (el.hasAttribute(ANNOTATED_ATTR)) return;
  el.setAttribute(ANNOTATED_ATTR, "1");

  const doc = el.ownerDocument;
  const host = doc.createElement("span");
  host.setAttribute(BADGE_ATTR, "");
  host.setAttribute("translate", "no");
  host.className = "notranslate";

  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = BADGE_STYLE;
  const label = doc.createElement("span");
  label.textContent = formatRub(candidate.krw * rubPerKrw);
  shadow.append(style, label);

  el.appendChild(host);
}
