# SOLOMON — Phase 2 / Slice 3B.6.4 — Ragas LLM judge (CP + CR) on the scoped Prudential set

_Generated 2026-05-17. Authorized by CEO after PR #47 (slice 3B.7.10) falsified the top-K dilution hypothesis. Pure retrieval evaluation: no answer generation, no faithfulness / AC / NS in this slice. Read-only against the live legacy + shadow corpora._

**Predecessor chain:** PR #45 (Q16 audit) → PR #46 (token fix) → PR #47 (K=20 falsification) → **PR #48 (this slice)**.

Per CEO authorization: the keyword-overlap proxy reached its evidentiary limit on Q16's `vida inteira` residual. This slice replaces the substring proxy with an LLM-judge that reads contexts vs the Julio-validated ground truth.

## 1. Design

**Scope:** Ragas `LLMContextPrecisionWithReference` + `LLMContextRecall` ONLY.

Both metrics are 100% retrieval-quality: they read `(question, retrieved_contexts, reference)` and judge whether the contexts are relevant and whether they cover the reference. **Neither requires a generated answer.** Skipping faithfulness / answer_correctness / noise_sensitivity in this slice avoids replicating the production `answer.ts` prompt — keeping the harness fully decoupled from the read path.

**Harness:** `app/eval/ragas/run_shadow_eval.py`. For each of the 9 scoped Prudential questions × `{legacy match_documents, shadow match_shadow_documents}`:
1. Embed the question via `text-embedding-3-small` (same model as production `embedder.ts`).
2. Dispatch the embedding to both Supabase RPCs with `match_count=10`, `match_threshold=0.0`, `filter_insurer_id=Prudential do Brasil` — same args, same insurer, no parameter divergence.
3. Capture retrieved chunks; reduce to plain-text contexts (headings prefix mirrors `getScoringText` so the judge sees the same surface the proxy did).
4. Pull Julio-validated `ground_truth` for each question id from `app/eval/ragas/questions.jsonl`.
5. Build Ragas `Dataset` over all 18 rows with `(user_input, retrieved_contexts, reference)`.
6. Run Ragas `evaluate()` with the two metrics, judge = Gemini 2.5 Flash, embeddings = `text-embedding-3-small`.
7. Re-attach `id / scope / corpus` by row position (Ragas 0.2.x drops extra columns) → per-row CSV + per-scope JSON aggregates + Markdown report.

**Decision rule (stop signal):** Aggregate over `scope='conditions'` rows only. `control_rate_table` and `out_of_scope_commercial` are reported informationally and never feed the stop. Stop fires if shadow loses on CP **or** CR vs legacy on the conditions aggregate. **NaN aggregates exit code 2** (fail-loud, slice 3B.6.4 hardening).

## 2. Judge / model / cost config

| Item | Value | Source |
|---|---|---|
| Judge LLM | **Gemini 2.5 Flash** (`gemini-2.5-flash`) | `metrics.py:_build_gemini_judge` |
| Judge temperature | 0.0 | `metrics.py` |
| Judge max_output_tokens | 8192 | `metrics.py` |
| Embedding model | `text-embedding-3-small` | `metrics.py:build_evaluator_embeddings` + `embedder.ts` |
| CP metric class | `ragas.metrics.LLMContextPrecisionWithReference` | Ragas 0.2.15 |
| CR metric class | `ragas.metrics.LLMContextRecall` | Ragas 0.2.15 |
| Retrieval params | `match_count=10`, `threshold=0.0`, `filter_insurer_id=Prudential do Brasil` | Mirrors production read path |
| Ragas RunConfig | `max_workers=4, timeout=600, max_retries=2` | Slice 3B.6.4 — default `max_workers=16, timeout=180` was too aggressive |
| Multi-judge | NO (single judge for this slice; ensemble gated as follow-up if needed) | — |

**Real cost (paid Gemini 2.5 Flash, 2026-05 list: $0.30/M input, $2.50/M output):**

| Run | Calls | Wall clock | Approx tokens (in/out) | Cost (USD) |
|---|---:|---:|---|---:|
| Smoke 1 (Q16, free tier) | 4 | 174 s | ~12k / ~1k | $0 (free tier, exhausted daily 20-req quota) |
| Full attempt #1 (Gemini free, default concurrency) | 36 | 620 s | n/a (429s on all 36) | $0 — all `RESOURCE_EXHAUSTED` |
| Full attempt #2 (Anthropic Haiku, zero credit) | 36 | 12 s | n/a (400s on all 36) | $0 — all `credit balance too low` |
| Smoke 2 (Q16, **paid Gemini**) | 4 | 41 s | ~12k / ~1k | **~$0.006** |
| **Full final (Gemini paid, throttled)** | **36** | **183 s** | **~108k / ~9k** | **~$0.055** |

**Aggregate cost for the slice: < $0.07.**

