export async function verifyTurnstile(token, ip, secret) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) {
    return { ok: false, codes: ['missing-input-response'] };
  }
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!res.ok) return { ok: false, codes: [`siteverify-http-${res.status}`] };
  const out = await res.json();
  return { ok: out.success === true, codes: out['error-codes'] || [], hostname: out.hostname };
}
