# SOLOMON — RAG Current State Audit

_Phase 1 of the RAG redesign brief. Read-only audit. No production change. Generated 2026-05-13._

**Author:** Claude (Phase 1 audit pass, this session).
**Scope:** answers every question in the brief's Phase 1 section, plus the Hermes-pending escalates (`tier1 < 3.5/5`, `qrag 31 high-severity`, `qrag backlog 103`).
**Sources of truth:**

- Supabase produto `ohmoyfbtfuznhlpjcbbk` (live queries, this session).
- Repo state at `master` HEAD `6ac24b2` (Wave A.4).
- Companion read-only scripts in `app/scripts/rag-audit/` (re-runnable for fresh snapshots).

---

## TL;DR (read this first)

1. **The repo does not run Azure DI today.** Grep for `DocumentAnalysisClient | FormRecognizer | DocumentIntelligence | analyzeDocument | prebuilt-layout` returns **zero** files. Two parser strings (`azure-document-intelligence-v2`, `azure-di-layout`) only appear inside **chunk metadata**, applied **offline** to **two PDFs** — MAG `rate_table` and Prudential `rate_table`. **14.251 conditions chunks were not produced by Azure DI.**
2. **Only 2 sourceTypes exist today**, not the 8 the brief defines (`conditions_pdf` 14.251 + `rate_table_pdf` 8.392 = 22.643 active chunks). The other 6 (`structured_rate_table`, `product_manual_pdf`, `underwriting_rules_pdf`, `claims_rules_pdf`, `commercial_material_pdf`, `unknown`) do not exist in the data.
3. **`product_id` is NULL on 98–100% of chunks**, but `metadata.product_name` is populated on 88%. The Padrão A boost only works because of this string fallback. `filter_product_id` in `match_documents` is effectively dead code.
4. **MAG / Azos / MetLife / MAPFRE / Caixa: `products=0` in the chunk pool.** The catalog rows live in `public.products` but were never joined back into `documents.product_id`. This is the structural cause of MAG 1.7/5 and Azos 2.8/5 in the Hermes escalate.
5. **`insurer_rate_tables` is fully populated for 2 insurers only**: MAG (265.880 rows / 9 products) and Prudential (6.098 rows / 88 products). 11 of 13 indexed insurers have **zero** structured rate coverage. The rate-lookup fast-path is fundamentally limited to MAG + Prudential.
6. **No hybrid (BM25) search exists.** `match_documents` is pure pgvector + Cohere rerank 3.5. Brief assumes BM25; today it is not there.
7. **`rag_exclude` is enforced** at the RPC level (migration `20260423180000_match_documents_exclude_rag_flagged.sql`). 32 chunks confirmed excluded, all from Prudential (6) + Bradesco (20) + Zurich (6) with reasons `rate_table_raw_numeric` (30) and `normalized_duplicate_cross_source` (2). The infrastructure works; the cleaning has not been run at scale.
8. **Bot and Dash share the same RAG core.** `handler.ts` and the `/api/ask`, `/api/compare`, `/api/pre-sinistro` routes all call the same `ask()`, `compareInsurers()`, `analyzePreSinistro()` in `app/src/services/rag/`. **No fork.** This is healthier than the brief assumes.
9. **Pre-sinistro and compare both call `semanticSearch` without a `sourceType` filter and without rerank.** `compare.ts` fires 6 queries × N insurers × 3 chunks = up to 54 candidates with no reranking. This is the most likely cause of "Bradesco = `Não consta` em todas dimensões" observed in the Wave A.4 smoke.
10. **Quality signals (`confidence`, `doc_title`, `section`, `clause`, `effective_date`) are present in 0 of 22.643 chunks.** Contextual retrieval as defined in the brief is unsupported without an ingestion redesign.

---

## 1. What the SOLOMON RAG consumes today

### 1.1 Tables in `public` (Supabase produto `ohmoyfbtfuznhlpjcbbk`)

| Table | Size | Approx rows | Role |
|---|---|---|---|
| `documents` | 622 MB | ~26.754 | **Chunks** (vector + content + metadata). Misnamed: this is the chunk store, not a documents store. |
| `insurer_rate_tables` | 110 MB | ~271.978 | **Structured rate rows** (age × gender × product × portfolio × period → rate). Pre-existing equivalent of brief's `structured_rate_table`. |
| `products` | 5.992 kB | 2.157 | Product catalog (linked to insurers). Not joined back into `documents`. |
| `coverages` | 2.456 kB | 1.275 | Coverage rows. Not in retrieval path. |
| `rag_cleaner_suggestions` | 1.248 kB | 111 | Cleaner queue (`qwen_cleaned_at` metadata refers to this — 8 chunks marked). |
| `pdf_version_detected` | 120 kB | 134 | Detected document version metadata. |
| `documents_deleted_non_life` | 4.816 kB | 2.708 | Quarantine — chunks already removed from active RAG. |
| `conversation_feedback`, `conversations`, `whatsapp_sessions`, `audit_log` | misc | misc | Conversation + ops, not RAG retrieval. |

