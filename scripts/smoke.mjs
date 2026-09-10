const args = process.argv.slice(2);
function argValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}
const base = (argValue('--base') || 'http://localhost:8788').replace(/\/$/, '');
const write = args.includes('--write');

const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}: ${err.message}`);
    failures.push(name);
  }
}

for (const path of ['/', '/recipes.html', '/planner.html']) {
  await check(`GET ${path} -> 200 text/html`, async () => {
    const res = await fetch(`${base}${path}`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) throw new Error(`content-type ${ct}`);
  });
}

await check('/ has Content-Security-Policy header', async () => {
  const res = await fetch(`${base}/`);
  if (!res.headers.get('content-security-policy')) throw new Error('missing CSP header');
});

await check('GET /api/health -> 200 ok:true', async () => {
  const res = await fetch(`${base}/api/health`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const json = await res.json();
  if (json.ok !== true) throw new Error(`unexpected body ${JSON.stringify(json)}`);
});

if (!write) {
  await check('POST /api/recipes without a token is rejected (403)', async () => {
    const res = await fetch(`${base}/api/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '__smoke__ unauthorized probe' }),
    });
    if (![401, 403, 404].includes(res.status)) {
      throw new Error(`expected 401/403/404 (endpoint may not exist yet), got ${res.status}`);
    }
  });
}

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log('All smoke checks passed.');
