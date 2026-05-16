# SOLOMON — Phase 2 PR 3B.6 Design: shadow embeddings + isolated eval harness

_Read-only design. No code, no migration, no DB write, no re-ingestion. Generated 2026-05-16._

**Issue:** [#13 — Phase 2: Azure DI Layout redesign for `conditions_pdf` retrieval](https://github.com/RENATOVIEIRA10/SOLOMON-/issues/13)
**Predecessor:** PR 3B.5 (shadow indexer + batch mode + ORPHAN_SUPERSET classification — closed, accepted by CEO 2026-05-16).
**Sources of truth:** Supabase produto `ohmoyfbtfuznhlpjcbbk` (live queries this session), `docs/phase-2-pr3b-plan.md`, `docs/phase-2-azure-di-architecture.md`, slice 3B.5 audit reports under `docs/audit-runs/phase-2-pr3b5-*`.

> **Phase 2 mother-rule:** Phase 2 replaces the chunker. It does **not** tune the retriever to compensate for bad chunks. PR 3B.6 measures whether the new chunker delivers a real retrieval ganho; it does not promote.

---

## 0. Status snapshot — where 3B.5 left us

| Surface | Value |
|---|---:|
| v4 shadow rows (slice 3B.5 product) | **150** |
| Distinct Prudential URLs covered | **22** |
| Shadow rows with `embedding` populated | **0** |
| Shadow rows with `valid_until = '1970-01-01T00:00:00Z'` (sentinel) | **150** |
| Shadow rows leaked into read path | **0** |
| `match_documents` top-50 contamination | **0 / 0** |
| Legacy v3 orphans (kept by no-DELETE) | 29 rows / 6 URLs |
| Production read path | **unchanged across all 5 slice PRs** |

The shadow set is the textual foundation. PR 3B.6 turns it into a measurable retrieval signal.

---

## 1. Goal

Quantify the retrieval ganho the new chunker delivers on Prudential, **without touching production**.

The measurement is concrete: take the 9 Prudential-impacted Ragas questions (6 `comparison` + 3 `concept` from the Phase 7 baseline — see `docs/phase-2-pr3b-plan.md` §3), run two parallel retrievals on the **same query embedding**:

1. **Legacy retrieval** — the existing production path (`match_documents` over rows with `valid_until IS NULL`, no shadow flag).
2. **Shadow retrieval** — a NEW, isolated function that searches over the v4 shadow set (sentinel `valid_until`, `metadata.shadow = true`, `hash_scheme = 'url-aware-v1'`) and returns nothing else.

Compare the retrieved contexts side-by-side: chunk count, page distribution, clause coverage, and (the actual lever) the Ragas metrics that fed the B2 gate — `context_precision` (CP), `context_recall` (CR), `faithfulness` (F), `answer_correctness` (AC), `noise_sensitivity` (NS).

The deliverable is a numeric `before / after` report, not a promotion.

---

## 2. Architecture — four components, all isolated

```
            ┌────────────────────────────────────────────────────────┐
            │             3B.6 — isolated shadow stack                │
            │                                                          │
  catalog ──┼──┐  v4 shadow rows                                       │
  (Prud.)   │  │  (150, embedding=null)                                │
            │  │                                                       │
            │  ▼                                                       │
            │ ┌─────────────────────┐   ┌──────────────────────┐       │
            │ │ shadow-embedder.ts  │──►│ documents.embedding  │       │
            │ │  (Prudential-only,  │   │  on shadow rows only │       │
            │ │  Prudential guard,  │   │  (still inert by     │       │
            │ │  idempotent)        │   │   valid_until)       │       │
            │ └─────────────────────┘   └──────────────────────┘       │
            │                                  │                       │
            │                                  ▼                       │
            │                         ┌────────────────────────┐       │
            │                         │ match_shadow_documents │       │
            │                         │ (NEW SQL function:     │       │
            │                         │  reads ONLY shadow     │       │
            │                         │  rows; same signature  │       │
            │                         │  as match_documents)   │       │
            │                         └────────────────────────┘       │
            │                                  │                       │
            │                                  ▼                       │
            │                         ┌────────────────────────┐       │
            │                         │ shadow-eval-harness    │       │
            │                         │ (9 Prudential Qs,      │       │
            │                         │  legacy vs shadow,     │       │
            │                         │  Ragas 5-metric        │       │
            │                         │  side-by-side report)  │       │
            │                         └────────────────────────┘       │
            │                                                          │
            └────────────────────────────────────────────────────────┘
                            ▲
                            │   nothing here touches the
                            │   production read path
                production read path (answer.ts, compare.ts,
                match_documents) remains EXACTLY as today
```

Four pieces, each independently reversible:

| # | Component | Lives in | DB effect |
|---|---|---|---|
| 1 | Shadow embedder | `app/scripts/phase2/azure-di-shadow-embedder.ts` + pure helper | UPDATE: `documents.embedding` on shadow rows only |
| 2 | Isolated retrieval | new SQL function `match_shadow_documents` in a new migration | new function only, read-only |
| 3 | Eval harness | `app/eval/shadow/` (new subdir) | none |
| 4 | Before/after report | `docs/audit-runs/phase-2-pr3b6-<ts>/REPORT.md` | none |

`match_documents` (the function the production read path actually calls — `answer.ts:629` and `compare.ts`) is **not edited**.

---

## 3. Surface decisions — where things live and what they touch

### 3.1 Where does the shadow embedding live?

**On `documents.embedding` of the same shadow row.** The column already exists, every shadow row currently has it `null`, and writing to it does not change inertness — `valid_until` is still the sentinel and `match_documents` still filters `valid_until IS NULL`, so production retrieval cannot see the embedding regardless of its value.

This avoids creating a parallel `shadow_documents` table. Three reasons:

1. The unique key `(content_hash, chunk_index)` already keeps shadow and prod rows in disjoint hash spaces (`shadow-v4:` prefix).
2. Adding a parallel table forks every join, index, and RLS rule. A single column update on rows already excluded from reads is the smallest mechanism.
3. Promotion (future, B2-gated) becomes a single SQL: `UPDATE documents SET valid_until = NULL WHERE metadata->>'shadow' = 'true' AND ...`. With a parallel table promotion would be a copy.

**Hard guardrail:** the embedder UPDATE statement MUST filter `valid_until = SHADOW_VALID_UNTIL_SENTINEL` AND `metadata->>'hash_scheme' = 'url-aware-v1'`. A `WHERE` clause that omits either is rejected at code review.

### 3.2 Isolated retrieval function

A new SQL function:

```sql
CREATE OR REPLACE FUNCTION match_shadow_documents(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_insurer_id uuid DEFAULT NULL
) RETURNS TABLE(id uuid, content text, metadata jsonb, similarity float)
```

Differences from production `match_documents` (the one referenced by `app/src/services/rag/answer.ts:629` and the baseline migration):

| | `match_documents` (prod) | `match_shadow_documents` (3B.6) |
|---|---|---|
| `valid_until` filter | `IS NULL` | `= '1970-01-01T00:00:00Z'` (sentinel) |
| `metadata->>'shadow'` filter | none | `= 'true'` |
| `metadata->>'hash_scheme'` filter | none | `= 'url-aware-v1'` |
| insurer filter | optional | optional |
| `rag_flagged_at IS NULL` (RAG flag, see migration `20260423180000`) | yes | yes — preserved verbatim |
| product filter | optional | optional |

Two functions, two corpora, **zero overlap by construction**.

### 3.3 What does the harness call from production?

Nothing. The harness is a standalone tsx script under `app/eval/shadow/`. It:

1. Reads the 9 Prudential-impacted questions from `app/eval/ragas/questions.jsonl` (already on disk).
2. Embeds each question via the same model used to embed shadow chunks (OpenAI `text-embedding-3-small`, 1536-dim — matching the existing `documents.embedding vector(1536)` column).
3. Issues TWO Supabase RPCs per question: `match_documents` (prod path) and `match_shadow_documents` (new).
4. Builds the prompt context locally (no LLM call required for the retrieval metrics — CP / CR are deterministic given the retrieved chunks + the gold reference set).
5. Optionally calls the answer LLM (Claude Haiku 4.5, same as production) to compute F / AC / NS — gated by a `--with-llm` flag so the bare retrieval run is free of LLM cost.
6. Writes a single Markdown report.

The harness does NOT import from `app/src/services/rag/*`. It builds its own minimal Supabase client. This isolation is the same discipline the slice 3B.5 batch CLI followed — no code path in production gets a new caller.

---

## 4. Slice breakdown — four small reversible PRs

Each slice independently reversible. Hard guardrails carried from slice 3B.5: Prudential-only, no read-path change, no DELETE, no promotion, no embeddings on prod rows, no Agentic RAG / PageIndex.

| Slice | Deliverable | DB effect | Reversibility |
|---|---|---|---|
| **3B.6.1** | Pure shadow-embedder module + CLI. Loads v4 shadow rows in batches, calls the embedding API once per chunk, UPDATEs `documents.embedding` on the same row. Idempotent (skip rows whose `embedding IS NOT NULL`). Prudential-only guard reused from 3B.5. Cost cap via `--max-rows` (default low). | UPDATE on shadow rows only. The UPDATE statement filters by sentinel `valid_until` AND `metadata->>'hash_scheme'`. | Revert = `UPDATE … SET embedding = NULL WHERE …same filters…`. No row count change. |
| **3B.6.2** | SQL migration adding `match_shadow_documents` (and only that). Idempotent `CREATE OR REPLACE FUNCTION`. | new function definition only. | Drop the function. Zero impact on prod `match_documents`. |
| **3B.6.3** | Eval harness script + a `--limit` flag for smoke runs. Outputs side-by-side per-question retrieved-chunk table + aggregate CP/CR. Writes `docs/audit-runs/phase-2-pr3b6-<ts>/REPORT.md`. | none (read-only) | Delete the script. |
| **3B.6.4** | (Optional, gated separately) Ragas-mode flag on the harness: runs Ragas to produce F / AC / NS alongside CP / CR. Persists each row into the agentes-hub `eval_runs` table tagged `mode='shadow'` so the scoreboard SQL views can pivot legacy vs shadow without code change. | INSERTs into agentes-hub `eval_runs` only (NOT produto). | DELETE from `eval_runs WHERE metadata->>'mode' = 'shadow'`. |

3B.6.1 + 3B.6.2 + 3B.6.3 is the **minimum measurable slice**. 3B.6.4 is the polish step (Ragas integration). CEO can stop after 3B.6.3 if the CP/CR-only delta is conclusive.

---

## 5. Stop criteria — when 3B.6 halts

Hard stop on any of:

1. **`UPDATE` row count > shadow row count.** Embedder claims to have updated more rows than the shadow set contains.
2. **Any row with `embedding IS NOT NULL` AND `metadata->>'shadow' IS NOT 'true'`** (cross-set bleed via a bad WHERE clause).
3. **Any row with `embedding IS NOT NULL` AND `valid_until IS NULL`** (a shadow row got promoted by accident).
4. **`match_documents` (prod) returns any row where `metadata->>'shadow' = 'true'`** — would mean the prod read path now sees shadow rows. Catastrophic.
5. **`match_shadow_documents` returns any row where `valid_until IS NULL`** — shadow function leaking into prod corpus. Catastrophic.
6. **AZURE_ERROR / embedding API rate-limit cascade** — embedder must back off + resume idempotently.
7. **Cost > $5 USD per slice run without `--allow-cost-blast`** (Prudential 150 rows × 1536-dim × $0.02/1M tokens ≈ ~$0.03 expected; the cap exists to catch unbounded reruns).
8. **`comparison` CP shadow < legacy** or **`concept` CR shadow < legacy** — measurement says the new chunker did NOT help. Not a code bug; a strategic stop signal. CEO call on whether to investigate the chunker, the resolver, or the eval set.

Stop criteria 1–5 are inertness/contract hard stops handled in code (assertions + post-write probes mirroring slice 3B.5's `assertRowsAreInert`). Criteria 6–7 are operational. Criterion 8 is the actual product question.

---

## 6. Eval design — the comparison itself

### 6.1 Question set (9 questions, all Prudential)

From the Phase 7 baseline (`eval_runs` run `20260514_182346`):

| Category | Q ids | Rationale |
|---|---|---|
| `comparison` (6) | Q31, Q32, Q36, Q37, Q38, Q39 | All Prudential or Prudential-vs-X. Q31/32/36/37 are the "conditions retrieval dead" cluster (CP = 0). Q38 already hits the structured rate path (CP = 1.0) and is the control. |
| `concept` (3) | Q16, Q17, Q26 | Q16 (carência suicídio) retrieves OK today — control. Q17 (renovação automática) is partial. Q26 (VG Corporate min vidas) is dead — the chunker target. |

The harness embeds each question once and dispatches two RPCs.

### 6.2 Per-question side-by-side table (the artifact CEO actually reads)

| Q | Category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | Legacy chunks | Shadow chunks | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|

Plus the aggregate row at bottom: per-category mean Δ.

### 6.3 Gold reference set — same as Phase 7

The CP / CR computation is deterministic given the gold reference passages already labelled in `questions.jsonl`. No new annotation work for the bare retrieval comparison.

### 6.4 Sample size honesty

9 questions is small. The eval will not give a confidence interval — it will give a directional signal. CEO's B2 thresholds (`comparison` CP ≥ 0.50, `concept` CP ≥ 0.55) were defined on this same sample size; this is the eval the project was built around.

### 6.5 What 3B.6 does NOT measure

- **Azos / MAG.** Their eval coverage is thin (1 Azos question, 2 MAG rate-flavored questions — see `docs/phase-2-pr3b-plan.md` §3). Shadow set is Prudential-only.
- **End-to-end answer quality** without `--with-llm`. CP / CR are retrieval-only.
- **Latency.** The shadow function will be a separate measurement if/when promoted.

---

## 7. Non-goals (explicit)

- **No promotion.** `valid_until` stays at the sentinel for every shadow row. `match_documents` is not edited.
- **No DELETE.** Neither v3 orphans (29 rows from pre-fix slice 3B.5) nor any v4 shadow row is removed.
- **No prod read-path import.** The harness builds its own Supabase client, mirrors the discipline of the 3B.5 CLI.
- **No Azos / MAG.** Prudential-only. Same `assertPrudentialOnly` guard.
- **No new chunker.** The shadow text is frozen at `parser = 'azure-di-layout-v3'` for the duration of this slice.
- **No Agentic RAG / PageIndex.** Those are Phase 3 (see `docs/phase-3-agentic-rag-reference.md`, `docs/phase-3-pageindex-agentic-rag-reference.md`).
- **No re-embedding of legacy rows.** Production embeddings are untouched.
- **No new dependency.** OpenAI client + Supabase client already in `app/` for the existing ingestion scripts.

---

## 8. Risks and how each is bounded

| Risk | Bound |
|---|---|
| Embedder accidentally writes to prod rows | WHERE clause filters MUST include sentinel `valid_until` AND `metadata->>'hash_scheme'`. Post-write probe asserts UPDATE count equals shadow row count. |
| `match_shadow_documents` leaks into prod retrieval | New function; production code does not import or reference it. Boolean: no caller change to `answer.ts` / `compare.ts`. |
| Embedding API cost explodes | `--max-rows` cap, default 200 (enough for the 150 Prudential shadow rows + headroom). >500 requires `--allow-cost-blast`. |
| CP / CR for shadow worse than legacy | Stop criterion 8. Surface to CEO; do not silently push for promotion. |
| Idempotency breaks on a partial embedder run | Embedder skips rows where `embedding IS NOT NULL` AND `metadata->>'hash_scheme' = 'url-aware-v1'`. Reruns are no-op. |
| v3 orphans get embedded accidentally | WHERE clause requires `hash_scheme = 'url-aware-v1'`. v3 rows have no `hash_scheme` field, so they never match. |
| Shadow embedding model drift vs prod | Same model (`text-embedding-3-small`, 1536-dim). If prod changes embedding model in the future, 3B.6's harness re-embeds questions with whatever model production uses at run time. |

---

## 9. One-line conclusion

PR 3B.6 turns the 150-row Prudential shadow set into a measurable retrieval signal by adding shadow-only embeddings + a parallel `match_shadow_documents` function + a 9-question side-by-side eval harness; **nothing promotes, nothing touches `match_documents`, nothing crosses the inertness boundary** — the output is a numeric `before / after` report the CEO can act on.

---

_End of design. 3B.6.1 implementation requires CEO approval of this plan._
