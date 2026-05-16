# SOLOMON — Phase 2 PR 3B shadow expansion design

_Read-only design. No code, no migration, no DB write, no re-ingestion. Generated 2026-05-16._

**Issue:** [#13 — Phase 2: Azure DI Layout redesign for `conditions_pdf` retrieval](https://github.com/RENATOVIEIRA10/SOLOMON-/issues/13)
**Predecessors:** PR #25 (3B.5 shadow text), PR #31 (3B.6.1 embedder), PR #32 (3B.6.2 retrieval fn), PR #33 (3B.6.3 eval harness — strategic stop fired).
**Sources of truth:** `docs/phase-2-pr3b-plan.md`, `docs/phase-2-pr3b6-design.md`, slice 3B.6.3 audit report under `docs/audit-runs/phase-2-pr3b6.3-20260516T142427Z/REPORT.md`.

> **Phase 2 mother-rule (unchanged):** Phase 2 replaces the chunker. PR 3B.6.3's strategic stop says the chunker has not been measured against legacy yet — the shadow set is too narrow to support measurement. This design fixes the measurement plumbing, not the chunker.

---

## 0. Why this design exists — the strategic stop

`docs/audit-runs/phase-2-pr3b6.3-20260516T142427Z/REPORT.md` aggregates:

| category | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | regressed? |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| comparison | 6 | 56.7% | 33.3% | **-23.3pp** | 43.1% | 9.7% | **-33.3pp** | **YES** |
| concept | 3 | 70.0% | 36.7% | **-33.3pp** | 80.6% | 33.3% | **-47.2pp** | **YES** |

CEO read (PR #33 merge comment, accepted): the harness did its job. The drop is not chunker quality — it is **scope mismatch**.

Two structural causes:

1. **The shadow set is page-truncated.** Slice 3B.5 batch ran `--max-pages 5`. Prudential conditions PDFs run 30-100+ pages. Clauses like _carência suicídio_ (Q16), _renovação automática_ (Q17), _VG Corporate min vidas_ (Q26) live on pages 8+ — outside the shadow window.
2. **Two of the nine questions are rate-table flavoured.** Q38 (CIB5G vs CIB5H) and Q39 (TM10/15/20) need product codes that live in `rate_table_pdf`, not `conditions_pdf`. Slice 3B.5 is `conditions_pdf`-only by contract, so the shadow set cannot retrieve them under any page span.

Until both are addressed, "shadow CP < legacy CP" is a statement about scope, not about the chunker.

---

## 1. What this design does NOT do

- No code. No migration. No DB write. No re-ingestion.
- No promotion. `valid_until` stays at the sentinel. `match_documents` is not edited.
- No DELETE of v3 orphans (29 rows) and no DELETE of the existing 150 v4 shadow rows.
- No Azos / MAG re-chunking.
- No 3B.6.4 (LLM Ragas judge) — remains gated.
- No Agentic RAG / PageIndex — those are Phase 3.

Same hard guardrails the rest of PR 3B carries.

---

## 2. Two-track expansion

### Track A — widen the page span (re-run slice 3B.5 batch)

Re-run the existing slice 3B.5 batch CLI on the 22 Prudential PDFs with a higher `--max-pages` (recommended **50**, or full-document if a doc is short). The CLI itself does not need code changes — the page-span argument is already a flag, and the batch's `ORPHAN_SUPERSET` classification (PR #29) already handles the inevitable coexistence of new v4 rows with the existing pages-1-5 v4 rows.

Concretely:

| step | command (VPS) | effect |
|---|---|---|
| 0 | `git pull master` | already on a branch with all the slices |
| 1 | `npm run phase2:azure-di:shadow-indexer -- --batch --dry-run` | confirm 22 URLs still in the manifest |
| 2 | `npm run phase2:azure-di:shadow-indexer -- --batch --live --write --max-pages 50` | write NEW v4 rows for pages 6-50 of every PDF |
| 3 | direct DB query | confirm the new total v4 row count + zero leak |

Idempotency note: existing v4 rows for pages 1-5 stay in place. New rows for pages 6-50 are net-new because their `chunk_index` values are different (the chunker emits indices 0..N-1 across the full layout). Each per-doc post-write probe will land in `ORPHAN_SUPERSET` or `FRESH` depending on prior state; **`shadowLeak = 0` is the only stop signal that matters**.

Cost estimate:

| component | quantity | unit | total |
|---|---:|---|---:|
| Azure DI Layout S0 | 22 PDFs × ~50 pages avg | $0.015 / page | **~$16.50** |
| OpenAI text-embedding-3-small | ~1000 chunks × ~250 tokens | $0.02 / 1M tokens | **~$0.005** |
| Supabase write | ~1000 UPDATEs | included | $0 |
| **Total expected** | | | **~$16.50** |

Inside the embedder's `--max-cost-usd $5` default — Track B needs `--max-cost-usd 1` (well above the embedding cost) but the **Azure DI portion is paid separately**. The shadow-indexer CLI has its own `--max-pages 50` ≤ `COST_BLAST_THRESHOLD 50` guard (any page-cap above 50 needs `--allow-cost-blast`), so 50 is a tight fit. If we go higher we add `--allow-cost-blast` explicitly.

### Track B — re-embed the new shadow rows (re-run slice 3B.6.1)

The slice 3B.6.1 embedder is idempotent: it only embeds rows with `embedding IS NULL` and the WHERE clause filters by `metadata.hash_scheme='url-aware-v1'` + sentinel `valid_until`. After Track A writes new shadow rows, the new rows have `embedding IS NULL` and the embedder picks them up.

```
npm run phase2:azure-di:shadow-embedder -- --live --write
```

Expected per the slice 3B.6.1 report:
- pre-write `shadow_rows_total` jumps from 150 to ~1150.
- pre-write `shadow_rows_already_embedded` = 150 (existing).
- pre-write `eligible` = ~1000 (new rows from Track A).
- post-write probes return 0 leak, 0 cross-set bleed, no AZURE_ERROR, no WRITE_ERROR.

No code change. Same hard contract (no embedding on non-shadow rows, idempotency, etc.).

---

## 3. Harness adjustment — categorize in-scope vs out-of-scope

CEO requirement: separate `conditions_pdf` in-scope questions from `rate_table_pdf` out-of-scope/control questions in the report.

The slice 3B.6.3 harness currently treats all 9 questions equally. The adjustment is a small, additive code change (no removed feature):

### 3.1 New field on `ShadowEvalQuestion`

```ts
export interface ShadowEvalQuestion {
  id: string
  category: 'comparison' | 'concept'
  question: string
  expectedTokens: readonly string[]
  /**
   * Which corpus this question SHOULD retrieve from. The shadow set
   * is conditions_pdf only, so 'control_rate_table' questions are
   * not expected to score on the shadow side — they are reported as
   * an informational sanity check that legacy retrieval still hits
   * the rate-table path.
   */
  scope: 'conditions' | 'control_rate_table'
  notes?: string
}
```

Per-question assignment (based on `questions.jsonl` `ground_truth` content):

| Q | category | scope | rationale |
|---|---|---|---|
| Q16 carência suicídio | concept | **conditions** | clause is in conditions PDF; rate tables irrelevant |
| Q17 renovação automática | concept | **conditions** | same |
| Q26 VG Corporate min vidas | concept | **conditions** | group-product clause in conditions PDF |
| Q31 Prudential TM10 vs Bradesco | comparison | **conditions** | answer mixes a Prudential rate (lives in rate table) with conditions text; the conditions-side retrieval IS the test we want here |
| Q32 DDR5G vs others | comparison | **conditions** | same shape — conditions clauses for DDR5G |
| Q36 Renda Familiar vs Bradesco | comparison | **conditions** | textual comparison; no rate numbers in ground truth |
| Q37 WL10G vs WL00G | comparison | **conditions** | the differentiator (`capital remido em 10 anos`) is a conditions concept; product codes are secondary |
| **Q38** CIB5G vs CIB5H | comparison | **control_rate_table** | pure rate question (`20,4928 vs 20,2133 per_1000_annual`); legacy hits this via the structured rate path; shadow conditions-only cannot score by design |
| **Q39** TM10/TM15/TM20 | comparison | **control_rate_table** | pure rate question (rate per 1000 annual for 3 terms); same as Q38 |

### 3.2 Report layout change

```
## Per-question results (in-scope: conditions_pdf — N=7)
  | Q | category | Legacy CP | Shadow CP | Δ CP | ... |
  Q16 ...
  Q17 ...
  Q26 ...
  Q31 ...
  Q32 ...
  Q36 ...
  Q37 ...

## Per-question results (control: rate_table_pdf — N=2, NOT in stop signal)
  | Q | category | Legacy CP | Shadow CP | Δ CP | reading |
  Q38 ...  legacy 100% / shadow 0% — expected: shadow conditions-only
  Q39 ...  legacy 100% / shadow 0% — expected

## Category aggregates (in-scope only — these drive the stop signal)
  | category | Qs in-scope | Legacy CP | Shadow CP | Δ CP | ...

## Control aggregate (informational only — not a stop signal)
  | scope | Qs | Legacy CP | Shadow CP | reading |
  control_rate_table | 2 | ... | ... | legacy ≥ shadow expected by design

## Stop signal (over in-scope aggregates only)
  ...
```

### 3.3 Strategic stop computation

The stop signal applies ONLY to `scope = 'conditions'` aggregates. Control questions are reported but never feed `shadowRegressed`. A control question scoring `shadow < legacy` is the **expected** behaviour (`conditions_pdf` shadow cannot beat structured rate retrieval on a rate question) and must not trip the stop.

### 3.4 Tests added by the harness adjustment

| test | what it asserts |
|---|---|
| each `ShadowEvalQuestion` has `scope` set | shape invariant |
| `tallyCategoryAggregates` skips `scope='control_rate_table'` questions | aggregate filter |
| new `tallyScopeAggregate` returns one row per scope | informational rollup |
| stop signal does not fire when only control questions regressed | strategic-stop scoping |

---

## 4. Slice breakdown (the actual PRs)

| slice | deliverable | mergeable separately? |
|---|---|---|
| **3B.7.1** | Harness adjustment — `scope` field on `ShadowEvalQuestion`, report split into in-scope / control sections, stop-signal restricted to in-scope. ~150 LOC + 4-6 new unit tests. | yes — pure code change, runs against the EXISTING shadow set, gives a clean baseline before Track A runs. |
| **3B.7.2** | Track A execution evidence — `docs/audit-runs/phase-2-pr3b7.2-<ts>/` report of the `--batch --live --write --max-pages 50` re-run. No code; commit is the audit-run report (mirroring how slice 3B.5 controlled batches were documented). | yes — pure DB write with existing CLI; no code change. CEO-approved page span. |
| **3B.7.3** | Track B execution evidence — `docs/audit-runs/phase-2-pr3b7.3-<ts>/` report of the embedder rerun on the new rows. No code. | yes — pure DB write with existing CLI. |
| **3B.7.4** | Re-run the (now-categorized) harness against the expanded shadow set. The first run produces the real measurement. | yes — pure CLI run; output drives the next CEO decision. |

3B.7.1 ships first so the harness baseline already separates control from in-scope, even on the current narrow shadow set. That avoids re-shaping the comparison after Track A lands.

---

## 5. Stop criteria — when each slice halts

3B.7.1 (harness adjustment):
- Unit tests fail.
- Existing 48 tests regress.
- Smoke run on the current shadow set surfaces any difference in in-scope per-question scores vs PR #33's report. (The categorization should not change in-scope numbers — only filter the aggregate.)

3B.7.2 (Track A re-run):
- Same hard stops as slice 3B.5 batch: `totalShadowLeaks > 0`, `AZURE_ERROR > 0`, `WRITE_ERROR > 0` (per `shadow-indexer-batch.ts` exit-code logic), `final read-path probe` returns non-zero shadow or non-null `valid_until`.
- Cost overrun: per-doc `--max-pages` honoured by the CLI; aggregate cost monitored via report's `estimated Azure cost`.
- Pre-write: shadow leak baseline must be 0 (carried from the slice 3B.5 contract).

3B.7.3 (Track B re-run):
- Same hard stops as slice 3B.6.1: `shadowLeak > 0`, cross-set bleed delta ≠ 0, embedded-count delta ≠ expected.

3B.7.4 (re-run harness):
- Strategic stop signal applies ONLY to in-scope aggregates (PR 3B.7.1).
- Reporting honest is mandatory — do not retry with different parameters to chase a passing number.

---

## 6. Cost summary

| component | estimate |
|---|---:|
| 3B.7.1 harness adjustment | $0 (code only) |
| 3B.7.2 Azure DI re-run (22 PDFs × ~50 pages) | ~$16.50 |
| 3B.7.3 embedder re-run (~1000 new chunks) | ~$0.005 |
| 3B.7.4 harness re-run | $0.000009 (9 question embeddings) |
| **Total** | **~$16.50** |

Below the slice 3B.5 batch's existing `--max-pages` and `--allow-cost-blast` guards. If we choose to go above 50 pages on a doc, that doc's run needs `--allow-cost-blast` per slice 3B.5's CLI contract — explicit, not silent.

---

## 7. Risks and how each is bounded

| risk | bound |
|---|---|
| Track A leaks shadow rows into prod (`valid_until = NULL`) | `assertRowsAreInert` runs per row; per-doc post-write probe + final read-path probe (`match_documents` top-K=50) ratchet exit-code to 1. Identical guard chain as PR #29. |
| Cross-URL hash collision (the old PR #28 bug) | The fix from PR #28 — URL-aware hash + `shadow-v4:` prefix — is already in master. Re-running just adds new (url, content) pairs. |
| Embedder re-run touches v3 orphans | Embedder WHERE clause filters `hash_scheme='url-aware-v1'` — v3 orphans never match. Tested in PR #31 (test: "rejects metadata.hash_scheme != url-aware-v1"). |
| Harness categorization mistaken (a real conditions question marked as control by accident) | Q16/17/26/31/32/36/37 are reviewed in this design and stay `conditions`. Only Q38/Q39 are `control_rate_table`. Per-question rationale is in the doc. Reviewable. |
| Expansion still does not produce a positive Δ | Same strategic-stop signal fires; CEO decides whether the chunker needs work or the eval set needs refinement. The harness is the truth-teller, not the chunker's advocate. |

---

## 8. Non-goals (explicit)

- No promotion. `valid_until` stays at the sentinel.
- No DELETE. v3 orphans (29 rows) AND existing 150 v4 rows from `--max-pages 5` stay in DB.
- No edit of `match_documents`, `answer.ts`, `compare.ts`.
- No Azos / MAG.
- No re-embedding of legacy production rows.
- No Ragas LLM judge in this round.
- No Agentic RAG / PageIndex.

---

## 9. One-line conclusion

PR 3B.6.3's strategic stop revealed the shadow corpus is page-truncated and conditions-only, so the chunker has not been measured yet; this design expands the shadow corpus to full Prudential PDFs and categorises the eval questions so the next harness run measures the chunker on its own terms — without promoting, deleting, or touching the production read path.

---

_End of design. Slice 3B.7.1 (harness adjustment) implementation requires CEO approval of this plan._
