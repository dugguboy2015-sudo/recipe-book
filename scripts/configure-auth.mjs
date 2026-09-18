// Applies the Supabase Auth settings the M1b sign-in flow depends on, via the Management API.
// Dry run by default (prints the differences); `--apply` writes them. Only the keys below are ever
// read back or printed — the full auth config also holds provider secrets.
//
//   node scripts/configure-auth.mjs            # show what would change
//   node scripts/configure-auth.mjs --apply    # change it
import { loadEnv } from './lib/env.mjs';

const env = loadEnv({ required: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'] });
const apply = process.argv.includes('--apply');

const SITE = 'https://recipe-book-9eo.pages.dev';

// Branded emails carrying both the link and a 6-digit code. Supabase refuses template changes on
// free-tier projects that use its built-in mailer (HTTP 400, checked 2026-09-18), so these are only
// applied once a custom SMTP provider is configured; until then the default templates (link only)
// are used, which the implicit flow still makes work cross-device.
function emailBody(heading, intro) {
  return `<h2>${heading}</h2>
<p>${intro}</p>
<p><a href="{{ .ConfirmationURL }}">Sign in to Recipe Book</a></p>
<p>Or enter this code on the sign-in screen:</p>
<p style="font-size:24px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
<p>The link and code work once and expire in an hour. If you didn't ask to sign in, you can ignore this email.</p>`;
}

const urls = {
  site_url: SITE,
  // Production, every preview deployment (branch and commit aliases), and local `npm run dev`.
  uri_allow_list: [`${SITE}/**`, 'https://*.recipe-book-9eo.pages.dev/**', 'http://localhost:8788/**'].join(','),
  mailer_otp_exp: 3600,
};

const templates = {
  mailer_otp_length: 6,
  mailer_subjects_magic_link: 'Your Recipe Book sign-in code',
  mailer_templates_magic_link_content: emailBody('Sign in to Recipe Book', 'Tap the button below to sign in.'),
  mailer_subjects_confirmation: 'Welcome to Recipe Book — your sign-in code',
  mailer_templates_confirmation_content: emailBody('Welcome to Recipe Book', 'Tap the button below to finish signing in for the first time.'),
};

const endpoint = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`;
const headers = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };

const current = await fetch(endpoint, { headers });
if (!current.ok) throw new Error(`Reading auth config failed: HTTP ${current.status}`);
const config = await current.json();

const desired = config.smtp_host ? { ...urls, ...templates } : urls;
if (!config.smtp_host) console.log('No custom SMTP configured: leaving the default email templates in place.\n');
const changes = Object.entries(desired).filter(([key, value]) => config[key] !== value);
if (changes.length === 0) {
  console.log('Auth config already up to date.');
  process.exit(0);
}
for (const [key, value] of changes) {
  const show = (v) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}...` : JSON.stringify(v));
  console.log(`${key}: ${show(config[key])} -> ${show(value)}`);
}
if (!apply) {
  console.log('\nDry run. Re-run with --apply to write these.');
  process.exit(0);
}

const response = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(Object.fromEntries(changes)) });
if (!response.ok) throw new Error(`Updating auth config failed: HTTP ${response.status} ${await response.text()}`);
console.log(`\nApplied ${changes.length} change(s).`);
