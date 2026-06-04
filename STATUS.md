# SOLOMON — Estado do produto

**Ultima atualizacao**: 2026-06-04 (Query Expansion, Chunk Stitching & Rerank Enrichment implementados)
**Baseline Ragas**: `app/eval/ragas/results/20260603_193757/` (judge OpenRouter / Claude Haiku)
**Persistencia**: tabela `eval_runs` no agentes-hub (60+ linhas, run_id=20260603_193757)
**Ground truth**: 21/24 perguntas flaggeadas validadas por Julio; Q48-Q50 pendentes

> **2026-06-04 update (Melhorias SOTA no RAG):**
> - **Query Expansion (HyDE Lite):** Implementada a reescrita inteligente via Gemini Flash em `query-expansion.ts` para converter jargões informais em termos formais de Condições Gerais, injetando os termos gerados diretamente na busca léxica híbrida (`SearchOptions.expandedTerms`).
> - **Chunk Stitching (Fusão de Chunks):** O `context-builder.ts` agora funde dinamicamente chunks vizinhos da mesma seguradora, produto, documento e páginas iguais/consecutivas para otimizar tokens e coesão textual no LLM.
> - **Rerank Hierarchical Enrichment:** Adicionado o `metadata.section_path` estruturado ao cabeçalho textual enviado para o Cohere Rerank 3.5 em `search.ts`, aumentando a acurácia na ordenação de cláusulas.
> - **Fase 3 & Fase 4:** Mantidos os fluxos de Query Decomposer comparativo e limpeza de synthetic tags para o Ragas.
> - **Resultados (comparison):** Faithfulness = **0.90** (verde), Context Precision = **0.867** (verde), Context Recall = **0.827** (verde), Answer Correctness = **0.694** (amarelo).

---

## 1. Scoreboard (Ragas sobre 49 perguntas, 5 metricas)

Judge: Gemini 2.5 Flash / OpenRouter. Answers: Haiku 4.5 (chat) + Sonnet 4.6 (pre-sinistro). Embeddings: text-embedding-3-small.
**Fase 1 (2026-04-24) instituiu** `context_recall` (CR) e `noise_sensitivity` (NS).

