# Pré-Sinistro — Plano de Hardening

**Data:** 2026-07-14
**Status:** proposta. Frente **separada** do lançamento do SOLOMON.
**Autor:** Claude (notebook) sob direção do CEO.

---

## 0. Princípio de desacoplamento (regra de ouro)

O pré-sinistro **fica fora do lançamento** e é tratado como frente independente. Ele
**não bloqueia** o resto do SOLOMON:

- O fluxo **ask** (perguntas de condições gerais) das 4 comerciais já está no ar,
  corrigido e provado — segue seu próprio ritmo.
- A rota/feature `/pre-sinistro` permanece **gated/oculta** para o corretor até o
  **Gate de Retorno** (Fase 6) passar por completo.
- Nenhuma fase deste plano é pré-requisito de qualquer entrega do fluxo ask.

Motivo: o pré-sinistro emite **veredicto de sinistro** — se ele alucina ("coberto"/"não
coberto" sem base), é risco civil direto. Ele só volta quando for medível e aprovado.

---

## 1. Contexto e evidência (o que a medição mostrou)

Medido em 2026-07-14 (harness `scripts/phase2/pre-sinistro-faithfulness.ts`, chamando
`analyzePreSinistro` direto, juiz de faithfulness estilo Ragas, temp 0):

| via | faithfulness (Prudential) | falhas de resposta |
|---|---|---|
| Gemini **direto** | 0.34–0.42 | 3/5 (MAX_TOKENS, JSON truncado) |
| **OpenRouter** | 0.43–0.47 | 1/5 (JSON malformado) |

Gate = **0.80**. Duas conclusões:

1. **Confiabilidade** — o Gemini **direto** ligava "thinking", consumia o orçamento de
   output e truncava o JSON; `callGeminiJson` tenta o direto primeiro e **não** trata
   `finishReason=MAX_TOKENS` como erro, então o fallback pro OpenRouter nunca disparava.
   Pelo OpenRouter as falhas caíram de 3/5 → 1/5.
2. **Grounding** — mesmo no provider certo + corpus shadow, o modelo **inventa ~metade
   dos claims** (sem suporte nos chunks). Isso é geração/grounding, **não** provider nem
   corpus. Trocar de provider é necessário para confiabilidade, mas **insuficiente** para
   o gate.

Groundwork já feito (banked, **gated**, não deployado): branch
`feat/pre-sinistro-shadow-routing` — liga `corpusDbRouting` no `analyzePreSinistro` +
canonicaliza o nome da seguradora para o AND-gate ("Prudential do Brasil" → "Prudential",
senão o roteamento falha silencioso). Pré-requisito da Fase 3; não muda o veredito sozinho.

---

## Fase 1 — Fixar o provider

**Objetivo:** o pré-sinistro usa OpenRouter de forma determinística, sem cair no Gemini
direto por acidente, com telemetria completa da chamada.

**Requisitos**
- `PRE_SINISTRO_PROVIDER=openrouter` (env). O caminho de LLM do pré-sinistro **não pode**
  ter fallback silencioso para o Gemini direto.
- Tratar `finishReason` de truncamento (`MAX_TOKENS`/`length`) como **erro explícito** —
  nunca retornar JSON parcial como sucesso.
- Registrar por chamada: `provider`, `model`, `promptTokens`, `outputTokens`,
  `finishReason`, `latencyMs`.

**Touchpoints:** `src/services/rag/llm.ts` (`callGeminiJson` ordem de provider;
`callOpenRouter`), `src/services/rag/pre-sinistro.ts` (`PRE_SINISTRO_MODEL`/provider).

**Critérios de aceite**
- 100% das chamadas de pré-sinistro registram `provider=openrouter` no log/trace.
- Injeção de `GEMINI_API_KEY` no ambiente **não** faz o pré-sinistro usar o direto.
- Truncamento vira erro capturável (entra no fluxo da Fase 2), não resposta inválida
  crua.

---

## Fase 2 — Robustez do JSON

**Objetivo:** o corretor nunca vê erro técnico; toda saída é um objeto válido e tipado.

**Requisitos**
- **JSON Schema obrigatório** na chamada (response_format json_object + schema).
- Validação com **Zod** no servidor (o shape do `PreSinistroResult`).
- **Reparo apenas sintático e determinístico** (ver ressalva abaixo).
- **Uma única** nova tentativa quando necessário.
- **Nunca** expor erro técnico ao corretor — degradar para um estado de produto
  (ex.: "não foi possível concluir a análise com segurança").

**RESSALVA CRÍTICA sobre "repair" (regra dura)**
> "Repair" **não** pode significar pedir ao modelo para completar livremente um JSON
> quebrado — isso pode **criar novos claims**. A ordem é:
> 1. **Reparo puramente sintático/determinístico** (fechar string/colchete não terminado
>    *apenas* quando não-ambíguo; remover fence markdown; nada que altere conteúdo).
> 2. Se o reparo sintático **não for possível**, a análise inteira é **refeita do zero a
>    partir dos chunks originais** (nova chamada com o mesmo contexto) — nunca "complete
>    este JSON".
> 3. Se ainda falhar, veredito de segurança (RISCO/abstém), sem erro técnico.

**Touchpoints:** `src/services/rag/pre-sinistro.ts` (parse/validação da saída do LLM),
novo módulo de schema+repair.

**Critérios de aceite**
- 100% das respostas ao corretor são objetos válidos (Zod green).
- Nenhum caminho de "repair" chama o modelo pedindo para completar JSON parcial.
- Falha de parse → re-análise a partir dos chunks (log distingue "syntactic-repair" de
  "full-reanalysis").

---

## Fase 3 — Grounding estrutural (a fase grande)

**Objetivo:** o veredito passa a ser **derivado de evidências verificadas**, não de um
texto livre que o modelo escreve.

**Requisitos**
- Substituir o **rationale livre** por **claims atômicos**.
- Cada claim deve indicar `chunkId` + **trecho literal** do chunk que o sustenta.
- **Eliminar** (no servidor) todo claim sem trecho literal correspondente.
- **Montar o rationale no servidor** a partir dos claims sobreviventes.
- O modelo **extrai evidências**; o **código determina o veredito**.
- **Sem evidência suficiente → sempre RISCO** (abstenção segura).

**Design implicado**
- Novo contrato de saída do LLM: lista de `{ claimText, chunkId, literalExcerpt, tipo:
  cobertura|exclusao|carencia|contestabilidade|definicao }`. Sem campo `verdict` vindo do
  modelo.
- Validação servidor: `literalExcerpt` deve aparecer **literalmente** (substring ≥ N
  chars) no chunk de `chunkId` (evoluir o `validateCitation` atual para por-claim).
- Regra de veredito determinística no código: COBERTO exige ≥1 claim de cobertura
  sustentado e nenhum de exclusão aplicável; NAO_COBERTO exige ≥1 claim de exclusão
  sustentado; senão RISCO. (Formaliza o que hoje é heurística de post-validation.)
- Depende da Fase 3-prereq (branch de routing+canonicalização) para os chunks virem do
  corpus shadow com tabelas.

**Touchpoints:** `pre-sinistro.ts` (SYSTEM_PROMPT, `PreSinistroResult`, montagem do
rationale, regra de veredito), `validateCitation`.

**Critérios de aceite**
- Todo claim exibido tem `chunkId` + trecho que valida por substring.
- Nenhum COBERTO/NAO_COBERTO sem claim sustentado do tipo correspondente.
- Faithfulness sobe estruturalmente (claims não sustentados são removidos por construção,
  não por sorte do modelo).

---

## Fase 4 — Teste de modelos (bake-off)

**Objetivo:** escolher o modelo com dados, não por palpite.

**Requisitos**
- Comparar **Gemini via OpenRouter** com **≥2 modelos mais fortes** (ex.: Claude / Qwen
  via OpenRouter).
- **Mesmas perguntas e os mesmos chunks** para todos (fixar o retrieval: alimentar chunks
  idênticos por caso, pra isolar o efeito do modelo).
- Escolher por **faithfulness, estabilidade, custo, latência**.
- **Não presumir** que só trocar o modelo leva de 0.45 → 0.80 (por isso vem *depois* da
  Fase 3, que ataca o grounding estruturalmente).

**Touchpoints:** reusar/estender `scripts/phase2/pre-sinistro-faithfulness.ts` com um modo
"chunks fixos" e loop de modelos.

**Critérios de aceite**
- Tabela modelo × {faithfulness, %JSON válido, custo/1k, p50/p95 latência} sobre o mesmo
  conjunto.
- Decisão registrada com o racional.

---

## Fase 5 — Avaliação das quatro seguradoras

**Objetivo:** um dataset de verdade, validado por humano, pra medir e gate por seguradora.

**Requisitos**
- **Mínimo 20 casos por seguradora** (MAG, Azos, MetLife, Prudential) = ≥80 casos.
- Cobrir: **cobertura, exclusão, carência, DPS, insuficiência documental, casos ambíguos**.
- **Gabarito validado pelo Julio** (corretor âncora) — segue o pipeline de review já
  documentado (`solomon_julio_review`).
- Medir por caso: **JSON válido; faithfulness; claims sustentados; correção do veredicto;
  taxa de abstenção; custo; latência.**

**Touchpoints:** `app/eval/ragas/` (novo `pre-sinistro-cases.jsonl` por seguradora), o
harness de faithfulness, pipeline de review do Julio.

**Critérios de aceite**
- ≥80 casos com GT validado por Julio.
- Bateria de métricas rodável por seguradora, reproduzível.

---

## Fase 6 — Gate de retorno (para o pré-sinistro voltar a ser exposto)

Só libera o pré-sinistro para o corretor quando **TODOS**:

1. **100% de respostas válidas** (JSON válido, sem erro técnico ao corretor).
2. **Faithfulness ≥ 0.80 por seguradora** (não média global — cada uma das 4).
3. **Nenhum COBERTO ou NAO_COBERTO sem evidência validada** (trecho literal em chunk).
4. **Aprovação do Julio**.
5. **Período em shadow silencioso** antes de expor: roda ao lado, telemetria observada,
   corretor **não** vê — até bater os números acima em tráfego/casos reais.

---

## Métricas canônicas (bateria única, usada nas Fases 4–6)

Por caso e agregado por seguradora:
- `json_valid` (bool) · `faithfulness` (0–1) · `supported_claims` / `total_claims`
- `verdict_correct` (vs GT do Julio) · `abstention` (RISCO por evidência insuficiente)
- `cost_usd` · `latency_ms` (p50/p95) · `provider` · `model` · `finishReason`

---

## Sequenciamento e risco

- **1 → 2** são baratas e destravam confiabilidade (provider fixo + JSON válido). Podem
  ir juntas num PR.
- **3** é o grande esforço (redesenho do contrato de saída + veredito no servidor). É o
  que realmente move o faithfulness.
- **4** depois de 3 (medir modelo com o grounding já estrutural).
- **5** em paralelo com 3/4 (montar casos + Julio leva tempo humano).
- **6** é gate, não fase de trabalho.

**Risco principal:** a Fase 3 pode não chegar a 0.80 mesmo com claims estruturais + modelo
forte — nesse caso o pré-sinistro permanece gated indefinidamente (o que é aceitável: melhor
gated que alucinando). O gate protege; nunca relaxar por pressa.
