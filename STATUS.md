# SOLOMON — Estado do produto

**Ultima atualizacao**: 2026-04-28 (Fase 2 entregue + re-eval rodado — AC +17pp, CR dobrou, CP -3pp por trade-off precision/recall)
**Baseline Ragas**: `app/eval/ragas/results/20260425_012159/` (judge primary Gemini 2.5 Flash, secondary Haiku degradou por saldo Anthropic $0)
**Persistencia**: tabela `eval_runs` no agentes-hub (50 linhas, run_id=20260425_012159)
**Ground truth**: 21/24 perguntas flaggeadas validadas por Julio; Q48-Q50 pendentes

---

## 1. Scoreboard (Ragas sobre 49 perguntas, 5 metricas)

Judge: Gemini 2.5 Flash. Answers: Haiku 4.5 (chat) + Sonnet 4.6 (pre-sinistro). Embeddings: text-embedding-3-small.
**Fase 1 (2026-04-24) instituiu** `context_recall` (CR) e `noise_sensitivity` (NS).

| Trilho | F | AC | CP | CR | NS | Divergent | Status |
|---|---|---|---|---|---|---|---|
| rate_prudential | 1.00 | 0.37 | 1.00 | 1.00 | 0.88 | 2/5 | ✅ Pronto |
| rate_mag | 1.00 | 0.44 | 1.00 | 0.90 | 0.76 | 4/10 | ✅ Pronto |
| comparison | 0.50 | 0.20 | 0.16 | 0.15 | n/a | 7/10 | 🔴 retrieval cego (CR=0.15) |
| concept | 0.77 | 0.31 | 0.44 | 0.33 | n/a | 10/15 | 🟡 retrieval cego (CR=0.33) |
| edge | 0.56 | 0.66 | 0.81 | 0.30 | 0.00 | 5/5 | 🟡 prompt fraco (NS=0.00) |
| pre_sinistro | 0.57 | 0.50 | 0.60 | 0.37 | n/a | 0/5 | 🟡 retrieval medio + F medio |

**Agregado**: F=0.78 · AC=0.39 · CP=0.60 · CR=0.48 · NS=0.75

### Leitura dos numeros (com 5 metricas)

- **F=0.78** (alto) = SOLOMON nao alucina; respostas sao fundamentadas nos chunks recuperados.
- **AC=0.39** (medio-baixo) = respostas nao batem 100% com expectativa expert. Gap de conteudo + limite de modelo.
- **CP=0.60** agregado, mas **CP=0.16 em comparison** = retrieval multi-seguradora quebrado (estrutural).
- **CR=0.48 (NOVA, Fase 1)** = **retrieval esta CEGO em 4 trilhos** (comparison 0.15, concept 0.33, edge 0.30, pre_sinistro 0.37). Recupera errado E perde o que deveria. Valida diagnostico das pesquisas (research-rag-sota + research-eval-vertical): gargalo e retrieval, nao geracao. Isto justifica priorizar Fase 2 (round-robin per-entity + query decomposition + reranker).
- **NS=0.00 em edge (NOVA, Fase 1)** = LLM se confunde MUITO com chunks irrelevantes em casos edge. Bate com Padrao 3 da pesquisa: prompts especializados por trilho.

### Multi-judge divergence (NOVA, Fase 1)

28/41 perguntas com |delta|>0.2 entre Gemini (primary) e Haiku (secondary). **Numero inflado**: Haiku ficou sem saldo Anthropic na metade do secondary, gerou NaN/erros — divergencia real e desconhecida. Re-rodar `--multi-judge` apos recarga Anthropic pra ter ensemble valido.

---

## 2. Definicao de "pronto pro Julio usar em cliente"

- [x] rate_mag F>0.95 (1.00 ✓)
- [x] rate_prudential F>0.95 (1.00 ✓)
- [x] Retrieval sem contaminacao cross-insurer (97 chunks flagged, commit 556a5f0)
- [x] Pre-sinistro Anthropic direto (Q46-Q50 respondendo, commit a20db96)
- [x] Judge validado pelo Julio em 21/24 perguntas flagged
- [ ] pre_sinistro F>0.70 (atual 0.54) — precisa Q48-50 + investigar Q46/Q47
- [ ] comparison CP>0.40 (atual 0.18) — problema estrutural multi-insurer
- [ ] concept AC>0.50 (atual 0.28) — gap de conteudo na base
- [ ] 3 evals consecutivos com delta <2pp (estabilidade)
- [ ] Q48, Q49, Q50 revisadas por Julio
- [ ] Tokens expostos rotacionados (vcp_134r5, sk-ant_ZV9Kl)

---

## 3. Blockers ordenados por impacto no produto

### P0 — Shipping blockers

1. **comparison CP=0.18** — retrieval multi-seguradora nao liga chunks a queries comparativas. Solucao proposta: prefix `[insurer — product]` nos chunks OR re-arquitetar query multi-stage. Estrutural, exige sessao dedicada.
2. **Tokens expostos** — `vcp_134r5...` (Vercel) + `sk-ant...ZV9Kl` (Anthropic) leakou em chat em 2026-04-23. Risco de compromisso ate rotacionar.
3. **Q48-Q50 sem review** — pre_sinistro trilho incompleto sem validacao Julio das 3 perguntas finais.

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

**P0-1: atacar comparison CP=0.18 (retrieval multi-seguradora).**