There is **no separate `chunks` table** — `documents` IS the chunks table.

### 1.2 `documents` schema (canonical)

```
id              uuid PK
product_id      uuid NULL                ← 98–100% NULL in practice
insurer_id      uuid NULL                ← populated almost always
source_url      text NULL                ← 18% NULL (esp. Prudential rate_table)
source_type     text NOT NULL            ← only 2 distinct values in the data
chunk_index     int NOT NULL
content         text NOT NULL
embedding       vector NULL              ← all populated for active rows
metadata        jsonb NULL
content_hash    text NOT NULL
pdf_hash        text NULL
valid_from      timestamptz
valid_until     timestamptz NULL         ← active = NULL
superseded_by   uuid NULL
created_at, updated_at
```

`match_documents` (RPC, defined in migration `20260423180000_match_documents_exclude_rag_flagged.sql`) filters:

```
embedding IS NOT NULL
AND valid_until IS NULL
AND (rag_exclude IS NULL OR rag_exclude <> 'true')
AND optional filters: insurer_id, product_id, source_type, tipo_produto
AND filter_exclude_non_life: tipo_produto NOT IN ('PGBL','VGBL','previdencia',...)
```

### 1.3 sourceTypes that actually exist

| sourceType | chunks | rag_excluded | sem_product_id | has azure_di parser? |
|---|---|---|---|---|
| `conditions_pdf` | 14.251 | 32 | 13.989 (98%) | **NO** — no Azure DI parser stamp anywhere |
| `rate_table_pdf` | 8.392 | 0 | 8.392 (100%) | YES — Prudential (`azure-di-layout` 2.418) + MAG (`azure-document-intelligence-v2` 5.974) |

**Brief lists 8 official sourceTypes. Today only 2 exist. The other 6 are aspirational.**

### 1.4 Per-insurer inventory (active chunks)

| Insurer | Chunks | Excluded | Products (in documents.product_id) | Distinct docs | Status |
|---|---|---|---|---|---|
| MAG Seguros | 6.378 | 0 | **0** | 9 | conditions only via crawler — no product_id |
| Prudential do Brasil | 5.620 | 6 | 11 | 22 | only insurer with both `conditions_pdf` + `rate_table_pdf` + product_id |
| Zurich | 3.793 | 6 | 6 | 40 | conditions only |
| Bradesco Seguros | 1.893 | 20 | 81 | 31 | 81 product_ids but only 1.893 chunks → ~23 chunks/produto (thin) |
| Azos | 1.385 | 0 | **0** | 12 | conditions only — no product_id |
| Tokio Marine | 930 | 0 | 5 | 22 | conditions only |
| MetLife | 885 | 0 | **0** | 5 | conditions only — no product_id |
| SulAmerica | 563 | 0 | 10 | 5 | conditions only |
| Porto Seguro | 483 | 0 | 1 | 3 | conditions only |
| MAPFRE Seguros | 449 | 0 | **0** | 6 | conditions only — no product_id |
| Icatu Seguros | 137 | 0 | 137 | **0** | structured-only ingest, no PDF chunks |
| Santander Auto/RE | 126 | 0 | 10 | 3 | conditions only |
| Caixa Vida e Previdencia | 1 | 0 | 1 | 0 | placeholder |

Maps directly onto the Hermes escalate `tier1 abaixo de 3.5/5` (Bradesco 3.0, Azos 2.8, Prudential 2.0, MetLife 2.8, MAG 1.7) — every insurer flagged either has `product_id=0` (MAG, Azos, MetLife) or chunks-per-product < 30 (Bradesco), and Prudential has the rate-table PDF but conditions are dominant.

### 1.5 `insurer_rate_tables` coverage

| Insurer | Rate rows | Distinct product_code |
|---|---|---|
| MAG Seguros | 265.880 | 9 |
| Prudential do Brasil | 6.098 | 88 |
| **All others** | **0** | **0** |

**Rate-lookup fast-path is structurally limited to MAG + Prudential.** Every other insurer falls through to RAG-on-conditions, which is exactly the failure mode the brief calls out (`conditions_pdf` answering a "quanto custa" question).

---

## 2. What documents came from Azure DI

