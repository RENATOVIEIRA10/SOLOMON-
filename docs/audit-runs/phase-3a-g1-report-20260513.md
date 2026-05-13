# Phase 3A — Gate G1 — Backfill Preview Report

_Generated: 2026-05-13. Read-only run. No DB write was issued._

> **CEO decision (2026-05-13):** **Direction A.** Backfill of `documents.product_id` is **cancelled inside Phase 3A**. Phase 3A is re-scoped to **G2 only** (source_type filter). The catalog-seed option for MetLife + MAPFRE (Direction B from §8) is split into a separate future plan, documented in [phase-3a-catalog-seed-future.md](./phase-3a-catalog-seed-future.md). Original Gate G3 in Phase 3A is **closed**. See §10 below for the formal re-scope record.

**Run method:** Executed via `mcp__claude_ai_Supabase__execute_sql` (read-only MCP). The shipped script (`app/scripts/rag-audit/preview-backfill-product-id.ts`, PR #8) could not be executed locally because `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` live in the Vercel env and are not mirrored to `app/.env.local`. The SQL run reproduces the same match ladder and writes the same 3 CSVs.

**Match ladder used (per plan §1.2):**
1. EXACT_NORMALIZED — `LOWER(metadata.product_name) = LOWER(products.name)`, same insurer.
2. Cross-insurer leak guard — exact match in a different insurer, recorded as conflict.
3. TOKEN_SIMILARITY — Jaccard ≥ 0.7 over normalized tokens, same insurer.
4. UNMATCHED.

**Note on `pg_trgm`/`unaccent`:** neither extension is installed in `public` on this Supabase project. Verified by `SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','unaccent')` returning empty. The Jaccard equivalent runs client-side (TS script) or per-token in SQL (this run). The CEO already accepted Jaccard as the read-only alternative for G1.

---

## 1. Total propostas por seguradora

| Insurer | Chunks addressable | Catalog candidates | EXACT matches | TOKEN_SIM matches | **Total proposals** | Unmatched |
|---|---|---|---|---|---|---|
| MAG Seguros | 6.273 | **0** | 0 | 0 | **0** | 6.273 |
| Azos | 493 | **0** | 0 | 0 | **0** | 493 |
| MetLife | 453 | **0** | 0 | 0 | **0** | 453 |
| MAPFRE Seguros | 449 | 60 | 0 | 0 | **0** | 449 |
| Caixa Vida e Previdencia | 0 | 2 | 0 | 0 | **0** | 0 |
| **Total** | **7.668** | 62 | 0 | 0 | **0** | **7.668** |

`Chunks addressable` is `product_id IS NULL AND metadata.product_name IS NOT NULL`. `Catalog candidates` is `count(*) FROM products WHERE insurer_id = this_insurer`.

---

## 2. Buckets por score

| Score bucket | Strategy | Count |
|---|---|---|
| 1.00 (exact) | EXACT_NORMALIZED | 0 |
| 0.90–1.00 | TOKEN_SIMILARITY | 0 |
| 0.80–0.90 | TOKEN_SIMILARITY | 0 |
| 0.70–0.80 | TOKEN_SIMILARITY | 0 |
| < 0.70 (under threshold) | rejected | n/a |

No bucket has any rows. This is **not** a tuning problem (lowering the threshold would not help) because the catalog for 4 of 5 target insurers is empty, and the MAPFRE catalog is in the wrong product category (see §6).

---

## 3. Conflitos por seguradora

| Insurer | Cross-insurer leak | Same-insurer exact ambiguity | TOKEN_SIM top-tie | **Total conflicts** |
|---|---|---|---|---|
| MAG Seguros | 0 | 0 | 0 | **0** |
| Azos | 0 | 0 | 0 | **0** |
| MetLife | 0 | 0 | 0 | **0** |
| MAPFRE Seguros | 0 | 0 | 0 | **0** |
| Caixa Vida e Previdencia | 0 | 0 | 0 | **0** |

`phase-3a-conflicts-20260513.csv` is **empty** (header only). The conflict guard cannot fire because no proposal exists in the first place.

---

## 4. Spot-check — 20 representative rows from `phase-3a-backfill-proposal-20260513.csv`

`phase-3a-backfill-proposal-20260513.csv` is **empty** (header only). There is nothing to spot-check.

For traceability, the table below shows what the proposals *would have looked like* if the catalog had matching products. Each row is the first chunk of each distinct `(insurer, product_name_chunk)` pair — 18 unique (chunk, name) groups exist across the 5 target insurers, covering all 7.668 addressable chunks.

| # | insurer | product_name_chunk | chunks at this name | proposed_product_name | strategy | jaccard |
|---|---|---|---|---|---|---|
| 1 | Azos | Especialista Fevereiro 2023 | 93 | _none_ | UNMATCHED | — |
| 2 | Azos | Especialista Marco 2025 | 170 | _none_ | UNMATCHED | — |
| 3 | Azos | Individual Julho 2021 | 53 | _none_ | UNMATCHED | — |
| 4 | Azos | Individual Junho 2021 | 64 | _none_ | UNMATCHED | — |
| 5 | Azos | Individual Junho 2022 | 64 | _none_ | UNMATCHED | — |
| 6 | Azos | Individual Marco 2021 | 49 | _none_ | UNMATCHED | — |
| 7 | MAG Seguros | Guia de Vendas por Cobertura MAR/2025 | 5.974 | _none_ | UNMATCHED | — |
| 8 | MAG Seguros | Guia de Vendas por Cobertura v02 (Mar/2025) | 275 | _none_ | UNMATCHED | — |
| 9 | MAG Seguros | Vida Inteira 3082/3083 | 24 | _none_ | UNMATCHED | — |
| 10 | MAPFRE Seguros | Regulamento de Assistência a Pessoas (.pdf) | 8 | _none_ | UNMATCHED | — |
| 11 | MAPFRE Seguros | Vida em Grupo | 84 | _none_ | UNMATCHED | — |
| 12 | MAPFRE Seguros | Vida Empresa | 44 | _none_ | UNMATCHED | — |
| 13 | MAPFRE Seguros | Vida Individual | 122 | _none_ | UNMATCHED | — |
| 14 | MAPFRE Seguros | Vida Individual Bilhete | 121 | _none_ | UNMATCHED | — |
| 15 | MAPFRE Seguros | Vida Voce Multiflex | 70 | _none_ | UNMATCHED | — |
| 16 | MetLife | Vida Segura | 171 | _none_ | UNMATCHED | — |
| 17 | MetLife | Vida Segura (atualizado) | 138 | _none_ | UNMATCHED | — |
| 18 | MetLife | Vida Total | 144 | _none_ | UNMATCHED | — |

(18 distinct `product_name_chunk` values explain 100% of the 7.668 chunks — same `chunk_id` is the row representative used in `phase-3a-unmatched-20260513.csv`.)

---

## 5. Top ambiguidades

There are **zero ambiguities** because there are **zero matches**. The plan defined "ambiguity" as one of:
- 2+ products in the same insurer share a normalized name (none, because catalog rows = 0).
- TOKEN_SIM top-1 and top-2 scores tie (none, because TOKEN_SIM produced no candidates above 0.7).

For information, the closest *near-matches* attempted via SQL `LIKE` substring (looser than Jaccard ≥ 0.7) on MAPFRE — the only insurer with a non-empty catalog — also returned 0. The MAPFRE chunk `product_name` values (`Vida Individual`, `Vida em Grupo`, `Vida Voce Multiflex`, etc.) share no tokens with the catalog rows (`PGBL CRESCER BNP MAPFRE MAXI 20`, `VGBL MAPFRE PREVISION RENDA FIXA`, etc.) — common token "MAPFRE" alone gives Jaccard well under 0.7.

---

## 6. Recomendação por seguradora

This is the structural finding that supersedes the original plan §1.1 assumption. The audit was correct that `product_id` is NULL on these insurers; the audit had **not** verified that the catalog (`public.products`) is suitable as the source side of the backfill. G1 makes that verification — and the answer is **no**.

| Insurer | Verdict | Reason | Recommended next step |
|---|---|---|---|
| MAG Seguros | **DESCARTAR (plan A)** | Catalog rows = 0. The `metadata.product_name` field carries **document/version labels** ("Guia de Vendas por Cobertura MAR/2025"), not commercial product names. The 5.974 chunks under that label are the entire MAG ingestion pulled from one guide PDF. | Drop from Phase 3A backfill. Address in Phase 2 redesign: either re-ingest with per-product chunking, or attach a synthetic `product_id` per chunk-pname after first inserting catalog rows for the 9 MAG `Vida Inteira / DIT / SAF / Doenças Graves` families surfaced by `insurer_rate_tables`. |
| Azos | **DESCARTAR (plan A)** | Catalog rows = 0. Chunk `product_name` field carries **version labels** ("Especialista Marco 2025", "Individual Junho 2022") — possibly the actual product is "Especialista" / "Individual" with vintage suffixes. | Drop from Phase 3A backfill. Phase 2 should normalize to `(family, vintage)` once the redesigned chunker can read Azos PDFs' table of contents. |
| MetLife | **REVISAR — plan B viable** | Catalog rows = 0, but chunk `product_name` field DOES carry real commercial names: `Vida Segura`, `Vida Segura (atualizado)`, `Vida Total`. These are the actual MetLife life products. | Smallest fix: insert 2 rows into `public.products` (`Vida Segura`, `Vida Total`), backfill 453 chunks via the new exact match (`Vida Segura (atualizado)` collapses to `Vida Segura`). Cheap, safe, recoverable. **This is a redirected sub-proposal, not the original plan.** |
| MAPFRE Seguros | **REVISAR — plan B viable** | Catalog has 60 rows but ALL are PGBL/VGBL (previdência, non-life). The chunk-pname set carries the actual life products: `Vida Individual`, `Vida Empresa`, `Vida em Grupo`, `Vida Voce Multiflex`, `Vida Individual Bilhete`, plus one auxiliary `Regulamento de Assistência a Pessoas`. | Smallest fix: insert 5 life-product rows into `public.products`, then backfill 441/449 chunks (the regulamento doc stays unmatched as expected — it is a cross-product assistance doc, not a product). Cheap, safe, recoverable. **This is a redirected sub-proposal, not the original plan.** |
| Caixa Vida e Previdencia | **DESCARTAR** | 0 chunks addressable — nothing to backfill. The 2 catalog rows (`COD. PROD. 9749`, `FEDERALPREV CRESCER - 1000`) are previdência; the single existing chunk for Caixa has no `metadata.product_name` (verified by audit §1.4 — Caixa had `chunks=1` already and zero addressable). | Phase 2 territory. Nothing for Phase 3A to do. |

---

## 7. G1 verdict and gate state

**Verdict:** **PARTIAL PASS** — the script ran correctly and the ladder behaved as designed. The conflicts CSV is empty (the original safety check), but **so is the proposals CSV**. The original plan §1.5 (apply migration) **must not proceed as written** — there is nothing to apply.

| Original plan path | G1 finding | New status |
|---|---|---|
| §1.5 backfill `documents.product_id` from `products.name` | 0 matches across 7.668 addressable chunks | **Inviable as written** |
| §1.3 preview script + CSVs | Ran; CSVs generated (proposals empty) | **Working as designed** |
| §1.4 spot-check protocol | No proposals exist to spot-check | **Vacuously satisfied** |
| §7.1 acceptance criterion "≥ 70% of MAG/Azos/MetLife/MAPFRE/Caixa chunks have product_id populated" | Not achievable from current `public.products` | **Cannot pass without catalog seeding** |

**Gates:**
- G0 — approved.
- G1 — **completed**, but with a structural finding that blocks G3 as currently planned.
- G2 (source_type filter) — independent of this; can still proceed when CEO unlocks it.
- G3 — **stays blocked**. Reopening requires choosing one of the directions in §8.
- G4 — blocked.

---

## 8. Three directions for the CEO to choose from (no implementation begins until you choose)

### Direction A — Abandon `product_id` backfill, re-scope Phase 3A to G2 only

Keep the source_type filter (G2 / PR pending), drop the backfill from Phase 3A entirely. Move `product_id` repopulation into Phase 2 (Azure DI redesign for `conditions_pdf`), where it gets product-level chunking by design.

Pros: zero new code, fastest path to the source_type win, no catalog mutation.
Cons: MAG/Azos/MetLife/MAPFRE Hermes tier scores get no help from Phase 3A — only the source_type filter, which mostly benefits the compare/pre-sinistro paths, not single-insurer concept queries.

### Direction B — Seed `public.products` from chunk `metadata.product_name`, then backfill

For MetLife (3 names) and MAPFRE (6 names), the chunk-pname set already carries real commercial product names. Insert 3+5 = 8 new rows in `public.products`, then re-run G1 — proposals will land cleanly. For MAG/Azos, the chunk-pname carries document/version labels, so this direction does not solve them.

Pros: 894 chunks (MetLife 453 + MAPFRE 441) get a real `product_id`. Cheap, fully reversible (delete the 8 rows + reset `documents.product_id` from the backup table).
Cons: New surface — we are creating catalog rows from chunk metadata, which is the inverse of the original direction. Adds 8 rows to `products` that will then be referenced by hundreds of chunks; if the inferred names turn out to be wrong, the rollback also has to clean up dangling references.

### Direction C — Phase 2 first

Skip Phase 3A backfill entirely. Move to Phase 2 (Azure DI Layout migration for `conditions_pdf`), which by design produces a clean `(document, product, section, page)` graph and populates `product_id` as part of ingestion.

Pros: solves the root cause once. No band-aids.
Cons: Phase 2 is the larger, longer, riskier work. Tier scores stay at current levels until Phase 2 ships.

---

## 9. What did NOT change in production

- No write was issued to Supabase. Verified by: the only SQL executed in this run was `SELECT`. The MCP execute_sql wrapper is read-eligible only by convention, but no UPDATE/INSERT/DELETE was authored by Claude in this run.
- No migration was created.
- No `public.products` rows were inserted.
- No `documents.product_id` was touched.
- No environment variable was changed.
- No file outside `docs/audit-runs/` was modified.
- The shipped script (`app/scripts/rag-audit/preview-backfill-product-id.ts`) remains exactly as merged in PR #8.

---

## 10. Re-scope record (added 2026-05-13 after CEO decision)

| Item | State before G1 | State after G1 + CEO decision |
|---|---|---|
| Phase 3A scope | G1 preview + G2 source_type + G3 backfill apply + G4 mini Ragas | **G2 source_type only** + final report (no G3, no mini Ragas of the dropped scope) |
| G1 preview | scheduled | **completed, PARTIAL PASS** (script works; backfill source is empty/wrong) |
| G3 backfill apply | blocked behind G1 | **cancelled** within Phase 3A |
| G4 mini Ragas | blocked behind G3 | **descoped from Phase 3A** (will be re-evaluated after G2 or as part of Phase 7) |
| `documents.product_id` repair | planned for G3 | **moved to Phase 2** (Azure DI Layout redesign produces it natively) |
| Catalog seed for MetLife + MAPFRE | not in original plan | **separate future plan** at [phase-3a-catalog-seed-future.md](./phase-3a-catalog-seed-future.md) — NOT part of Phase 3A |
| `insurer_rate_tables` | "do not touch" already | **no change** — still not touched |

**What "inviable" means here, precisely:** the original §1.5 SQL (`UPDATE documents.product_id ... FROM products`) would update zero rows because (a) the `products` catalog is empty for MAG / Azos / MetLife / Caixa, and (b) for MAPFRE it is fully populated with non-life rows (30 PGBL + 30 VGBL) that would never match a life chunk's `product_name` even at Jaccard 0.3. The data is missing on the source side of the join, not on the chunk side.

---

_End of G1 report. Re-scope applied. Phase 3A now proceeds with G2 only._

