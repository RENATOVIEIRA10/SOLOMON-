const CACHE_VERSION = 'solomon-v1';

const PRECACHE_URLS = [
  '/~offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/solomon-wordmark.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // (a) Non-GET: pass through
  if (request.method !== 'GET') return;

  // (b) API routes: NEVER cache — oracle responses are dynamic and authenticated
  if (url.pathname.startsWith('/api/')) return;

  // (c) Document navigation: network-first, fallback to /~offline
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/~offline'))
    );
    return;
  }

  // (d) Static assets (style/script/font/image): cache-first with revalidation
  if (['style', 'script', 'font', 'image'].includes(request.destination)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        // Only cache same-origin 200 responses
        if (response.ok && url.origin === self.location.origin) {
          cache.put(request, response.clone());
        }
        return response;
      })
    );
  }
});
