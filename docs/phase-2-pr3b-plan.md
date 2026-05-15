# SOLOMON — Phase 2 PR 3B Plan: semantic chunker + shadow set

_Read-only plan. No code, no migration, no DB write, no re-ingestion. Generated 2026-05-15._

**Issue:** [#13 — Phase 2: Azure DI Layout redesign for `conditions_pdf` retrieval](https://github.com/RENATOVIEIRA10/SOLOMON-/issues/13) (scope correction registered there by the CEO)
**Unlocked by:** PR #14 (ingestion audit), PR #15 (architecture gate), PR #16 (PR 3A — Azure DI F0/S0 probe, S0 confirmed).
**Sources of truth:** Supabase produto `ohmoyfbtfuznhlpjcbbk` (live queries this session) + `docs/phase-2-ingestion-audit.md` + `docs/rag-current-state-audit.md` + `docs/phase-2-azure-di-architecture.md`.

> **Phase 2 mother-rule:** Phase 2 replaces the chunker. It does **not** tune the retriever to compensate for bad chunks.

---

## 0. Scope correction — this is NOT Bradesco-first

PR 3A used Bradesco as the probe seed. That was a **technical probe choice, not a rollout decision.** Issue #13 now carries the corrected business focus:

| Priority | Insurer | Why |
|---|---|---|
| **P0** | **Prudential do Brasil** | Largest `conditions_pdf` corpus (3.202 chunks / 22 docs); dominates the `comparison` eval (6/10 questions); the **only one of the three with a `products` catalog** — product_id resolution is actually testable. |
| **P1** | **Azos** | 1.385 chunks / 12 docs, pure conditions play (no rate tables). Eval coverage is thin (1 question) — see §3. |
| **P2** | **MAG Seguros** | Only 404 conditions chunks / 8 docs (thin). MAG's real value is its rate tables (5.974 `rate_table_pdf` chunks + 265.880 structured rows) — **already done, out of scope.** |

**Bradesco = fixture / parser sanity-check, not a rollout target.** See §5.

This plan does **not** write code. It answers the six questions below and designs PR 3B as small reversible slices.

---

## 1. What PDFs/pages exist for Prudential, Azos, MAG?

Live query against `documents` (active rows, joined on `insurer_id`):

| Insurer | `conditions_pdf` chunks | distinct docs (`source_url`) | `rate_table_pdf` chunks | real page numbers (conditions) |
|---|---:|---:|---:|---:|
| Prudential do Brasil | 3.202 | 22 | 2.418 | **0 / 3.202** |
| Azos | 1.385 | 12 | 0 | **0 / 1.385** |
| MAG Seguros | 404 | 8 | 5.974 | **0 / 404** |

**Observations:**
- **Zero `conditions_pdf` chunks have a real page number** for any of the three (`metadata.page` is `0` or absent everywhere). Citations cannot point to a page today.
- Prudential has the deepest conditions corpus and the only meaningful `rate_table_pdf` set with real pages (2.418, all pages populated — that path is fine, untouched).
- Azos has **no rate tables at all** — every Azos answer rides on `conditions_pdf`. The chunker is Azos's *entire* retrieval surface.
- MAG's conditions corpus is thin (8 docs). Re-chunking MAG conditions is low-volume; MAG's rate path is the structured tables and stays out of scope.
- The Azure DI page count for a full reprocess of these three: roughly **Prudential ~1.700 pages + Azos ~700 + MAG ~250 ≈ 2.650 pages** (extrapolated from the architecture doc's ~13.500-page / 157-doc total). Well inside the trial credit; the pilot (Prudential alone, paid S0) is a fraction of that.

---

## 2. Metadata quality per insurer

Live query — coverage of the fields the new chunk contract must populate:

| Field | Prudential | Azos | MAG | Verdict |
|---|---|---|---|---|
| `product_id` populated | 11 / 3.202 (0.3%) | 0 / 1.385 | 0 / 404 | **dead** — `filter_product_id` is inert for all three |
| `products` catalog rows (for resolution) | **12** | **0** | **0** | only Prudential can be resolved by a catalog join |
| `metadata.page` (real, >0) | 0% | 0% | 0% | **absent** everywhere |
| `metadata.product_name` usable | 11 / 3.202 — **99.7% is the literal `"Conditions PDF"`** | 64% null/garbage | 26% null/garbage | **garbage-dominant**, worst on Prudential |
| `metadata.insurer_name` present | 100% | 36% (892 missing) | 74% (105 missing) | Azos chunks are largely unattributable |
| `metadata.section` / `clause` | 0% | 0% | 0% | **never captured** — no clause anchoring possible |
| `metadata.parser` | 0% (conditions) | 0% | 0% (conditions) | conditions chunks have no provenance stamp |

**The single sharpest finding:** the empty `products` catalog for Azos and MAG. PR #14 proposed "backfill `product_id` via fuzzy join `metadata.product_name` ↔ `products.name`" — **that join has nothing to join against for Azos and MAG.** Their catalog is empty. For those two, the chunker must emit `metadata.product_unresolved = true` and product resolution becomes a *separate, later* effort (catalog seeding), not part of PR 3B. Only Prudential (12 catalog products) can have product_id resolved inside PR 3B.

Second finding: Prudential's `product_name` is 99.7% the literal string `"Conditions PDF"`. The architecture doc's chunk contract ("`product_name` never the literal `Conditions PDF`") is, in practice, almost entirely a Prudential problem.

---

## 3. The real retrieval pain in `concept` / `comparison` for these three

From the Phase 7 baseline (`eval_runs`, run `20260514_182346`), per-question:

### `comparison` — the catastrophe (8/10 questions CP = 0.00)

| Question | Insurer(s) | CP | CR | Reading |
|---|---|---:|---:|---|
| Q31 Prudential TM10 vs Bradesco | Prudential | 0.00 | 0.33 | conditions retrieval dead |
| Q32 Prudential DDR5G vs others | Prudential | 0.00 | 0.00 | conditions retrieval dead |
| Q34 MAG DITA vs MAG DIT | MAG | 0.00 | 0.00 | rate-flavored, still 0 |
| Q36 Prudential Renda Familiar vs Bradesco | Prudential | 0.00 | 0.40 | conditions retrieval dead |
| Q37 Prudential WL10G vs WL00G | Prudential | 0.00 | 0.00 | conditions retrieval dead |
| Q38 Prudential CIB5G vs CIB5H | Prudential | **1.00** | 0.75 | the **only** CP=1.0 — it hits the structured rate path |
| Q33 / Q35 | Zurich·Bradesco / catalog | 0.00 | — | dead |
| Q39 / Q40 | Prudential / MAG | null | null | Phase 7 billing hole — unscored |

`comparison` aggregate CP = 0.13 decomposes cleanly: **every question that needs `conditions_pdf` retrieval scores CP = 0.00; the one that hits `insurer_rate_tables` scores CP = 1.00.** This is the chunker's signature, exactly as PR #14 argued. **Prudential is in 6 of the 10 `comparison` questions** — fixing Prudential's chunker is most of the `comparison` gate.

### `concept` — uneven, not uniformly dead

| Question | Insurer | CP | CR | Reading |
|---|---|---:|---:|---|
| Q16 Prudential — carência suicídio | Prudential | 1.00 | 0.50 | retrieves OK |
| Q17 Prudential — renovação automática | Prudential | 0.59 | 0.00 | partial |
| Q26 Prudential — VG Corporate min vidas | Prudential | 0.00 | 0.00 | dead (group product, doc poorly covered) |
| Q25 Azos — doenças preexistentes | Azos | 1.00 | 0.33 | retrieves OK |

`concept` pain is real but **patchy** — some Prudential clauses retrieve fine, others (group products) are dead. The blind chunker hurts `concept` less uniformly than `comparison` because single-clause concept questions sometimes get lucky with a 2000-char window that happens to contain the whole clause.

### The eval-coverage gap (a finding that shapes the pilot)

- **Prudential:** 6 `comparison` + 3 `concept` questions → a real before/after signal is measurable.
- **Azos:** **1** question total (Q25, `concept`). A shadow before/after on Azos would have ~1 data point — **not measurable.**
- **MAG:** 2 `comparison` questions, both rate-flavored; 0 `concept`.

→ Before Azos can be a *measurable* pilot, the eval set needs Azos `concept`/`comparison` questions. That is a B2 prerequisite, not a PR 3B blocker — flagged in §6.

---

## 4. Which insurer is the real pilot of the shadow set?

**Prudential do Brasil.** It is the only choice that satisfies all four pilot criteria:

1. **Business priority** — P0 per the issue #13 scope correction.
2. **Eval lever** — 6/10 `comparison` questions + 3 `concept` questions ride on Prudential. The ratified gate (`comparison` CP 0.13 → ≥ 0.50) is *mostly* a Prudential measurement.
3. **Measurable before/after** — enough scored Phase 7 baseline questions exist to run B2 partial Ragas apple-to-apple.
4. **product_id resolvable** — Prudential has a 12-row `products` catalog, so the chunker's `product_id` resolver stage can be exercised for real (Azos/MAG would only ever produce `product_unresolved=true`).

Azos and MAG do **not** become pilots. They are **rollout followers** — re-chunked through the *same* pipeline only after Prudential's shadow set passes B2 partial Ragas. Azos additionally needs eval questions added first (§3).

---

## 5. Where Bradesco enters — fixture only, never rollout

Bradesco is the **parser sanity-check fixture**, for three concrete reasons:

1. **It is already the PR 3A probe seed** — `app/scripts/phase2/azure-di-shadow.ts` and the committed S0 evidence (`docs/audit-runs/azure-di-shadow-20260515T020506Z/`) are Bradesco Vida Viva. The probe artifacts are a ready-made golden input.
2. **It is a known-pathological chunking case** — PR #14 / the rag-current-state audit found Bradesco `conditions_pdf` chunks with `max_len = 24.824` chars. A doc that breaks the *old* chunker that badly is the ideal **adversarial fixture** for the *new* semantic chunker's clause-boundary logic.
3. **It keeps Bradesco out of the rollout sequence** — using Bradesco as a unit-test fixture means the chunker is exercised against it on every commit, without Bradesco ever being re-ingested into the shadow set or counted as a rollout target.

**Concretely:** PR 3B's semantic-chunker slice gets a golden-file test that runs the Bradesco Vida Viva Layout markdown through the chunker and asserts the chunk contract (no mid-clause cuts, section path present, page numbers monotonic). Bradesco appears in `app/scripts/phase2/__fixtures__/` and in test assertions — **never** in a shadow-set write, never in the rollout table.

---

## 6. PR 3B in small, reversible slices

PR 3B = the 6-stage pipeline from the architecture doc (PR #15 §1), delivered as **6 separate PRs**, each independently reversible. Hard guardrails carried from issue #13: no re-ingestion, no read-path change, no `rate-lookup.ts` change, no `DELETE`, no promotion before B2.

| Slice | Deliverable | DB write? | Reversibility |
|---|---|---|---|
| **3B.1** | `azure-di-client.ts` — wraps the REST `prebuilt-layout` call (PR 3A already proved S0 works), returns a typed Layout result. Pure I/O module. | none | New file, unused until 3B.2 imports it. Delete-to-revert. |
| **3B.2** | `semantic-chunker.ts` — Layout markdown → clause/section-bounded chunks honoring the contract (300–1500 chars, never mid-clause, `section` path, `page`, `clause` id). Pure function. **Golden-file tested on the Bradesco fixture (§5) + one Prudential doc.** | none | New file. Pure function — fully testable, no side effects. |
| **3B.3** | `chunk-gate.ts` — the 8 quality gates from architecture doc §5 (content, boundary, page, insurer, product, confidence, type, dedup). Quarantine-not-index on fail. Pure function. | none | New file. Pure function. |
| **3B.4** | `product-resolver.ts` + **read-only preview script** — matches `(insurer, SUSEP \| code \| name)` ↔ `products`. **Prudential only resolves (12 catalog rows); Azos/MAG emit `product_unresolved=true`** (§2). Preview script writes a report to `docs/audit-runs/`, **no DB write** (Phase 3A G1 discipline). | none | Read-only. The preview is a report, not a mutation. |
| **3B.5** | `shadow-indexer.ts` — writes the **Prudential pilot** chunks tagged `metadata.parser='azure-di-layout-v3'` with `valid_until` set to a sentinel (or `metadata.shadow=true`) so they are **inert**: `match_documents` filters `valid_until IS NULL`, so shadow chunks never reach the production read path. | yes — **shadow only, inert by construction** | Shadow rows are already excluded from every read. "Revert" = leave inert or mark, **never `DELETE`**. The production read path is provably untouched. |
| **3B.6** | shadow embed + index + **isolated shadow-eval harness** — embeds the shadow chunks and provides a script that runs retrieval *against the shadow set in isolation*, so B2 can compare old-chunks vs shadow-chunks before/after. | embeddings on already-inert rows | Read-only eval; embeddings sit on rows that are already out of the read path. |

**Explicitly NOT in PR 3B:**
- **Promotion** (flipping `valid_until` so shadow becomes live and old becomes superseded) — gated behind **B2 partial Ragas before/after**. Never before.
- **Azos / MAG re-chunking** — rollout followers, only after Prudential's shadow set passes B2.
- **`product_id` backfill for Azos/MAG** — blocked by their empty `products` catalog; separate catalog-seeding effort.
- **Any `rate_table_pdf` / `insurer_rate_tables` / `rate-lookup.ts` change** — that path scores CP=CR≈1.0, untouched.

### Post-PR-3B sequence (for context, not part of this plan)

- **B1** — paid S0 run: re-chunk Prudential's 22 `conditions_pdf` docs into the shadow set (~1.700 pages, well inside trial credit).
- **B2** — partial Ragas before/after: the 6 Prudential `comparison` + 3 `concept` questions, old chunks vs shadow chunks. Gate: `comparison` CP 0.13 → ≥ 0.50, CR → ≥ 0.45; `concept` CP → ≥ 0.55, CR → ≥ 0.50; **no `rate_*` regression.**
- **B3 / B4** — promote (if B2 passes) or roll back (fully reversible via `valid_until`).
- **Then** Azos (after eval questions are added), then MAG.

---

## 7. What this plan does NOT do

- No code. No migration. No DB write. No re-ingestion. No `DELETE`. No read-path change. No `rate-lookup.ts` change.
- No promotion of any chunk before B2 partial Ragas before/after.
- No Azos/MAG `product_id` backfill (their `products` catalog is empty — separate effort).
- No commitment of the `questions_comparison.jsonl` fixture or new Azos eval questions — those are B2 prerequisites, tracked separately.

---

## 8. One-line conclusion

PR 3B builds the semantic chunker + an **inert** Prudential shadow set in six reversible slices; **Prudential is the pilot** because it is P0, carries 6/10 of the `comparison` gate, and is the only one of the three with a `products` catalog; **Bradesco stays a test fixture, never a rollout target**; nothing is promoted before B2 partial Ragas before/after.

---

_End of plan. PR 3B implementation (slice 3B.1) requires CEO approval of this plan._
