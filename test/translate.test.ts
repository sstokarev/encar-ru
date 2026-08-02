// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyDictionary,
  isBrowserTranslated,
  showTranslateHint,
  translateInstruction,
  translateText,
  HINT_ATTR,
  HINT_STORAGE_KEY,
  ORIGINAL_ATTR,
  TRANSLATED_ATTR,
} from "../src/translate/apply";
import { EXACT_MAP, TOKEN_MAP } from "../src/translate/dictionary";
import { scanPrices } from "../src/scan/scanner";
import { emulateBrowserTranslation } from "./helpers/translate-emulate";

function readFixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

const LISTING_HTML = readFixture("listing-desktop.html");
const CARD_HTML = readFixture("card-fem.html");

function loadFixture(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

/** Prices as the scanner sees them, in document order. */
function scannedPrices(): number[] {
  return scanPrices(document).map((c) => c.krw);
}

function setUserAgent(value: string): void {
  Object.defineProperty(window.navigator, "userAgent", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
});

describe("dictionary", () => {
  it("carries a bounded, non-empty ko->ru vocabulary (R12: ~150-250 terms)", () => {
    const total =
      Object.keys(EXACT_MAP).length + Object.keys(TOKEN_MAP).length;
    expect(total).toBeGreaterThanOrEqual(150);
    expect(total).toBeLessThanOrEqual(250);
    for (const [ko, ru] of [
      ...Object.entries(EXACT_MAP),
      ...Object.entries(TOKEN_MAP),
    ]) {
      expect(ko.trim()).toBe(ko);
      expect(ru.trim().length).toBeGreaterThan(0);
    }
  });

  it("never maps the price unit, so the scanner keeps its anchor", () => {
    expect(EXACT_MAP["만원"]).toBeUndefined();
    expect(TOKEN_MAP["만원"]).toBeUndefined();
    expect(EXACT_MAP["원"]).toBeUndefined();
    expect(TOKEN_MAP["원"]).toBeUndefined();
  });

  it("translates exact labels, compounds and numeric suffix forms", () => {
    expect(translateText("주행거리")).toBe("Пробег");
    expect(translateText("디젤 2.0 2WD")).toBe("дизель 2.0 2WD");
    expect(translateText("16/09식")).toBe("16/09 г.в.");
    expect(translateText("· 가솔린+전기")).toBe("· бензин + электро");
    expect(translateText("38개 옵션 모두보기")).toBe("все опции (38)");
    // Sentences get the exact layer only — no half-translated gibberish.
    expect(translateText("문의하면 전화번호와 통화내용이 자동 저장됩니다.")).toBeNull();
    expect(translateText("완전히 모르는 문장")).toBeNull();
  });
});

describe("applyDictionary on the desktop listing fixture", () => {
  beforeEach(() => {
    loadFixture(LISTING_HTML);
  });

  it("renders the search sidebar labels in Russian", () => {
    expect(bodyText()).toContain("주행거리");
    applyDictionary(document);
    const text = bodyText();
    for (const ru of [
      "Пробег",
      "Год выпуска",
      "Тип кузова",
      "Цена",
      "Топливо",
      "Регион",
      "Коробка передач",
      "Марка / модель / комплектация",
    ]) {
      expect(text).toContain(ru);
    }
  });

  it("translates row tokens: fuel, manufacturers, year form", () => {
    applyDictionary(document);
    const text = bodyText();
    expect(text).toContain("дизель");
    expect(text).toContain("бензин");
    expect(text).toContain("Hyundai");
    expect(text).toContain("Kia");
    expect(text).toContain("16/09 г.в.");
  });

  it("keeps the price text untouched and the scan unchanged", () => {
    const before = scannedPrices();
    expect(before.length).toBe(41);

    document.body.innerHTML = "";
    loadFixture(LISTING_HTML);
    applyDictionary(document);
    const after = scannedPrices();

    expect(after).toEqual(before);
    expect(bodyText()).toContain("만원");
  });

  it("is idempotent across repeated passes (observer re-runs)", () => {
    const first = applyDictionary(document);
    expect(first).toBeGreaterThan(0);
    const text = bodyText();
    const second = applyDictionary(document);
    expect(second).toBe(0);
    expect(bodyText()).toBe(text);
    expect(scannedPrices().length).toBe(41);
  });

  it("preserves the original Korean text on the rewritten element", () => {
    applyDictionary(document);
    const marked = document.querySelector(`[${TRANSLATED_ATTR}]`);
    expect(marked).not.toBeNull();
    const original = marked?.getAttribute(ORIGINAL_ATTR) ?? "";
    expect(original.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(original)).toBe(true);
  });
});

describe("applyDictionary on the fem card fixture", () => {
  beforeEach(() => {
    loadFixture(CARD_HTML);
  });

  it("translates the card section headings", () => {
    applyDictionary(document);
    const text = bodyText();
    for (const ru of [
      "Основная информация",
      "Опции",
      "Основные опции",
      "Состояние авто",
      "Гарантия",
      "Информация о продавце",
    ]) {
      expect(text).toContain(ru);
    }
  });

  it("translates key buttons and status words", () => {
    applyDictionary(document);
    const text = bodyText();
    for (const ru of [
      "Связаться с продавцом",
      "Все фотографии",
      "В избранное",
      "Подробнее",
      "Ещё",
      "Продано",
    ]) {
      expect(text).toContain(ru);
    }
  });

  it("keeps the scan result identical", () => {
    const before = scannedPrices();
    expect(before.length).toBeGreaterThan(0);

    document.body.innerHTML = "";
    loadFixture(CARD_HTML);
    applyDictionary(document);

    expect(scannedPrices()).toEqual(before);
  });
});

describe("browser-translated pages", () => {
  it("no-ops when the translator's font wrappers are present", () => {
    loadFixture(CARD_HTML);
    emulateBrowserTranslation(document.body);
    const before = bodyText();

    expect(isBrowserTranslated(document)).toBe(true);
    expect(applyDictionary(document)).toBe(0);
    expect(bodyText()).toBe(before);
  });

  it("no-ops when the document language is no longer Korean", () => {
    loadFixture(LISTING_HTML);
    document.documentElement.setAttribute("lang", "ru");
    const before = bodyText();

    expect(isBrowserTranslated(document)).toBe(true);
    expect(applyDictionary(document)).toBe(0);
    expect(bodyText()).toBe(before);
  });

  it("runs normally on an untranslated Korean page", () => {
    loadFixture(LISTING_HTML);
    document.documentElement.setAttribute("lang", "ko");
    expect(isBrowserTranslated(document)).toBe(false);
    expect(applyDictionary(document)).toBeGreaterThan(0);
  });
});

describe("Safari-style in-place translation (P2)", () => {
  /**
   * Safari translates in place: no <font> wrappers, no lang change — the
   * Korean text is simply replaced. Only the content itself gives it away.
   */
  function emulateInPlaceTranslation(root: Element): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const parent = node.parentElement;
      if (parent === null) continue;
      if (["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) continue;
      if (parent.closest('[translate="no"], .notranslate') !== null) continue;
      node.data = node.data.replace(/[가-힣]+/g, "перевод");
    }
  }

  it("detects translation with no font wrappers and no lang attribute", () => {
    loadFixture(CARD_HTML);
    expect(isBrowserTranslated(document)).toBe(false);

    emulateInPlaceTranslation(document.body);
    expect(
      document.querySelector('font[style*="vertical-align: inherit"]'),
    ).toBeNull();
    expect(document.documentElement.getAttribute("lang")).toBeNull();

    expect(isBrowserTranslated(document)).toBe(true);
    expect(applyDictionary(document)).toBe(0);
  });

  it("detects it on the listing as well", () => {
    loadFixture(LISTING_HTML);
    emulateInPlaceTranslation(document.body);
    expect(isBrowserTranslated(document)).toBe(true);
  });

  it("never locks itself out after its own dictionary pass", () => {
    loadFixture(LISTING_HTML);
    expect(applyDictionary(document)).toBeGreaterThan(0);
    // Our own rewrites must not read as a browser translation, otherwise the
    // dictionary would stop working on everything the SPA loads later.
    expect(isBrowserTranslated(document)).toBe(false);
    loadFixture(CARD_HTML);
    expect(applyDictionary(document)).toBeGreaterThan(0);
    expect(isBrowserTranslated(document)).toBe(false);
  });

  it("stays quiet on a page too small to judge", () => {
    document.body.innerHTML = "<div>Цена</div><div>1 000 ₽</div>";
    expect(isBrowserTranslated(document)).toBe(false);
  });
});

describe("the widget's own UI", () => {
  it("is never rewritten by the dictionary", () => {
    const badge = document.createElement("span");
    badge.setAttribute("data-encar-ru-badge", "");
    badge.setAttribute("translate", "no");
    badge.className = "notranslate";
    const shadow = badge.attachShadow({ mode: "open" });
    const label = document.createElement("span");
    label.textContent = "연식 ≈ 1 000 ₽";
    shadow.append(label);
    // Light-DOM text inside the host must be left alone as well.
    badge.textContent = "";
    const inner = document.createElement("i");
    inner.textContent = "주행거리";
    badge.appendChild(inner);

    const outside = document.createElement("div");
    outside.textContent = "주행거리";

    document.body.append(badge, outside);
    applyDictionary(document);

    expect(label.textContent).toBe("연식 ≈ 1 000 ₽");
    expect(inner.textContent).toBe("주행거리");
    expect(badge.hasAttribute(TRANSLATED_ATTR)).toBe(false);
    expect(outside.textContent).toBe("Пробег");
  });

  it("leaves annotated price elements alone", () => {
    const price = document.createElement("strong");
    price.setAttribute("data-encar-ru", "1");
    price.textContent = "1,250만원";
    document.body.append(price);

    applyDictionary(document);
    expect(price.textContent).toBe("1,250만원");
  });
});

describe("showTranslateHint", () => {
  it("shows once, is a no-op on the second call, and dismissal sets the flag", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36");

    expect(showTranslateHint(document)).toBe(true);
    const hosts = document.querySelectorAll(`[${HINT_ATTR}]`);
    expect(hosts.length).toBe(1);
    const host = hosts[0] as HTMLElement;
    expect(host.getAttribute("translate")).toBe("no");
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot?.textContent ?? "").toContain("Chrome");

    // Second call while the bubble is on screen: nothing added.
    expect(showTranslateHint(document)).toBe(false);
    expect(document.querySelectorAll(`[${HINT_ATTR}]`).length).toBe(1);
    expect(localStorage.getItem(HINT_STORAGE_KEY)).toBeNull();

    const close = host.shadowRoot?.querySelector("button");
    expect(close).not.toBeNull();
    (close as HTMLButtonElement).click();

    expect(document.querySelectorAll(`[${HINT_ATTR}]`).length).toBe(0);
    expect(localStorage.getItem(HINT_STORAGE_KEY)).toBe("1");
    // Dismissed for good.
    expect(showTranslateHint(document)).toBe(false);
    expect(document.querySelectorAll(`[${HINT_ATTR}]`).length).toBe(0);
  });

  it("does not show when the flag is already stored", () => {
    localStorage.setItem(HINT_STORAGE_KEY, "1");
    expect(showTranslateHint(document)).toBe(false);
    expect(document.querySelector(`[${HINT_ATTR}]`)).toBeNull();
  });

  it("gives a browser-specific Russian instruction", () => {
    const chrome = translateInstruction(
      "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36",
    );
    const safari = translateInstruction(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1",
    );
    const other = translateInstruction("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/128.0");

    expect(chrome).toContain("Chrome");
    expect(safari).toContain("Safari");
    expect(safari).toContain("АА");
    expect(other).toContain("браузера");
    expect(new Set([chrome, safari, other]).size).toBe(3);
    for (const line of [chrome, safari, other]) {
      expect(/[а-яА-Я]/.test(line)).toBe(true);
    }
  });

  it("stacks above encar's own fixed sheets", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36");
    expect(showTranslateHint(document)).toBe(true);
    const host = document.querySelector<HTMLElement>(`[${HINT_ATTR}]`)!;
    // Declared inline on the host: host-page CSS outranks :host rules, and a
    // z-index only applies to a positioned element.
    expect(host.style.zIndex).toBe("2147483000");
    expect(host.style.position).toBe("relative");
    expect(
      host.shadowRoot?.querySelector("style")?.textContent ?? "",
    ).toContain("z-index: 2147483000");
  });

  it("stops nagging after a timeout even if its × is unreachable", () => {
    vi.useFakeTimers();
    setUserAgent("Mozilla/5.0 (iPhone) Version/17.5 Mobile/15E148 Safari/604.1");
    expect(showTranslateHint(document)).toBe(true);

    vi.advanceTimersByTime(12_000);
    expect(localStorage.getItem(HINT_STORAGE_KEY)).toBe("1");
    expect(document.querySelector(`[${HINT_ATTR}]`)).toBeNull();
    expect(showTranslateHint(document)).toBe(false);
  });

  it("stops nagging after the first scroll", () => {
    setUserAgent("Mozilla/5.0 (iPhone) Version/17.5 Mobile/15E148 Safari/604.1");
    expect(showTranslateHint(document)).toBe(true);
    expect(localStorage.getItem(HINT_STORAGE_KEY)).toBeNull();

    window.dispatchEvent(new Event("scroll"));
    expect(localStorage.getItem(HINT_STORAGE_KEY)).toBe("1");
    // The bubble itself stays: the user may still be reading it.
    expect(document.querySelector(`[${HINT_ATTR}]`)).not.toBeNull();
  });

  it("stays out of the dictionary's way", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36");
    const label = document.createElement("div");
    label.textContent = "연식";
    document.body.append(label);

    showTranslateHint(document);
    applyDictionary(document);

    const host = document.querySelector(`[${HINT_ATTR}]`);
    expect(host?.hasAttribute(TRANSLATED_ATTR)).toBe(false);
    expect(label.textContent).toBe("Год выпуска");
  });
});
