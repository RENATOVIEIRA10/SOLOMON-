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

Hipotese: quando query menciona 2+ seguradoras, retrieval retorna chunks sem contexto de qual seguradora e qual produto. Ragas CP=0 confirma: judge nao consegue ligar chunks as claims da resposta.

Abordagem proposta:
1. Audit: pegar Q33/Q35/Q36 (comparison multi-insurer), ver quais chunks voltaram e se tem marcacao clara de `insurer_name` + `product_name`
2. Se falta prefix nos chunks: adicionar no build_context antes de mandar pro LLM
3. Re-rodar Ragas sobre mesmas Qs apos fix
4. Target: CP>0.40 em comparison

Custo: 1 eval rodada Gemini (~$0.24).
Tempo estimado: 2-4h.

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
