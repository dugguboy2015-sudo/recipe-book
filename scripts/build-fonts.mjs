// Copies the woff2 files this app actually uses out of @fontsource and into public/fonts/.
//
// Why: base.css used to start with `@import url('https://fonts.googleapis.com/...')`. An @import at
// the top of a stylesheet is the worst way to load a font: the browser must fetch and parse the CSS
// before it even learns the font exists, so it serialises two round trips in front of first paint,
// and it hands a third party a request on every visit. Self-hosting removes both.
//
//   node scripts/build-fonts.mjs           # copy the files
//   node scripts/build-fonts.mjs --check   # fail if any are missing or stale
//
// Same generate-and-commit pattern as the PWA icons, the icon sprite and the modulepreload lists.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const OUT = 'public/fonts';

// Only the weights the stylesheets ask for. Fraunces italic is included because display headings
// use it; Work Sans italic is not used anywhere.
const FILES = [
  ['@fontsource/fraunces/files/fraunces-latin-400-normal.woff2', 'fraunces-400.woff2'],
  ['@fontsource/fraunces/files/fraunces-latin-600-normal.woff2', 'fraunces-600.woff2'],
  ['@fontsource/fraunces/files/fraunces-latin-700-normal.woff2', 'fraunces-700.woff2'],
  ['@fontsource/fraunces/files/fraunces-latin-400-italic.woff2', 'fraunces-400-italic.woff2'],
  ['@fontsource/work-sans/files/work-sans-latin-400-normal.woff2', 'work-sans-400.woff2'],
  ['@fontsource/work-sans/files/work-sans-latin-500-normal.woff2', 'work-sans-500.woff2'],
  ['@fontsource/work-sans/files/work-sans-latin-600-normal.woff2', 'work-sans-600.woff2'],
  ['@fontsource/work-sans/files/work-sans-latin-700-normal.woff2', 'work-sans-700.woff2'],
];

const check = process.argv.includes('--check');
mkdirSync(OUT, { recursive: true });

let stale = 0;
let bytes = 0;
for (const [from, to] of FILES) {
  const src = `node_modules/${from}`;
  if (!existsSync(src)) throw new Error(`missing font source: ${src} (run npm install)`);
  const data = readFileSync(src);
  bytes += data.length;
  const dest = `${OUT}/${to}`;
  const current = existsSync(dest) ? readFileSync(dest) : null;
  if (current && current.equals(data)) continue;
  if (check) {
    console.error(`${dest} is stale or missing — run \`node scripts/build-fonts.mjs\``);
    stale += 1;
  } else {
    writeFileSync(dest, data);
  }
}

if (stale) process.exit(1);
console.log(`fonts: ${FILES.length} files, ${Math.round(bytes / 1024)}KB${check ? ' (up to date)' : ' written'}`);
