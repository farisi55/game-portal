const CACHE_NAME = 'arcade-portal-v2';
const APP_SHELL = [
  './',
  './index.html',
  './game.html',
  './manifest.json',
  './favicon.svg',
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

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.type !== 'basic' || response.status !== 200) {
          return response;
        }

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
