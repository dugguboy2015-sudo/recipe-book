// Generates the PWA's app icons as PNGs, with no image library and no build step: the shapes are
// drawn by testing each pixel, then encoded with zlib (which Node has) and a hand-rolled PNG
// header. Run it when the icon design or the brand colours change — the output is committed.
//
//   node scripts/build-icons.mjs
//
// A manifest needs PNG icons (Chrome still ignores SVG icons in a manifest, and iOS needs a PNG
// for its home-screen icon), which is why this exists at all rather than reusing the site's SVGs.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

// The brand, taken from css/tokens.css — the icon should look like the app, not near it.
const BRAND_INK = [26, 61, 47];   // --brand-ink, the deep green
const CREAM = [250, 246, 238];    // --surface in light theme
const SPICE = [214, 106, 58];     // --spice, the warm accent

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {(x: number, y: number) => [number, number, number]} shade */
function png(size, shade) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = shade(x, y);
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b;
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // 8 bits per channel
  ihdr[9] = 2;  // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A bowl with steam: the same idea as the in-app dish illustrations, at icon scale.
 * `safe` insets the drawing for a maskable icon, where the outer ~10% can be cropped to any shape.
 */
function drawIcon(size, { safe = 1 } = {}) {
  const c = size / 2;
  const s = (size / 2) * safe;
  return (x, y) => {
    const dx = x - c;
    const dy = y - c;

    // Bowl: the lower half of a disc, with a rim line above it.
    const r = s * 0.62;
    const inBowl = dy > -s * 0.04 && Math.hypot(dx, dy - s * 0.02) < r;
    const onRim = Math.abs(dy + s * 0.06) < s * 0.05 && Math.abs(dx) < r * 1.06;
    if (inBowl || onRim) return CREAM;

    // Three curls of steam above it.
    for (const [ox, scale] of [[-s * 0.34, 0.8], [0, 1], [s * 0.34, 0.8]]) {
      const sx = dx - ox;
      const sy = dy + s * 0.42;
      const wave = Math.sin((sy / (s * 0.34)) * Math.PI) * s * 0.07;
      if (Math.abs(sx - wave) < s * 0.045 * scale && sy > -s * 0.3 * scale && sy < s * 0.26) return SPICE;
    }
    return BRAND_INK;
  };
}

mkdirSync('public/icons', { recursive: true });
const outputs = [
  ['public/icons/icon-192.png', 192, {}],
  ['public/icons/icon-512.png', 512, {}],
  // Maskable icons are cropped to the platform's shape, so everything important stays well inside.
  ['public/icons/icon-maskable-512.png', 512, { safe: 0.78 }],
];
for (const [path, size, options] of outputs) {
  writeFileSync(path, png(size, drawIcon(size, options)));
  console.log(`wrote ${path} (${size}×${size})`);
}
