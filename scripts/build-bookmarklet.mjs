/**
 * Builds the bookmarklet from src/loader/bookmarklet.ts (U3).
 *
 * esbuild-bundles the loader into a single minified IIFE, wraps it as a
 * "javascript:" URL (percent-encoded so it survives copy/paste and bookmark
 * managers), writes site/bookmarklet.txt and prints the result.
 *
 * Also writes site/bookmark.html — the same bookmarklet as an importable
 * bookmarks file (U13). Chrome shows NO favicon for a javascript: bookmark: a
 * dragged button lands on the bar as an anonymous grey globe among the client's
 * other bookmarks. The Netscape bookmark format carries an ICON attribute, and
 * an imported bookmark keeps it — so importing gives the button the product's
 * own red ₽ AND spares the client the copy-paste-into-the-address-field dance.
 *
 * Usage: node scripts/build-bookmarklet.mjs
 */

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [resolve(root, "src/loader/bookmarklet.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2017",
  write: false,
  // Bookmarklets run inside a javascript: URL — keep output on one line.
  legalComments: "none",
});

const code = result.outputFiles[0].text.trim();
if (code.includes("\n")) {
  throw new Error("Bundled loader is not a one-liner; bookmarklet would break.");
}

// The javascript: scheme percent-decodes its body before evaluation, so a
// fully encodeURIComponent-ed payload is both valid and paste-safe.
const bookmarklet = "javascript:" + encodeURIComponent(code);

const outFile = resolve(root, "site/bookmarklet.txt");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, bookmarklet + "\n", "utf8");

console.log(`Wrote ${outFile} (${bookmarklet.length} chars)`);

/* ------------------------------------------------- importable bookmark ---- */

/** HTML-escapes an attribute value; the payload contains quotes and &. */
function attr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const icon = readFileSync(resolve(root, "extension/icons/icon-32.png"));
const iconUri = `data:image/png;base64,${icon.toString("base64")}`;

// Netscape bookmark file format — what every browser's "Import bookmarks"
// reads. ADD_DATE is fixed so rebuilding does not churn the file.
const bookmarkFile = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="${attr(bookmarklet)}" ADD_DATE="1754092800" ICON="${attr(iconUri)}">Цена в РФ</A>
</DL><p>
`;

const bookmarkFilePath = resolve(root, "site/bookmark.html");
writeFileSync(bookmarkFilePath, bookmarkFile, "utf8");
console.log(`Wrote ${bookmarkFilePath} (${bookmarkFile.length} chars)`);
