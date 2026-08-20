/**
 * Service worker — makes the app work with no connection at all.
 *
 * App shell: cache-first, refreshed in the background.
 * Data JSON:  network-first, falling back to cache when offline.
 * Remote photos:      cache-first, fetched and stored on first view.
 *
 * CACHE_VERSION is stamped automatically by tools/build-data.mjs on every
 * build, so a rebuild always invalidates stale caches.
 */

const CACHE_VERSION = 'vg-20260820125333';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const PHOTO_CACHE = CACHE_VERSION + '-photos';
const PHOTO_LIMIT = 600;

const SHELL = [
  './',
  './index.html',
  './app.webmanifest',
  './css/styles.css',
  './js/main.js',
  './js/data.js',
  './js/state.js',
  './js/scoring.js',
  './js/images.js',
  './js/util/dom.js',
  './js/util/storage.js',
  './js/ui/components.js',
  './js/ui/setup.js',
  './js/ui/criteria.js',
  './js/ui/results.js',
  './js/ui/detail.js',
  './js/ui/compare.js',
  './data/criteria.json',
  './data/destinations.json',
  './data/meta.json',
  './data/origins.json',
  './data/photos.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll fails the whole install if any single file 404s; photos.json is
    // optional until the photo tool has run, so add them individually.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('vg-') && !k.startsWith(CACHE_VERSION))
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin) {
    // Remote photos: serve from cache, otherwise fetch and keep a copy.
    event.respondWith(photoStrategy(req));
    return;
  }

  // Data changes every time the catalogue is rebuilt, so it must be
  // network-first. Serving it cache-first pinned returning visitors to whatever
  // data existed on their very first visit — including a photos.json that was
  // only a fraction resolved.
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(dataStrategy(req));
    return;
  }

  event.respondWith(shellStrategy(req));
});

/** Fresh data when online; last known good data when not. */
async function dataStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      return res;
    }
    throw new Error('bad response');
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
  }
}

async function shellStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });

  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);

  if (hit) {
    network;                       // refresh in the background
    return hit;
  }
  const res = await network;
  if (res) return res;

  // Offline and never cached — for a navigation, fall back to the shell.
  if (req.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  return new Response('Offline and not cached', { status: 503, statusText: 'Offline' });
}

async function photoStrategy(req) {
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;

  try {
    const res = await fetch(req);
    if (res && res.ok && res.type !== 'opaque') {
      await cache.put(req, res.clone());
      trimCache(cache, PHOTO_LIMIT);
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Photo unavailable offline' });
  }
}

/** Crude FIFO eviction so the photo cache cannot grow without bound. */
async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const k of keys.slice(0, keys.length - limit)) await cache.delete(k);
}