The "credit / quota / fail-loud" sequence is captured because it is part of the honest evidence. Both the Gemini free-tier quota (20 req/day per model) and the Anthropic zero-balance hit at the same time. Switching to the CEO-provided paid Gemini key resolved it; the NaN-fail-loud guard added in this slice ensured the failure mode could not silently mark a run as "passing".

## 3. Smoke result (Q16 only, `--limit 1`)

| id | scope | corpus | CP | CR | n_contexts |
|---|---|---|---:|---:|---:|
| Q16 | conditions | legacy | 1.000 | 0.500 | 3 |
| Q16 | conditions | shadow | 0.807 | 0.500 | 10 |

Smoke confirms the harness works end-to-end and that Q16 CR is **a tie at 0.500** under semantic judgment — directly contradicting the proxy's 100 vs 75 verdict.

## 4. Full-run results

### 4.1 Per-row CP and CR (all 18 rows, 9 Qs × {legacy, shadow})

| id | scope | corpus | CP | CR | n_contexts |
|---|---|---|---:|---:|---:|
| Q16 | conditions | legacy | 1.000 | 0.500 | 3 |
| Q16 | conditions | shadow | 0.807 | 0.500 | 10 |
| Q17 | conditions | legacy | 0.526 | 0.000 | 10 |
| Q17 | conditions | **shadow** | **0.948** | **0.500** | **10** |
| Q26 | out_of_scope_commercial | legacy | 0.000 | 0.000 | 10 |
| Q26 | out_of_scope_commercial | shadow | 0.000 | 0.000 | 10 |
| Q31 | conditions | legacy | 0.500 | 0.000 | 10 |
| Q31 | conditions | shadow | 0.000 | 0.000 | 10 |
| Q32 | conditions | legacy | 0.000 | 0.000 | 10 |
| Q32 | conditions | shadow | 0.000 | 0.000 | 10 |
| Q36 | conditions | legacy | 0.000 | 0.250 | 10 |
| Q36 | conditions | shadow | 0.833 | 0.000 | 10 |
| Q37 | conditions | legacy | 0.000 | 0.000 | 0 |
| Q37 | conditions | shadow | 0.000 | 0.000 | 10 |
| Q38 | control_rate_table | legacy | 0.000 | 0.000 | 10 |
| Q38 | control_rate_table | shadow | 0.000 | 0.000 | 10 |
| Q39 | control_rate_table | legacy | 0.250 | 0.200 | 10 |
| Q39 | control_rate_table | shadow | 0.000 | 0.000 | 10 |

### 4.2 Aggregates by scope

| scope | Qs | legacy CP | shadow CP | dCP | legacy CR | shadow CR | dCR |
|---|---:|---:|---:|---:|---:|---:|---:|
| **conditions (drives stop)** | **6** | **0.338** | **0.432** | **+0.094** | **0.125** | **0.167** | **+0.042** |
| control_rate_table (informational) | 2 | 0.125 | 0.000 | -0.125 | 0.100 | 0.000 | -0.100 |
| out_of_scope_commercial (informational) | 1 | 0.000 | 0.000 | +0.000 | 0.000 | 0.000 | +0.000 |

### 4.3 Q16-specific read (the residual that drove this slice)

