/**
 * Applies the ko->ru dictionary to the host page (U9, R12).
 *
 * Clients are Russian speakers who cannot read Korean, and the browser's own
 * page translation proved undiscoverable — so the widget translates the
 * recurring encar UI vocabulary itself and, once, explains how to switch on
 * full-page translation for the rest.
 *
 * Hard constraints:
 *  - The price scanner must keep working. Text nodes carrying the price unit
 *    (만원) and everything inside an already annotated price element are never
 *    touched, and the original text of every rewritten node is preserved in a
 *    data attribute (ORIGINAL_ATTR) so a re-run can never translate twice.
 *  - The widget's own UI is off limits: badge/breakdown/hint hosts opt out of
 *    translation the same way they opt out of the browser translator
 *    (translate="no" / .notranslate / data-* markers).
 *  - Never fight the browser translator: on an already translated page
 *    (isBrowserTranslated) applyDictionary is a no-op.
 *
 * DOM text is written through textContent / Text.data only (KTD5).
 */

import {
  EXACT_MAP,
  SUFFIX_RULES,
  TOKEN_ENTRIES,
  TOKEN_MAX_LENGTH,
} from "./dictionary";

/** Marks an element whose text nodes have been translated (idempotency). */
export const TRANSLATED_ATTR = "data-encar-ru-tr";
/** Original Korean text of the rewritten nodes, one per line. */
export const ORIGINAL_ATTR = "data-encar-ru-orig";
/** Marker carried by the one-time translation hint host. */
export const HINT_ATTR = "data-encar-ru-hint";
/** localStorage flag: the hint has been shown and dismissed. */
export const HINT_STORAGE_KEY = "encar-ru:hint-translate";

/**
 * Subtrees the dictionary never enters: our own widget hosts (badge,
 * breakdown, shared host marker, hint), anything opted out of translation,
 * annotated price elements, and already translated elements.
 */
const SKIP_SELECTOR = [
  "[data-encar-ru]",
  "[data-encar-ru-badge]",
  "[data-encar-ru-breakdown]",
  "[data-encar-ru-host]",
  `[${HINT_ATTR}]`,
  '[translate="no"]',
  ".notranslate",
].join(", ");

/**
 * Text nodes this widget has already rewritten. A per-node set rather than an
 * ancestor attribute check: marking an ancestor would also hide its untouched
 * (and dynamically added) siblings and children from every later pass.
 */
const translatedNodes = new WeakSet<Text>();

/** Tags whose text is code/markup or user input, never UI copy. */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "TITLE",
  "TEMPLATE",
]);

/** Price unit: nodes containing it belong to the scanner, not to us. */
const PRICE_TEXT_RE = /만\s*원/;

/** Any Hangul syllable — nodes without one have nothing to translate. */
const HANGUL_RE = /[가-힣]/;

/**
 * Sentence markers. Token replacement inside a running sentence produces
 * half-Korean gibberish, so sentences get the exact-match layer only.
 */
const SENTENCE_RE = /[.!?]\s*$|니다|하세요|드려요|돼요|이에요/;

/** Browser-translation wrapper injected by Chrome/Google Translate. */
const TRANSLATED_FONT_SELECTOR = 'font[style*="vertical-align: inherit"]';

/**
 * True when the page is already machine-translated by the browser.
 * Two independent signals: the translator's <font> wrappers, and a document
 * language that is no longer Korean. An unset lang is not a signal (fixtures
 * and body-only injections have none) — only an explicit non-ko value is.
 */
export function isBrowserTranslated(doc: Document): boolean {
  if (doc.querySelector(TRANSLATED_FONT_SELECTOR) !== null) return true;
  const lang = doc.documentElement?.getAttribute("lang") ?? "";
  return lang.trim() !== "" && !/^ko\b/i.test(lang.trim());
}

