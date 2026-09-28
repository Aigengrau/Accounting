/**
 * Generates the PWA PNG icons.
 *
 * Android's install prompt wants real PNGs, so these are rasterised here rather
 * than relying on SVG support in the manifest. No dependencies: the PNG is
 * assembled by hand using Node's own zlib.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark is three bars of unequal length — a ledger and a bar chart at once —
 * on the app's accent blue.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'assets', 'icons');

const ACCENT = [0x2a, 0x78, 0xd6];
const INK = [0xff, 0xff, 0xff];

/** 4x supersampling, which is enough to keep the curves clean at 192px. */
const SS = 4;

/** Signed distance to a rounded rectangle, used for anti-aliased edges. */
function roundedRectCoverage(px, py, x, y, w, hgt, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + hgt - r));
  const inCore = px >= x && px <= x + w && py >= y && py <= y + hgt;
  if (!inCore) return 0;
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return 1;
  return Math.hypot(dx, dy) <= r ? 1 : 0;
}

function blend(dst, i, colour, alpha) {
  if (alpha <= 0) return;
  for (let c = 0; c < 3; c++) {
    dst[i + c] = Math.round(dst[i + c] * (1 - alpha) + colour[c] * alpha);
  }
  dst[i + 3] = Math.round(dst[i + 3] * (1 - alpha) + 255 * alpha);
}

/**
 * Draws the icon into an RGBA buffer.
 * @param {number} size    pixel dimension
 * @param {boolean} maskable full-bleed background with the mark inside the safe zone
 */
function drawIcon(size, maskable) {
  const buf = new Uint8Array(size * size * 4); // transparent

  // Geometry expressed as fractions of the canvas, so it scales cleanly.
  const bgInset = maskable ? 0 : size * 0.055;
  const bgSize = size - bgInset * 2;
  const bgRadius = maskable ? 0 : bgSize * 0.225;

  // Maskable icons get a 40% safe zone; keep the mark well inside it.
  const markScale = maskable ? 0.52 : 0.62;
  const markW = size * markScale;
  const markX = (size - markW) / 2;
  const barH = size * (maskable ? 0.072 : 0.086);
  const barGap = barH * 0.72;
  const barRadius = barH / 2;
  const widths = [1, 0.66, 0.86]; // unequal, so it reads as data rather than a menu
  const blockH = barH * 3 + barGap * 2;
  const markY = (size - blockH) / 2;

  const step = 1 / SS;
  const sampleWeight = 1 / (SS * SS);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Background.
      let bgAlpha = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          if (maskable) {
            bgAlpha += sampleWeight;
          } else {
            bgAlpha += roundedRectCoverage(px, py, bgInset, bgInset, bgSize, bgSize, bgRadius) * sampleWeight;
          }
        }
      }
      blend(buf, i, ACCENT, bgAlpha);

      // The three bars.
      let inkAlpha = 0;
      for (let b = 0; b < 3; b++) {
        const by = markY + b * (barH + barGap);
        const bw = markW * widths[b];
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const px = x + (sx + 0.5) * step;
            const py = y + (sy + 0.5) * step;
            inkAlpha += roundedRectCoverage(px, py, markX, by, bw, barH, barRadius) * sampleWeight;
          }
        }
      }
      blend(buf, i, INK, Math.min(1, inkAlpha));
    }
  }

  return buf;
}

// ------------------------------------------------------------------ PNG writer

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng(rgba, size) {
  // Each scanline is prefixed with a filter byte; 0 means no filtering.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
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

// ------------------------------------------------------------------------ run

mkdirSync(OUT, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
];

for (const t of targets) {
  const png = encodePng(drawIcon(t.size, t.maskable), t.size);
  writeFileSync(join(OUT, t.name), png);
  console.log(`wrote ${t.name} (${t.size}px, ${(png.length / 1024).toFixed(1)} KB)`);
}

// The SVG is the same geometry, for the browser tab and any size the OS asks for.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Aoiro">
  <rect x="28" y="28" width="456" height="456" rx="103" fill="#2a78d6"/>
  <g fill="#ffffff">
    <rect x="98" y="190" width="317" height="44" rx="22"/>
    <rect x="98" y="256" width="209" height="44" rx="22"/>
    <rect x="98" y="322" width="273" height="44" rx="22"/>
  </g>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('wrote icon.svg');
