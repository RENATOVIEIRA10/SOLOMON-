---
phase: 05-guardrails-determin-sticos-pr-sft-v2
plan: "02"
subsystem: rag-guardrails
tags: [guardrail, domain-guard, insurer-mismatch, out-of-domain, grd-02, grd-03, tdd]
dependency_graph:
  requires: [05-01]
  provides: [detectOutOfDomainQuery, refusalMessageForDomain, GRD-02-insurer-mismatch, GRD-03-domain-guard, domain-guard-test]
  affects: [answer.ts, stream.ts, domain-guard.ts]
tech_stack:
  added: []
  patterns:
    - detectOutOfDomainQuery — keyword/regex determinístico, early-return antes do retrieval (GRD-03)
    - insurer-source-guard — check de insurer_id pós-loadEnrichment antes do LLM (GRD-02)
    - refusalMessageForDomain — mensagem honesta sem expor estrutura interna (T-05-06 mitigado)
key_files:
  created:
    - app/src/services/rag/domain-guard.ts
    - app/scripts/phase2/domain-guard.test.ts
  modified:
    - app/src/services/rag/answer.ts
    - app/src/services/rag/stream.ts
decisions:
  - detectOutOfDomainQuery usa regex/keyword determinístico seguindo shape de detectRateIntent (sem embedding-based classifier)
  - GRD-02 faz nova chamada resolveInsurerIds pós-loadEnrichment (insurerIds do fast-path está em escopo restrito)
  - Mensagem GRD-03 não lista tabelas internas nem produtos de outras seguradoras (T-05-06)
  - Padrão de retorno idêntico ao rate-table-lookup: model field identifica o guardrail ativo
  - stream.ts usa yield token+meta+return; answer.ts usa return direto (sem LLM)
metrics:
  duration_minutes: 12
  completed_date: "2026-06-10"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 5 Plan 02: GRD-02 + GRD-03 — Domain Guard + Insurer Mismatch — Summary

Dois early-returns determinísticos: detectOutOfDomainQuery (keyword/regex) bloqueia auto/residencial/viagem antes do retrieval (GRD-03); check de insurer_id pós-loadEnrichment bloqueia resposta com fonte de seguradora errada antes do LLM (GRD-02). Ambos espelhados em answer.ts e stream.ts.

## What Was Built

### Task 1: domain-guard.ts + Teste GRD-03

Criado `app/src/services/rag/domain-guard.ts`:

- `stripAccentsLower` — normalização interna, mesma abordagem de `detectRateIntent`
- `OUT_OF_DOMAIN_PATTERNS` — 3 entradas: auto, residencial, viagem com regex \b-delimitado
- `export interface DomainCheck { isOutOfDomain: boolean; detectedDomain?: string }`
- `export function detectOutOfDomainQuery(question: string): DomainCheck` — itera patterns, retorna false se vida/invalidez/DIT
- `DOMAIN_LABELS` — mapeamento para label legível ao usuário
- `export function refusalMessageForDomain(detectedDomain?: string): string` — mensagem honesta listando escopo suportado sem vazar estrutura interna

Criado `app/scripts/phase2/domain-guard.test.ts` (convenção tsx standalone):
- 13 testes cobrindo: seguro auto (H09), meu carro, residencial, viagem, cobertura morte Vida Viva (falso-positivo), invalidez acidente, seguro de vida, refusalMessageForDomain contém "vida" e "auto"
- 13 tests: 13 passed (exit 0)

### Task 2: Wire GRD-03 + GRD-02 em answer.ts e stream.ts

Em `app/src/services/rag/answer.ts`:
- Import `detectOutOfDomainQuery, refusalMessageForDomain` de `./domain-guard`
- GRD-03 logo após `detectInsurers(question)` (linha ~180), ANTES do fast-path de taxa e qualquer retrieval. Log `[grd-03]`, model `domain-guard`, early-return com `AskResult` shape completo
- GRD-02 após `loadEnrichment(searchResults)` (linha ~530), ANTES de `buildContext`. Chama `resolveInsurerIds`, compara Set de requestedIds vs retrievedIds. Se `requestedIds.size > 0 && !hasMatch`, log `[grd-02]`, model `insurer-source-guard`, early-return com recusa explícita

