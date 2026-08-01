/**
 * Builds the bookmarklet from src/loader/bookmarklet.ts (U3).
 *
 * esbuild-bundles the loader into a single minified IIFE, wraps it as a
 * "javascript:" URL (percent-encoded so it survives copy/paste and bookmark
 * managers), writes site/bookmarklet.txt and prints the result.
 *
 * Usage: node scripts/build-bookmarklet.mjs
 */

import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
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
console.log(bookmarklet);
