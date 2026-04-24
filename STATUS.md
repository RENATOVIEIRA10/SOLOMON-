# SOLOMON — Estado do produto

**Ultima atualizacao**: 2026-04-24 (pos review Julio batch 1)
**Baseline Ragas**: `app/eval/ragas/results/20260424_rerun_pos_julio_review/`
**Ground truth**: 21/24 perguntas flaggeadas validadas por Julio; Q48-Q50 pendentes

---

## 1. Scoreboard (Ragas sobre 49 perguntas)

Judge: Gemini 2.5 Flash. Answers: Haiku 4.5 (chat) + Sonnet 4.6 (pre-sinistro). Embeddings: text-embedding-3-small.

| Trilho | F | AC | CP | Status |
|---|---|---|---|---|
| rate_mag | 1.00 | 0.45 | 1.00 | ✅ Pronto |
| rate_prudential | 1.00 | 0.42 | 1.00 | ✅ Pronto |
| comparison | 0.77 | 0.25 | 0.18 | 🟡 CP estrutural; AC gap dataset |
| concept | 0.77 | 0.28 | 0.48 | 🟡 AC gap dataset/docs |
| edge | 0.53 | 0.63 | 0.86 | 🟡 F medio; AC/CP OK |
| pre_sinistro | 0.54 | 0.51 | 0.61 | 🟡 F medio; Q48-50 sem review |

**Agregado**: F=0.803 · AC=0.396 · CP=0.649

### Leitura dos numeros

- **F=0.80** (alto) = SOLOMON nao alucina; respostas sao fundamentadas nos chunks recuperados.
- **AC=0.40** (medio-baixo) = mesmo com GT validado por Julio, respostas nao batem com expectativa expert. Isso e gap de **conteudo da base**, nao de prompt.
- **CP=0.65** agregado, mas **CP=0.18 em comparison** = retrieval multi-seguradora quebrado (problema estrutural, nao LLM).

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

| Data | Commit | F | AC | CP | Change |
|---|---|---|---|---|---|
| 2026-04-21 | 20260421_001234 | 0.687 | 0.427 | 0.504 | baseline inicial |
| 2026-04-23 | 20260423_182541 | 0.734 | 0.437 | 0.504 | +rag_exclude, 45/50 OK |
| 2026-04-23 | 20260423_200049 | 0.709 | 0.420 | 0.478 | +pre-sinistro Anthropic, 50/50 OK (judge Haiku) |
| 2026-04-24 | rerun_judge_fixed | 0.721 | 0.435 | 0.508 | +fix answer pre-sinistro (judge Haiku) |
| 2026-04-24 | rerun_judge_gemini_flash | 0.770 | 0.408 | 0.631 | +judge Gemini |
| **2026-04-24** | **rerun_pos_julio_review** | **0.803** | **0.396** | **0.649** | **+Julio review GT 21/24** |

F subiu 11.6pp em 3 dias. AC oscila. CP subiu 14.5pp.

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

### Pendente — proxima sessao pega dai

1. **Implementar os 3 fixes de comparison** (secao 4) — ordem recomendada: A -> C -> B
2. **Q48, Q49, Q50** — Julio review pendente (pre_sinistro)
3. **Tokens expostos** — rotacionar `vcp_134r5...` (Vercel) + `sk-ant...ZV9Kl` (Anthropic)
4. **AC=0.40 gap de conteudo** — auditar conhecimento faltante na base vs expectativa Julio (ex: Q26 VG Express 500 vidas nao esta nos CGs)

### Saldos de API
- Anthropic: ~$1.90 restante (nao queimado nesta sessao)
- Gemini: chave REVELA compartilhada, $0 incremental
- Ollama Pro: descartado como judge, ainda valido pra opencode dev agent
