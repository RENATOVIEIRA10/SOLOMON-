# Pré-sinistro — melhoria de qualidade (retrieval-first)

- **Data:** 2026-07-15
- **Trilho:** pré-sinistro (`app/src/services/rag/pre-sinistro.ts`)
- **Status:** design aprovado pelo CEO → próximo passo é plano de implementação
- **Escopo de produto:** trilho **fora do piloto** (segue promessa proibida no veredito de lançamento PR #57). Este trabalho é paralelo/pós-piloto e **não** liga o pré-sinistro em produção. Não bloqueia a venda de cotação.

## 1. Problema

Avaliação de faithfulness rodada na VPS (worktree isolado, SHA `47a4da6` de `feat/pre-sinistro-shadow-routing`, gerador via OpenRouter):

- **Gate = faithfulness ≥ 0.80. Reprovado de forma robusta.**
- Cross-judge com 3 juízes independentes (gemini-2.5-flash com thinking OFF, claude-sonnet-4.6, gpt-4o-mini) sobre Q46–Q50:
  - legacy ≈ **0.43** · shadow ≈ **0.50** (média dos juízes) · máximo absoluto **0.566**.
- Correção de uma leitura anterior: "o corpus shadow piora o pré-sinistro" era **artefato** (juiz único + Q48 perdida por JSON truncado + amostra comercial n=2). Com N completo e 3 juízes, **shadow ≈ legacy**. O shadow ainda vira 2 verdicts para COBERTO com grounding fraco (Q46/Q48) — motivo suficiente para **não** promover o wire shadow→pré-sinistro, mas não por "piorar faithfulness".

## 2. Diagnóstico (causa-raiz)

Faithfulness = claims atômicos do `rationale` suportados pelos `chunks` recuperados. Valor baixo = o rationale afirma além dos chunks. Duas causas distintas:

### Causa A — Retrieval (comprovado por dados)
As cláusulas **existem no corpus, em abundância** (tabela `documents`, produção):

| Seguradora | chunks totais | "sobreviv" | "carênc" | "suicíd" | "doença grave" | "acid. pessoal" |
|---|---|---|---|---|---|---|
| Prudential | 12.210 | 317 | 1.120 | 316 | 929 | 1.039 |
| Zurich | 3.793 | 27 | 573 | 260 | 114 | 286 |
| MAG | 6.502 | 12 | 34 | 16 | 28 | 14 |

O pré-sinistro recupera **apenas 8 chunks** e não traz a cláusula certa, apesar de ela existir às centenas. **Não é ingestão; é retrieval.** Evidência adicional: no Q50, quando o retrieval trouxe o produto certo (shadow), a faithfulness subiu para 0.71–0.80 vs 0.33–0.73 no legacy. O total de 12.210 chunks da Prudential também sugere **ruído/duplicação** afogando os chunks bons.

### Causa B — Raciocínio jurídico paramétrico
Os rationais citam **Art. 766 do CC** (Q49), doutrina de má-fé, devolução de reserva matemática (Q47) — conhecimento correto e necessário que **não vive nas condições gerais da seguradora**. A métrica `faithfulness-vs-chunks` penaliza como "não suportado", mas é o raciocínio que dá valor ao trilho. Os juízes discordam nesses casos (Q49: Sonnet 0.17 × GPT 0.63), confirmando que a métrica é ambígua para claim jurídico.

## 3. Objetivo / critérios de sucesso

- **Primário:** correctness do veredicto (COBERTO / NAO_COBERTO / RISCO) contra **gabarito humano (Julio)**.
- **Guardrail:** faithfulness dos *claims-de-apólice* (nunca afirmar cobertura sem ancorar em chunk).
- **Anti-meta:** NÃO otimizar faithfulness cega — isso empurraria o modelo a só repetir chunks e mataria o raciocínio jurídico, que é o diferencial.

## 4. Design (faseado)

### Fase 0 — medir certo (pré-requisito barato)
- **Resolver a divergência de modelo:** o código usa `callGeminiJson` (roda `gemini-2.5-flash`); o `CLAUDE.md` afirma Claude Sonnet 4.6. Decidir e alinhar código+doc. Recomendação: Sonnet 4.6 (trilho de alta consequência jurídica).
- **Gabarito de correctness com o Julio** para Q46–Q50; ampliar a amostra (meta ≥20 casos, incluindo comerciais Prudential/MAG e casos-limite).
- **Métrica dupla no harness:** correctness (vs gabarito) + faithfulness como guardrail, **separando** claims-de-apólice de claims-jurídicos (a Causa B não deve derrubar o número).

### Fase 1 — retrieval (maior ganho por menor esforço)
- **top-k 8 → 24–40** no caminho do pré-sinistro (`semanticSearch` em `pre-sinistro.ts`).
- **Multi-query:** decompor o caso em sub-queries (cobertura / carência / exclusão / faixa etária / produto), recuperar por cada, unir + dedup — ataca o mismatch semântico entre "cliente 52 anos com câncer" e o texto jurídico "período de sobrevivência de 30 dias".
- **Hybrid search:** keyword (tsvector/BM25) + vetorial, para termos exatos ("carência de 2 anos").
- **Rerank** dos candidatos (cross-encoder, ou reaproveitar o pre-rerank nomic já existente).
- **Dedup/ruído:** investigar os 12.210 chunks da Prudential (duplicação afogando bons).
- **Validação:** re-rodar o harness a cada mudança; alvo = mover faithfulness-de-apólice **e** correctness.

### Fase 2 — camada jurídica (adiada; só se a Fase 1 chegar a um teto)
- Output em **2 camadas**: "o que a apólice diz" (cada claim cita `chunk_id`) × "o que a lei diz" (cita corpus jurídico).
- **Corpus jurídico** separado: artigos relevantes do CC (766, 798…), circulares SUSEP. Ingestão própria.

## 5. Fora de escopo (YAGNI)
- Ligar o pré-sinistro em produção (segue proibido no piloto).
- Fase 2 antes de a Fase 1 mostrar seu teto.
- Reconstruir o "hardening de 11 pontos" descrito em sessão anterior — esse patch **não existe em disco algum** e não é o gargalo (o gargalo é retrieval).

## 6. Riscos / ressalvas honestas
- **Amostra N=5** — robusta na direção (todos os juízes <0.60), imprecisa na magnitude. A Fase 0 amplia.
- **faithfulness ≠ correctness** — um veredicto pode estar certo com faithfulness baixa (raciocínio jurídico correto fora dos chunks).
- **top-k maior** sobe latência/custo e pode diluir precisão — medir, não assumir.
- **Gerador Gemini Flash × Sonnet 4.6** muda os números; fixar isso na Fase 0 antes de comparar baselines.
