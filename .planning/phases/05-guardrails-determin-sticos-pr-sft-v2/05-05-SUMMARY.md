---
phase: 5
plan: 05-05
subsystem: rag/guardrails
tags: [grd-04, claim-guard, tdd, oraculo, pre-sinistro, gap-closure]
dependency_graph:
  requires: [05-02]
  provides: [GRD-04-oraculo]
  affects: [answer.ts, stream.ts, /api/ask, /api/ask/stream]
tech_stack:
  added: []
  patterns: [regex-AND-two-groups, early-return-guard, WR-05-unicode-escapes]
key_files:
  created:
    - app/src/services/rag/claim-guard.ts
    - app/scripts/phase2/claim-guard.test.ts
  modified:
    - app/src/services/rag/answer.ts
    - app/src/services/rag/stream.ts
decisions:
  - AND de dois grupos de regex (evento concreto + veredicto) para evitar falsos positivos em perguntas conceituais
  - stripAccentsLower com ̀-ͯ (WR-05) — sem combining chars literais no fonte
  - early-return com model=claim-verdict-guard, tokensUsed=0, confidenceScore=1.0 (paridade com domain-guard)
metrics:
  duration: 35min
  completed: 2026-06-11
  tasks_completed: 2/2
  tests_passing: 18 (13 novos + 5 existentes verdes)
---

# Phase 5 Plan 05-05: Claim-Intent Guard (GRD-04 Canal Oráculo) Summary

GRD-04 determinístico no canal oráculo: detector regex AND-de-dois-grupos que bloqueia perguntas de veredicto sobre sinistro concreto em `/api/ask` e `/api/ask/stream`, retornando `model=claim-verdict-guard` com 0 tokens antes do LLM.

## Objective

Fechar gap G-10 do held-out gate: o oráculo estava endossando presunção de cobertura para sinistros concretos sem cláusula aplicável. O GRD-04 existia apenas no trilho `/api/pre-sinistro`; perguntas via `/api/ask` contornavam o guard por inteiro.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | claim-guard.ts + teste TDD | `6815d3b` | claim-guard.ts, claim-guard.test.ts |
| 2 | Wiring answer.ts + stream.ts | `378662e` | answer.ts, stream.ts |

## What Was Built

**`app/src/services/rag/claim-guard.ts`**
- `detectClaimVerdictIntent(question)`: true somente quando AMBOS os grupos casam:
  - `CLAIM_EVENT_RE`: evento concreto ocorrido (faleceu, sofreu acidente, parada cardíaca, fratura, internação, diagnóstico)
  - `VERDICT_RE`: pedido de veredicto (é coberto, pode presumir, a família recebe, veredito, acionar o seguro)
- `claimGuidanceMessage()`: resposta orientativa inconclusiva — nunca presume COBERTO/NÃO_COBERTO, direciona ao trilho pré-sinistro
- WR-05: `̀-ͯ` em vez de combining chars literais

**`app/scripts/phase2/claim-guard.test.ts`** — 13 testes:
- DISPARAM (true): G-09 verbatim, G-10 verbatim, infarto+família recebe, acidentou+acionar seguro
- NÃO DISPARAM (false): G-11, G-12, "O que é carência?", cotação, documentos pós-falecimento, CR-01 conceitual

**Wiring em answer.ts e stream.ts**: bloco GRD-04 inserido imediatamente após GRD-03 (domain-guard), antes do rate fast-path — em paridade exata entre os dois arquivos.

## Verification

- `claim-guard.test.ts`: 13/13 passed
- `domain-guard.test.ts`: 24/24 passed (regressão)
- `rate-unit-guard.test.ts`: 16/16 passed (regressão)
- `insurer-lexicon.test.ts`: 10/10 passed (regressão)
- `pre-sinistro-h11-guard.test.ts`: 7/7 passed (regressão)
- `npm run build`: exit 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Combining chars literais (WR-05) no Write tool**
- **Found during:** Task 1
- **Issue:** O Write tool materializou os combining chars literais na função `stripAccentsLower` do claim-guard.ts, que o plano proíbe explicitamente. O comentário da função também tinha o problema.
- **Fix:** Reescrita programática via Python usando `chr(92)` + concatenação para produzir `̀-ͯ` literais no arquivo.
- **Files modified:** `app/src/services/rag/claim-guard.ts`
- **Commit:** `6815d3b`

**2. [Rule 1 - Bug] CLAIM_EVENT_RE não cobria "faleceu ontem" sem sujeito explícito**
- **Found during:** Task 1 RED run — `"O cliente teve um infarto e faleceu ontem, a familia recebe o capital?"` retornando false
- **Issue:** O padrão exigia sujeito explícito contíguo ao verbo. "faleceu ontem" sem sujeito não casava.
- **Fix:** Adicionados padrões sem sujeito: `faleceu ontem`, `faleceu\b(?!\s+na\s+proposta)` e `parada cardiaca`.
- **Files modified:** `app/src/services/rag/claim-guard.ts`
- **Commit:** `6815d3b`

## Known Stubs

Nenhum — a mensagem de orientação é estática e completa.

## Threat Flags

Nenhum — o guard não expõe nova superfície: é regex puro que roda antes do LLM, sem eco de input do usuário na resposta.

## Self-Check: PASSED

- `app/src/services/rag/claim-guard.ts` — FOUND
- `app/scripts/phase2/claim-guard.test.ts` — FOUND
- commit `6815d3b` — FOUND
- commit `378662e` — FOUND
- `grep "presuma cobertura" claim-guard.ts` — FOUND (linha da mensagem de alerta)
- `grep "detectClaimVerdictIntent" answer.ts` — 2 ocorrências (import + uso)
- `grep "detectClaimVerdictIntent" stream.ts` — 2 ocorrências (import + uso)
- `grep "claim-verdict-guard" answer.ts` — FOUND
- `grep "claim-verdict-guard" stream.ts` — FOUND
- Ordem em answer.ts: domain-guard (180) → claim-guard (193) → rate (223) — CORRETO
- Ordem em stream.ts: domain-guard (83) → claim-guard (98) → rate (113) — CORRETO
- `npm run build` — exit 0
