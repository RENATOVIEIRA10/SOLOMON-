---
phase: 07-pwa-producao
reviewed: 2026-06-12T03:51:03Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - app/public/sw.js
  - app/src/components/sw-register.tsx
  - app/src/app/layout.tsx
  - app/next.config.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
fixes:
  fixed: [WR-01, WR-02, WR-03]
  fixed_at: 2026-06-12
---

# Phase 07: Code Review Report — PWA Produção

**Reviewed:** 2026-06-12T03:51:03Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Review do service worker vanilla (substituindo @serwist/turbopack) + registro + metadata PWA, num app Next.js 16 com dashboard autenticado (Supabase SSR) e API LLM paga. Foco em vazamento de conteúdo autenticado via cache, compatibilidade com App Router (RSC) e robustez do fetch handler.

**O risco nº 1 (cache de conteúdo autenticado) está corretamente mitigado:**

- Documents (`destination === 'document'`) são network-first sem `cache.put` — nenhum HTML logado entra no Cache Storage (`sw.js:42-47`).
- O guard `/api/` (`sw.js:39`) vem ANTES do handler de assets, então nenhuma rota de API pode ser capturada pelo branch de assets, independente do destination.
- Requests RSC do App Router (soft navigations e prefetches, `?_rsc=`, header `RSC: 1`) têm `destination === ''` — não casam com nenhum branch e passam ilesos ao network. Navegação client-side e prefetch de rota não quebram nem são cacheados.
- Respostas cross-origin/opaque nunca entram no cache: opaque tem `response.ok === false` e há check explícito de `url.origin === self.location.origin` (`sw.js:57`) — sem risco de inflar quota com opaques.
- `app/src/app/auth/signout/route.ts` (única rota fora de `/api/`) responde a GET como navegação (`document` → network-first, sem cache) ou fetch (`destination ''` → pass-through). Sem risco.
- Registro só em produção (`sw-register.tsx:10`); `layout.tsx` sem SerwistProvider, `<SwRegister />` corretamente posicionado no body do root layout.
- Coerência manifest/viewport OK: `theme_color`/`background_color` `#0A0A0A` == `viewport.themeColor`; `viewportFit: cover` tem safe-areas definidas em `globals.css:134-137`.

Os problemas encontrados são de staleness/crescimento de cache e robustez do handler — nenhum vaza dados, mas degradam o produto ao longo de deploys.

## Warnings

### WR-01: Cache-first sem revalidação + CACHE_VERSION estático = assets stale para sempre e cache que só cresce

**Status:** fixed (2026-06-12, branch feat/pwa-producao) — SWR para assets não-hasheados (`/public`, `/_next/image`) com revalidação em background via `event.waitUntil`; cache-first puro mantido só para `/_next/static/` (immutable). Caches divididos em `solomon-precache-v1` + `solomon-runtime` com limite FIFO de 60 entradas; cleanup do `activate` usa allowlist das duas.

**File:** `app/public/sw.js:1, 49-63`
**Issue:** O comentário na linha 49 diz "cache-first with revalidation", mas **não há revalidação nenhuma** — uma vez cacheado, o asset é servido do cache até a versão mudar. Combinado com `CACHE_VERSION = 'solomon-v1'` fixo:

1. Assets de `/public` sem hash no nome (`/icon-512.png`, `/solomon-wordmark.png`, `/solomon-avatar.png`) e variantes de `/_next/image?url=...&w=...` ficam stale indefinidamente. Se uma imagem for substituída mantendo o filename, usuários nunca veem a nova.
2. Entre deploys, o cleanup do `activate` é no-op (mesmo nome de cache), então chunks hasheados `/_next/static/*` de builds antigos acumulam para sempre — crescimento sem limite até o browser evictar por pressão de storage (e a eviction leva junto o `/~offline`, ver WR-03).

Para `/_next/static/*` (immutable, content-hashed) cache-first puro está correto; o problema é aplicar a mesma estratégia a URLs mutáveis.

**Fix:**
```js
// Opção A (mínima): cache-first só para conteúdo imutável; SWR para o resto
const isImmutable = url.pathname.startsWith('/_next/static/');
if (isImmutable && cached) return cached;
if (cached) {
  // stale-while-revalidate para /public e /_next/image
  event.waitUntil(
    fetch(request)
      .then((r) => { if (r.ok) return cache.put(request, r); })
      .catch(() => {})
  );
  return cached;
}
```
Adicionalmente, injetar a versão no build (ex.: `const CACHE_VERSION = 'solomon-' + BUILD_ID;` via script de build que reescreve o sw.js, ou bump manual documentado a cada deploy) para que o `activate` realmente limpe builds antigos.

### WR-02: Fetch handler intercepta schemes não-http e não trata erro de fetch — respondWith rejeita

**Status:** fixed (2026-06-12, branch feat/pwa-producao) — guard same-origin no início do fetch handler (`request.url.startsWith(self.location.origin)`) descarta chrome-extension://, blob: e cross-origin; fetch do branch de assets em try/catch com fallback `caches.match(request)` e `Response.error()` como último recurso.

**File:** `app/public/sw.js:50-63`
**Issue:** Dois buracos de robustez no branch de assets:

1. Requests `chrome-extension://` (recursos injetados por extensões) podem ter `destination` 'script'/'image' e caem no handler. `fetch()` de scheme não-http dentro do SW rejeita → o recurso da extensão falha com erro de SW em vez de ser ignorado.
2. `await fetch(request)` sem try/catch: offline com cache miss, a promise passada ao `respondWith` rejeita → "network error" + unhandled rejection no console. O resultado prático é igual a não ter SW, mas polui logs e mascara erros reais; para imagens já vistas seria possível degradar melhor.

**Fix:**
```js
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return; // chrome-extension://, blob:, etc.
  // ...
  // e no branch de assets:
  try {
    const response = await fetch(request);
    if (response.ok && url.origin === self.location.origin) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached ?? Response.error();
  }
});
```

### WR-03: Fallback offline pode resolver para `undefined` → network error em vez da página offline

**Status:** fixed (2026-06-12, branch feat/pwa-producao) — se `caches.match('/~offline')` vier `undefined`, retorna `Response` 503 com HTML mínimo inline ("SOLOMON — você está offline. Reconecte para continuar.", `text/html; charset=utf-8`).

**File:** `app/public/sw.js:43-45`
**Issue:** `caches.match('/~offline')` retorna `undefined` se a entrada não existir — cenário real: eviction por pressão de storage (agravado pelo crescimento sem limite do WR-01) ou precache que falhou silenciosamente após um update. `respondWith(Promise<undefined>)` vira network error genérico — exatamente a experiência que o `/~offline` deveria evitar, e falha só em campo (offline), onde não há telemetria.

**Fix:**
```js
event.respondWith(
  fetch(request).catch(async () => {
    const offline = await caches.match('/~offline');
    return (
      offline ??
      new Response('<h1>Sem conexão</h1>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
  })
);
```

## Info

### IN-01: Listener `controllerchange` vazio e sem cleanup

**File:** `app/src/components/sw-register.tsx:18-20`
**Issue:** O listener registrado não faz nada (corpo vazio) e o `useEffect` não retorna cleanup. Em produção o componente monta uma vez no root layout, então o leak é teórico — mas é dead code que sugere um update-flow que não existe.
**Fix:** Remover o `addEventListener` por completo, ou implementar de fato (ex.: toast "Nova versão disponível"). Se mantiver, retornar cleanup: `return () => navigator.serviceWorker.removeEventListener('controllerchange', handler);`.

### IN-02: Guard `typeof navigator !== "undefined"` redundante

**File:** `app/src/components/sw-register.tsx:8`
**Issue:** `useEffect` só roda no client; `navigator` sempre existe ali. O check `"serviceWorker" in navigator` é suficiente.
**Fix:** Remover a condição redundante.

### IN-03: `appleWebApp.startupImage` com ícone genérico será ignorado pelo iOS

**File:** `app/src/app/layout.tsx:49-52`
**Issue:** `apple-touch-startup-image` exige imagens com dimensões exatas por device (media queries); um PNG 512x512 único é ignorado ou distorcido. O comentário já reconhece como follow-up de design — registrando para rastreio.
**Fix:** Gerar o set device-specific (ex.: via `pwa-asset-generator`) ou remover `startupImage` até lá (iOS usa `background_color` como fallback).

### IN-04: Ícones `maskable` reutilizam o asset `purpose: any` — risco de corte na safe zone

**File:** `app/public/manifest.json:26-37`
**Issue:** Maskable icons são cortados em formas (círculo, squircle) e exigem ~20% de padding de safe zone. Reusar o mesmo PNG de `purpose: any` pode cortar o wordmark/símbolo no launcher Android.
**Fix:** Gerar variantes maskable dedicadas com padding (validar em https://maskable.app) ou, até lá, declarar só `purpose: "any"`.

### IN-05: Precache usa modo de cache HTTP default — pode precachear cópia stale

**File:** `app/public/sw.js:13`
**Issue:** `cache.addAll(PRECACHE_URLS)` fetcha com `cache: 'default'`, podendo armazenar uma cópia vinda do HTTP cache do browser (potencialmente velha) em vez da rede. Para `/~offline` (HTML de rota Next) isso pode congelar uma versão antiga no precache.
**Fix:** `cache.addAll(PRECACHE_URLS.map((u) => new Request(u, { cache: 'reload' })))`.

### IN-06: Update flow (skipWaiting + claim) — janela de inconsistência avaliada: severidade baixa no estado atual

**File:** `app/public/sw.js:15, 28`
**Issue:** Análise do risco pedido no escopo: com `CACHE_VERSION` constante, o cleanup do `activate` é no-op entre deploys — a janela "SW novo deleta cache da página antiga aberta" **não se materializa hoje**. Quando a versão for bumpada (necessário pelo WR-01), páginas antigas abertas perderão o cache v1, mas como documents são network-first e assets são content-hashed, elas caem para a rede e seguem funcionais (degradação só se offline exatamente nesse instante). `skipWaiting` sem force-reload é decisão consciente e correta para não interromper resposta do oráculo em andamento.
**Fix:** Nenhuma ação obrigatória. Opcional: ao implementar bump de versão, mover `clients.claim()` para dentro do `waitUntil` (encadeado após o cleanup) para ordem determinística.

---

_Reviewed: 2026-06-12T03:51:03Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