| parser | chunks | source_type | distinct insurers | distinct docs |
|---|---|---|---|---|
| `azure-document-intelligence-v2` | 5.974 | rate_table_pdf (MAG) | 1 | 1 |
| `azure-di-layout` | 2.418 | rate_table_pdf (Prudential) | 1 | 0 (source_url NULL) |

**Quality signals on Azure DI chunks:**
- `confidence`: 0
- `doc_title`: 0
- `section`: 0
- `clause`: 0
- `page`: 0 (MAG has `table_source_pages` array on 2.418 chunks; everything else 0)

So the Azure DI run that did happen was **table-extraction only** — output was numeric rows folded into `insurer_rate_tables` plus short auxiliary text chunks (avg ~285 chars). It is **not** the Azure DI Layout markdown pipeline the brief describes.

**No code in this repo calls Azure DI today.** It was a one-time offline conversion, not a live ingestion path.

---

## 3. Active chunks vs rag_exclude

| Bucket | Count | Notes |
|---|---|---|
| Total chunks in `documents` | 22.643 | (Postgres approximate row count reads 26.754, but `pgstat` overcounts vs the actual aggregate.) |
| Embedding NOT NULL | 22.643 | 100% — backfill clean |
| `valid_until IS NULL` (active) | 22.643 | 100% — `superseded_by` is also 0 across the table |
| Has `rag_exclude` key in metadata | 2.450 | Most of these are `rag_exclude=false` or other state markers |
| `rag_exclude=true` (hard excluded by RPC) | 32 | Prudential 6 + Bradesco 20 + Zurich 6 |

`rag_exclude=true` reasons:
- `rate_table_raw_numeric`: 30 (numbers extracted without spacing, unusable for RAG — covered by `solomon-audit-exact-dup-prudential-202604231700`)
- `normalized_duplicate_cross_source`: 2

**Verdict:** `rag_exclude` IS enforced. The cleaning pass that ran in April 2026 only touched ~32 chunks. The Hermes backlog of `31 high-severity pending` + `103 info pending` lives in `rag_cleaner_suggestions` (111 rows) — those are **proposals not yet executed**.

---

## 4. Mandatory metadata — what's missing

| Field | Chunks with it | Coverage | Risk |
|---|---|---|---|
| `insurer_name` | 19.998 | 88% | 2.645 chunks would be unattributable in a citation |
| `product_name` | 19.998 | 88% | same gap |
| `page` | 13.762 | **61%** | 8.881 chunks cannot cite a page (Azos 64% missing, Bradesco 49% missing, MAG conditions 26% missing, MetLife 49% missing — **Prudential conditions 0.3% missing only**) |
| `source_url` | 13.762 | 61% | 8.881 chunks cannot link to PDF |
| `parser` | 8.392 | 37% | identifies pipeline of origin (only rate_table_pdf has it) |
| `tipo_produto` | **8** | <0.1% | `filter_exclude_non_life` is effectively inert |
| `confidence` | **0** | 0% | no quality gate signal stored |
| `doc_title`, `section`, `clause` | **0** | 0% | contextual retrieval (per brief) blocked |
| `effective_date` | **0** | 0% | brief's vigência filter cannot be applied |
| `azure_di` flag | **0** | 0% | (parser string substitutes, but informal) |

Bradesco chunk-length pathology: `min_len=145, max_len=24.824` — chunks both far below and far above the brief's chunking-by-clause target. 7 Bradesco chunks have **no `source_url` at all** (orphaned).

---

## 5. Retrieval flows — who uses what

### 5.1 Bot WhatsApp (`app/src/services/whatsapp/handler.ts`)

```
incoming text
  ├── /comparar → compareInsurers()      [services/rag/compare.ts]
  ├── /sinistro → analyzePreSinistro()   [services/rag/pre-sinistro.ts]
  ├── /ajuda /plano /feedback → meta-commands (no RAG)
  └── default  → ask()                   [services/rag/answer.ts]
                  ├── channel='whatsapp'  → stripSourcesSection prompt
                  └── formatRagResponse() appends inline citations
```

### 5.2 Dash (Next.js `app/src/app/`)

```
/api/ask           → ask()              channel='api' | 'dashboard'
/api/ask/stream    → askStream()        SSE wrapper around ask()
/api/compare       → compareInsurers()  same core
/api/pre-sinistro  → analyzePreSinistro()
```

Components in `app/src/components/` (`chat-view`, `comparador-view`, `pre-sinistro-view`) consume those routes. **No fork in the RAG core between Bot and Dash.**

### 5.3 What each trilho actually does

