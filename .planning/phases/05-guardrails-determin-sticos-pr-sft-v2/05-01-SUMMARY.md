---
phase: 05-guardrails-determin-sticos-pr-sft-v2
plan: "01"
subsystem: rag-guardrails
tags: [guardrail, rate-lookup, unit-validation, llm-arithmetic-block, grd-01, tdd]
dependency_graph:
  requires: []
  provides: [assertRateUnit, llmArithmeticBlocked, rate-unit-guard-test]
  affects: [answer.ts, stream.ts, rate-lookup.ts]
tech_stack:
  added: []
  patterns:
    - assertRateUnit — throw high com prefixo [grd-01] para unidade desconhecida
    - llmArithmeticBlocked — flag derivada de rateIntentDetected para injetar secao PROIBIDO no systemPrompt
key_files:
  created:
    - app/scripts/phase2/rate-unit-guard.test.ts
  modified:
    - app/src/services/rag/rate-lookup.ts
    - app/src/services/rag/answer.ts
    - app/src/services/rag/stream.ts
decisions:
  - assertRateUnit exportado publicamente; formatCapitalPremiumLine sempre valida antes de calcular
  - llmArithmeticBlocked derivado de rateIntentDetected existente (sem nova variavel de estado)
  - Texto PROIBIDO concatenado no promptTemplate apos todas as outras transformacoes (whatsapp, compare)
  - Teste tsx standalone (sem jest/vitest) seguindo convencao rag-comparison-helpers.test.ts
  - package.json nao modificado nesta tarefa (evitar conflito com plans paralelos da Wave 1)
metrics:
  duration_minutes: 8
  completed_date: "2026-06-10"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 3
---

# Phase 5 Plan 01: GRD-01 — Guardrail de Unidade de Taxa e Bloqueio de Aritmetica LLM — Summary

assertRateUnit() em rate-lookup.ts com chamada inline em formatCapitalPremiumLine + flag llmArithmeticBlocked em answer.ts/stream.ts que injeta secao PROIBIDO no systemPrompt quando ha intencao de taxa sem fast-path.

## What Was Built

### Task 1: assertRateUnit + Teste de Regressao H01

Adicionado em `app/src/services/rag/rate-lookup.ts` (~linha 716):

- `KNOWN_RATE_UNITS` Set com os 5 valores validos do vocabulario de rate_unit
- `export function assertRateUnit(rateUnit, context)` — lanca `Error('[grd-01] ...')` para qualquer unidade fora do Set
- Chamada inline `assertRateUnit(row.rate_unit, 'formatCapitalPremiumLine')` como primeira linha de `formatCapitalPremiumLine` — defesa em profundidade antes do calculo de premio

Criado `app/scripts/phase2/rate-unit-guard.test.ts` (convencao tsx standalone):
- 7 cases de `assertRateUnit`: 5 unidades conhecidas nao lancam, 2 desconhecidas lancam com prefixo `[grd-01]`
- 4 invariantes H01: `(1.75 * 320000) / 1000 = 560` (mensal), `560 * 12 = 6720` (anual), never 5600, never 56000
- 11 testes, exit 0

### Task 2: Flag llmArithmeticBlocked em answer.ts e stream.ts

Em `app/src/services/rag/answer.ts`:
- `const llmArithmeticBlocked = rateIntentDetected` antes da montagem do systemPrompt
- Ramificacao `if (llmArithmeticBlocked)` concatena secao `## PROIBIDO (GRD-01)` ao `promptTemplate` proibindo aritmetica de premio/taxa/capital ao LLM

Em `app/src/services/rag/stream.ts`:
- `let rateIntentDetected = false` declarado no inicio do try (escopo do generator)
- `rateIntentDetected = intent.hasIntent` setado dentro do bloco fast-path logo apos `if (intent.hasIntent)`
- Mesma logica `llmArithmeticBlocked` espelhada antes de `callLLMStream`
- `const baseTemplate` promovido de `const` para `let` para permitir a concatenacao

## Commits

| Task | Hash | Files |
|------|------|-------|
| 1 (TDD RED+GREEN) | 726314f | rate-lookup.ts (+assertRateUnit +KNOWN_RATE_UNITS), rate-unit-guard.test.ts (novo) |
| 2 (flag anti-aritmetica) | 6516947 | answer.ts (llmArithmeticBlocked + PROIBIDO), stream.ts (rateIntentDetected + llmArithmeticBlocked + PROIBIDO) |

## Verification Results

```
npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/rate-unit-guard.test.ts
→ 11 passed (exit 0)

npm run build
→ Compiled successfully in 8.5s
→ TypeScript: Finished in 10.0s
→ 31 static pages geradas sem erro
```

## Deviations from Plan

Nenhum — plano executado exatamente como descrito.

O plano dizia para nao modificar `package.json` (evitar conflito com plans paralelos da Wave 1); seguido.

## Known Stubs

Nenhum — nao ha dados hardcoded ou placeholders nos arquivos modificados.

## Threat Flags

Nenhuma nova superficie de seguranca introduzida. As modificacoes sao defensivas:
- `assertRateUnit` — falha alta (throw) antes de calcular, sem expor estado interno
- Secao PROIBIDO no systemPrompt — nao expoe estrutura de tabelas nem outros produtos (T-05-02: accepted)
- Concatenacao acontece em codigo apos a deteccao de intent, fora do alcance da pergunta do usuario (T-05-01: mitigado por construcao)

## Self-Check: PASSED

- [x] `app/src/services/rag/rate-lookup.ts` — existe e contem assertRateUnit + KNOWN_RATE_UNITS
- [x] `app/scripts/phase2/rate-unit-guard.test.ts` — existe, 11 testes passam
- [x] `app/src/services/rag/answer.ts` — contem llmArithmeticBlocked + PROIBIDO (GRD-01)
- [x] `app/src/services/rag/stream.ts` — contem rateIntentDetected + llmArithmeticBlocked + PROIBIDO (GRD-01)
- [x] Commit 726314f existe
- [x] Commit 6516947 existe
- [x] Build passa (exit 0, sem erros TypeScript)