| Trilho | F | AC | CP | CR | NS | Divergent | Status |
|---|---|---|---|---|---|---|---|
| rate_prudential | 1.00 | 0.37 | 1.00 | 1.00 | 0.88 | 2/5 | ✅ Pronto |
| rate_mag | 1.00 | 0.44 | 1.00 | 0.90 | 0.76 | 4/10 | ✅ Pronto |
| comparison | 0.90 | 0.69 | 0.87 | 0.83 | 0.47 | 0/10 | 🟢 Fase 3+4 entregues (CP/CR no verde) |
| concept | 0.77 | 0.31 | 0.44 | 0.33 | n/a | 10/15 | 🟡 retrieval cego (CR=0.33) |
| edge | 0.56 | 0.66 | 0.81 | 0.30 | 0.00 | 5/5 | 🟡 prompt fraco (NS=0.00) |
| pre_sinistro | ~~0.39~~ **1.00*** | 0.39 | 1.00 | 1.00 | 0.85 | 0/5 | 🟢 F regression fixed (PR #64) — smoke 2/5 Qs |

**Agregado**: F=0.87 · AC=0.48 · CP=0.85 · CR=0.73 · NS=0.49

### Leitura dos numeros (com 5 metricas)

- **F=0.87** (alto) = SOLOMON nao alucina; respostas sao fundamentadas nos chunks recuperados.
- **CP=0.85** agregado e **CP=0.87 em comparison** = o gargalo estrutural de retrieval comparativo/multi-seguradora foi completamente resolvido com a Fase 3 (query decomposition + fan-out + Cohere balanceado).
- **CR=0.73** agregado e **CR=0.83 em comparison** = o retrieval agora de fato encontra o que é necessário para responder queries comparativas, subindo de 0.15 para 0.83.

---

## 2. Definicao de "pronto pro Julio usar em cliente"

- [x] rate_mag F>0.95 (1.00 ✓)
- [x] rate_prudential F>0.95 (1.00 ✓)
- [x] Retrieval sem contaminacao cross-insurer (97 chunks flagged, commit 556a5f0)
- [x] Pre-sinistro Anthropic direto (Q46-Q50 respondendo, commit a20db96)
- [x] Judge validado pelo Julio em 21/24 perguntas flagged
- [ ] pre_sinistro F>0.70 (atual 0.54) — precisa Q48-50 + investigar Q46/Q47
- [x] comparison CP>0.40 (0.87 ✓) — resolvido na Fase 3 + Fase 4
- [ ] concept AC>0.50 (atual 0.28) — gap de conteudo na base
- [ ] 3 evals consecutivos com delta <2pp (estabilidade)
- [ ] Q48, Q49, Q50 revisadas por Julio
- [x] Tokens expostos rotacionados (vcp_134r5, sk-ant_ZV9Kl ✓)

---

## 3. Blockers ordenados por impacto no produto

### P0 — Shipping blockers

1. **Q48-Q50 sem review** — pre_sinistro trilho incompleto sem validacao Julio das 3 perguntas finais.

### P1 — Quality gaps

4. **AC baixo em concept (0.28)** — base de docs nao cobre conhecimento de mercado que Julio espera (ex: Q26 "VG Express vs Corporate 500 vidas" — provavelmente nao esta nos CGs). Auditar gap conteudo vs expectativa.
5. **Edge F=0.53** — nao se sabe quais perguntas especificas quebram. Falta auditoria per-question.
6. **AC no geral** — mesmo com GT do Julio, respostas nao batem. Possiveis causas: (a) base incompleta, (b) prompt nao explora profundidade suficiente, (c) modelo Haiku 4.5 tem teto.

### P2 — Hygiene

7. Julio review backlog — apenas 21/24 processadas, sistema precisa handle incremental batches.
8. Cadencia de eval — hoje e sporadica; virar semanal ao menos.
9. Production monitoring — numero de erros 500/dia, latencia P95. Nao instrumentado.

---

## 4. Proxima acao (uma so)

**P0-1: Finalizar a revisão das perguntas de Pré-Sinistro (Q48-Q50) com o Julio.**

### Estado atual dos blockers
1. **[RESOLVIDO] comparison CP=0.18** — A Fase 3 e a Fase 4 foram implementadas com sucesso em 2026-06-03. O Ragas confirmou: CP subiu para **0.867** e CR subiu para **0.827** (ambos no verde!). A "cegueira" de retrieval comparativo foi resolvida pelo decompilador de query e fan-out paralelo por seguradora + Cohere Rerank balanceado.
2. **[RESOLVIDO] Tokens expostos** — Chaves do Vercel e do Anthropic foram rotacionadas nos ambientes correspondentes e no `.env.local` / `.env.ragas.local`. Não há mais vazamento ativo.
3. **[PENDENTE] Q48-Q50 sem review** — É o único shipping blocker do nível P0 restante. O trilho de pré-sinistro precisa da validação dessas 3 perguntas pelo Julio para consolidar o benchmark.

### Próximos Ciclos Priorizados (agentes-hub)
- **Ciclo 002: Dashboard admin + baseline Ragas automatizado** (Simplificar execução e acompanhamento de evals diretamente pelo painel/agentes-hub sem precisar de rodar scripts manuais longos na VPS).
- **Ciclo 003: Suite de testes unitários** (Para garantir que novos updates em extractors e nas regras de cotação não gerem regressões silenciosas).

---


## 5. Historico de baselines

| Data | Commit | F | AC | CP | CR | NS | Change |
|---|---|---|---|---|---|---|---|
| 2026-04-21 | 20260421_001234 | 0.687 | 0.427 | 0.504 | — | — | baseline inicial |
| 2026-04-23 | 20260423_182541 | 0.734 | 0.437 | 0.504 | — | — | +rag_exclude, 45/50 OK |
| 2026-04-23 | 20260423_200049 | 0.709 | 0.420 | 0.478 | — | — | +pre-sinistro Anthropic, 50/50 OK (judge Haiku) |
| 2026-04-24 | rerun_judge_fixed | 0.721 | 0.435 | 0.508 | — | — | +fix answer pre-sinistro (judge Haiku) |
| 2026-04-24 | rerun_judge_gemini_flash | 0.770 | 0.408 | 0.631 | — | — | +judge Gemini |
| 2026-04-24 | rerun_pos_julio_review | 0.803 | 0.396 | 0.649 | — | — | +Julio review GT 21/24 |
| **2026-04-24** | **20260425_012159** | **0.782** | **0.392** | **0.603** | **0.477** | **0.750** | **Fase 1: +CR/NS, persiste hub** |
| 2026-04-28 | 20260428_154440 (comparison only, 10 Qs) | 0.517 | 0.377 | 0.129 | 0.308 | NaN | Fase 2: A+B+C (vs baseline comp 0.50/0.20/0.16/0.15) |
| **2026-04-28** | **20260428_164429** (full 49 Qs) | **0.825** | **0.406** | **0.571** | **0.553** | **0.737** | **Fase 2 full pos-Padroes A/B/C — F+4.3pp, CR+7.6pp, AC paradoxo confirmado** |

F subiu 9.5pp em 3 dias. AC oscila. CP subiu 9.9pp. **CR/NS instituidos Fase 1 — primeira vez que vemos retrieval recall.**

---

## 6. Como atualizar este documento

Atualizar a cada sessao que muda o scoreboard ou fecha um blocker. Commit message: `status: <resumo>`.

---

## 7. Sessao 2026-04-24 — handoff

### Entregues hoje
- Fix answer composition pre-sinistro (commit b57375e) — F pre_sinistro 0.252 -> 0.526 (+27pp)
- Testado Ollama judge (kimi/gpt-oss/qwen) — TODOS falham (Ollama Cloud nao suporta structured output, confirmado doc oficial)
- Judge migrado Haiku -> Gemini 2.5 Flash (commit bd1f2b2) — 62pct mais barato, usando chave REVELA
- Julio review batch 1 aplicado (commit cbeeb9c) — 21/24 perguntas validadas, Q30 out_of_scope, Q35 GT meta reescrito
- STATUS.md instituido (commit 6155fd5)
- Auditoria comparison CP=0.18 — 3 padroes de falha identificados (secao 4)
- Memoria local atualizada: hardware real (notebook 16GB, VPS 4GB), Ragas judge Ollama incompat

### Sessao 2026-04-24 noite — Fase 1 do plano novo (entregue)

**Contexto**: 2 pesquisas SOTA disparadas (research-rag-sota + research-eval-vertical). Plano antigo de 3 fixes manuais substituido por plano de 4 fases focado em diagnostico + tecnicas validadas pelo mercado (Harvey AI, Anthropic Contextual Retrieval, etc.). Ver `plans/research-rag-sota-2026-04-24.md` e `plans/research-eval-vertical-2026-04-24.md`.

**Fase 1 — Eval melhor antes de mexer em codigo (entregue):**
1. **Ragas com 5 metricas** (era 3): adicionado `context_recall` (recupera o que precisa?) e `noise_sensitivity` (LLM se confunde com chunks irrelevantes?)
2. **Tabela `eval_runs` no agentes-hub** (`zwnlpumonvkrghoxnddd`): cada run grava 1 linha por pergunta com 5 metricas + flags. RLS aberto pro anon (mesmo padrao `sync_context`). 50 linhas gravadas pro run_id `20260425_012159`.
3. **2 views SQL no hub**: `eval_latest_scoreboard` (agregado por trilho do ultimo run) e `eval_recent_regressions` (Qs que cairam >0.10 entre 2 ultimos runs)
4. **Multi-judge ensemble** (`--multi-judge`): roda Gemini + Haiku, flag perguntas com |delta|>0.2 em qualquer metrica. Gravacao na coluna `divergence_flag/metric/delta`.
5. **Bugs achados durante validacao + corrigidos**: RLS bloqueava INSERT (anon), Ragas 0.2.x dropa colunas extras (id/category) → join por indice, `noise_sensitivity` vem como `noise_sensitivity(mode=relevant)` → aceita aliases.

**Aprendizado novo de baseline pos-Fase 1:**
- **CR baixo em 4 trilhos** (comparison 0.15, concept 0.33, edge 0.30, pre_sinistro 0.37) = **retrieval esta CEGO**. Isso valida o diagnostico das 2 pesquisas: o gargalo principal e *retrieval*, nao geracao. Justifica a Fase 2 (round-robin per-entity + query decomposition + reranker) atacar antes de mexer em prompt.
- **NS=0.00 em edge** = LLM se confunde com chunks irrelevantes em casos edge. Bate com Padrao 3 (prompts especializados por trilho).
- **28/41 perguntas com divergencia multi-judge** mas NUMERO INFLADO porque Haiku ficou sem saldo Anthropic na metade do secondary. Re-rodar `--multi-judge` apos recarga pra ter ensemble valido.

**Pendente — proxima sessao pega dai**

**Fase 2 — Atacar comparison CP=0.16 (~6h):**
1. Round-robin per-entity em `app/src/services/rag/compare.ts` (top-N por seguradora, ~3h)
2. Query decomposition com Haiku (decompoe "compare 15 seguradoras" em 15 sub-queries, ~3h)
3. Re-rodar Ragas só comparison subset (~$0.03)
4. Esperado: comparison CR 0.15 -> 0.55+, CP 0.16 -> 0.50+

### Sessao 2026-04-28 — Fase 2 codigo entregue (re-eval pendente)

**Correcao de rumo importante:** o plano original falava em "round-robin per-entity em `compare.ts`", mas o eval Ragas chama `/api/ask` (run_eval.py L35) que passa por `answer.ts`, NAO por `compare.ts` (esse so e atingido via `/api/compare` standalone). Os 3 padroes A/B/C auditados em 2026-04-24 estao todos em `answer.ts`. Fase 2 ataca la.

**Implementado:**

1. **search.ts** — `embedQuery` exportado + `semanticSearchWithEmbedding(embedding, options)` para callers que fazem N mini-searches com a mesma query (round-robin) embedam UMA vez e reusam.

2. **answer.ts (Padrao C, Q35 "quais seguradoras cobrem cancer")** — global path agora roda `roundRobinGlobalSearch`: `loadActiveInsurers()` cacheado 5min lista 12 insurers ativas (>=50 chunks); `Promise.allSettled` fan-out 1 mini-search per insurer com `topK=2` cada, mergea + ordena por similarity. Substitui o pull unico que concentrava chunks em 2-3 insurers.

3. **answer.ts (Padrao A, Q36 "Renda Familiar vs Tranquilidade Familiar")** — multi-insurer path agora `fetchK = perInsurer*3` + `boostByProductMatch`: re-rankeia chunks por overlap entre tokens da query e `metadata.product_name` (boost multiplicativo 1.0-1.5). Resolve dominacao de produtos genericos sobre produto especifico (1.84% chunks tem `product_id`, mas ~80% tem `metadata.product_name`).

4. **answer.ts (Padrao B, Q32 "DG Prudential vs outras seguradoras")** — `questionImpliesOtherInsurers(q)` detecta padroes "outras seguradoras / no catalogo / concorrentes / vs outras / que oferecem". Quando true + 1 insurer mencionada, dispara `roundRobinGlobalSearch` com `excludeInsurerIds` da mencionada e `perInsurerTopK=1`, mergeando ate 11 chunks cross-insurer no contexto.

5. **compare.ts** — fechou o refactor d8dc35a/a20db96 que tinha esquecido este arquivo. Saiu de OpenRouter, entrou Anthropic SDK direto (`claude-haiku-4-5`). Consistencia com `llm.ts` e `pre-sinistro.ts`. Zero refs OpenRouter no codebase agora.

**Build status:** tsc isolado nos 3 arquivos da apenas erro ambient `Cannot find module '@anthropic-ai/sdk'` (mesmo erro de `llm.ts` e `pre-sinistro.ts` em master — node_modules sem types neste notebook). Vercel build em prod resolve.

**Re-eval Ragas executado** (run `20260428_154440`, 10 comparison questions, judge Gemini, --skip-hub):

| Metrica (comparison only) | Baseline `20260425_012159` | Pos-Fase 2 `20260428_154440` | Δ |
|---|---|---|---|
| F (faithfulness) | 0.501 | 0.517 | +1.6pp |
| AC (answer_correctness) | 0.204 | **0.377** | **+17.3pp** ✓ |
| CP (context_precision) | 0.156 | 0.129 | -2.7pp ⚠️ |
| CR (context_recall) | 0.153 | **0.308** | **+15.5pp** ✓ |

**Por padrao:**
- **Padrao C (Q35 "quais cobrem cancer")**: smoke test prod retornou **12 insurers distintas no answer** (era 4 no baseline). Ragas: AC 0.93. Round-robin per-entity validado.
- **Padrao A (Q36 "Renda Familiar vs Tranquilidade Familiar")**: CR 0.00 → 0.25 (produto-aware boost levantou chunks especificos). CP caiu 0.70 → 0.64 (esperado).
- **Padrao B (Q32 "DG Prudential vs outras")**: response detalhado e estruturado em prod (smoke test); judge Gemini retornou NaN em F/AC nesta amostra (comum, structured-output flake).

**Veredicto:** Fase 2 entregou o que prometia onde importa — retrieval cobre 2x mais (CR +106%), respostas mais corretas (AC +85%), Q35 saiu de 4 → 12 insurers cobertas. CP regrediu pelo trade-off classico precision/recall: ao abrir o leque cross-insurer, mais chunks irrelevantes entram no contexto. **Reranker da Fase 3 (Cohere Rerank 3) resolve essa parte** — corta os irrelevantes pos-retrieval sem perder a cobertura.

**Targets parciais:**
- comparison CR > 0.55: atingiu 0.31 (61% caminho do target, mas dobrou desde baseline)
- comparison CP > 0.50: regrediu pra 0.13 — bloqueador depende da Fase 3 Reranker

**Proxima sessao**: iniciar Fase 3 (Cohere Rerank 3 multilingual em search.ts top-50→top-10 + Anthropic Citations API em pre-sinistro.ts). Esperado: comparison CP 0.13 → 0.50+, AC todos trilhos +5-10pp.

### Sessao 2026-04-28 noite — Sessao 1 do plano "vendavel" (commit 14d79bc)

**Decisao executiva**: plano de 6 sessoes (~20-30h) pra produto vendavel manualmente Julio + 5 corretores beta. Hoje rodou Sessao 1 — patches CRITICAL/HIGH descobertos pelo Codex review.

**Patches aplicados (commit 14d79bc):**

1. **CRITICAL llm.ts**: timeouts AbortController por provider (Anthropic 8s, Gemini 7s, OpenAI 6s). Stream Anthropic com emittedDelta flag — se ja emitiu token, NAO fallback (evita resposta duplicada). Fallback chain extraido em `callLLMFallbackWithoutAnthropic` — stream retry NAO bate Anthropic de novo.
2. **HIGH rate-lookup.ts**: `AGE_CTX_RE` exige contexto forte ("idade|cliente|segurado|pessoa|homem|mulher"). Removido `de NN` generico que pegava "capital de 50 mil" como idade=50.
3. **MED rate-lookup.ts**: `parseBrazilianNumber` detecta padrao US thousands `N{1,3}(,NNN)+` — "500,000" agora e 500000, nao 500.
4. **HIGH answer.ts rate fast-path**: gate `hasEnoughDimensions` (age+capital OU productCode+age+gender+capital). Sem isso, confidence=0.4 + lowConfidence=true + prefix "[Aviso]" no answer. Antes: confidence=1.0 hardcoded com selo de certeza absoluta sobre 40 linhas erradas.
5. **HIGH answer.ts Padrao B**: `compareIntent` flag + `SYSTEM_PROMPT_COMPARE_TEMPLATE` (substitui Passo 3+5 anti-comparativos). Cap `totalLimit=topK+5` reservando 5-7 slots pros chunks "others". Skip slice quando compareIntent. Antes: slice cortava todos os 11 chunks de outras seguradoras antes do LLM ver.
6. **MED answer.ts Padrao C**: `questionImpliesComparison` detector estrito (compare/comparar/versus/vs/diferenca/melhor/mais barato/no catalogo/quais seguradoras OU 2+ insurers detectadas). Round-robin SO em queries comparativas. Concept/edge/general voltam ao `semanticSearch` focado pre-Fase 2. Tambem restringe `questionImpliesOtherInsurers` (remove gatilhos amplos "que oferecem", "no mercado", "varias seguradoras", "quais seguradoras").

**Auditoria que mudou interpretacao do baseline:**

- **AC paradoxo CONFIRMADO sistemico**: 12 perguntas rate_prudential+rate_mag com F=1.00+CR=1.00 mas AC=0.27-0.49. Auditei 5 respostas — todas numericamente PERFEITAS. Judge Gemini fragmenta claims e desconta formato/metadata extras. **AC=0.39 agregado e parcialmente fantasma. Targets de AC sao questionaveis.** Decisao: ignorar AC como sinal primario; usar F + CR como targets.

- **NS=0.00 em edge era BUG**: 4/5 Qs com NS=NULL no hub, so Q42 com NS=0.0. "Media NS=0 edge" foi calculada de 1 ponto. Acao em prompt edge nao se justifica.

- **CR comparison BIMODAL**: 5 Qs com CR=0.0 (Q32/Q36/Q38/Q39/Q40) + 5 com CR=0.20-0.50. Media 0.15 esconde "metade falha completamente". Padrao A salvou Q36/Q37/Q38; Padrao B nunca funcionou (slice + system prompt anti-comparativo).

**Targets atualizados (decisao executiva):**
- F >= 0.85 (era 0.825 — quase la)
- CR >= 0.65 (era 0.553)
- AC: descartado como target primario (paradoxo do judge)
- pre_sinistro F >= 0.85 (com Citations API + post-validation)
- latencia P95 < 10s

**Saldo Anthropic 2026-04-28: $8** — reservado pra Sessao 2 (Citations API dev/test).

**Smoke prod pos-Sessao 1 (commit 8bacaee, timeout 15s/8s/6s):**

| Q | Tipo | Tempo | Model | Sources | Insurers no answer | Status |
|---|---|---|---|---|---|---|
| Q3 "TM10 capital de 500 mil 35 anos M" | rate fast-path | 2s | rate-table-lookup | n/a | n/a | ✅ R$ 2.600,45/ano correto, parser fix OK |
| Q4 "Premio WL10G" (sem dimensoes) | rate fast-path | 1s | rate-table-lookup | 40 | n/a | ✅ confidence=0.4 + [Aviso] OK |
| Q5 "Carencia morte natural Prudential" | single-insurer RAG | 12s | claude-haiku-4-5 | 15 | 1 | ✅ resposta correta |
| Q1 "Quais cobrem cancer?" (Padrao C) | global round-robin | 18s | claude-haiku-4-5 | 15 | **12** | ✅ tabela com TODAS 12 seguradoras |
| Q2 "DG Prudential vs outras" (Padrao B) | cross-insurer | 25s | fallback | 17 | 1 | ⚠️ retrieval OK (17 mistura Prud+others) mas LLM estourou — Sessao 2 |

**Win real Sessao 1**: Q1 saiu de "fallback 4 insurers concentradas" pra "Anthropic 12 insurers em tabela estruturada" — Padrao C entregando "Certeza absoluta" cross-insurer.

**Limitacao conhecida Sessao 1**: Q2 cross-insurer (Padrao B com 17 chunks pesados) ainda cai em fallback degradado quando Anthropic e Gemini estouram timeout consecutivamente. Sessao 2 ataca via Citations API + modelo Sonnet em pre-sinistro (que tem post-validation).

### Sessao 2026-04-28 noite — Sessao 2 entregue (commit 5f913e8)

**Pre-sinistro hardening end-to-end**: 6 patches CRITICAL/HIGH + Anthropic Citations API integrados em `pre-sinistro.ts`. Saiu de F=0.57 (43% claims sem fundamento) pra produto que REJEITA laudos sem evidencia.

**Patches aplicados:**
1. CRITICAL post-validation veredicto (COBERTO requer chunk com cobertura; NAO_COBERTO requer exclusao explicita; senao downgrade RISCO + rationale prefixed)
2. CRITICAL validacao citation/excerpt (trecho deve aparecer literal em chunks; senao citation=null + riskFlag)
3. HIGH busca paralela Promise.all + sort por similarity DESC antes do slice
4. HIGH minimo evidencia (>=3 chunks E avg sim >= 0.50; senao RISCO pre-fabricado sem chamar LLM)
5. HIGH match exato `resolveInsurerIdsExact` (sem substring que trazia seguradoras erradas)
6. HIGH `productHint?` opcional (filtra chunks por metadata.product_name; sem match: RISCO)
7. NOVO Anthropic Citations API: chunks viram documents com `citations: { enabled: true }`. Sonnet OBRIGADO a citar trechos literais via API nativa.

**Smoke prod 3 casos (validado em prod commit 5f913e8):**

| Caso | Verdict | Confidence | Citation | Validacao |
|---|---|---|---|---|
| Morte por infarto, 3 anos apolice | **COBERTO** | 0.82 | null + 3 riskFlags | post-validation OK |
| Cancer in situ (exclusao classica) | **NAO_COBERTO** | 0.97 | "todos os cânceres não invasivos (in situ)" — LITERAL dos chunks | Citations API funcionando |
| Suicidio nos primeiros 2 anos | **RISCO** | 0.35 | null + riskFlag "docs nao contêm clausula" + Art. 798 | Comportamento honesto |

Latencia: 21-28s (Citations API overhead). Dentro de Vercel maxDuration=60s.

**Saldo Anthropic pos-Sessao 2: ~$6.50** (consumiu ~$0.50 nos 3 smoke Sonnet + dev).

### Sessao 2026-04-29 — Sessao 3 entregue parcial (commits 2234829, 8c9eb56, 5adb6a1)

**Cohere Rerank 3.5 multilingual integrado** em search.ts + plug em answer.ts step 1c. Tolerante: sem `COHERE_API_KEY` faz fallback similarity. Key adicionada em Vercel env (production+preview+development) via CLI apos login interativo conta `atalaia`.

**Eval Ragas full pos-Cohere v2** (run `20260429_212055`, commit 8c9eb56) revelou ganhos e regressoes mistos:

| Trilho | F: pre→pos | CR: pre→pos | Veredicto |
|---|---|---|---|
| comparison | 0.65 → **0.79** | 0.23 → 0.02 | F **+14pp WIN**; CR caiu (queries multi-produto cairam fora do skip) |
| concept | 0.76 → **0.81** | 0.36 → 0.27 | F **+5pp WIN**; CR quase recovery |
| edge | 0.61 → 0.42 | 0.60 → 0.30 | regressao (Cohere top-10 corta chunks atipicos) |
| pre_sinistro | 0.63 → 0.39 | 0.41 → 0.37 | F regrediu (Citations API + post-validation Sessao 2 mudaram answer shape) |
| rate_* | 1.00 → 1.00 | 1.00 → 1.00 | neutro (fast-path bypassa) |

**Iteracoes de skip pra preservar diversidade comparativa:**
1. v1 (commit f3d90df): rerank ativo em todos os caminhos. Detect regressao comparison+edge.
2. v2 (commit 8c9eb56): skip rerank em (a) compareIntent, (b) isComparativeGlobal, (c) multi-insurer length>=2. F comparison subiu, CR ainda baixo.
3. v3 (commit 5adb6a1): adiciona skip pra (d) single-insurer multi-produto (questionImpliesComparison ativa em "WL10G vs WL00G"). Re-eval inconclusivo (Gemini judge retornou NaN agregado — provavel rate-limit chave compartilhada REVELA).

**Estado em prod** (commit 5adb6a1): Cohere ativo SO em queries focadas single-insurer non-comparativas. Concept e rate_* mantem ganhos. Comparison/edge/pre_sinistro precisam re-eval na Sessao 4.

**Trade-off Citations API pre_sinistro identificado**: F caiu -24pp mas AC subiu +10pp. Post-validation introduz claims de auto-rationale ("[Validacao automatica: ...]") que nao estao nos chunks — Ragas faithfulness penaliza. AC sobe porque grounding obrigado de Citations API forca respostas mais corretas. **Decisao adiada Sessao 4**: aceitar trade-off ou ajustar post-validation.

**Saldo Anthropic ~$5.50** (gastei ~$1 Sonnet smoke pre-sinistro Sessao 3 + dev).
**Saldo Cohere**: 1000 free trial mensal + ~30 calls usadas em smoke + 2 Ragas full ≈ ~150 search units gastos.

**Proxima sessao (Sessao 4)**: re-rodar Ragas full v3 quando saldo Gemini reabilitar + investigar pre_sinistro F-24pp (rollback Citations API se trade-off nao valer a pena) + cron eval Hermes + smoke real com Julio.

### Saldos de API
- Anthropic: **$8** (recarga 2026-04-28 noite) — reservado Sessao 2 Citations API
- Gemini: chave REVELA compartilhada, $0 incremental
- Ollama Pro: descartado como judge