| Source | legacy CP | shadow CP | legacy CR | shadow CR |
|---|---:|---:|---:|---:|
| Proxy at K=10 (PR #46) | 100.0% | 90.0% | 100.0% | 75.0% |
| Proxy at K=20 (PR #47) | 100.0% | 85.0% | 100.0% | 75.0% |
| **Ragas at K=10 (this slice)** | **1.000** | **0.807** | **0.500** | **0.500** |

**Q16 verdict under semantic judge: TIE on CR (0.500 = 0.500), shadow -19pp on CP** — the precision delta is structural (shadow returns 10 chunks vs legacy's 3 above similarity > 0 because Q16's question embedding only matches 3 chunks strongly enough for legacy's smaller, denser corpus). CR equality means **the proxy's -25pp recall gap was entirely a measurement artifact**, exactly as PR #45's audit suspected. The semantic judge confirms shadow retrieval covers the Q16 ground truth equally well.

## 5. Executive read (honest)

1. **Aggregate stop signal CLEAR.** In-scope conditions: shadow CP 0.432 vs legacy 0.338 (+9.4pp), shadow CR 0.167 vs legacy 0.125 (+4.2pp). Shadow > legacy on BOTH metrics.

2. **Q16 (the entire chain's residual) is NEUTRAL on retrieval coverage.** Shadow CR ties legacy CR at 0.500. The proxy's -25pp gap was the substring metric's blind spot, not a real chunker defect. The PR #45 audit's hypothesis (top-K dilution / token brittleness) was right about the **direction** (the proxy was wrong); the K=20 falsification only ruled out the **specific mechanism** (top-K cutoff), not the conclusion.

3. **Q17 is the headline win for shadow.** Shadow CR 0.500 vs legacy 0.000; shadow CP 0.948 vs legacy 0.526. Legacy retrieves zero chunks that cover the GT; shadow retrieves chunks the judge can ground the answer in. This is the kind of gap the keyword proxy could not see (both got 100/100 in the PR #44 proxy run).

4. **Q31 is the lone in-scope regression.** Shadow CP drops from 0.500 → 0.000 (CR both 0). Q31 is the "comparar premio TM10 vs Bradesco Tranquilidade" question — the legacy ingestion happens to retrieve one chunk the judge marks relevant, the shadow chunker's top-10 doesn't. CR=0 for both → neither corpus actually answers the GT for this question; the CP gap is on irrelevant chunks. Worth noting but not gating: aggregate still positive.

5. **Q32, Q37: both 0/0 on both corpora.** These two ask the judge to evaluate retrieval where the ground truth is hard for substring (Q32: DDR5G product disambiguation) or impossible (Q37 legacy returned 0 chunks). Neither corpus wins; informationally honest.

6. **Q36 is an inversion.** Legacy gets CR=0.250 with CP=0.000 (the relevant chunk is buried); shadow gets CP=0.833 with CR=0.000 (precision is high on the wrong axis). Net effect on aggregate: legacy +0.125 CR vs shadow +0.083 CP gap-on-average — but the aggregate still tilts shadow.

7. **Absolute scores are low.** Aggregate CR of 0.167 (shadow) / 0.125 (legacy) means even the better corpus surfaces only ~16% of the Julio-validated ground truth on average. This is not a state for production-quality answers; it is, however, a **clean comparative signal** that says shadow is the better corpus for the same retrieval workload. Promotion design should land first; absolute-quality work (answer generation, faithfulness, larger top-K, hybrid retrieval) is the natural next phase.

8. **Control aggregates regress as designed.** Q38/Q39 (rate_table_pdf questions) — shadow scores 0 because the shadow corpus is `conditions_pdf` only by contract. Reported but informational; does not gate.

## 6. Decision per CEO criterion

The CEO's criterion (verbatim from the slice-3B.6.4 brief):

> se Ragas confirmar shadow neutro/melhor em Q16 e aggregate in-scope não regredir, próxima decisão pode ser promotion design controlado
>
> se Ragas também flagrar Q16, reabrir investigação de chunker/corpus para Q16 antes de qualquer promoção

**Both halves of criterion A are met:**

- **Q16 shadow is NEUTRAL on CR vs legacy** (tie at 0.500). Not "melhor", but explicitly "neutro" — which is what the criterion authorized.
- **Aggregate in-scope did NOT regress.** It moved **positive** on both metrics (+9.4pp CP, +4.2pp CR).

**Recommendation:** Authorize **slice 3C — promotion design (controlled)**.

The full evidence package across PR #45 → #48 reads cleanly: shadow corpus is structurally correct (chunker indexed all 22 Prudential URLs, semantic chunker behaves consistently), the residual that worried us on Q16 was a proxy artifact, and the semantic judge confirms the aggregate move is in the right direction. The natural next step is to design a **controlled, reversible promotion path** — read-path switch behind a flag or per-insurer toggle, with monitoring and a fast rollback. Nothing in this slice authorizes the promotion itself.

## 7. Guardrails honored

Prudential-only. `conditions_pdf` only. No DELETE. No promotion. No read-path change. No embedder rerun. No edits to `match_documents` / `match_shadow_documents` / `answer.ts` / `compare.ts`. No Azos / MAG. No Agentic RAG / PageIndex. No page-span 100. No answer generation (faithfulness / AC / NS deferred — explicit per CEO scope). Single judge (multi-judge ensemble deferred). Branch via REST API push (Windows 403 workaround).

## 8. Artifacts

- Harness: `app/eval/ragas/run_shadow_eval.py`.
- Raw retrieval: `app/eval/ragas/results/shadow-20260517_180706Z/raw_retrieval.jsonl` (on VPS).
- Per-row scores (committed): `docs/audit-runs/phase-2-pr3b6.4-20260517T180706Z/ragas_per_row.csv`.
- Aggregates (committed): `docs/audit-runs/phase-2-pr3b6.4-20260517T180706Z/aggregates.json`.
- Auto-generated report (committed): `docs/audit-runs/phase-2-pr3b6.4-20260517T180706Z/shadow-eval-report.md`.
- Evidence package (this doc): `docs/phase-2-pr3b6.4-ragas-judge.md`.
- Smoke timestamps: free-tier `20260517_173004Z` (4 calls, Gemini free), paid `20260517_180607Z` (4 calls).
- Full-run timestamp: `20260517_180706Z` (36 calls, Gemini paid, 183s wall clock, ~$0.055).
