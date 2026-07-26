/**
 * Generates the application icon from the design's logo mark.
 *
 * The mark is not an asset anybody drew in a file — it exists only as CSS in the design export and
 * in `App.module.css`: a rounded accent square with three smaller squares inside, one solid and two
 * at 45 %. That is the product's whole thesis in a glyph — several participants, one surface — so
 * the icon is generated from the same numbers rather than traced by hand and left to drift.
 *
 * No image dependency: PNG is a handful of chunks plus zlib, and zlib ships with Node. Rendering is
 * supersampled 4× and box-filtered down, which is what gives the corners clean edges.
 *
 * Rebuild with: node apps/desktop/scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'build', 'icon.png');

/** Final edge in px. electron-builder converts this to .ico / .icns itself; 512 is its floor. */
const SIZE = 512;
const SS = 4;

/** Straight from `packages/tokens/src/palette.ts` › ACCENT and the dark window background. */
const ACCENT = [0x3f, 0xa8, 0xa0];
const ON_ACCENT = [0x08, 0x09, 0x0b];

/*
 * Geometry transcribed from the 20px mark in the design export: corner radius 4, three 5.5 squares
 * with radius 1 inset 3.5 from their corners. Expressed as ratios so the icon is resolution-free.
 */
const R = (v) => (v / 20) * SIZE * SS;
const CANVAS = SIZE * SS;
const OUTER_RADIUS = R(4);
const CELL = R(5.5);
const CELL_RADIUS = R(1);
const INSET = R(3.5);

/** Signed-distance test for a rounded rectangle — true when the point is inside. */
function inRoundedRect(x, y, left, top, w, h, radius) {
  const right = left + w;
  const bottom = top + h;
  if (x < left || y < top || x >= right || y >= bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** `over` composited on `under` at `alpha`. The two quiet squares are the accent at 45 %. */
function blend(under, over, alpha) {
  return under.map((c, i) => Math.round(c * (1 - alpha) + over[i] * alpha));
}

const QUIET = blend(ACCENT, ON_ACCENT, 0.45);

const cells = [
  { x: INSET, y: INSET, colour: ON_ACCENT },
  { x: CANVAS - INSET - CELL, y: INSET, colour: QUIET },
  { x: INSET, y: CANVAS - INSET - CELL, colour: QUIET },
];

/** Colour of one supersampled point: transparent outside the mark, a cell colour, or the accent. */
function sample(x, y) {
  if (!inRoundedRect(x, y, 0, 0, CANVAS, CANVAS, OUTER_RADIUS)) return null;
  for (const cell of cells) {
    if (inRoundedRect(x, y, cell.x, cell.y, CELL, CELL, CELL_RADIUS)) return cell.colour;
  }
  return ACCENT;
}

/** RGBA scanlines, each already prefixed with PNG filter byte 0 (none). */
function render() {
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);

  for (let y = 0; y < SIZE; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      // Box filter over the SS×SS block: the fraction that landed inside becomes the alpha, which
      // is what antialiases the outer radius instead of leaving it stair-stepped.
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const colour = sample(x * SS + sx + 0.5, y * SS + sy + 0.5);
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          hits += 1;
        }
      }

      const at = row + 1 + x * 4;
      if (hits === 0) continue;
      raw[at] = Math.round(r / hits);
      raw[at + 1] = Math.round(g / hits);
      raw[at + 2] = Math.round(b / hits);
      raw[at + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  }

  return raw;
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(dirname(OUT), { recursive: true });
const file = png(render());
writeFileSync(OUT, file);
console.log(`icon: wrote ${OUT} — ${SIZE}×${SIZE}, ${(file.length / 1024).toFixed(1)} KiB`);
