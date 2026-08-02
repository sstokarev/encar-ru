/**
 * Generates the extension icons (16/32/48/128 px PNG) from one vector-ish
 * description, so the set can never drift apart the way hand-exported files do.
 *
 * Store listings REQUIRE a 128 px icon and Chrome renders the small sizes in
 * the toolbar and the extensions page; a missing size is silently upscaled and
 * looks blurry exactly where a paying client first sees the product.
 *
 * No image library: the icons are rasterised here (3x3 supersampling for the
 * edges) and written as PNG with node's own zlib. A build step that needs a
 * native dependency is a build step that breaks on someone else's machine.
 *
 * The mark is encar's red with a white ₽: the widget's whole promise is the
 * Russian price, and the glyph reads at 16 px where any wordmark would not.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "extension/icons");
const SIZES = [16, 32, 48, 128];

/** Encar's brand red — the same token the badge uses (src/ui/badge.ts). */
const RED = [215, 46, 54];
const WHITE = [255, 255, 255];

/** Design grid: every shape below is expressed in these units. */
const GRID = 128;
const RADIUS = 28;

/** Supersampling factor per axis; 3x3 is enough for a 16 px tile. */
const SS = 3;

/** Rounded-square background: true inside the tile. */
function inBackground(x, y) {
  const r = RADIUS;
  const nx = Math.min(x, GRID - x);
  const ny = Math.min(y, GRID - y);
  if (nx >= r || ny >= r) return true;
  const dx = r - nx;
  const dy = r - ny;
  return dx * dx + dy * dy <= r * r;
}

/** The ₽ glyph: stem, bowl (a right half-ring) and the crossbar. */
function inGlyph(x, y) {
  // Stem.
  if (x >= 40 && x <= 53 && y >= 26 && y <= 102) return true;
  // Bowl: right half of a ring closed onto the stem.
  const dx = x - 53;
  const dy = y - 50;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (x >= 53 && dist >= 12 && dist <= 25) return true;
  // Crossbar — what makes it a ruble sign and not a P.
  if (x >= 27 && x <= 66 && y >= 80 && y <= 92) return true;
  return false;
}

/** RGBA pixel rows for one icon size, antialiased by supersampling. */
function raster(size) {
  const scale = GRID / size;
  const rows = [];
  for (let py = 0; py < size; py++) {
    // Each row is prefixed with PNG filter type 0 (None).
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          if (!inBackground(x, y)) continue;
          bg++;
          if (inGlyph(x, y)) fg++;
        }
      }
      const samples = SS * SS;
      const alpha = Math.round((bg / samples) * 255);
      // Glyph coverage is measured against the covered part of the pixel, so
      // the white never bleeds outside the red tile.
      const mix = bg === 0 ? 0 : fg / bg;
      const offset = 1 + px * 4;
      for (let channel = 0; channel < 3; channel++) {
        const value = RED[channel] + (WHITE[channel] - RED[channel]) * mix;
        row[offset + channel] = Math.round(value);
      }
      row[offset + 3] = alpha;
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raster(size), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png(size));
  console.log(`Wrote ${file}`);
}
