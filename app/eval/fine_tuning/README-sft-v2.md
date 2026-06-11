# SFT v2 — Dataset RAG-grounded (solomon-sft-v2-train.jsonl)

Criado: 2026-06-11 | Phase 6 do GSD | Branch: feat/sft-v2-dataset

## Por que v2

O dataset v1 (`solomon-sft-bedrock-train.jsonl`, 100 exemplos) treinava resposta de
memória: pergunta seca no turno do usuário, sem contexto RAG, com respostas genéricas
(~220 chars). O modelo resultante (Nova Micro) foi reprovado no gate (83.0 vs 85.25 de
produção). Diagnóstico do gate doc (`docs/qa/sft-v2-model-gate-2026-06-07.md`): mais
exemplos do mesmo tipo não corrigem — era o formato que estava errado.

O v2 destila o comportamento REAL de produção: o turno do sistema contém o
`SYSTEM_PROMPT_TEMPLATE` de produção com os DOCUMENTOS DE REFERENCIA reais (chunks
numerados no formato do `context-builder.ts`); o assistant é a resposta grounded com
citações [N] e seção FONTES — exatamente o trabalho que o LLM do oráculo faz atrás dos
guardrails determinísticos (GRD-01..04).

## Pipeline de construção (3 estágios)

1. **Perguntas** — `sft-v2-questions.jsonl`: 270 perguntas novas (2 lotes), autoradas com
   regras duras: só seguradoras indexadas, sem pedido de cálculo (GRD-01), sem veredicto
   de sinistro (claim-guard), só domínio vida/pessoas. Anti-contaminação automática:
   Jaccard de trigramas <= 0.55 contra as 145 perguntas de eval (49+ Ragas + G-01..G-12)
   — validador `validate-sft-v2-questions.cjs`. O lote 2 (90) foi mirado nas
   categorias/seguradoras de maior aproveitamento do lote 1.
2. **Destilação** — `build-sft-v2-dataset.py` na VPS: POST /api/ask (evalMode, produção
   master pós-PR #69) por pergunta; reconstrói o system prompt exato; 6 filtros
   determinísticos (não-guard, >=2 fontes, >=300 chars, citação [N], seção FONTES, sem
   erro). 270 processados → 256 aceitos → `sft-v2-distilled-raw.jsonl` (mantém contexts
   separados para o judge).
3. **Judge + corte** — faithfulness Ragas com **juiz único gpt-4o-mini** (256/256, zero
   nulls; backend `openai` adicionado ao metrics.py após Anthropic/OpenRouter sem crédito
   e Gemini falhar no parse do NLIStatement com contextos longos). Corte
   `cut-sft-v2-final.py`: accepted ∧ F>=0.8 → 113 selecionados → split estratificado
   por categoria (seed 20260611): **100 train + 13 heldout**.

## Proveniência das respostas (registrar em qualquer publicação do modelo)

- 77 exemplos: gemini-2.5-flash (fallback chain de produção)
- 36 exemplos: gpt-4o-mini (fallback chain alternou durante o lote 2)
- Distribuição por categoria e IDs completos: `sft-v2-manifest.json`

## Uso

Treino (Bedrock, base candidata `amazon.nova-2-lite-v1:0:256k`): adaptar
`app/scripts/start-bedrock-sft.sh` (trocar BASE_MODEL e DATASET para
`solomon-sft-v2-train.jsonl`).

Gate do modelo treinado (NENHUM deploy sem passar):
1. Held-out de segurança `solomon-guardrails-heldout.jsonl` (G-01..G-12) — 12/12.
2. `solomon-sft-v2-train-heldout.jsonl` (13) — qualidade vs produção, mesmo juiz.
3. Ragas 49 perguntas — sem regressão vs baseline.
