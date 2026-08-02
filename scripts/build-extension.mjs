/**
 * Builds the Chrome/Edge extension (U11).
 *
 * The bookmarklet cannot survive a page load — encar navigates normally
 * between www.encar.com and fem.encar.com, so every page needs a fresh tap.
 * An MV3 content script matched on *.encar.com does the same job once per
 * browser instead of once per page.
 *
 * The widget core is bundled INTO the extension rather than fetched from
 * Pages: MV3 forbids executing remotely hosted code. Only config.json and the
 * CBR rates stay remote — those are data, not code, so the importer can still
 * change tariffs without shipping a new extension version.
 *
 * Produces extension/widget.js and a store-ready site/encar-ru-extension.zip.
 * The zip is written with a fixed timestamp so identical input gives an
 * identical file (a changing zip on every CI run is noise, not a release).
 *
 * Usage: node scripts/build-extension.mjs
 */

import { build } from "esbuild";
import { deflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = resolve(root, "extension");

const manifestPath = resolve(extDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// The manifest version is the widget version: a client reporting "0.3.0" must
// be answerable from a single number.
const mainSource = readFileSync(resolve(root, "src/main.ts"), "utf8");
const versionMatch = /const VERSION = "([^"]+)"/.exec(mainSource);
if (versionMatch === null) {
  throw new Error("Could not read VERSION from src/main.ts");
}
if (manifest.version !== versionMatch[1]) {
  throw new Error(
    `Version mismatch: manifest.json ${manifest.version} vs src/main.ts ${versionMatch[1]}`,
  );
}

const result = await build({
  entryPoints: [resolve(root, "src/main.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2017",
  write: false,
  legalComments: "none",
});

const widget = result.outputFiles[0].text;
mkdirSync(extDir, { recursive: true });
writeFileSync(resolve(extDir, "widget.js"), widget, "utf8");

/* ---------------------------------------------------------------- zip ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed DOS timestamp (1980-01-01 00:00) keeps the archive byte-stable.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, contents] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(contents, { level: 9 });
    const crc = crc32(contents);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    locals.push(local, deflated);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);

    offset += local.length + deflated.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

const archive = zip([
  ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8")],
  ["widget.js", Buffer.from(widget, "utf8")],
]);

const outFile = resolve(root, "site/encar-ru-extension.zip");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, archive);

console.log(
  `Wrote extension/widget.js (${(widget.length / 1024).toFixed(1)} kb) and ${outFile} (${(archive.length / 1024).toFixed(1)} kb), version ${manifest.version}`,
);
