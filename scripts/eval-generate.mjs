// Task 9's generation eval: runs the 11 documented cases against a local `npm run dev` and writes
// docs/generation-eval.md. Uses real Workers AI quota (roughly 5,000-8,000 neurons) — run at most
// once a day, ideally soon after 00:00 UTC. If the daily allocation runs out mid-run, resume after
// the reset; that is not a failure of this script.
//
// Known environment limitation (see docs/progress.md, Phase 9): on this machine `wrangler pages
// dev` cannot start at all while `wrangler.toml` declares the `[ai]` binding, so this script has
// never actually been run here. It's written and ready for whenever local dev is available (a
// broader Cloudflare API token, or a machine where the AI binding's remote session succeeds).
const args = process.argv.slice(2);
function argValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}
const base = (argValue('--base') || 'http://localhost:8788').replace(/\/$/, '');
const TEST_TOKEN = 'eval-generate-turnstile-token';

const CASES = [
  { n: 1, prompt: 'paneer butter masala, lighter than restaurant style', constraints: {}, expected: '200; is_vegetarian:true; contains_dairy:true' },
  { n: 2, prompt: "egg-free banana bread for kids' lunchboxes", constraints: { eggFree: true }, expected: '200; is_egg_free:true; no egg warning' },
  { n: 3, prompt: 'vegan pav bhaji', constraints: { vegetarian: true, dairyFree: true }, expected: '200; contains_dairy:false; warning if butter appears' },
  { n: 4, prompt: 'chicken biryani for 6', constraints: { serves: 6 }, expected: '200 vegetarian adaptation; is_vegetarian:true, is_egg_free:true; serves 6; origin_note explains the swap' },
  { n: 5, prompt: 'french toast for a weekend breakfast', constraints: {}, expected: '200 eggless version; is_egg_free:true' },
  { n: 6, prompt: 'kanda poha', constraints: {}, expected: '409 similar_exists (Kanda Poha exists); no generation row' },
  { n: 7, prompt: 'baingan bharta with bajra roti', constraints: {}, expected: '409 similar_exists' },
  { n: 8, prompt: 'write me a poem about cars', constraints: {}, expected: '422 not_a_recipe' },
  { n: 9, prompt: 'protein-rich packed lunch wrap for a teenager', constraints: {}, mealType: 'Packed Lunch', expected: '200; meal_types includes Packed Lunch; proteinSmart:true; lunchbox_notes present; no nuts' },
  { n: 10, prompt: "healthier vegetarian shepherd's pie", constraints: {}, expected: '200; cuisine British or Fusion; vegetarian and egg-free; protein-smart' },
  { n: 11, prompt: 'spicy Rajasthani dinner with millets', constraints: {}, expected: '200; cuisine Rajasthani; spice_level >= 4; whole grains, not refined' },
];

async function runCase(testCase) {
  const start = Date.now();
  const body = { prompt: testCase.prompt, constraints: testCase.constraints, turnstileToken: TEST_TOKEN };
  if (testCase.mealType) body.mealType = testCase.mealType;

  const res = await fetch(`${base}/api/recipes/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - start;
  const data = await res.json().catch(() => ({}));

  return {
    ...testCase,
    status: res.status,
    code: data.code,
    warnings: data.warnings || [],
    usage: data.usage,
    latencyMs,
    draft: data.draft,
    matches: data.matches,
  };
}

const results = [];
for (const testCase of CASES) {
  console.log(`Running case ${testCase.n}: ${testCase.prompt}`);
  const result = await runCase(testCase); // sequential, deliberately, to respect the daily quota
  console.log(`  -> ${result.status} ${result.code || ''} (${result.latencyMs}ms)`);
  results.push(result);
}

const rows = results.map((r) => {
  const outcome = r.status === 200 ? `200 (protein-smart: ${r.draft?.is_protein_smart ?? 'n/a'})` : `${r.status} ${r.code || ''}`;
  return `| ${r.n} | ${r.prompt} | ${r.expected} | ${outcome} | ${r.warnings.map((w) => w.code).join(', ') || '—'} | ${r.latencyMs}ms | ${r.usage ? `${r.usage.provider}/${r.usage.model}, ${r.usage.inputTokens}in/${r.usage.outputTokens}out` : '—'} |`;
}).join('\n');

const successLatencies = results.filter((r) => r.status === 200 || ([1, 2, 3, 4, 5, 9, 10, 11].includes(r.n))).map((r) => r.latencyMs).sort((a, b) => a - b);
const medianLatency = successLatencies.length ? successLatencies[Math.floor(successLatencies.length / 2)] : null;

const markdown = `# Generation eval results

Run at ${new Date().toISOString()} against ${base}.

| # | Prompt | Expected | Actual | Warnings | Latency | Usage |
|---|---|---|---|---|---|---|
${rows}

Median latency across cases 1-5 and 9-11: ${medianLatency !== null ? `${medianLatency}ms` : 'n/a'} (target: under 45s).
`;

const { writeFileSync } = await import('node:fs');
writeFileSync('docs/generation-eval.md', markdown);
console.log('\nWrote docs/generation-eval.md');
