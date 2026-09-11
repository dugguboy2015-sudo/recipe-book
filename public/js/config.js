export const SUPABASE_URL = 'https://xtxufygmwqicrgzjwdxc.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_G7NG8ND3HlxS5FFdj57TBQ_WRdgc23V';

// Turnstile test keys always pass (Cloudflare docs); used only on localhost dev, never in production.
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_LIVE_SITE_KEY = '0x4AAAAAAEve4iXZ3aK_SGq7';

const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
export const TURNSTILE_SITE_KEY = isLocalHost ? TURNSTILE_TEST_SITE_KEY : TURNSTILE_LIVE_SITE_KEY;
