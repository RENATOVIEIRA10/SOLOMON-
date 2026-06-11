---
phase: 06
plan: 01
subsystem: eval / fine-tuning dataset
tags: [sft-v2, dataset, validator, anti-contamination]
provides:
  - app/eval/fine_tuning/sft-v2-questions.jsonl
  - app/scripts/phase2/validate-sft-v2-questions.cjs
requires:
  - 145 perguntas existentes (questions*.jsonl + heldout) como baseline anti-contaminacao
affects:
  - plano 06-02 (builder que destila respostas via /api/ask)
key-files:
  created:
    - app/eval/fine_tuning/sft-v2-questions.jsonl
    - app/scripts/phase2/validate-sft-v2-questions.cjs
metrics:
  questions: 180
  categories: 10
  jaccard_max: 0.495
  validator_exit: 0
completed: 2026-06-11
---

# Phase 6 Plan 01: Banco de Perguntas SFT v2 + Validador Anti-Contaminacao Summary

Autorado banco de 180 perguntas RAG-grounded para o dataset SFT v2 (corretor de vida brasileiro real) + validador CJS que reprova contaminacao, padroes proibidos e distribuicao fora do alvo. Builder de respostas via producao fica para outro plano.

## O que foi feito

- **`sft-v2-questions.jsonl`** (180 linhas `{id,category,insurer,question}`):
  - 10 categorias com distribuicao exata ao alvo: coberturas_produto 35, exclusoes 30, carencia_contestabilidade 20, sinistro_operacional 20, dit_dita 15, doencas_graves 15, invalidez 15, beneficiarios_capital 10, assistencias 10, conceitos_aplicados 10.
  - So as 14 seguradoras indexadas, proporcional ao corpus: Prudential 25, MAG 25, Bradesco 21, Zurich 17, MetLife 13, Porto/Tokio 10, Azos/SulAmerica 9, Icatu 7, MAPFRE 6, Caixa 5, Santander 3.
  - 20 perguntas sem seguradora (11.1%, conceitos aplicados).
  - ~10% com erros leves de digitacao (realismo): "consigo", "da pra", "pra".
  - Zero parafrase das 145 existentes — Jaccard maximo 0.495 (limite 0.55).
- **`validate-sft-v2-questions.cjs`** (padrao `validate-heldout.cjs`):
  1. JSONL valido, campos obrigatorios nao-vazios, IDs S-NNN unicos e sequenciais.
  2. Contagem por categoria dentro de +/-20% do alvo.
  3. Anti-contaminacao: Jaccard de trigramas de caracteres (lowercase, sem acentos) contra as 145 existentes; FALHA se > 0.55; reporta top 5 pares mesmo quando passa.
  4. Guards estaticos: calculo de premio, veredicto de sinistro, dominios proibidos (auto/residencial/viagem), seguradoras nao-indexadas.

## Regras duras respeitadas

- Sem categoria "calculation" / pedido de premio (fast-path GRD-01 nem chega ao LLM).
- Perguntas de sinistro sao operacionais ou conceituais — nunca veredicto concreto (claim-verdict-guard).
- Dominio exclusivo vida/pessoas (domain-guard).
- Tom de corretor real, direto, sem emoji.

## Verificacao

Validador rodado: `node app/scripts/phase2/validate-sft-v2-questions.cjs` -> **exit 0** na primeira execucao, sem ajustes necessarios.

## Deviations from Plan

None - plano executado exatamente como escrito. Banco com 180 perguntas (>= 170 exigido), validador exit 0, branch `feat/sft-v2-dataset`, sem push.

## Self-Check: PASSED

- FOUND: app/eval/fine_tuning/sft-v2-questions.jsonl (180 linhas)
- FOUND: app/scripts/phase2/validate-sft-v2-questions.cjs
- FOUND commit df4cdb9 (validador)
- FOUND commit 98eca6b (dataset)