| Trilho | Function | Pipeline | sourceType filter | Rerank | Diversity |
|---|---|---|---|---|---|
| Rate lookup | `ask()` → `detectRateIntent` → `queryRateTable` | structured SQL on `insurer_rate_tables`, bypass LLM | n/a (structured) | n/a | n/a |
| Concept/coverage | `ask()` → `semanticSearch` global / round-robin | pgvector → Cohere rerank → diversify | **only if rate intent fires** | **only if** not compare/multi-insurer | round-robin if no insurer named |
| Comparison (`compareInsurers`) | `semanticSearch` per dimension × per insurer | pgvector only, topK=3 per query, no rerank, no source_type filter | **never** | **never** | enforced by structural loop |
| Pre-sinistro (`analyzePreSinistro`) | uses Sonnet 4.6, fetches own context via search | pgvector — needs read | needs verification | needs verification | needs verification |
| Global ("quais seguradoras…") | falls back to round-robin global | same as concept | no | no | yes |

**Gap vs the brief:**
- No hybrid (BM25 + vector). Pure cosine.
- No Azure AI Search semantic ranker.
- No GraphRAG. No insurer/product summary index.
- `filter_source_type` not used for compare or pre-sinistro.
- Compare does no rerank — and Cohere rerank is skipped in compare-intent paths anyway (`answer.ts:349`) to preserve diversity.

---

## 6. Capability matrix vs the brief (today)

| Trilho | Brief verde threshold | Today (anecdotal+Hermes) | Status |
|---|---|---|---|
| rate_prudential | F≥0.85, AC≥0.65, CP≥0.75, CR≥0.70, source correct, source shown | structured fast-path; tier 3.0/5 (Hermes) | **Yellow / beta** |
| rate_mag | same | tier 1.7/5 (Hermes) — fast-path covers DIT/DITA but score is low | **Red / bloqueado** |
| concept | F≥0.85, AC≥0.65, CP≥0.75, CR≥0.70 | Wave A.4 smoke OK; tier scores 1.9–3.0/5 across insurers | **Yellow** |
| coverage | same | shares concept pipeline; same constraints | **Yellow** |
| comparison | same + diversity preserved | Wave A.4 smoke showed Bradesco = "Não consta" em todas dimensões | **Red** |
| edge | same | NS=NULL on 4/5 edge questions in the hub (memory `feedback_ns_edge_bug.md`) | **Yellow** — eval data thin |
| pre_sinistro | F≥0.85 + literal citation gate | Wave A.4 smoke veredicto RISCO 90% with fundamentos; needs rebaseline post-Gemini | **Yellow** |
| global ("quais seguradoras…") | needs corpus-wide retrieval | round-robin works structurally; not benchmarked | **Yellow** |

This matrix is anecdotal — only the rebaseline Ragas run (Phase 7 of the brief) will produce real numbers. Treat statuses above as conservative.

---

## 7. Trilhos sem evidência (Ragas eval is stale)

Memory `project_solomon_plano_4_fases.md` notes the last Ragas baseline ran before the Gemini swap (Waves A.2–A.4, commits 31b2192 / 6ac24b2). The CEO's own next-candidates list opens with **"Re-baseline Ragas com Gemini (gating obrigatorio)"** for that exact reason. No trilho that touches `compareInsurers` or `analyzePreSinistro` should be declared ready before that rebaseline.

---

## 8. Tooling deltas vs brief

| Brief expectation | Today | Delta |
|---|---|---|
| Azure DI Layout Markdown for every PDF | Used once, offline, on 2 rate-table PDFs | Ingestion redesign needed (Phase 2 of brief) |
| Tables → structured rows | YES via `insurer_rate_tables` (271k rows) | Coverage limited to 2 insurers |
| Hybrid search (BM25 + vector) | pgvector only | Add `tsvector` GIN index + RPC `match_documents_hybrid` |
| Semantic ranker | Cohere Rerank 3.5 | OK, but skipped in compare path |
| Filter by metadata | only `insurer_id, product_id, source_type, tipo_produto` exposed | needs `effectiveDate`, `parser`, `confidence`, document version |
| Round-robin diversity for comparison | Padrão B + Padrão C implemented in `answer.ts` | works; `compare.ts` does its own thing without it |
| Contextual retrieval (doc/insurer/product/section/clause/page enriched before embedding) | not done | Phase 2 |
| GraphRAG for corpus-wide | not done | Phase 4 |
| Capability matrix + Eval scoreboard | `STATUS.md` exists; no per-trilho gating | Phase 6 |

---

## 9. Risks the audit surfaced (acknowledged, not fixed in this phase)

