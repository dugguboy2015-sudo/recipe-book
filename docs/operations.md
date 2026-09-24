# Operations

Day-to-day running of this app once it's deployed: changing limits, rotating secrets, restoring
data, un-deleting a recipe, reading the audit trail, and keeping an eye on AI usage. For what the
system looks like and why, see [`docs/architecture.md`](architecture.md).

## Changing generation and write limits

All three limits are `wrangler.toml` `[vars]` (plain, non-secret config — safe to see in the repo):

```toml
[vars]
GEN_GLOBAL_DAILY = "18"          # AI model calls per UTC day, whole site
GEN_PER_HOUSEHOLD_DAILY = "5"    # AI model calls per household per UTC day (recipes + nutrition estimates)
WRITES_PER_USER_HOURLY = "30"    # create/edit/delete/restore/approve per signed-in member per hour
```

Since M1c these count by household and member, not by IP — every write and AI call is made by a
signed-in household member.

Edit the value, commit, open a PR, merge to `main` — Cloudflare Pages picks up `wrangler.toml`
changes on the next deploy like any other file, no separate step. There's nothing to redeploy by
hand.

`GEN_GLOBAL_DAILY`/`GEN_PER_HOUSEHOLD_DAILY` bound *this app's own* request count, not Workers AI's
underlying free-tier neuron allocation — raising them doesn't raise Cloudflare's own daily ceiling,
it just changes how much of that ceiling this app is willing to spend before turning visitors away
with a 429 of its own. See "When Workers AI runs out" below for what happens if the underlying
allocation is exhausted first.

## Rotating secrets

Every secret lives in exactly two places: `.env.local` (your machine, gitignored) and Cloudflare
Pages' secrets store (pushed via `npm run secrets:push`, which runs `scripts/set-secrets.mjs`).
None of them are ever committed, logged, or embedded in a build artifact.

| Secret | Where to generate a new one | What breaks until you push the new value |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Supabase dashboard → Project Settings → API Keys → Secret keys | Every write and every AI generation — Functions can't reach the database at all |
| `TURNSTILE_SECRET_KEY` | Cloudflare dashboard → Turnstile → your widget → Rotate secret key (rotate the **site key** too if you suspect it's been scraped, and update `TURNSTILE_SITE_KEY` and `public/js/config.js`'s copy together) | Since M1c the Functions no longer use it. It matters only if Supabase's sign-in captcha is switched on (see "Sign-in settings" below) — then update it there too, or sign-in emails are refused |
| `FOUNDING_OWNER_EMAIL` | Not a secret — the founding owner's email, kept out of the public repo. `.env.local`, pushed with the others | Only the *first* household created by that email is affected: it would not become the curator or claim the existing recipes |
| `GEMINI_API_KEY` | aistudio.google.com/apikey | No functional break — Workers AI is the primary model and works without it; you just lose the fallback for whenever Workers AI's own daily allocation runs out |
| `IP_HASH_SALT` | Auto-generated (32 random bytes) the first time `npm run dev:vars` runs without one already in `.env.local`; rotate manually by deleting the line and re-running | Nothing breaks — rate limits and the audit log just start hashing IPs differently from that moment on, so a visitor's very-recent request history (the last hour of writes, the last day of generations) is no longer linked to their new hash. Their limits simply reset a little early; nothing is lost. |

After changing any of them in `.env.local`, push the new values with:

```bash
npm run secrets:push
```

## Sign-in settings

Supabase Auth is configured by `npm run auth:configure` (`scripts/configure-auth.mjs`; dry run by
default, `-- --apply` to write): the site URL and the redirect allowlist (production, every preview,
local dev). Two things are deliberately left for the owner:

- **A custom SMTP sender.** Supabase's built-in sender allows **2 auth emails per hour for the whole
  project** and refuses custom email templates on the free tier. Configure SMTP in the Supabase
  dashboard (Authentication → Emails → SMTP; e.g. Resend's free tier with a verified domain, or a
  Gmail app password), then re-run `auth:configure -- --apply`: it notices SMTP and also installs the
  branded templates, which add a 6-digit code to the link.
