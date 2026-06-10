---
phase: 05-guardrails-determin-sticos-pr-sft-v2
plan: "03"
subsystem: pre-sinistro
tags: [guardrails, grd-04, h11, tdd, pre-sinistro, regression-test]
dependency_graph:
  requires: []
  provides: [hasEvidenceFor-exported, h11-regression-test]
  affects: [pre-sinistro.ts]
tech_stack:
  added: []
  patterns: [post-validation-downgrade, tdd-red-green, tsx-standalone-test]
key_files:
  created:
    - app/scripts/phase2/pre-sinistro-h11-guard.test.ts
  modified:
    - app/src/services/rag/pre-sinistro.ts
decisions:
  - "Exportar hasEvidenceFor permite teste unitario direto sem invocar LLM — decisao minimal de menor risco"
  - "TDD RED/GREEN: teste criado antes da modificacao confirma que a funcao era privada e nao testavel"
  - "Texto de downgrade permanece em riskFlags, rationale intocado (regra PR #64)"
metrics:
  duration: "~15min"
  completed: "2026-06-10T17:27:22Z"
  tasks: 1
  files_modified: 1
  files_created: 1
---

# Phase 05 Plan 03: GRD-04 Guardrail H11 (pré-sinistro sem suporte textual) Summary

Export `hasEvidenceFor` de privada para pública em `pre-sinistro.ts` + 7-assertion test que prova que chunk genérico (H11) retorna false em ambos os lados — tornando impossível por construção qualquer veredicto conclusivo sem suporte textual.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Confirmar/reforcar post-validation + exportar hasEvidenceFor + teste H11 | 1f6b960 | pre-sinistro.ts (+1 line), pre-sinistro-h11-guard.test.ts (new, 147 lines) |

## What Was Built

**`app/src/services/rag/pre-sinistro.ts`** — mudança cirúrgica: `function hasEvidenceFor(` → `export function hasEvidenceFor(`. O post-validation block (linhas 284–307) com 3 downgrades para RISCO estava intacto e correto — não foi alterado. O `rationale` não contém nenhuma concatenação de texto sintético de downgrade (verificado por grep).

**`app/scripts/phase2/pre-sinistro-h11-guard.test.ts`** — teste standalone tsx com 7 assertions:
- `hasEvidenceFor('COBERTO', [chunkCobertura])` === true (chunk com palavra "cobertura")
- `hasEvidenceFor('NAO_COBERTO', [chunkExclusao])` === true (chunk com palavra "exclui")
- `hasEvidenceFor('COBERTO', [chunkGenerico])` === false (H11 — sem keywords de cobertura)
- `hasEvidenceFor('NAO_COBERTO', [chunkGenerico])` === false (H11 — sem keywords de exclusão)
- 3 assertions do caso combinado H11: ambos false → qualquer veredicto conclusivo seria rebaixado para RISCO

## Verification

```
7 passed
```

```
grep export function hasEvidenceFor → 1 match (linha 495)
grep 'verdict = "RISCO"' → 3 matches (3 downgrades preservados)
grep 'rationale.*downgrade|rationale.*rebaixado' → 0 matches
```

## Deviations from Plan

Nenhuma — plano executado exatamente como escrito. A única alteração no `pre-sinistro.ts` foi acrescentar `export` à função `hasEvidenceFor`. O post-validation block já estava correto e não precisou de ajuste.

## Threat Model Coverage

| Threat ID | Status |
|-----------|--------|
| T-05-07 (Tampering — post-validation verdict) | Mitigado: hasEvidenceFor exportada e testada; post-validation block confirmado com 3 downgrades |
| T-05-08 (riskFlags com texto sintético) | Aceito: rationale confirmado sem texto sintético; downgrade vai para riskFlags |
| T-05-09 (Repudiation — downgrade sem registro) | Mitigado: 3 addRiskFlag descritivos confirmados intactos |

## Known Stubs

Nenhum.

## Threat Flags

Nenhum novo surface introduzido — modificação localizada em função utilitária interna sem impacto em boundary de rede ou auth.

## Self-Check: PASSED

- [x] `app/scripts/phase2/pre-sinistro-h11-guard.test.ts` existe
- [x] `app/src/services/rag/pre-sinistro.ts` modificado (export adicionado)
- [x] Commit `1f6b960` existe em master
- [x] Teste passa: 7 passed, exit 0