1. **Bradesco chunks max_len=24.824 chars** — chunking is broken on at least one document. A single chunk that big poisons both retrieval (one chunk fills a topK slot) and the LLM context window.
2. **MAG / Azos / MetLife / MAPFRE / Caixa: zero product_id** on chunks. The Padrão A boost mitigates with `metadata.product_name` strings, but `filter_product_id` in `match_documents` is dead.
3. **Prudential rate_table_pdf chunks: 100% `source_url=NULL`**. The fast-path answer cites a PDF page but cannot link out.
4. **`tipo_produto` populated on 8 of 22.643 chunks** — `filter_exclude_non_life` is effectively a no-op for active retrieval.
5. **`insurer_rate_tables` for Bradesco/Zurich/Azos/MetLife/Tokio/SulAmerica/Porto/MAPFRE/Caixa/Santander = 0 rows.** Rate fast-path is unreachable for them.
6. **Compare path has no rerank, no source_type filter, no diversity guard** beyond the structural per-insurer loop. The "Bradesco = `Não consta` em todas dimensões" smoke is consistent with: topK=3 × 6 queries returns chunks that ARE Bradesco but are not aligned with `cobertura morte | invalidez | DG | contestabilidade | funeral | exclusões`. Bradesco PDFs probably structure these sections differently from Prudential.
7. **Eval baseline is stale** (pre-Gemini). The matrix above is anecdotal.
8. **Two insurer rows for `MAG Seguros`** (memory `feedback_resolveInsurerIds_duplicates.md` discusses this) — `resolveInsurerIds()` already returns both; check that the second is not orphaned with chunks the first lacks.

---

## 10. Re-runnable scripts (already created in this audit)

All read-only. Run from `app/`. None of them write to Supabase.

| Script | What it does |
|---|---|
| `scripts/rag-audit/inventory.ts` | Per-insurer + per-sourceType chunk inventory, `insurer_rate_tables` coverage, eligibility for `match_documents` |
| `scripts/rag-audit/audit-azure-di.ts` | Parser histogram, Azure DI footprint, quality signals on Azure chunks, conditions_pdf coverage by Azure |
| `scripts/rag-audit/test-rag-exclude.ts` | Verifies `match_documents` actually filters `rag_exclude=true` (regression guard for the April 2026 bug) |
| `scripts/rag-audit/test-source-type-routing.ts` | Embeds rate-intent vs concept queries and reports the sourceType mix of top-10 hits — proves whether the brief's "rate query returns conditions_pdf" failure still happens at the RPC level |
| `scripts/rag-audit/report.ts` | Runs all of the above and concatenates the markdown |

Each can be piped into `docs/audit-runs/<name>-YYYYMMDD.md` to capture a frozen snapshot.

---

## 11. What this audit does NOT do (deferred to later phases per the brief)

- **No production changes.** Code, schema, and data are unchanged.
- **No Ragas rebaseline.** That is Phase 7 of the brief and CEO has it next on the list.
- **No new sourceTypes introduced.** Phase 2 territory.
- **No Azure DI live pipeline.** Phase 2.
- **No fixes for the metadata gaps.** Phase 3 quality gates.
- **No Solomon Core consolidation refactor.** Phase 4.
- **No RAG Inspector / Capability Matrix UI.** Phases 5–6.

---

## 12. What the audit unblocks (next decisions)

The brief's Phase 2 + Phase 3 design depends on three answers this audit now gives:

1. **What is the minimum sourceType set?** Today's 2 are insufficient (rate_lookup + concept can't be distinguished cleanly at retrieval time without a richer taxonomy). The brief's 8 are an upper bound. A pragmatic next step is **4**: `conditions_pdf`, `rate_table_pdf` (kept), `structured_rate_table` (already exists as `insurer_rate_tables`), `unknown` (pending classification).

2. **Where is the Azure DI redesign worth its weight?** Conditions PDFs (14.251 chunks) — yes, urgently. Rate tables — already done well enough via the offline run + structured table. So the Phase 2 spend should target conditions ingestion first, leaving the rate path alone.

3. **What's the smallest fix that lifts the Hermes tier1 scores?** Two structural fixes that don't need ingestion redesign:
   - Backfill `product_id` on MAG / Azos / MetLife / MAPFRE / Caixa chunks via fuzzy join `documents.metadata.product_name` ↔ `products.name`.
   - Add `source_type` filter to compare.ts and pre-sinistro.ts (force `conditions_pdf` for verbal queries, `rate_table_pdf` only when rate intent fires).
   These are Phase 3 territory but are the highest-leverage moves the audit identified.

---

_End of audit. Phase 2 (architecture) requires CEO approval per the brief contract._