- **Sign-in captcha.** The sign-in dialog already sends a Turnstile token. To make Supabase require
  it: Authentication → Attack Protection → enable Captcha, provider Turnstile, paste
  `TURNSTILE_SECRET_KEY`. Test a real sign-in from an ordinary browser straight afterwards (automated
  browsers can't pass Turnstile); turning it off again is the same switch. Local `npm run dev` uses
  Turnstile's test site key, whose tokens a real secret rejects — sign in locally with an
  admin-generated link instead (`scripts/lib/test-member.mjs` shows how).

## Test members for write checks

`npm run smoke -- --base <url> --write` and `scripts/eval-generate.mjs` create throwaway signed-in
members (`scripts/lib/test-member.mjs`: admin API, pre-confirmed, no email sent), act as them, and
delete them afterwards. Every deployment shares the production database, so a run that is killed
halfway can leave a `__smoke__ household` behind — delete it (and its auth user) from the Supabase
dashboard.

## Restoring from backup

`npm run backup` (run before every migration) writes `backups/<timestamp>/recipes.json` — a full
snapshot of the `recipes` table. `scripts/restore.mjs` reverses that: it upserts those rows back by
`id`, dry-run by default.

```bash
npm run restore -- backups/2026-09-10T12-00-00-000Z              # dry run: reports insert/update/unchanged counts, writes nothing
npm run restore -- backups/2026-09-10T12-00-00-000Z --apply --yes  # actually writes
```

It refuses to write unless **both** `--apply` and `--yes` are given — a single flag typo can't
accidentally overwrite production. **Scope**: this restores `recipes`' own columns only (matching
what `npm run backup` captures) — it does not touch `recipe_ingredients` rows, since those aren't
part of any backup today. Restoring a recipe this way reverts its own fields (name, times,
nutrition, the legacy `ingredients` jsonb mirror, dietary flags, …); its current structured
ingredients are left as they are.

## Un-deleting a recipe

Two ways, in order of preference:

1. **The restore endpoint** — `POST /api/recipes/:id/restore` (Origin check, signed-in member
   of the recipe's household or the curator, rate limit — same as every other write). This is what the app's own UI uses (the "Undo" action on the
   delete snackbar, for 8 seconds after a delete) and the only way that also writes a
   `recipe_audit_log` row for the restore.
2. **A migration**, for a bulk restore or once the UI's undo window has passed and going through
   the API isn't convenient:
   ```sql
   update public.recipes set is_deleted = false, deleted_at = null where id = <id>;
   ```
   Put it in a new `migrations/NNN_restore_recipe.sql` and run `npm run migrate` — **not**
   `npm run sql`, which is deliberately restricted to `SELECT` only (see the next section) and will
   reject any non-`SELECT` statement at the database level, by design.

## Reading the audit log

`recipe_audit_log` is append-only — every create/update/delete/restore, who did it (`source`:
`'manual'` or `'ai'`), a hashed actor IP (never the raw address), and `before`/`after` snapshots.
Read it with `npm run sql -- --read-only "<query>"` (the flag is required for any query — this
script only ever runs in a read-only transaction, so it's not a path to writing, by design; see
"SQL against production" in `CLAUDE.md`).

```bash
# Everything that happened to one recipe
npm run sql -- --read-only "select action, source, created_at from public.recipe_audit_log where recipe_id = 12 order by created_at desc"

# Every delete in the last 7 days
npm run sql -- --read-only "select recipe_id, actor_ip_hash, created_at from public.recipe_audit_log where action = 'delete' and created_at > now() - interval '7 days' order by created_at desc"

# How much traffic one hashed IP has generated recently (for investigating a rate-limit report)
npm run sql -- --read-only "select action, created_at from public.recipe_audit_log where actor_ip_hash = '<hash>' order by created_at desc limit 50"
```

## AI usage

```bash
npm run sql -- --read-only "select date_trunc('day', created_at) d, count(*), sum(est_neurons), count(*) filter (where outcome='saved') saved from public.recipe_generations group by 1 order by 1 desc"
```

`outcome` distinguishes what actually happened to each model call: `generated` (became the
returned draft), `invalid` (structurally fine but superseded by the one retry, or ultimately
rejected), `error` (the model call itself failed — parse/transport), `refused` (the request never
passed its own sanity checks, no model call made). A saved draft is linked back to its generation
row via `recipe_generations.saved_recipe_id`.

## When Workers AI's daily allocation runs out

If Cloudflare's own Workers AI free-tier daily neuron budget is exhausted before this app's own
`GEN_GLOBAL_DAILY`/`GEN_PER_HOUSEHOLD_DAILY` limits are hit, the generate endpoint automatically falls
back to Gemini Flash **if `GEMINI_API_KEY` is set** — no code change or redeploy needed, it's
checked on every request. Without a Gemini key configured, a visitor sees the same "come back
after midnight UTC" message this app already shows when its own daily limits are hit, since from
the endpoint's point of view both are just "no model available right now."

## Reviewing unreviewed ingredients

Every ingredient created from an AI draft (or a manual add without a match) starts life as
`status = 'unreviewed'` — its allergen/diet flags came from the AI or the person entering the
recipe, not a curator. List them with their usage to prioritize which ones matter most:

```bash
npm run sql -- --read-only "select i.id, i.display_name, i.category, u.uses from public.ingredients i join public.ingredient_usage u on u.id = i.id where i.status = 'unreviewed' order by u.uses desc"
```

To mark one reviewed, or merge a duplicate into a canonical ingredient (e.g. "spring onion" into
"scallion"), write a migration — there's no UI for this today:

```sql
-- Mark reviewed once you've checked its flags:
update public.ingredients set status = 'reviewed' where id = <id>;

-- Merge a duplicate: repoint every reference, then remove the duplicate.
update public.recipe_ingredients set ingredient_id = <canonical_id> where ingredient_id = <duplicate_id>;
insert into public.ingredient_aliases (alias, ingredient_id)
  select name, <canonical_id> from public.ingredients where id = <duplicate_id>
  on conflict do nothing;
delete from public.ingredients where id = <duplicate_id>;
```

## Re-estimating nutrition for one recipe

`POST /api/recipes/estimate-nutrition` (the same endpoint the add/edit form's "Estimate nutrition"
button calls) takes a recipe's ingredients and serving count and returns the eight J.1 nutrition
fields as an estimate — it doesn't write anything itself. To refresh one recipe: open it for
editing, click "Estimate nutrition," review the numbers, and save. There's no bulk/scripted path
today; re-estimating many recipes at once would mean scripting repeated calls to that endpoint
(mind `GEN_PER_HOUSEHOLD_DAILY` if you do, and only ever against a recipe you intend to also review
by eye — these are estimates, not verified values).

## Where planner learning lives

A signed-in household's plan and its learned signals live in the database (`plan_weeks`,
`plan_prefs`), shared between members and devices. **Signed out**, they live only in the browser
that built them (`localStorage` keys `recipeBookPlanner.v3` and `recipeBook.prefs.v1`), which
means:

- Clearing site data/cookies for this domain, or switching browsers or devices, loses the plan and
  every preference signal (manual/kept/removed/loved/notAgain counts, the 12-week history).
- **Export** (on the planner page) downloads both as one JSON file; **Import** on another
  browser/device restores them exactly, after a confirmation. Signing in is the easier route now:
  a household's plan follows its members, and a first sign-in on a browser that already has a plan
  adopts it as the household's.
- **Plan data is not in `npm run backup`**, which only ever covers the `recipes` table. A
  household's `plan_weeks`/`plan_prefs` rows are recoverable only from Supabase's own backups, or
  from a planner Export someone took.

## Troubleshooting

**`npm run dev` won't start, or hangs.** `wrangler.toml`'s `[ai]` binding tries to establish a
remote Workers AI session before serving any route, which needs a Cloudflare API token with the
broader Workers Scripts scope — a Pages-only token isn't enough, and this has been a standing,
unresolved limitation on every machine used to build this app so far. Symptoms: the dev server
either never finishes starting, or fails immediately with an AI-binding-related error. There is no
current workaround other than a token with that broader scope; in the meantime, every PR's
Cloudflare Pages preview URL is a full, real deployment (Workers AI included) and is the practical
way to test anything that touches `env.AI` — including `scripts/eval-generate.mjs`, which also
needs a working local dev server and has never been run against a real model for the same reason.

**A write or generation fails with `sign_in_required` or `no_household`.** Since M1c these need a
signed-in member of a household; the app opens the sign-in or household-setup dialog itself. If a
signed-in person still gets 401, their session expired and didn't refresh — signing out and in
again fixes it. `not_your_recipe` (403) means another household contributed that recipe; only it,
or the curator, can change it.

**The quota endpoint (`GET /api/recipes/generate/quota`) looks wrong.** It reads
`recipe_generations` directly (count today, site-wide and for the caller's household; a signed-out caller gets `requiresSignIn: true` and no personal count) — if
the numbers look stale, check the request actually reached this endpoint (not a cached response;
it sets `Cache-Control: no-store`) rather than assuming the underlying data is wrong.