/**
 * Text of `root` as the SITE wrote it: its current text plus every
 * pre-translation original this widget preserved under ORIGINAL_ATTR.
 *
 * Anything that parses Korean out of the page (src/scan/params.ts) must read
 * this and never plain textContent: the dictionary rewrites the very tokens
 * those parsers match ("16/09식" -> "16/09 г.в.", "디젤" -> "дизель"), so a
 * rescan of an already translated row would otherwise find nothing.
 *
 * Originals are appended, not substituted: the result is a superset of the
 * subtree text, which is all a token/regex scan needs, and it stays correct
 * when only part of a subtree was rewritten. When the browser's own translator
 * rewrote the page there are no preserved originals — the caller then sees
 * unparseable text and must degrade honestly rather than guess.
 */
export function originalText(root: Element): string {
  const text = root.textContent ?? "";
  const own = root.getAttribute(ORIGINAL_ATTR);
  const rewritten = Array.from(root.querySelectorAll(`[${ORIGINAL_ATTR}]`));
  if (own === null && rewritten.length === 0) return text;
  const parts = [text];
  if (own !== null) parts.push(own);
  for (const el of rewritten) parts.push(el.getAttribute(ORIGINAL_ATTR) ?? "");
  return parts.join(" ");
}

/** Applies the numeric-suffix rules ("16/09식" -> "16/09 г.в."). */
function applySuffixRules(text: string): string {
  let out = text;
  for (const rule of SUFFIX_RULES) {
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

/** Applies substring replacements, longest key first. */
function applyTokens(text: string): string {
  let out = text;
  for (const [ko, ru] of TOKEN_ENTRIES) {
    if (out.includes(ko)) out = out.split(ko).join(ru);
  }
  return out;
}

/**
 * Translation of a single trimmed string, or null when nothing applies.
 * Exact match first; token/suffix replacement only for short, non-sentence
 * strings.
 */
export function translateText(trimmed: string): string | null {
  const exact = EXACT_MAP[trimmed];
  if (exact !== undefined) return exact;
  if (trimmed.length > TOKEN_MAX_LENGTH) return null;
  if (SENTENCE_RE.test(trimmed)) return null;
  const replaced = applyTokens(applySuffixRules(trimmed));
  return replaced === trimmed ? null : replaced;
}

function isSkippable(node: Text): boolean {
  if (translatedNodes.has(node)) return true;
  const parent = node.parentElement;
  if (parent === null) return true;
  if (SKIP_TAGS.has(parent.tagName)) return true;
  if (parent.closest(SKIP_SELECTOR) !== null) return true;
  // The scanner parses this text; leave it exactly as the site wrote it.
  return PRICE_TEXT_RE.test(node.data);
}

function isDocument(root: Document | Element): root is Document {
  return root.nodeType === 9;
}

function resolveDoc(root: Document | Element): Document {
  return isDocument(root) ? root : root.ownerDocument;
}

function collectTextNodes(root: Document | Element): Text[] {
  const doc = resolveDoc(root);
  const start: Node | null = isDocument(root)
    ? (root.body ?? root.documentElement)
    : root;
  if (start === null) return [];
  const walker = doc.createTreeWalker(start, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/**
 * Walks the text nodes under `root` and replaces the known Korean UI strings
 * with their Russian equivalents. Returns the number of rewritten nodes.
 *
 * Idempotent: rewritten nodes' parents are marked with TRANSLATED_ATTR and
 * skipped on every later pass, so the MutationObserver may call this after
 * each scan without the text degrading.
 */
export function applyDictionary(root: Document | Element): number {
  // Never fight the browser translator (KTD3).
  if (isBrowserTranslated(resolveDoc(root))) return 0;

  // Two phases: every skip decision is taken against the DOM as it was found,
  // so a node translated early in the pass cannot hide a later sibling.
  const pending: { node: Text; text: string }[] = [];
  for (const node of collectTextNodes(root)) {
    const raw = node.data;
    const trimmed = raw.trim();
    if (trimmed === "" || !HANGUL_RE.test(trimmed)) continue;
    if (isSkippable(node)) continue;
    const translated = translateText(trimmed);
    if (translated === null) continue;
    // Surrounding whitespace of the original node is kept intact.
    const lead = raw.slice(0, raw.indexOf(trimmed));
    const tail = raw.slice(lead.length + trimmed.length);
    pending.push({ node, text: `${lead}${translated}${tail}` });
  }

  for (const { node, text } of pending) {
    const parent = node.parentElement;
    if (parent === null) continue;
    // Original text is preserved so a re-run (or a later scan) can always
    // recover what the site actually wrote.
    const previous = parent.getAttribute(ORIGINAL_ATTR);
    parent.setAttribute(
      ORIGINAL_ATTR,
      previous === null ? node.data : `${previous}\n${node.data}`,
    );
    parent.setAttribute(TRANSLATED_ATTR, "1");
    node.data = text;
    translatedNodes.add(node);
  }
  return pending.length;
}

const HINT_STYLE = `
  :host {
    all: initial;
  }
  .box {
    position: fixed;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    box-sizing: border-box;
    width: max-content;
    max-width: min(92vw, 420px);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 12px;
    background: #14251c;
    color: #ffffff;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.4;
  }
  .text {
    flex: 1 1 auto;
  }
  .title {
    display: block;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .note {
    display: block;
    margin-top: 4px;
    opacity: 0.75;
    font-size: 13px;
  }
  button {
    flex: 0 0 auto;
    min-width: 44px;
    min-height: 44px;
    margin: -8px -8px -8px 0;
    border: 0;
    background: transparent;
    color: #ffffff;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
`;

const HINT_TITLE = "Encar по-русски";
const HINT_NOTE = "Основные надписи виджет уже перевёл.";

/**
 * Browser-specific one-liner on enabling full page translation.
 * Chrome-family first: Chrome on iOS reports both "CriOS" and "Safari".
 */
export function translateInstruction(userAgent: string): string {
  if (/CriOS|Chrome|Chromium|Edg[A-Z]?\//.test(userAgent)) {
    return "Chrome: меню ⋮ справа вверху → «Перевести» — и вся страница будет на русском.";
  }
  if (/Safari/.test(userAgent)) {
    return "Safari: кнопка «АА» слева в адресной строке → «Перевести на русский».";
  }
  return "Включите перевод страницы в меню браузера — и весь сайт будет на русском.";
}

function readHintFlag(win: Window | null): boolean {
  try {
    return win?.localStorage.getItem(HINT_STORAGE_KEY) !== null;
  } catch {
    // Storage blocked (private mode): show the hint, never crash the widget.
    return false;
  }
}

function writeHintFlag(win: Window | null): void {
  try {
    win?.localStorage.setItem(HINT_STORAGE_KEY, "1");
  } catch {
    // Nothing to do: the hint simply reappears on the next page load.
  }
}

/**
 * Shows the one-time, dismissible hint bubble explaining how to enable full
 * page translation in the current browser. Returns true when the bubble was
 * rendered; false when it was already shown (localStorage flag) or is already
 * on screen. Dismissing writes the flag.
 */
export function showTranslateHint(doc: Document = document): boolean {
  const win = doc.defaultView;
  if (readHintFlag(win)) return false;
  if (doc.querySelector(`[${HINT_ATTR}]`) !== null) return false;
  const parent = doc.body ?? doc.documentElement;
  if (parent === null) return false;

  const host = doc.createElement("div");
  host.setAttribute(HINT_ATTR, "");
  host.setAttribute("translate", "no");
  host.className = "notranslate";

  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = HINT_STYLE;

  const box = doc.createElement("div");
  box.className = "box";
  const text = doc.createElement("div");
  text.className = "text";
  const title = doc.createElement("strong");
  title.className = "title";
  title.textContent = HINT_TITLE;
  const body = doc.createElement("span");
  body.textContent = translateInstruction(win?.navigator.userAgent ?? "");
  const note = doc.createElement("span");
  note.className = "note";
  note.textContent = HINT_NOTE;
  text.append(title, body, note);

  const close = doc.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Закрыть");
  close.textContent = "×";
  close.addEventListener("click", () => {
    writeHintFlag(win);
    host.remove();
  });

  box.append(text, close);
  shadow.append(style, box);
  parent.appendChild(host);
  return true;
}
