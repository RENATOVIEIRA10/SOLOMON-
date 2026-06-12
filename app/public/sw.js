// Caches:
// - PRECACHE: assets de offline (bump manual da versao em mudancas de estrategia/assets)
// - RUNTIME: assets capturados em runtime, com limite FIFO de entradas
const PRECACHE = 'solomon-precache-v1';
const RUNTIME = 'solomon-runtime';
const RUNTIME_MAX_ENTRIES = 60;

const PRECACHE_URLS = [
  '/~offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/solomon-wordmark.png',
];

// Ultimo recurso se o precache de /~offline foi evictado pelo browser (WR-03)
const OFFLINE_FALLBACK_HTML =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>SOLOMON — offline</title></head>' +
  '<body style="background:#0A0A0A;color:#fff;font-family:system-ui,sans-serif;' +
  'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px">' +
  '<p>SOLOMON — você está offline. Reconecte para continuar.</p></body></html>';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const allowlist = [PRECACHE, RUNTIME];
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => !allowlist.includes(name))
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// FIFO simples: cache.keys() retorna em ordem de insercao — remove as mais antigas
async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= RUNTIME_MAX_ENTRIES) return;
  await Promise.all(
    keys.slice(0, keys.length - RUNTIME_MAX_ENTRIES).map((key) => cache.delete(key))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // (a) Non-GET: pass through
  if (request.method !== 'GET') return;

  // (b) Same-origin only — ignora chrome-extension://, blob: e cross-origin (WR-02).
  //     Garante o invariante: nada fora da nossa origem entra no cache.
  if (!request.url.startsWith(self.location.origin)) return;

  const url = new URL(request.url);

  // (c) API routes: NUNCA interceptadas — respostas do oraculo sao dinamicas e autenticadas
  if (url.pathname.startsWith('/api/')) return;

  // (d) Document navigation: network-first, NUNCA entra em cache.put.
  //     Offline → /~offline do precache; se evictado, HTML minimo inline (WR-03).
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match('/~offline');
        return (
          offline ??
          new Response(OFFLINE_FALLBACK_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        );
      })
    );
    return;
  }

  // (e) Static assets (style/script/font/image):
  //     - /_next/static/* (content-hashed, immutable): cache-first puro
  //     - demais (/public, /_next/image): stale-while-revalidate (WR-01)
  if (['style', 'script', 'font', 'image'].includes(request.destination)) {
    const isImmutable = url.pathname.startsWith('/_next/static/');
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        // RUNTIME primeiro (copia revalidada vence a do precache), depois global
        const cached = (await cache.match(request)) ?? (await caches.match(request));

        if (cached && isImmutable) return cached;

        if (cached) {
          // SWR: responde do cache e revalida em background
          event.waitUntil(
            fetch(request)
              .then(async (response) => {
                // Mesma origem garantida pelo guard (b); so respostas 200 entram
                if (response.ok) {
                  await cache.put(request, response.clone());
                  await trimRuntimeCache(cache);
                }
              })
              .catch(() => {})
          );
          return cached;
        }

        // Cache miss: rede, com fallback ao cache como ultimo recurso (WR-02)
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response.clone());
            event.waitUntil(trimRuntimeCache(cache));
          }
          return response;
        } catch (err) {
          const fallback = await caches.match(request);
          return fallback ?? Response.error();
        }
      })()
    );
  }
});