Em `app/src/services/rag/stream.ts`:
- Import `detectOutOfDomainQuery, refusalMessageForDomain` de `./domain-guard`
- GRD-03 logo após `detectInsurers(question)`, mesma lógica mas via yield token + yield meta + return
- GRD-02 após `loadEnrichment(searchResults)`, mesma lógica de mismatch mas via yield token + yield meta + return

## Commits

| Task | Hash | Files |
|------|------|-------|
| 1 (TDD — domain-guard + teste) | 10f7768 | domain-guard.ts (novo), domain-guard.test.ts (novo) |
| 2 (wire GRD-02 + GRD-03) | 466013c | answer.ts (import + GRD-03 + GRD-02), stream.ts (import + GRD-03 + GRD-02) |

## Verification Results

```
npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/domain-guard.test.ts
→ 13 tests: 13 passed (exit 0)

npm run build
→ Compiled successfully in 31.1s
→ TypeScript: Finished in 8.8s
→ 31 rotas geradas sem erro
```

Acceptance criteria confirmados via grep:
- `from './domain-guard'` em answer.ts: 1 match (linha 19)
- `from "./domain-guard"` em stream.ts: 1 match (linha 21)
- `[grd-03]` em answer.ts: match (linha 181)
- `[grd-02]` em answer.ts: match (linha 537)
- `insurer-source-guard` em answer.ts: 2 matches
- `insurer-source-guard` em stream.ts: 2 matches
- `domain-guard` em stream.ts: 3 matches (import + saveConversation + yield meta)
- `detectOutOfDomainQuery` (linha 179) aparece antes de `detectRateIntent` (linha 210) em answer.ts — GRD-03 antes do fast-path de taxa

## Deviations from Plan

### Auto-fixed Issues

Nenhum — plano executado exatamente como descrito.

Nota: resolveInsurerIds em GRD-02 é chamado separadamente pós-loadEnrichment (não reutilizado do bloco fast-path) porque a variável `insurerIds` do fast-path está em escopo restrito (`if (mentionedInsurers.length > 0)` interno ao bloco de 0a). O plano previu essa situação: "Preferir reaproveitar. senao a chamada acima e aceitavel (mesma query, custo baixo)."

## Known Stubs

Nenhum — os guardrails são determinísticos e retornam recusas concretas, sem placeholders.

## Threat Flags

Nenhuma nova superfície introduzida. Mitigações do threat register aplicadas:

| Flag | Mitigado | Evidência |
|------|----------|-----------|
| T-05-04 (insurer-mismatch) | Sim | GRD-02: check insurer_id em código antes do LLM em answer.ts e stream.ts |
| T-05-05 (prompt-injection burlar domain-guard) | Sim | detectOutOfDomainQuery roda sobre pergunta crua antes do LLM; regex determinístico |
| T-05-06 (information disclosure em mensagens de recusa) | Sim | refusalMessageForDomain não lista tabelas internas; apenas ramo e escopo suportado |

## Self-Check: PASSED

- [x] `app/src/services/rag/domain-guard.ts` — existe, exporta detectOutOfDomainQuery + refusalMessageForDomain
- [x] `app/scripts/phase2/domain-guard.test.ts` — existe, 13 testes passam
- [x] `app/src/services/rag/answer.ts` — contém import domain-guard + [grd-03] + [grd-02] + insurer-source-guard
- [x] `app/src/services/rag/stream.ts` — contém import domain-guard + [grd-03] + [grd-02] + insurer-source-guard
- [x] Commit 10f7768 existe
- [x] Commit 466013c existe
- [x] Build passa (exit 0, sem erros TypeScript, 31 rotas)
