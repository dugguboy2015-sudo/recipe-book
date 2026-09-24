// M4: the service worker, so the app opens on patchy kitchen wifi and can live on a home screen.
//
// Deliberately runtime-only — no precache list. This project has no build step, so there is no
// hashed asset manifest to invalidate, and a hand-maintained precache list would go stale silently
// the first time someone forgot to bump it. Instead: network first, fall back to the cache. Online
// you always get the current file; offline you get the last one that worked.
//
// What is cached, and what is deliberately not:
//   - This site's own pages, CSS and JS: yes.
//   - The public recipe catalogue from Supabase: yes, so the kitchen still has the recipes.
//   - Anything private (a household's plan, settings, shopping list, members, auth): NO. Phones
//     get shared and accounts get signed out; household data is not left sitting in a cache.

const CACHE = 'recipe-book-v1';

const SUPABASE_ORIGIN = 'https://xtxufygmwqicrgzjwdxc.supabase.co';
// The public key every browser already holds (it is in js/config.js). supabase-js sends it as the
// bearer token when nobody is signed in, which is exactly the case whose responses are safe to
// keep: a signed-in member's reads can include their household's pending recipes, so those are
// left uncached rather than risk showing them to the next person on a shared phone.
const PUBLISHABLE_BEARER = 'Bearer sb_publishable_G7NG8ND3HlxS5FFdj57TBQ_WRdgc23V';
// The public catalogue: readable by anyone, identical for everyone, and the part worth having offline.
const PUBLIC_TABLES = /\/rest\/v1\/(recipes|recipe_ingredients|ingredients|ingredient_aliases|units|cuisines|recipe_stats|cuisine_counts|tag_counts|planner_candidates|recipe_dietary_derived)\b/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // One page so a cold, offline start still has something to render.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isCacheable(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin === self.location.origin) return true;
  if (url.origin === SUPABASE_ORIGIN) {
    if (!PUBLIC_TABLES.test(url.pathname)) return false;
    const auth = request.headers.get('Authorization');
    return !auth || auth === PUBLISHABLE_BEARER;
  }
  return false; // fonts, the Supabase library on its CDN, auth — straight to the network
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!isCacheable(event.request, url)) return;
  event.respondWith(networkFirst(event.request));
});
