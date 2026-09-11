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
  await check('POST /api/recipes without a token is rejected (403 verification_failed)', async () => {
    const res = await fetch(`${base}/api/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe: { name: '__smoke__ unauthorized probe' } }),
    });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
    const json = await res.json();
    if (json.code !== 'verification_failed') throw new Error(`expected code verification_failed, got ${json.code}`);
  });

  await check('POST /api/recipes with a bad Origin is rejected (403 origin_not_allowed)', async () => {
    const res = await fetch(`${base}/api/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ recipe: { name: '__smoke__ bad origin probe' } }),
    });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
    const json = await res.json();
    if (json.code !== 'origin_not_allowed') throw new Error(`expected code origin_not_allowed, got ${json.code}`);
  });
}

if (write) {
  // Local only: the test Turnstile secret key (configured via .dev.vars) accepts any token of
  // plausible length for this well-known dummy site/secret pair, so no real browser is needed.
  const TEST_TOKEN = 'smoke-test-turnstile-token';
  const timestamp = Date.now();
  const name = `__smoke__${timestamp}`;
  let recipeId;

  await check('create __smoke__ recipe -> 201', async () => {
    const res = await fetch(`${base}/api/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipe: {
          name, cuisine: 'Other', description: 'Smoke test recipe.', serves: 4, total_time_minutes: 10,
          steps: [{ group: 'Method', steps: ['Smoke test step.'] }],
          is_vegetarian: true, is_egg_free: true, contains_dairy: false,
        },
        ingredients: [{ group: 'Ingredients', items: [{ ingredient: { name: 'smoke test ingredient' } }] }],
        turnstileToken: TEST_TOKEN,
      }),
    });
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${await res.text()}`);
    const json = await res.json();
    recipeId = json.recipe.id;
  });

  await check('update __smoke__ recipe -> 200', async () => {
    // The first PATCH attempt always 409s (the create response's updated_at has more precision
    // than a client would normally know in advance) — that's expected; re-read the real value
    // from the conflict response's `current` and retry once with it.
    const firstRes = await fetch(`${base}/api/recipes/${recipeId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipe: { description: 'Updated.' }, expectedUpdatedAt: new Date().toISOString(), turnstileToken: TEST_TOKEN }) });
    if (firstRes.status === 409) {
      const conflict = await firstRes.json();
      const retryRes = await fetch(`${base}/api/recipes/${recipeId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipe: { description: 'Updated.' }, expectedUpdatedAt: conflict.current.updated_at, turnstileToken: TEST_TOKEN }) });
      if (retryRes.status !== 200) throw new Error(`expected 200 on retry, got ${retryRes.status}: ${await retryRes.text()}`);
      return;
    }
    if (firstRes.status !== 200) throw new Error(`expected 200 or 409-then-200, got ${firstRes.status}: ${await firstRes.text()}`);
  });

  await check('delete __smoke__ recipe -> 200', async () => {
    const res = await fetch(`${base}/api/recipes/${recipeId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstileToken: TEST_TOKEN }) });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
  });

  await check('restore __smoke__ recipe -> 200', async () => {
    const res = await fetch(`${base}/api/recipes/${recipeId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstileToken: TEST_TOKEN }) });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
  });

  await check('delete __smoke__ recipe again -> 200 (leaves it soft-deleted for cleanup)', async () => {
    const res = await fetch(`${base}/api/recipes/${recipeId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstileToken: TEST_TOKEN }) });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
  });

  await check('audit log recorded create/update/delete/restore/delete', async () => {
    const { loadEnv } = await import('./lib/env.mjs');
    const { sql } = await import('./lib/supabase.mjs');
    const env = loadEnv({ required: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'] });
    const rows = await sql(env, `select action from public.recipe_audit_log where recipe_id = ${recipeId} order by created_at`, { readOnly: true });
    const actions = rows.map((r) => r.action);
    const expected = ['create', 'update', 'delete', 'restore', 'delete'];
    if (JSON.stringify(actions) !== JSON.stringify(expected)) {
      throw new Error(`expected audit actions ${expected.join(',')}, got ${actions.join(',')}`);
    }
  });

  await check('hard-delete __smoke__ recipe with the secret key (cleanup)', async () => {
    const { loadEnv } = await import('./lib/env.mjs');
    const { rest } = await import('./lib/supabase.mjs');
    const env = loadEnv({ required: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] });
    const res = await rest(env, `recipes?id=eq.${recipeId}&name=eq.${encodeURIComponent(name)}`, { method: 'DELETE', secret: true });
    if (res.status !== 200 && res.status !== 204) throw new Error(`cleanup delete failed: status ${res.status}`);
  });
}

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log('All smoke checks passed.');
