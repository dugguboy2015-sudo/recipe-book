import { TURNSTILE_SITE_KEY } from '../config.js';

let scriptPromise = null;
let widgetId = null;
let pending = null; // { resolve, reject } for the in-flight getToken() call, if any

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function ensureWidget(container) {
  await loadScript();
  if (widgetId !== null) return widgetId;
  widgetId = window.turnstile.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    appearance: 'interaction-only',
    execution: 'execute',
    callback: (token) => {
      pending?.resolve(token);
      pending = null;
    },
    'error-callback': () => {
      pending?.reject(new Error('Turnstile verification failed.'));
      pending = null;
    },
    'expired-callback': () => {
      pending?.reject(new Error('Turnstile token expired.'));
      pending = null;
    },
  });
  return widgetId;
}

/** Renders the widget into `container` (lazily, once) and resolves a single-use token. */
export async function getToken(container) {
  const id = await ensureWidget(container);
  try {
    return await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pending = null;
        reject(new Error('Turnstile timed out.'));
      }, 30_000);
      pending = {
        resolve: (token) => { clearTimeout(timeoutId); resolve(token); },
        reject: (err) => { clearTimeout(timeoutId); reject(err); },
      };
      window.turnstile.execute(id);
    });
  } finally {
    window.turnstile.reset(id); // tokens are single-use
  }
}
