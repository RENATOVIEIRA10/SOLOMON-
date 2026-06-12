---
phase: 7
plan: "07-01"
subsystem: pwa
tags: [pwa, service-worker, offline, ios, android, serwist-removal]
dependency_graph:
  requires: []
  provides: [pwa-sw-vanilla, pwa-offline-fallback, pwa-ios-polish]
  affects: [app/public/sw.js, app/src/components/sw-register.tsx, app/src/app/layout.tsx, app/next.config.ts]
tech_stack:
  added: []
  removed: ["@serwist/turbopack (29 packages)"]
  patterns: ["vanilla service worker", "network-first documents", "cache-first static assets", "production-only SW registration"]
key_files:
  created:
    - app/public/sw.js
    - app/src/components/sw-register.tsx
  modified:
    - app/src/app/layout.tsx
    - app/next.config.ts
    - app/package.json
  deleted:
    - app/src/sw.ts
    - app/src/app/serwist.ts
decisions:
  - "SW vanilla estático em public/ em vez de gerado por toolchain: imune a churn Next/Turbopack, existe em dev e prod igualmente"
  - "Sem reload forçado no controllerchange: evita interromper resposta do oráculo em andamento"
  - "Nunca cachear /api/*: respostas do oráculo são dinâmicas e autenticadas"
  - "startupImage genérica /icon-512.png: set completo por device é follow-up de design"
metrics:
  duration: "~25 min"
  completed: "2026-06-12T03:46:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 7
---

# Phase 7 Plan 01: PWA Produção (SW Vanilla + iOS Polish) Summary

Substituição completa do `@serwist/turbopack` por service worker vanilla estático em `public/sw.js` com registro próprio, garantindo que o SW exista em produção (antes: 404 em prod); adicionado `startupImage` para splash iOS.

## Tasks Executadas

| Task | Nome | Commit | Arquivos-chave |
|------|------|--------|----------------|
| 1 | public/sw.js vanilla + registro próprio | `7c4d493` | app/public/sw.js, app/src/components/sw-register.tsx, app/src/app/layout.tsx, app/next.config.ts, app/package.json |
| 2 | Polish nativo iOS/Android (splash + viewport) | `8500309` | app/src/app/layout.tsx |

## Acceptance Criteria — Resultado

| Critério | Status |
|----------|--------|
| app/public/sw.js contém `skipWaiting` | PASS |
| app/public/sw.js contém `clients.claim` | PASS |
| app/public/sw.js contém `'/~offline'` | PASS |
| app/public/sw.js contém `startsWith('/api/')` | PASS |
| grep "serwist" app/src retorna 0 | PASS |
| grep "serwist" next.config.ts retorna 0 | PASS |
| grep "@serwist" package.json retorna 0 | PASS |
| layout.tsx contém `<SwRegister` | PASS |
| layout.tsx NÃO contém SerwistProvider | PASS |
| npm run build exit 0 (Task 1) | PASS |
| npm run build exit 0 (Task 2) | PASS |
| npm run dev + curl /sw.js → 200 | PASS (porta 3001, conteúdo correto) |
| export viewport com viewportFit: "cover" e themeColor | PASS (já existia) |
| layout.tsx contém startupImage | PASS |

## Decisões Tomadas

1. **SW vanilla vs toolchain**: `@serwist/turbopack` servia sw.js virtualmente apenas em dev — em produção retornava 404. Arquivo estático em `public/` é servido em qualquer ambiente sem configuração adicional.

2. **Sem reload forçado no controllerchange**: O SW novo ativa via `skipWaiting` + `clients.claim`. Forçar reload em `controllerchange` interromperia respostas SSE do oráculo em andamento — decisão deliberada de omitir.

3. **Cache granular**:
   - `/api/*` → nunca interceptado (respostas autenticadas/dinâmicas do oráculo)
   - `destination === 'document'` → network-first com fallback `/~offline`
   - `style|script|font|image` → cache-first com revalidação same-origin 200 only

4. **viewport já estava correto**: `themeColor`, `viewportFit: "cover"`, `initialScale: 1` já existiam. Task 2 apenas adicionou `startupImage`.

## Known Stubs

- **startupImage genérica**: `app/src/app/layout.tsx` linha ~50 — entrada única `/icon-512.png`. Set completo com dimensões por device (iPhone 14 Pro, iPad, etc.) requer design follow-up. Funcional como splash básico mas não otimizado para todos os modelos iOS.

## Deviations from Plan

None — plano executado exatamente como especificado.

## Threat Flags

Nenhuma nova superfície introduzida. O SW respeita o threat model do plano:
- `/api/*` nunca passa pelo cache (autenticação preservada)
- `cache.put` apenas para respostas `ok` e same-origin (sem cache poisoning cross-origin)
- `skipWaiting` + cache versionado + limpeza no activate (sem SW velho preso)

## Self-Check: PASSED

- app/public/sw.js: FOUND
- app/src/components/sw-register.tsx: FOUND
- .planning/phases/07-pwa-producao/07-01-SUMMARY.md: FOUND
- Commit 7c4d493: FOUND
- Commit 8500309: FOUND
- app/src/app/serwist.ts: CONFIRMED DELETED
- app/src/sw.ts: CONFIRMED DELETED