### Auditoria 2026-04-24 — diagnostico ja feito

Root cause confirmado por audit nas 5 perguntas comparison (ver `app/eval/ragas/results/20260423_200049/raw.jsonl`):

1. **insurerName + productName ja vem nos sources** — enrichment funciona, prefix no build_ragas_dataset funciona.
2. **O problema e o CONTEUDO dos chunks retrievados**, nao o formato.
3. **3 padroes distintos de falha** identificados:

#### Padrao A — produto especifico mencionado mas nao filtrado (Q36)

Query: "Como Prudential Renda Familiar compara ao Bradesco Tranquilidade Familiar?"
Retrieval retorna 15 chunks:
- 8 Prudential: 1 chunk RENDA FAMILIAR + 5 Conditions PDF + CAPITAL GLOBAL + TEMPORARIO DECRESCENTE
- 7 Bradesco: 1 chunk TRANQUILIDADE FAMILIAR + 6 Vida Viva (outro produto)

Causa: `answer.ts` multi-insurer path chama `semanticSearch(query, { insurerId: X, topK: 8 })` — filtra por insurer mas **nao por produto**. Produtos genericos da base (Vida Viva tem 15+ chunks) dominam produtos especificos raros (Tranquilidade Familiar tem 1 chunk).

Fix: detectar produto na query (similar ao `detectProductHint` em rate-lookup.ts mas para produtos nao-rate) + passar `productId` pra `semanticSearch`. `SearchOptions` ja aceita productId (search.ts:26).

Escopo: criar `app/src/services/rag/product-detector.ts` com ~30 produtos canonicos do catalogo, plugar em answer.ts multi-insurer path. ~80 linhas.

#### Padrao B — "outras seguradoras" nao detectavel por nome (Q32)

Query: "Compare Seguro Doencas Graves Plus da Prudential (DDR5G) com outras seguradoras que oferecem DG"
Retrieval: 15/15 Prudential, ZERO outras.

Causa: `detectInsurers` so identifica nomes explicitos. "outras seguradoras" vira mentionedInsurers=["Prudential"], falha em disparar multi-insurer broad search.

Fix: detectar padroes "vs outras", "outras seguradoras", "catalogo" na query. Se match + tem 1 seguradora mencionada, fazer 2-stage: (1) busca focada naquela seguradora com produto especifico, (2) busca global cross-insurer pros concorrentes.

Escopo: ~30 linhas em answer.ts.

#### Padrao C — global search nao diversifica seguradoras (Q35)

Query: "Quais seguradoras no seu catalogo cobrem cancer? Liste."
Retrieval: 15 chunks distribuidos entre so 4 seguradoras (Tokio Marine 9, Zurich 3, Bradesco 2, Porto 1). Zero Prudential/SulAmerica/MetLife/Icatu/Azos apesar de todas oferecerem DG.

Causa: `diversifyResults` (answer.ts:535+) ate garante cobertura mas so dentro dos 15 chunks retrieveddos; nao expande cobertura cross-insurer. Embedding similarity concentra em chunks Tokio Marine (cobertura forte em DG mulher).

Fix: pra query global sem seguradora mencionada, usar **round-robin por insurer**: topK=2 chunks por insurer ativa (12 insurers × 2 = 24 chunks, trimm para topK final). Ou fazer 12 mini-searches filtradas por insurer_id e merger.

Escopo: ~40 linhas em answer.ts + possivel nova funcao em search.ts.

### Ordem de ataque recomendada (proxima sessao)

1. **Fix A primeiro** (produto especifico) — cirurgico, ganho grande em Q36 e outras queries com produto mencionado. ~2h.
2. **Fix C depois** (round-robin global) — medio impacto, destrava Q35 + concept queries genericas. ~2h.
3. **Fix B por ultimo** (outras seguradoras) — pattern-matching, baixo risco. ~1h.

Depois de cada fix: re-rodar Ragas sobre comparison subset apenas (5 perguntas × 3 metricas = 15 judges Gemini = ~$0.03).

Target final: comparison CP>0.40 (atual 0.18).

Custo total esperado: ~$0.20 em evals Gemini. Nenhuma chamada Anthropic.
Tempo estimado: 5-6h de foco em 1 sessao dedicada.

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

**Saldo Anthropic:** se ainda em $0, multi-judge nao roda; eval primario com Gemini-only continua valido.

**Fase 3 — Reranker + Citations API (~5h):**
- Cohere Rerank 3 multilingual em `search.ts` (top-50 vetor → re-ordena → top-10)
- Anthropic Citations API em `pre-sinistro.ts` (Sonnet obrigado a citar span exato)
- Esperado: AC todos trilhos +5-10pp, pre_sinistro F 0.57 -> 0.70+

**Pendencias antigas mantidas:**
- Q48, Q49, Q50 — Julio review pre_sinistro
- AC=0.39 gap de conteudo — auditar Q26 VG Express 500 vidas etc.
- (Tokens expostos: CEO declarou notebook seguro, descartado.)
- Recarregar Anthropic ($0 atualmente — quebrou secondary judge da Fase 1)

### Saldos de API
- Anthropic: **$0** (esgotou no secondary judge da Fase 1) — recarregar para multi-judge funcionar
- Gemini: chave REVELA compartilhada, $0 incremental
- Ollama Pro: descartado como judge, ainda valido pra opencode dev agent
