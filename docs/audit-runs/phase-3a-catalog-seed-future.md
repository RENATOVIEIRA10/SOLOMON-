# Future plan — Catalog seed / product catalog repair for MetLife + MAPFRE

_Status: **NOT SCHEDULED.** Out of scope for Phase 3A. This document only records the option for a future decision._

_Origin: Gate G1 of Phase 3A discovered that the `documents.product_id` backfill cannot proceed for the 5 target insurers because the source side (`public.products`) is either empty or in a non-life category. Full G1 report: [phase-3a-g1-report-20260513.md](./phase-3a-g1-report-20260513.md)._

_CEO decision 2026-05-13: registered as a separate future plan; **not** part of the current Phase 3A._

---

## 1. What this future plan would do

For exactly two insurers — **MetLife** and **MAPFRE Seguros** — the chunk-pname set already carries real commercial life-product names. G1 verified this:

| Insurer | Distinct chunk-pname values | Chunks |
|---|---|---|
| MetLife | `Vida Segura`, `Vida Segura (atualizado)`, `Vida Total` | 453 |
| MAPFRE Seguros | `Vida Individual`, `Vida Individual Bilhete`, `Vida em Grupo`, `Vida Voce Multiflex`, `Vida Empresa`, `Regulamento de Assistência a Pessoas (.pdf)` | 449 |
| **Total** | 9 chunk-pname values | **902 chunks (441 of MAPFRE if regulamento is excluded as non-product)** |

The future plan would:

1. **Insert** ~8 rows into `public.products` (MetLife 2 — collapsing `Vida Segura (atualizado)` into `Vida Segura`; MAPFRE 5 — excluding the regulamento aux doc).
2. **Backfill** the matching chunks via the existing G1 preview script (same 4-strategy ladder; would now hit at strategy 1 EXACT_NORMALIZED).
3. **Verify** with a small Ragas subset that retrieval quality on MetLife/MAPFRE concept queries improves.

## 2. Why it is not part of Phase 3A

- Phase 3A is bounded to **structural fixes without ingestion or catalog mutation**. Inserting rows into `public.products` is a catalog mutation, not a backfill.
- The shape of the change is "create the source side from the chunk side", which is the inverse of the original Phase 3A backfill direction. Inverting it deserves its own design review.
- The MAG / Azos / Caixa insurers (the bulk of the chunk volume) cannot benefit from this approach — their chunk-pname is a document/version label, not a product. So this future plan addresses only ~12% of the originally-addressable 7.668 chunks (902 / 7.668). Better-leverage moves (G2 source_type filter; Phase 2 Azure DI redesign) come first.

## 3. Risks the future plan would have to address

- **Provenance:** the inferred product names come from chunk metadata, not the SUSEP/insurer catalog. They may be wrong, abbreviated, or duplicated with later official rows.
- **`susep_process`:** would be NULL on the inserted rows; downstream code that joins on SUSEP would break or skip.
- **Rollback complexity:** deleting an inserted product row leaves orphaned `documents.product_id` references. Reversal needs paired UPDATE + DELETE.
- **Cross-insurer leak in the chunk-pname** itself: `Vida Individual` is a generic term — other insurers may end up with the same string in their own chunks, and the leak guard from G1 has to fire correctly.
- **`metadata.product_name` is shared across versions:** "Vida Segura" and "Vida Segura (atualizado)" likely refer to the same product at different vintages. Collapsing them is a product decision (the CEO would have to confirm whether they should be one row or two).

## 4. Acceptance criteria if/when it runs

If this plan is later scheduled, it would inherit the same shape as the cancelled Phase 3A G3:

- A read-only preview script (same `app/scripts/rag-audit/preview-backfill-product-id.ts` would work as-is — it would now produce non-empty proposals).
- CEO spot-check per insurer (8 rows max, fast to review).
- A single migration that does the INSERT + UPDATE in one transaction, with a backup table for reversal.
- A regression Ragas subset on MetLife and MAPFRE concept questions.

## 5. Dependencies

This plan **must not** run before:

1. Phase 3A G2 ships and is validated in production (source_type filter).
2. Decision on whether Phase 2 (Azure DI redesign for `conditions_pdf`) will produce a clean catalog as a side effect — if yes, this future plan is **redundant** and should be skipped.

## 6. What this plan does NOT cover

- MAG / Azos / Caixa — their chunk-pname is unsuitable as a catalog seed source. They require Phase 2.
- The `insurer_rate_tables` repair — still out of scope, even in this future plan.
- Hybrid search, GraphRAG, contextual retrieval — Phase 2 / 4 territory.

---

_This document is a placeholder for a future proposal. No work begins from it without an explicit go-ahead and a separate plan PR._
