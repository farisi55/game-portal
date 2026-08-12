const CACHE_NAME = 'gimboot-portal-v1';
const APP_SHELL = [
  './',
  './index.html',
  './game.html',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './css/style.css',
  './js/config.js',
  './js/utils.js',
  './js/catalog.js',
  './js/player.js',
  './js/pwa.js',
  './games/kicau-mania/index.html',
  './games/kicau-mania/style.css',
  './games/kicau-mania/game.js',
  './games/kicau-mania/thumb.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return;
  }

  if (!['http:', 'https:'].includes(requestUrl.protocol)) return;

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }

  // Stale-while-revalidate: answer from cache immediately if we have it
  // (fast, and works offline), but ALWAYS also fetch a fresh copy in the
  // background and update the cache for next time. Plain cache-first meant
  // an updated file (e.g. js/config.js after adding a new game) could stay
  // stuck stale in a returning visitor's cache indefinitely, since nothing
  // ever re-triggers the install step unless sw.js's own bytes change —
  // this makes every update self-correct on the very next load instead.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
