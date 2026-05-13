# SOLOMON — Phase 3A Plan: Structural Fixes Without Reingestion

_Read-only plan document. No patch, migration, backfill, or code change is applied by this document. Generated 2026-05-13. Author: Claude (Phase 3A planning pass)._

**Status:** **PROPOSED — awaiting CEO approval.**
**Upstream:** [docs/rag-current-state-audit.md](./rag-current-state-audit.md) (Phase 1 audit, PR #6).
**Downstream blockers:** Phase 2 (Azure DI migration for `conditions_pdf`) and Phase 7 (full Ragas rebaseline) are explicitly deferred until Phase 3A is delivered and validated.

---

## 0. Purpose and scope

Phase 1 surfaced two structural defects that throttle SOLOMON's retrieval quality **without** needing any reingestion of PDFs or any new ingestion pipeline:

1. **`product_id` is NULL on ~98% of chunks**, and entirely missing for MAG / Azos / MetLife / MAPFRE / Caixa. `metadata.product_name` already carries the correct string in 88% of chunks, but `filter_product_id` in `match_documents` is dead because no value is set to filter on.
2. **`compare.ts` and `pre-sinistro.ts` query the index without a `source_type` filter and without rerank.** Rate-table chunks (avg ~285 chars, numeric noise) leak into verbal queries, and verbal-conditions chunks leak into rate queries on the rare path that bypasses the fast-path.

This phase corrects both **using data and code that already exists**. It does not redesign ingestion. It does not change the brief's Phase 2 architecture.

**Hard non-goals (deferred):**
- No reingestion of any PDF.
- No new sourceTypes.
- No new ingestion pipeline.
- No Azure DI live integration (that is the reframed Phase 2).
- No metadata enrichment (`confidence`, `section`, `clause`, `effective_date`) — Phase 2.
- No GraphRAG.
- No hybrid (BM25 + vector) search — separate proposal.
- No Solomon Core refactor — Phase 4.

**Hard rules:**
- Every step that touches data is preceded by a **read-only preview** that the CEO approves.
- Every write is performed as a single atomic SQL transaction with a recorded backup row set.
- Every code change is a separate small commit that can be reverted with `git revert`.
- No production deploy until smoke + mini-Ragas pass.

---

## 1. Preview of `product_id` backfill for MAG / Azos / MetLife / MAPFRE / Caixa

### 1.1 Why these 5 insurers

| Insurer | Chunks | `product_id` populated | Catalog rows in `public.products` |
|---|---|---|---|
| MAG Seguros | 6.378 | 0 (0%) | needs verification (script will print) |
| Azos | 1.385 | 0 (0%) | needs verification |
| MetLife | 885 | 0 (0%) | needs verification |
| MAPFRE Seguros | 449 | 0 (0%) | needs verification |
| Caixa Vida e Previdencia | 1 | 0 (0%) | needs verification |
| **Total addressable** | **9.098** chunks | — | — |

These are the 5 insurers where the chunk pool has `product_id=NULL` **and** the catalog table `public.products` has rows. Bradesco (81 product_ids populated) and Prudential (11 populated) are excluded — their backfill problem is a different shape (Bradesco has thin coverage per product, not missing IDs) and is **not** in scope for Phase 3A.

### 1.2 Match strategy (ranked, conservative)

The script tries 4 join strategies in order of confidence and stops at the first one that produces a non-zero match for each chunk. A chunk that no strategy matches stays NULL — it becomes a Phase 2 ingestion problem, not a Phase 3A problem.

| # | Strategy | Source field | Target field | Confidence |
|---|---|---|---|---|
| 1 | **Exact (normalized)** | `lower(unaccent(documents.metadata->>'product_name'))` | `lower(unaccent(products.name))` | HIGH |
| 2 | **Insurer-scoped exact** | same as #1 | scoped by `products.insurer_id = documents.insurer_id` | HIGH (default scope) |
| 3 | **Token-set similarity** | tokenized `metadata.product_name` | tokenized `products.name` | MEDIUM (`pg_trgm` similarity ≥ 0.7) |
| 4 | **Manual review queue** | unmatched chunks | written to `docs/audit-runs/phase-3a-unmatched-YYYYMMDD.csv` | n/a |

Strategy #2 (insurer-scoped) is the safe default — it prevents a MAG chunk from being attached to a Prudential product just because the strings happen to overlap.

### 1.3 Preview script (read-only, to be created)

**File:** `app/scripts/rag-audit/preview-backfill-product-id.ts`
**Reads only.** Writes nothing. Outputs to stdout (and CSV files in `docs/audit-runs/`).

Output contract (printed to stdout as markdown):

```
| insurer | chunks | matched_exact | matched_token | unmatched | conflicts |
|---|---|---|---|---|---|
| MAG Seguros | 6378 | 5210 | 612 | 556 | 0 |
| Azos | 1385 | 1290 | 50 | 45 | 0 |
| ...
```

A `conflict` is when two strategies disagree on which `product_id` to attach, or when a chunk would match a product from a **different insurer** (strategy #1 without scope picks a wrong-insurer product). Conflicts MUST be zero before approval — otherwise the strategy ladder is too loose and the spec is rejected.

Three CSVs written to `docs/audit-runs/`:

- `phase-3a-backfill-proposal-YYYYMMDD.csv` — `chunk_id, insurer, current_product_id, proposed_product_id, strategy, confidence, product_name_chunk, product_name_target`
- `phase-3a-unmatched-YYYYMMDD.csv` — chunks with no match (Phase 2 input)
- `phase-3a-conflicts-YYYYMMDD.csv` — must be empty before approval

### 1.4 Spot-check protocol (human-in-the-loop)

Before the backfill is approved, the CEO (or a designated reviewer) MUST sample at least:
- 20 random rows from `phase-3a-backfill-proposal-YYYYMMDD.csv` (10 strategy #1, 10 strategy #3).
- 100% of strategy #3 (token-similarity) matches if total count is ≤ 500.
- 100% of any rows where `product_name_chunk` and `product_name_target` look textually distant.

Approval is **per insurer**. CEO can approve MAG and Azos but reject MetLife if the proposal looks weak — the SQL update is parameterized by insurer.

### 1.5 SQL plan (executed only after CEO approval)

```sql
-- Phase 3A backfill - DRY RUN by default
BEGIN;

-- Snapshot of the to-be-changed rows BEFORE the update, kept until rollback window expires
CREATE TABLE IF NOT EXISTS public.documents_backfill_backup_phase3a (
  chunk_id uuid PRIMARY KEY,
  insurer_id uuid,
  previous_product_id uuid,
  proposed_product_id uuid,
  strategy text,
  backfill_run_at timestamptz DEFAULT now()
);

-- Insert proposals as a snapshot (idempotent: PK on chunk_id)
INSERT INTO documents_backfill_backup_phase3a (chunk_id, insurer_id, previous_product_id, proposed_product_id, strategy)
SELECT d.id, d.insurer_id, d.product_id, p.proposed_product_id, p.strategy
FROM staging_phase3a_proposals p
JOIN documents d ON d.id = p.chunk_id
ON CONFLICT (chunk_id) DO NOTHING;

-- Apply backfill — single UPDATE, transactional
UPDATE documents d
SET product_id = b.proposed_product_id,
    updated_at = now()
FROM documents_backfill_backup_phase3a b
WHERE d.id = b.chunk_id AND d.product_id IS NULL;

COMMIT;
```

Migration filename if accepted: `app/supabase/migrations/<YYYYMMDDHHMMSS>_phase3a_backfill_product_id.sql`.

**Reversal:** see §6.

---

## 2. `source_type` filter in `compare.ts` and `pre-sinistro.ts`

### 2.1 Current state (from audit §5)

- `compare.ts` calls `semanticSearch(q, { insurerId: id, topK: 3 })` — no `sourceType`, no rerank.
- `pre-sinistro.ts` — same shape (requires verification by reading the file; not done in this plan to avoid premature design).
- The brief explicitly forbids `rate_table_pdf` chunks from answering verbal coverage/comparison/pre-sinistro questions.

### 2.2 Proposed patch (smallest possible)

`app/src/services/rag/compare.ts`, inside the per-dimension fetch loop:

```diff
- const r = await semanticSearch(q, { insurerId: id, topK: 3 });
+ const r = await semanticSearch(q, { insurerId: id, topK: 3, sourceType: 'conditions_pdf' });
```

`app/src/services/rag/pre-sinistro.ts` — identical change at every `semanticSearch` call where the query is verbal (cobertura / exclusão / sinistro). If pre-sinistro fans out multiple queries, each gets the filter.

**Why only `conditions_pdf` and not "anything but rate_table_pdf":**
- Today only 2 sourceTypes exist; the set of "not rate_table" equals the set "conditions". The whitelist is equivalent and is forward-compatible (when Phase 2 adds `product_manual_pdf`, the maintainer makes an explicit choice).
- Explicit allowlist beats implicit denylist by a wide margin in audit contexts.

### 2.3 What NOT to touch in this patch

- **No rerank addition.** `compare.ts` skips rerank deliberately to preserve diversity (audit §5.3). Adding rerank is a separate proposal with its own evaluation — not Phase 3A.
- **No topK change.** Current topK=3 per query × 6 queries × N insurers is the established budget.
- **No round-robin restructuring.** `compare.ts` already has structural diversity by per-insurer fanout.
- **No prompt change.** The system prompt in `compare.ts` is independent of retrieval.
- **No new dimensions.** The 6 comparison dimensions stay as-is.
- **No `pre-sinistro.ts` redesign.** Only the source_type filter is added; the Sonnet 4.6 model stays, the evidence gate stays.

### 2.4 Patch hygiene

- One commit per file (`compare.ts`, `pre-sinistro.ts`) → 2 small commits, each ≤ 5 lines changed.
- Commit message format: `fix(rag): force conditions_pdf source_type in <file> (Phase 3A)`.
- The two commits sit in a branch named `fix/phase-3a-source-type-filter`.

---

## 3. Regression tests

The audit already produced 2 read-only test scripts (`test-rag-exclude.ts`, `test-source-type-routing.ts`). Phase 3A adds **unit tests** at the function level for the patched code.

### 3.1 New tests (proposed paths)

| Test | Location | What it locks |
|---|---|---|
| `compareInsurers — source_type=conditions_pdf` | `app/src/services/rag/__tests__/compare.test.ts` | Every retrieval result returned by `compareInsurers` has `source_type === 'conditions_pdf'`. Mock `semanticSearch` and assert each call's `options.sourceType === 'conditions_pdf'`. |
| `analyzePreSinistro — source_type=conditions_pdf for verbal queries` | `app/src/services/rag/__tests__/pre-sinistro.test.ts` | Same assertion for pre-sinistro's verbal queries. |
| `rate-lookup fast-path unchanged` | `app/src/services/rag/__tests__/answer.test.ts` (extension) | When rate intent fires, the path bypasses `semanticSearch` entirely — does NOT regress to a verbal query. |
| `rag_exclude regression — black-box` | reuses `app/scripts/rag-audit/test-rag-exclude.ts` | Run as part of CI before the backfill is applied. |
| `product_id backfill — sampled correctness` | `app/scripts/rag-audit/verify-backfill.ts` (new, read-only) | After backfill, samples 50 random newly-populated chunks per insurer and asserts `metadata.product_name` matches `products.name` of the attached `product_id`. |

### 3.2 Test runner

- Vitest (if already in the repo) or Node's built-in `node:test` — to be confirmed from `app/package.json` when the patch is written. **Not confirmed in this plan.**
- All tests run via `npm test -- --reporter verbose` from `app/`.
- CI: not added in Phase 3A. CEO can decide if GitHub Actions setup belongs here or in a separate proposal.

---

## 4. Before/after report

A single markdown document (`docs/audit-runs/phase-3a-before-after-YYYYMMDD.md`) is generated automatically by a wrapper script. It captures:

### 4.1 Database snapshots

| Metric | Before | After | Δ | Pass criterion |
|---|---|---|---|---|
| Chunks with `product_id` populated | inventory snapshot | inventory snapshot | absolute Δ | per-insurer ≥ 70% of addressable |
| Chunks with `metadata.product_name` only (no product_id) | snapshot | snapshot | Δ negative | non-positive |
| `rag_exclude=true` chunks | 32 | 32 | 0 | unchanged |
| `valid_until IS NULL` chunks | snapshot | snapshot | 0 | unchanged |
| Total active chunks | 22.643 | 22.643 | 0 | unchanged |

### 4.2 Retrieval behaviour snapshots

Re-run `test-source-type-routing.ts` and `inventory.ts` before AND after the deploy, capture both outputs verbatim into the report. The report passes if:

- **Source-type routing test:** after the patch, the count of rate-query top-10 that lean toward `conditions_pdf` is at most 1 per query (was unknown before — the script will tell us).
- **Inventory:** counts after match the proposal CSV exactly (no extra rows touched, no fewer rows touched).

### 4.3 Smoke probes (WhatsApp via curl against prod)

5 fixed prompts run against `app-atalaia.vercel.app` (production) — before and after, recorded verbatim:

1. `"quais coberturas da MAG seguros?"` — concept query, MAG, expected: cite MAG product, source_url present.
2. `"compare Prudential vs Bradesco"` — `/comparar` command.
3. `"qual a taxa MAG vida inteira 40 anos homem capital 500 mil"` — rate fast-path, must still hit MAG rate.
4. `"/sinistro MAG morte_natural infarto agudo do miocardio"` — pre-sinistro.
5. `"o que e contestabilidade na Azos"` — concept query, Azos, must cite Azos.

Pass criterion: every response has a valid citation and no obvious wrong-insurer leakage. Recorded as transcript in the report.

### 4.4 Output location

`docs/audit-runs/phase-3a-before-after-YYYYMMDD.md` — committed in the same PR as the backfill migration so a reviewer sees the proof alongside the change.

---

## 5. Mini Ragas after approval

### 5.1 Subset selection

A reduced eval set targeting the 5 insurers and 2 retrieval paths most affected by Phase 3A:

| Category | Questions | Source |
|---|---|---|
| MAG concept/coverage | 5 | `app/eval/ragas/questions.jsonl` (filter `insurer=MAG`) |
| Azos concept/coverage | 3 | same |
| MetLife concept/coverage | 3 | same |
| MAPFRE concept/coverage | 2 | same |
| Caixa concept/coverage | 1 | same |
| Compare (cross-insurer) | 3 | `app/eval/ragas/questions_comparison.jsonl` |
| Rate fast-path control | 3 | (must not regress) |
| **Total** | **20** | — |

If a category has fewer questions in the existing eval set, take what is there — no new questions are written in Phase 3A.

### 5.2 Metrics

Same 5 as `STATUS.md` baseline: faithfulness (F), answer_correctness (AC), context_precision (CP), context_recall (CR), noise_sensitivity (NS).

Judge: **Gemini 2.5 Flash** (matches the current production stack post-Wave A.2).

### 5.3 Pass criteria

- **No regression > 0.05** on any of F/AC/CP/CR for the rate fast-path control questions (these should be unaffected).
- **At least one of CP or CR improves by ≥ 0.10** for the MAG / Azos / MetLife concept/coverage subset (this is the structural gain we are betting on).
- **F does not drop > 0.05** for any subset.
- Tier-score Hermes escalates (`tier1 < 3.5/5`) get re-evaluated **manually** by the operator and the result is logged in `agentes-hub.sync_context` as an `escalate_resolved` event for the relevant Hermes IDs.

### 5.4 Execution location

VPS (`104.131.187.118`, `/root/solomon/repo/app/eval/ragas`, per `CLAUDE.md`). Notebook is too small for the full run; the subset (20 questions) MIGHT fit on the notebook but the baseline answer is: VPS by default.

### 5.5 Persistence

Each row written to `agentes-hub.eval_runs` as the existing pipeline already does. Mini run is tagged in metadata as `phase: '3A'` and `run_type: 'mini_subset'` so it is filterable in the dashboard.

### 5.6 Hard rule

**No trilho is declared "green" off the mini Ragas alone.** A green declaration requires the full 49-question Ragas run, which is Phase 7. The mini run is a gate to detect regressions, not a substitute for the full rebaseline.

---

## 6. Rollback and safety

### 6.1 Backfill rollback

Backup table `documents_backfill_backup_phase3a` records every chunk_id touched, its previous product_id (NULL in the planned scope), and the proposed product_id. Reversal is one SQL statement:

```sql
-- Phase 3A rollback — full reversal
BEGIN;
UPDATE documents d
SET product_id = b.previous_product_id,
    updated_at = now()
FROM documents_backfill_backup_phase3a b
WHERE d.id = b.chunk_id AND d.product_id = b.proposed_product_id;
COMMIT;
```

**Partial rollback per insurer:** add `WHERE d.insurer_id = '<insurer_uuid>'` to the UPDATE. The backup table is keyed by `chunk_id` and trivially filterable by insurer.

The backup table is **kept for 30 days** after the backfill. After 30 days of green-state production, it can be dropped via a separate housekeeping migration. If the smoke or mini-Ragas fails in §4–5, the rollback is executed within the same session and the table is preserved for forensics.

### 6.2 Code patch rollback

Both patches (`compare.ts` source_type, `pre-sinistro.ts` source_type) are single commits each. Reversal:

```
git revert <commit-sha>
git push origin master  # only on explicit CEO approval per global rule
```

Vercel redeploys automatically on push. No data side-effects of the code revert.

### 6.3 Safety gates between steps

The phase is split into four gates. The CEO unlocks each one in sequence:

| Gate | Unlocks | Reversible? |
|---|---|---|
| G0 | This plan approved | n/a |
| G1 | Preview script runs and CSVs are reviewed | yes — no DB write yet |
| G2 | Source_type filter patches merged + deployed | yes — git revert |
| G3 | Backfill migration applied to prod DB | yes — §6.1 SQL |
| G4 | Mini Ragas passes + smoke green | n/a — declaration only |

A failure at any gate stops the phase. Gate G2 can be released before G3 if the CEO prefers to deploy the smaller, lower-risk patch first.

### 6.4 Data-loss protections

- No `DELETE` is issued by Phase 3A. Anywhere.
- No `UPDATE` to columns outside `documents.product_id` and `documents.updated_at`.
- No change to `match_documents` RPC. Filter behaviour stays identical.
- No change to `embedding` column. No re-embedding. No vector index rebuild.
- No change to `valid_until` or `superseded_by`. Document supersession is out of scope.
- Application secrets are not touched. Service-role key usage is read-only in preview, write-only in the single migration (which is reviewed before execution).

### 6.5 Production safety

- No work on Friday after 16:00 local. No work during a known maintenance window of Supabase or Vercel.
- Migration applied via `mcp__claude_ai_Supabase__apply_migration` after CEO countersigns the diff. **Never** via raw `execute_sql`.
- Smoke against production runs `app-atalaia.vercel.app` and not the Preview alias — Vercel target=production is required when env vars are rotated, per memory `reference_vercel_redeploy_target.md`. For Phase 3A the env vars are unchanged, so no redeploy is triggered by this work.

---

## 7. Acceptance criteria

Phase 3A is considered **delivered** if and only if **all** of these are true:

### 7.1 Backfill

- [ ] Preview CSVs reviewed and approved by CEO (per insurer).
- [ ] Conflicts CSV is empty before approval.
- [ ] Backfill applied via reviewed migration file (committed to repo).
- [ ] `documents_backfill_backup_phase3a` populated and queryable.
- [ ] ≥ 70% of MAG / Azos / MetLife / MAPFRE / Caixa chunks have `product_id` populated after the run.
- [ ] No chunk attached to a `product_id` whose `insurer_id` differs from the chunk's `insurer_id` (cross-insurer leak guard).
- [ ] Verify script (`verify-backfill.ts`) samples ≥ 50 rows per insurer and all match `metadata.product_name`.

### 7.2 source_type filter

- [ ] `compare.ts` patched, ≤ 5 LOC changed.
- [ ] `pre-sinistro.ts` patched, ≤ 5 LOC changed for verbal queries.
- [ ] Unit tests added asserting `sourceType: 'conditions_pdf'` is passed on every call where the query is verbal.
- [ ] `npm run build` clean from `app/`.
- [ ] `npm test` green (or whatever runner the repo declares).
- [ ] Rate fast-path unit test passes (zero regression on `answer.ts` rate path).

### 7.3 Regression guard

- [ ] `test-rag-exclude.ts` re-run against prod — verdict PASS, no leak.
- [ ] `test-source-type-routing.ts` re-run against prod — rate query domination by `rate_table_pdf` improves (script's verdict line is positive), concept query domination by `conditions_pdf` not worse.
- [ ] `rag_exclude=true` count after Phase 3A is exactly 32 (Prudential 6 + Bradesco 20 + Zurich 6). Any change is a regression.

### 7.4 Before/after report

- [ ] `docs/audit-runs/phase-3a-before-after-YYYYMMDD.md` committed.
- [ ] 5 smoke probes recorded verbatim, all with valid citations.
- [ ] No wrong-insurer attribution in any of the 5 probes (read by a human).

### 7.5 Mini Ragas

- [ ] 20-question subset executed on VPS with Gemini 2.5 Flash judge.
- [ ] Per §5.3: no F/AC/CP/CR regression > 0.05 on the rate fast-path control set.
- [ ] Per §5.3: at least one of CP or CR for the concept/coverage MAG/Azos/MetLife subset improves by ≥ 0.10.
- [ ] Per-row results persisted in `eval_runs` with `phase=3A, run_type=mini_subset`.

### 7.6 Hermes escalates

- [ ] After Phase 3A green, the Hermes operator re-evaluates the tier-score escalates. If tier1 for MAG / Azos / MetLife rises to ≥ 3.5/5, the relevant `sync_context` escalate rows are marked `resolved=true` with `resolved_by=phase-3a`.
- [ ] No new escalates introduced by the phase (check by running the Hermes nightly job after deploy and comparing the new-escalates delta).

### 7.7 Documentation

- [ ] PR titled `fix/phase-3a: structural fixes without reingestion` opens against `master` with the migration + code patches + tests.
- [ ] PR description links to this plan document.
- [ ] Audit script `verify-backfill.ts` added to `app/scripts/rag-audit/` and listed in the audit `report.ts`.
- [ ] `STATUS.md` updated to reflect Phase 3A delivery (one section, dated).

### 7.8 Phase exit gate

- [ ] CEO signs off in the PR or in a `sync_context` event of type `phase_approved` with `phase=3A`.
- [ ] Phase 2 (Azure DI migration for `conditions_pdf`) and Phase 7 (full Ragas) unblocked **only after** §7.5 mini-Ragas passes.

---

## 8. What this plan does NOT promise

- It does not promise that MAG / Azos / MetLife will reach the brief's "Verde" threshold (F≥0.85, AC≥0.65, CP≥0.75, CR≥0.70). That requires Phase 2 (better chunking + page metadata for the conditions_pdf set) and possibly Phase 4 (Solomon Core hardening) — Phase 3A targets the structural retrieval defect, not the chunking quality.
- It does not promise that comparison answers stop saying "Não consta" for Bradesco. Bradesco has 81 product_ids already populated — Phase 3A does not touch Bradesco. The Bradesco compare-quality problem will need a separate analysis (likely chunking and Bradesco-specific section recognition).
- It does not promise that pre-sinistro becomes vendable. That requires the literal-citation gate from the brief's Phase 4 spec and a Sonnet 4.6 rebaseline.
- It does not promise the "Verde" status in the capability matrix. Phase 3A is bounded to **structural** fixes; the matrix flips only after the full Phase 7 Ragas rebaseline.

---

## 9. Open questions for the CEO before any code is written

1. **Confidence threshold for strategy #3** (token similarity): default proposed is `pg_trgm` similarity ≥ 0.7. Loosen to 0.6 (more matches, more noise) or tighten to 0.8 (fewer matches, more conservative)?
2. **Per-insurer approval granularity:** confirm approval is given as one batch (all 5 insurers in one go) or per-insurer (5 separate green lights).
3. **Backup retention window:** default proposed is 30 days. Is that too long (storage) or too short (forensics)?
4. **Mini Ragas execution venue:** VPS by default. CEO can override to notebook if it is convenient and RAM permits.
5. **Gate G2 vs G3 ordering:** the default is "patches first, backfill second" (lower-risk first). CEO can flip if a different smoke order makes the diagnosis cleaner.
6. **`pre-sinistro.ts` scope:** the patch will be sized after reading the file. If the file has more than one type of query (e.g., a rate-shaped subquery for evidence weighting), only the verbal queries get the `conditions_pdf` filter. CEO should know that "all queries" is not necessarily the right answer.

Once these are answered, the actual code lives in a new branch `fix/phase-3a-source-type-filter` + a separate branch for the migration, and each step opens its own small PR per §6.3 gates.

---

_End of plan. No code, migration, backfill, or schema change has been performed by this document. Awaiting CEO approval to unlock Gate G1._
