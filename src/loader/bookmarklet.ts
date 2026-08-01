/**
 * encar-ru thin loader (U3, KTD4).
 *
 * Bundled by scripts/build-bookmarklet.mjs into a minified IIFE that is
 * shipped as a bookmarklet ("javascript:" URL) and inside the iOS Shortcut
 * "Run JavaScript on Web Page" action. It never carries widget logic —
 * it only appends the remote core with a cache-bust param computed at each
 * run, so core updates reach clients without reinstalling the loader.
 */

// Placeholder until U4 deploys GitHub Pages. Single constant, replace here.
export const WIDGET_ORIGIN = "sstokarev.github.io/encar-ru";

/** Minimal window surface the loader touches (injectable for tests). */
export interface LoaderWindow {
  location: { hostname: string };
  document: Document;
  __encarRu?: { rescan: () => void };
}

/** Cache-bust stamp computed at run time (KTD4): YYYYMMDD, zero-padded. */
function dateStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

export function runLoader(win: LoaderWindow): void {
  // No-op outside encar.com and its subdomains (KTD4).
  const host = win.location.hostname;
  if (host !== "encar.com" && !host.endsWith(".encar.com")) {
    return;
  }

  // Double-load guard: the core is already active — just rescan.
  if (win.__encarRu) {
    win.__encarRu.rescan();
    return;
  }

  const doc = win.document;
  const src = `https://${WIDGET_ORIGIN}/widget.js?v=${dateStamp()}`;

  // Idempotence while the core is still loading (requested, not yet run).
  const marker = `script[src^="https://${WIDGET_ORIGIN}/widget.js"]`;
  if (doc.querySelector(marker)) {
    return;
  }

  const tag = doc.createElement("script");
  tag.src = src;
  tag.referrerPolicy = "no-referrer"; // KTD5: never leak the encar URL.
  (doc.head || doc.documentElement).appendChild(tag);
}

// Auto-run in the browser; tests import runLoader and inject a fake window.
if (typeof window !== "undefined" && !("__vitest_worker__" in globalThis)) {
  runLoader(window as unknown as LoaderWindow);
}
