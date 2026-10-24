// Fails if public/_headers' CSP and what public/ actually loads have drifted apart.
//
// Why this exists: P10 moved the webfonts onto our own origin and deleted the Google Fonts
// @import, but left `font-src https://fonts.gstatic.com` in the CSP. Production then blocked every
// self-hosted woff2 and fell back to system faces, which is not a visible error anywhere, only a
// console warning nobody reads. The local static preview used to verify P10 does not apply
// _headers at all, so nothing in the pipeline could have caught it.
//
// Two directions, both failures:
//   1. Referenced but not allowed  -> the browser blocks it in production.
//   2. Allowed but never referenced -> a stale permission, and the sign the CSP has gone unmaintained.
//
//   node scripts/check-csp.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Hosts fetched by code we do not author, so they never appear as a literal in public/.
// Each needs a reason, because an unexplained entry here is how a CSP rots.
const DYNAMIC = {
  'https://challenges.cloudflare.com': 'Turnstile: its own script injects the widget iframe.',
};

const DIRECTIVES = ['script-src', 'style-src', 'font-src', 'img-src', 'connect-src', 'frame-src'];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else if (/\.(html|css|js|webmanifest)$/.test(entry.name)) acc.push(path);
  }
  return acc;
}

const headers = readFileSync('public/_headers', 'utf8');
const csp = (headers.match(/Content-Security-Policy:\s*([^\n\r]+)/) || [])[1];
if (!csp) {
  console.error('No Content-Security-Policy found in public/_headers.');
  process.exit(1);
}

const allowed = new Map(); // host -> [directives]
for (const part of csp.split(';')) {
  const [name, ...values] = part.trim().split(/\s+/);
  if (!DIRECTIVES.includes(name)) continue;
  for (const value of values) {
    if (!value.startsWith('http')) continue;
    const host = value.replace(/\/$/, '');
    allowed.set(host, [...(allowed.get(host) || []), name]);
  }
}

const referenced = new Set();
let sameOriginFont = false;
for (const file of walk('public')) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)) referenced.add(match[0]);
  // A relative url() inside @font-face means the fonts come from our own origin.
  if (/@font-face/.test(source) && /src:\s*url\(['"]?\/?[^h)]/.test(source)) sameOriginFont = true;
}

const problems = [];

for (const [host, directives] of allowed) {
  if (referenced.has(host)) continue;
  if (DYNAMIC[host]) continue;
  problems.push(`stale: ${host} is allowed by ${directives.join(', ')} but nothing in public/ references it.`);
}

for (const host of referenced) {
  if (allowed.has(host) || DYNAMIC[host]) continue;
  // Only flag hosts we would actually fetch from; links in prose and canonical URLs are not loads.
  if (host.includes('recipe-book-9eo.pages.dev') || host.includes('github.com')) continue;
  problems.push(`blocked: ${host} is referenced in public/ but no CSP directive allows it.`);
}

const fontSrc = csp.match(/font-src\s+([^;]+)/)?.[1] ?? '';
if (sameOriginFont && !fontSrc.includes("'self'")) {
  problems.push(`blocked: public/ serves its own @font-face files but font-src is "${fontSrc.trim()}" and does not include 'self'.`);
}

if (problems.length) {
  for (const problem of problems) console.error(`FAIL  ${problem}`);
  process.exit(1);
}
console.log(`csp: in step with public/ (${allowed.size} external host(s) allowed, all referenced).`);
