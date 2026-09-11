import { readFileSync, readdirSync } from 'node:fs';

const CSS_DIR = 'public/css';
const TOKENS_FILE = 'tokens.css';

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/g;
const FONT_SIZE_RE = /font-size\s*:\s*([^;]+);/g;
const ALLOWED_FONT_SIZE = /^var\(--fs-[1-8]\)$/;

let errors = 0;

function checkColors(file, text) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
    const matches = line.match(COLOR_RE);
    if (matches) {
      console.error(`${file}:${idx + 1}: colour literal outside tokens.css: ${matches.join(', ')}`);
      errors += 1;
    }
  });
}

function checkFontSizes(file, text) {
  let match;
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  while ((match = FONT_SIZE_RE.exec(text))) {
    const value = match[1].trim();
    if (!ALLOWED_FONT_SIZE.test(value)) {
      console.error(`${file}:${lineOf(match.index)}: font-size "${value}" is not a type-scale token (var(--fs-1) … var(--fs-8))`);
      errors += 1;
    }
  }
}

for (const file of readdirSync(CSS_DIR)) {
  if (!file.endsWith('.css')) continue;
  const text = readFileSync(`${CSS_DIR}/${file}`, 'utf8');
  if (file !== TOKENS_FILE) checkColors(file, text);
  checkFontSizes(file, text);
}

if (errors > 0) {
  console.error(`\nlint-css: ${errors} violation(s).`);
  process.exit(1);
}
console.log('lint-css: no colour literals outside tokens.css, no off-scale font sizes.');
