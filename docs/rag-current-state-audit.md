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

See the full file in repo for sections 1–12 (tables in public, schema, sourceTypes, per-insurer inventory, insurer_rate_tables coverage, Azure DI footprint, rag_exclude state, missing metadata, retrieval flows, capability matrix vs brief, tooling deltas, risks, re-runnable scripts, deferred items, next decisions).
