---
phase: 8
plan: 08-01
subsystem: shell-motion
tags: [motion, pwa, accessibility, haptics, page-transition, ambient]
dependency_graph:
  requires: []
  provides: [page-transition, ambient-drift, tap-haptic, mobile-header]
  affects: [app-shell, ambient-background, globals.css, all-views]
tech_stack:
  added: [haptics.ts, page-transition.tsx, template.tsx]
  patterns: [enter-only page transition, ambient drift CSS, navigator.vibrate guard]
key_files:
  created:
    - app/src/components/ui/page-transition.tsx
    - app/src/app/(app)/template.tsx
    - app/src/lib/haptics.ts
  modified:
    - app/src/components/app-shell.tsx
    - app/src/components/ui/ambient-background.tsx
    - app/src/app/globals.css
    - app/src/components/dashboard/dashboard-home.tsx
    - app/src/components/dashboard/focus-action-card.tsx
    - app/src/components/chat/chat-view.tsx
    - app/src/components/dashboard/alerts-view.tsx
    - app/src/components/pre-sinistro/pre-sinistro-view.tsx
    - app/src/components/dashboard/profile-view.tsx
    - app/src/components/dashboard/client-detail-view.tsx
    - app/src/components/dashboard/knowledge-view.tsx
    - app/src/components/comparador/comparador-view.tsx
    - app/package.json
decisions:
  - "enter-only PageTransition (sem AnimatePresence de saída) — App Router desmonta antes, evita flash"
  - "ambient drift em CSS puro (@keyframes) — não depende de JS/React, mais performático"
  - "navigator.vibrate(8ms) sem lib — iOS no-op silencioso, zero overhead"
  - "pt-14 no <main> mobile compensa MobileHeader sem tocar em todos os componentes de conteúdo"
metrics:
  duration: "~45 min"
  completed: "2026-06-13"
  tasks_completed: 4
  files_changed: 13
---

# Phase 8 Plan 01: Shell Motion Layer Summary

**One-liner:** Camada de movimento premium sobre o shell existente — page transition fade+lift, ambient drift CSS, haptic nav tap e mobile header contextual, com bundle unificado em motion/react e todas as animações gated em prefers-reduced-motion.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Unificar motion lib (SHL-02) | d6146c5 | 9 components + package.json |
| 2 | Transição de página (SHL-01) | a2ab5db | page-transition.tsx, template.tsx |
| 3 | Ambient vivo + haptics (SHL-03, SHL-04) | 20739fe | globals.css, ambient-background.tsx, haptics.ts, app-shell.tsx |
| 4 | Header contextual mobile (SHL-05) | 1574a58 | app-shell.tsx |

## Decisions Made

1. **enter-only PageTransition** — App Router desmonta o componente antes que AnimatePresence de saída termine, causando flash. Enter-only (key=pathname, sem AnimatePresence) é o padrão robusto.

2. **ambient drift em CSS puro** — @keyframes dentro de `@media (prefers-reduced-motion: no-preference)` significa que a animação nem compila quando o usuário optou por reduzir movimento. Mais seguro do que gate via JS/useReducedMotion.

3. **navigator.vibrate(8ms) sem lib** — API nativa com guard `"vibrate" in navigator`. iOS ignora silenciosamente. Zero kB de overhead.

4. **pt-14 md:pt-0 no main** — Compensa o MobileHeader sem tocar nos muitos componentes que usam `safe-top`. O padding resultante é generoso mas sem sobreposição de conteúdo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Scope expansion] framer-motion em 8 componentes adicionais**
- **Found during:** Task 1
- **Issue:** O plano mencionava apenas `dashboard-home.tsx` como arquivo conhecido com `framer-motion`. O grep revelou 8 outros componentes com o mesmo import.
- **Fix:** Todos os 9 arquivos foram migrados para `motion/react` antes do `npm uninstall`. Build confirmou zero quebras.
- **Files modified:** focus-action-card.tsx, chat-view.tsx, alerts-view.tsx, pre-sinistro-view.tsx, profile-view.tsx, client-detail-view.tsx, knowledge-view.tsx, comparador-view.tsx
- **Commit:** d6146c5

## Acceptance Criteria Check

- grep `from "framer-motion"` app/src: **0 ocorrências**
- grep `"framer-motion"` app/package.json: **0 ocorrências**
- template.tsx existe e usa PageTransition: **PASS**
- page-transition.tsx contém useReducedMotion e [0.22, 1, 0.36, 1]: **PASS**
- globals.css contém @keyframes ambient-drift e bloco no-preference: **PASS**
- app/src/lib/haptics.ts contém "vibrate" e "in navigator": **PASS**
- app-shell.tsx importa tapHaptic e usa em onClick; contém active:scale: **PASS**
- app-shell.tsx contém function MobileHeader e `<MobileHeader`: **PASS**
- MobileHeader usa md:hidden e safe-top/safe-area: **PASS**
- main mobile compensa altura do header (pt-14 md:pt-0): **PASS**
- npm run build exit 0 (4× verificado, uma por task): **PASS**

## Known Stubs

Nenhum. Todos os entregáveis estão funcionais e conectados.

## Threat Flags

Nenhum novo endpoint, rota de auth, acesso a arquivo ou mudança de schema introduzida.

## Self-Check: PASSED

- app/src/components/ui/page-transition.tsx: FOUND
- app/src/app/(app)/template.tsx: FOUND
- app/src/lib/haptics.ts: FOUND
- Commits d6146c5, a2ab5db, 20739fe, 1574a58: todos presentes no log
