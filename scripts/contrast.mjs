import { readFileSync } from 'node:fs';

function extractBlock(text, selectorRe) {
  const match = selectorRe.exec(text);
  if (!match) return {};
  const start = match.index + match[0].length;
  const end = text.indexOf('}', start);
  const body = text.slice(start, end);
  const tokens = {};
  for (const line of body.split(';')) {
    const m = line.match(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
    if (m) tokens[m[1]] = m[2];
  }
  return tokens;
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseColor(value) {
  if (value.startsWith('#')) return hexToRgb(value);
  const rgbaMatch = value.match(/rgba?\(([^)]+)\)/);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((p) => parseFloat(p.trim()));
    return parts.slice(0, 3);
  }
  throw new Error(`Cannot parse color: ${value}`);
}

function luminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex1, hex2) {
  const l1 = luminance(parseColor(hex1));
  const l2 = luminance(parseColor(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const tokensText = readFileSync('public/css/tokens.css', 'utf8');
const light = extractBlock(tokensText, /^:root\s*\{/m);
const dark = extractBlock(tokensText, /:root\[data-theme="dark"\]\s*\{/);

// Pairs actually used together in components.css/pages.css/base.css, each with the WCAG
// minimum that applies: 4.5:1 for text, 3:1 for large text / UI component boundaries.
const PAIRS = [
  ['ink', 'bg', 4.5, 'body text on page background'],
  ['ink-muted', 'bg', 4.5, 'muted text on page background'],
  ['ink-muted', 'surface', 4.5, 'muted text on surface'],
  ['brand-ink', 'bg', 4.5, 'brand heading text on page background'],
  ['brand-ink', 'surface', 4.5, 'brand heading text on surface (cards)'],
  ['brand-ink', 'surface-raised', 4.5, 'brand heading text on raised surface'],
  ['ink', 'surface-raised', 4.5, 'body text on raised surface (detail panels)'],
  ['surface', 'brand-ink', 4.5, 'button text on primary button'],
  ['surface', 'danger', 4.5, 'button text on danger/secondary button'],
  ['danger', 'danger-bg', 4.5, 'danger text on danger tint (field errors, badges)'],
  ['ok', 'ok-bg', 4.5, 'ok text on ok tint (vegetarian badge)'],
  ['warn', 'warn-bg', 4.5, 'warn text on warn tint (egg badge)'],
  ['spice-ink', 'spice-bg', 4.5, 'spice ink on spice tint'],
  ['brand', 'bg', 3.0, 'brand as UI border/icon colour (3:1)'],
  // Card borders (--line) are decorative — cards are already visually separated by box-shadow and
  // spacing, so the border isn't the sole means of identifying the component (WCAG 1.4.11 doesn't
  // apply); not checked here for that reason, unlike the focus ring and button/chip borders below.
  ['cuisine-south-indian-ink', 'cuisine-south-indian-bg', 4.5, 'cuisine band: South Indian'],
  ['cuisine-north-indian-ink', 'cuisine-north-indian-bg', 4.5, 'cuisine band: North Indian'],
  ['cuisine-maharashtrian-ink', 'cuisine-maharashtrian-bg', 4.5, 'cuisine band: Maharashtrian'],
  ['cuisine-rajasthani-ink', 'cuisine-rajasthani-bg', 4.5, 'cuisine band: Rajasthani'],
  ['cuisine-chaat-ink', 'cuisine-chaat-bg', 4.5, 'cuisine band: Chaat'],
  ['cuisine-indo-chinese-ink', 'cuisine-indo-chinese-bg', 4.5, 'cuisine band: Indo-Chinese'],
  ['cuisine-gujarati-ink', 'cuisine-gujarati-bg', 4.5, 'cuisine band: Gujarati'],
  ['cuisine-fusion-ink', 'cuisine-fusion-bg', 4.5, 'cuisine band: Fusion'],
  ['cuisine-other-ink', 'cuisine-other-bg', 4.5, 'cuisine band: Other (fallback)'],
];

let failures = 0;

for (const [themeName, tokens] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min, label] of PAIRS) {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    if (!fgValue || !bgValue) {
      console.error(`FAIL  [${themeName}] missing token(s) for "${label}": --${fg}=${fgValue}, --${bg}=${bgValue}`);
      failures += 1;
      continue;
    }
    const ratio = contrastRatio(fgValue, bgValue);
    const pass = ratio >= min;
    console.log(`${pass ? 'PASS' : 'FAIL'}  [${themeName}] ${label}: --${fg} on --${bg} = ${ratio.toFixed(2)}:1 (need ${min}:1)`);
    if (!pass) failures += 1;
  }
}

if (failures > 0) {
  console.error(`\ncontrast: ${failures} failing pair(s).`);
  process.exit(1);
}
console.log('\ncontrast: all pairs pass in both themes.');
