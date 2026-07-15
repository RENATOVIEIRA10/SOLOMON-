# Pré-sinistro — melhoria de qualidade (retrieval-first)

- **Data:** 2026-07-15
- **Trilho:** pré-sinistro (`app/src/services/rag/pre-sinistro.ts`)
- **Status:** design aprovado pelo CEO (com decisões de modelo e 6 ajustes técnicos) → próximo passo é o plano de implementação (F0 + F1)
- **Escopo de produto:** trilho **fora do piloto** (promessa proibida no veredito de lançamento PR #57). Trabalho paralelo/pós-piloto; **não liga** o pré-sinistro em produção; não bloqueia a venda de cotação.

## 1. Problema

Eval de faithfulness na VPS (worktree isolado, SHA `47a4da6`, gerador via OpenRouter) + verificação adversarial com **juiz cruzado** (3 juízes: gemini-2.5-flash com thinking OFF, claude-sonnet-4.6, gpt-4o-mini) sobre Q46–Q50:

| Config | gemini-flash | sonnet-4.6 | gpt-4o-mini |
|---|---|---|---|
| legacy | 0.357 | 0.409 | 0.510 |
| shadow | 0.473 | 0.451 | 0.566 |

Gate = faithfulness ≥ 0.80 → **reprovado de forma robusta e unânime** (máximo 0.566). Correção honesta: "shadow piora" da 1ª rodada era artefato (juiz único + Q48 perdido por JSON truncado + n=2). Com N completo e 3 juízes, **shadow ≈ legacy**.

## 2. Diagnóstico (causa-raiz)

Faithfulness = claims atômicos do `rationale` suportados pelos `chunks`. Duas causas:

### Causa A — Retrieval (comprovado)
As cláusulas **existem no corpus, em abundância** (`documents`, produção):

| Seguradora | chunks | "sobreviv" | "carênc" | "suicíd" | doença grave | acid. pessoal |
|---|---|---|---|---|---|---|
| Prudential | 12.210 | 317 | 1.120 | 316 | 929 | 1.039 |
| Zurich | 3.793 | 27 | 573 | 260 | 114 | 286 |
| MAG | 6.502 | 12 | 34 | 16 | 28 | 14 |

O pré-sinistro recupera só **8 chunks** e não traz a cláusula certa. Não é ingestão; é **retrieval**.

**Achado que barateia a F1:** o pré-sinistro usa apenas `semanticSearch` top-8, **sem hybrid e sem rerank** (`pre-sinistro.ts:158`), enquanto o **oráculo já tem** `hybridSearch` + `rerankWithCohere` + multi-query fan-out (`answer.ts:475-555`). A F1 é **portar o pipeline existente**, não construir reranker novo.

### Causa B — Raciocínio jurídico paramétrico
Rationais citam **Art. 766 do CC**, doutrina de má-fé, reserva matemática — corretos e necessários, mas fora das condições gerais. A métrica `faithfulness-vs-chunks` penaliza como "não suportado". Otimizar faithfulness cega mataria o raciocínio jurídico. Esses claims serão **rotulados como não-validados** até a F2 (corpus jurídico + revisor).

## 3. Objetivo / critérios de sucesso

- **Primário:** correctness do veredicto (COBERTO / NAO_COBERTO / RISCO) vs **gabarito humano (Julio)**.
- **Gate correto (não faithfulness cega):** tratar **RISCO como abstenção**; medir **matriz de confusão com custo assimétrico**. O gate principal deve impedir **veredicto conclusivo falso** — especialmente **COBERTO sem cláusula decisiva**.
- **Guardrail:** faithfulness dos *claims-de-apólice* (nunca afirmar cobertura sem ancorar em chunk).

## 4. Modelo (decisão CEO)

- **Gerador candidato:** `anthropic/claude-sonnet-4.6` (alta consequência jurídica). Custo ~10× entrada / ~6× saída vs Gemini ($3/$15 vs $0,30/$2,50 por Mtok) — justificado pelo baixo volume.
- **Gemini 2.5 Flash:** mantido **apenas como controle no eval**, **não** como fallback silencioso.
- **Promoção:** só depois do gabarito + **A/B pareado com o mesmo contexto recuperado** (mesmos chunks para Sonnet e Gemini).
- **Sonnet 5 fica fora desta F0:** muito recente, rejeita `temperature: 0.2` e usa tokenizer ~30% mais tokens — incompatível com o código atual. Experimento posterior.

### Adapter de modelo (pré-requisito da F0)
Hoje `callGeminiJson` (`llm.ts:600`) tem fallback inválido: se OpenRouter falha, chama `callGeminiJsonDirect` com o `model` recebido → mandaria o identificador Sonnet ao endpoint REST do Gemini. **Trocar por um JSON caller provider-agnostic** com ordem segura:

```
OpenRouter/Sonnet  →  Anthropic direto/Sonnet  →  FALHAR FECHADO (fail closed)
```

Sem fallback cross-provider silencioso. Gemini entra só como braço de controle explícito do eval.

## 5. Design (faseado)

### Fase 0 — medir certo (pré-requisito)
- **Adapter provider-agnostic** (acima); fixar `PRE_SINISTRO_MODEL = anthropic/claude-sonnet-4.6`, alinhar `CLAUDE.md` (drift).
- **Gabarito cego do Julio:** Q46–Q50 + 15 casos novos (Q51–Q65). Sem mostrar resposta de nenhum modelo. Campos por caso: fatos + versão exata da apólice · veredicto · cláusula decisiva · fatos ausentes · confiança + justificativa · `reviewed_by` + data + hash/versão do documento.
- **Métrica dupla no harness:** correctness (vs gabarito, RISCO = abstenção, matriz de confusão com custo assimétrico) + faithfulness (guardrail), **separando** claim-de-apólice de claim-jurídico.
- **A/B pareado:** Sonnet vs Gemini sobre os **mesmos chunks recuperados**.

### Fase 1 — retrieval (maior ganho; reusar o que existe)
- **Portar o pipeline do oráculo** para o pré-sinistro: `hybridSearch` (+`WithEmbedding`) + `rerankWithCohere` + multi-query — **reutilizar**, não recriar.
- **Multi-query:** decompor o caso em sub-queries (cobertura / carência / exclusão / faixa etária / produto).
- **Dois valores de k:** recuperar **24–40 candidatos**, mas enviar ao modelo só **8–12 chunks reranqueados** dentro de um orçamento de tokens. **Não** despejar 40 chunks no modelo.
- **Hybrid** cobre termos exatos ("carência de 2 anos"); **dedup** do ruído (12.210 chunks Prudential).
- **Evidência por claim:** cada *claim-de-apólice* exige **`chunk_ids`** (hoje há uma `citation` singular para o rationale inteiro). *Claims jurídicos* ficam rotulados "não validados" até a F2.
- **Segurança:** `humanReviewRequired = true` para **todas** as análises enquanto o trilho estiver fora do piloto (hoje é condicional em `pre-sinistro.ts:313`).
- **Validação:** re-rodar o harness a cada mudança; alvos = matriz de confusão + faithfulness-de-apólice.

### Fase 2 — camada jurídica (adiada; só se a F1 chegar ao teto)
- Output em 2 camadas: "o que a apólice diz" (cita `chunk_id`) × "o que a lei diz" (cita corpus jurídico).
- Corpus jurídico separado: CC (arts. 766, 798…), circulares SUSEP. Ingestão + revisor jurídico validam os claims legais.

## 6. Fora de escopo (YAGNI)
- Ligar o pré-sinistro em produção (segue proibido no piloto).
- Sonnet 5 (incompatibilidades acima).
- Criar reranker/hybrid novo — reusar `search.ts`.
- Reconstruir o "hardening de 11 pontos" de sessão anterior (não existe em disco; não é o gargalo).
- F2 antes de a F1 mostrar seu teto.

## 7. Riscos / ressalvas
- **N=5** hoje (robusto na direção, impreciso na magnitude) — o gabarito Julio (Q46–Q65) amplia para ~20.
- **faithfulness ≠ correctness** — o gate primário passa a ser a matriz de confusão.
- **top-k maior** sobe latência/custo e pode diluir precisão — por isso os **dois valores de k** (recall alto, contexto enviado enxuto).
- **Custo Sonnet** — mitigado por baixo volume + `humanReviewRequired` (não é fluxo massivo).
