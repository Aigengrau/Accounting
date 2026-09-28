/**
 * Service worker: makes the app installable and fully usable offline.
 *
 * Strategy is cache-first for the app shell, because the shell only changes when
 * a new version is deployed, and there is no dynamic content to fetch — all data
 * lives in IndexedDB on the device.
 *
 * Bump CACHE_VERSION on deploy to roll the cache.
 */

const CACHE_VERSION = 'aoiro-v1';

/** Relative to the service worker's scope, so a GitHub Pages sub-path works. */
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/components.css',
  'css/views.css',
  'js/app.js',
  'js/store.js',
  'js/db.js',
  'js/derive.js',
  'js/fx.js',
  'js/ui/dom.js',
  'js/ui/charts.js',
  'js/ui/icons.js',
  'js/tax/rates.js',
  'js/tax/engine.js',
  'js/tax/sourcing.js',
  'js/tax/advisor.js',
  'js/accounting/accounts.js',
  'js/accounting/journal.js',
  'js/accounting/reports.js',
  'js/accounting/depreciation.js',
  'js/views/dashboard.js',
  'js/views/transactions.js',
  'js/views/entry.js',
  'js/views/tax.js',
  'js/views/advisor.js',
  'js/views/reports.js',
  'js/views/calendar.js',
  'js/views/settings.js',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Added one at a time so a single 404 cannot fail the whole install.
    await Promise.all(SHELL.map(async (path) => {
      try {
        await cache.add(new Request(path, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] could not cache', path, err);
      }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache cross-origin requests. The only one the app makes is the optional
  // reference-rate lookup, which must always be live and must fail soft offline.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      // Refresh in the background so the next load picks up a new deploy.
      event.waitUntil(refresh(request));
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      // Offline and not cached. Navigations fall back to the app shell so the
      // SPA can still route; anything else simply fails.
      if (request.mode === 'navigate') {
        const shell = await caches.match('index.html')
          || await caches.match('./');
        if (shell) return shell;
      }
      return new Response('Offline and not cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  })());
});

async function refresh(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response);
    }
  } catch {
    // Offline. The cached copy stands.
  }
}
