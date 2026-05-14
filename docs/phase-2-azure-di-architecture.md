# SOLOMON — Phase 2 Azure DI Architecture

_Read-only design document. No code, schema, data, migration, or API call performed. Generated 2026-05-14._

**Issue:** [#13 — Phase 2: Azure DI Layout redesign for conditions_pdf retrieval](https://github.com/RENATOVIEIRA10/SOLOMON-/issues/13)
**Upstream:** [PR #14 — Phase 2 ingestion audit](https://github.com/RENATOVIEIRA10/SOLOMON-/pull/14) (approved as Phase 2 entry point)
**This is PR 2** of the 7-PR sequence defined in the audit §8.

> **Phase 2 mother-rule:** Phase 2 replaces the chunker. It does **not** tune the retriever to compensate for bad chunks.

---

## 0. What this document decides

The audit (PR #14) proved the root cause: a blind 2000-char chunker producing truncated, page-less, `product_id`-less fragments. This document specifies **how** the replacement pipeline is built, what it costs, how it is rolled out safely, and how it is measured — so the implementation PRs (3–7) have an approved contract to build against.

It does **not** write code. It is the architecture gate.

---

## 1. Azure DI Layout architecture

### 1.1 Why Layout (not Read, not a local parser)

| Option | Structure? | Tables? | Page numbers? | Verdict |
|---|---|---|---|---|
| `pdf-parse` (current) | no | no | no | the thing we are removing |
| Azure DI **`prebuilt-read`** | no (OCR text only) | no | yes | too thin — loses clause structure |
| Azure DI **`prebuilt-layout`** | yes (headings, paragraphs, lists) | yes (cell-level) | yes | **chosen** |

Insurance condition PDFs are deeply enumerated (`4. Coberturas` → `4.16 Morte do Cônjuge` → `a.2)` → `b.4)`). `prebuilt-layout` returns Markdown with that heading hierarchy preserved, plus per-element `boundingRegions` carrying the page number, plus structured table objects. That hierarchy is exactly what the new chunker splits on.

### 1.2 Pipeline stages

```
PDF bytes
  │
  ▼
[1] Azure DI prebuilt-layout
      → Markdown (## headings, lists, paragraphs)
      → per-element page numbers (boundingRegions)
      → table objects (rows/cells)
      → per-span confidence
  │
  ▼
[2] Document classifier
      conditions_pdf | rate_table | product_manual | unknown
      (heuristic: filename + first-page headings + SUSEP process presence)
  │
  ▼
[3] Semantic chunker  ← THE REPLACEMENT
      split on Markdown heading boundaries + clause numbers (4.16, a.2))
      target 300–1500 chars, NEVER cross a clause boundary, NEVER mid-word
      carry: section path, clause id, page, parser tag
  │
  ▼
[4] product_id resolver
      match (insurer_id, SUSEP process | product code | fuzzy name) ↔ public.products
      no match → metadata.product_unresolved = true  (flagged, not silent NULL)
  │
  ▼
[5] Quality gate  (§5)
      drop empty/whitespace; flag low-confidence; dedupe by content_hash;
      reject mid-word boundaries; reject mixed-insurer/mixed-product chunks
  │
  ▼
[6] Embed (existing embedder) → Index (existing indexer, contract-enforced)
      writes to SHADOW SET first: metadata.parser = 'azure-di-layout-v3'
```

Stages [5]–[6] reuse the existing `embedder.ts` / `indexer.ts` — only the **input contract** changes. Stages [1]–[4] are new.

### 1.3 Where it runs

- **VPS**, not the notebook — the 226 source PDFs (395 MB) already live on the VPS (`.crawler-pdfs/`), and Azure DI calls are network-bound, not CPU-bound.
- Azure DI is called document-by-document (one `analyze` request per PDF), results cached to disk so a re-run of the chunker does not re-bill the API.
- Both ingestion entry points (`ingest-opin.ts`, `crawl-pdfs-playwright.ts`) are refactored to feed the new pipeline — the audit showed both currently call the blind `chunkPdf()`.

---

## 2. Cost estimate

### 2.1 Page inventory (measured on the VPS, this session)

| Metric | Value | Method |
|---|---|---|
| PDFs on VPS | 226 | `find /root -name '*.pdf'` |
| Total pages | **19.575** | `pdfinfo` per file |
| Avg pages/PDF | 86 | — |
| Distinct `conditions_pdf` docs in DB | 157 | Supabase `COUNT(DISTINCT source_url)` |
| **Estimated pages to reprocess (157 unique docs × 86)** | **~13.500** | the 226 count includes stale dirs + re-downloads |

### 2.2 Azure DI pricing

> **Pricing must be re-confirmed in the Azure portal at execution time** — it varies by region and changes. The numbers below are planning estimates based on the standard `prebuilt-layout` S0 tier (~$10 per 1.000 pages = $0.01/page) known as of early 2026.

| Scope | Pages | Estimated cost (S0) | BRL @ R$5,50 |
|---|---|---|---|
| **Bradesco-first pilot** (31 docs × 86) | ~2.700 | **~$27** | ~R$ 150 |
| Full reprocess (157 docs) | ~13.500 | **~$135** | ~R$ 740 |
| Worst case (all 226 PDFs, no dedup) | 19.575 | ~$196 | ~R$ 1.080 |

### 2.3 Free tier de-risk

Azure DI **F0 (free tier) = 500 pages/month**. The pilot can validate the *entire pipeline* (stages 1–6) on ~5-6 Bradesco documents **at zero cost** before any paid commitment. Recommendation: **F0 validation first, then S0 only after the pilot Ragas before/after proves the chunker redesign moves CP.**

### 2.4 Cost discipline (carries from issue #12)

- Azure DI results are **cached to disk** — the chunker can be re-tuned and re-run without re-billing.
- Re-ingestion is insurer-by-insurer, not big-bang — spend is gated by validation at each step.
- No paid Azure DI call happens before the F0 pilot is approved.

---

## 3. Shadow set strategy

The new pipeline **never overwrites** existing chunks until validated.

### 3.1 Mechanism

- New chunks are indexed with `metadata.parser = 'azure-di-layout-v3'`.
- Old chunks keep their current state (`metadata.parser` absent or `azure-*` for the rate tables).
- During the shadow phase, `match_documents` still serves the **old** chunks — production read path is unchanged.
- The shadow chunks are queryable directly (by `metadata.parser`) for the before/after eval.

### 3.2 Promote / supersede

The `documents` table already has the columns for this (Phase 1 audit §1.2, currently unused):
- `valid_until` — set to `now()` on the OLD chunks of a promoted insurer.
- `superseded_by` — optional pointer from old chunk → new chunk.
- `match_documents` already filters `WHERE valid_until IS NULL` — so promoting = setting `valid_until` on the old set, in one transaction, per insurer.

### 3.3 No DELETE, ever

Old chunks are never deleted in Phase 2. They are superseded (`valid_until` set). If a promotion regresses, rollback = `UPDATE ... SET valid_until = NULL` on the old set + `valid_until = now()` on the shadow set. Fully reversible.

---

## 4. Final chunk contract

Every `conditions_pdf` chunk written by the new pipeline MUST satisfy this before embedding. This supersedes the draft in audit §4.

| Field | Type | Rule |
|---|---|---|
| `content` | text | clause/section-bounded segment, **300–1500 chars**, never mid-word, never crossing a clause boundary |
| `content_hash` | text | SHA-256 of normalized content (dedup key) |
| `source_type` | text | `conditions_pdf` — **real PDF text only**. Catalog dumps / stubs are classified `unknown` and NOT indexed as conditions |
| `insurer_id` | uuid | resolved via CNPJ — **required, never NULL** |
| `product_id` | uuid \| null | resolved via §1.2 [4]; if NULL then `metadata.product_unresolved = true` is **mandatory** |
| `chunk_index` | int | sequential within document |
| `embedding` | vector | text-embedding-3-small (unchanged) |
| `metadata.parser` | text | `azure-di-layout-v3` — **always set** (provenance + rollback key) |
| `metadata.page` | int | **real page number** from `boundingRegions` — never 0, never null |
| `metadata.section` | text | heading path, e.g. `"4. Coberturas > 4.16 Morte do Cônjuge"` |
| `metadata.clause` | text \| null | clause id when detectable (`4.16`, `a.2)`) |
| `metadata.doc_title` | text | document title from page 1 |
| `metadata.effective_date` | date \| null | vigência when present in the document |
| `metadata.confidence` | float | min span confidence from Azure DI for this chunk |
| `metadata.product_name` | text | resolved product name — **never the literal `"Conditions PDF"`** |
| `metadata.insurer_name` | text | canonical insurer name |
| `source_url` | text | original PDF URL — required |

**Rejected at the quality gate (§5), never indexed:**
- mid-word or mid-clause boundaries
- content < 200 chars that is whitespace/stub
- mixed insurer or mixed product in one chunk
- `page = 0` or `page = null`
- `insurer_id = null`

---

## 5. Quality gates (before indexing)

Each chunk passes ALL gates or it is **quarantined** (logged to a `phase2_rejected.csv` for review), not indexed.

| Gate | Check | Action on fail |
|---|---|---|
| G-content | `200 ≤ len(content) ≤ 1500` AND not whitespace-only | quarantine |
| G-boundary | content does not start/end mid-word; does not split a clause number | quarantine — chunker bug, must fix |
| G-page | `metadata.page` is an int ≥ 1 | quarantine — Azure DI element had no region |
| G-insurer | `insurer_id` is a valid uuid | quarantine |
| G-product | `product_id` resolved OR `metadata.product_unresolved = true` set | quarantine if neither |
| G-confidence | `metadata.confidence ≥ 0.70` | flag `metadata.low_confidence = true`, **still index** (don't lose data, mark it) |
| G-type | document classified `conditions_pdf` (not catalog dump / unknown) | route to correct sourceType or drop |
| G-dedup | `content_hash` not already in shadow set | skip (idempotent re-runs) |

The gate report (`docs/audit-runs/phase2-gate-report-<insurer>.csv`) is a deliverable of each re-ingestion PR — same discipline as the Phase 3A G1 CSVs.

---

## 6. Bradesco-first plan

Bradesco is the worst `comparison` offender (CP≈0.13, the giant 24k-char chunks, the catalog dumps). It is the pilot.

| Step | What | Cost | Gate |
|---|---|---|---|
| B0 | Azure DI F0 free-tier validation on ~5 Bradesco PDFs — prove stages 1–6 produce contract-compliant chunks | **$0** | manual review of ~5 docs' chunks |
| B1 | Run full Bradesco set (~31 docs, ~2.700 pages) through the pipeline → shadow set | ~$27 | gate report CSV, 0 quarantine surprises |
| B2 | Partial Ragas before/after on Bradesco `comparison` + `concept` questions | judge cost only | CP must move toward target §7 |
| B3 | If B2 passes → promote Bradesco (set `valid_until` on old Bradesco chunks) | $0 | smoke on prod compare endpoint |
| B4 | If B2 fails → rollback (shadow set stays, old chunks untouched), re-tune chunker, repeat B1 | — | — |

Only after Bradesco promotes cleanly do the other insurers follow (PR 6).

---

## 7. Partial Ragas eval — comparison + concept

Per issue #12 (eval cost policy): Phase 2 is a RAG change → **partial Ragas**, not full.

### 7.1 Subset

`app/eval/ragas/questions_phase2_subset.jsonl` — ~18 questions:
- **comparison: all 10** — the trilho the redesign must move.
- **concept: 8** — sampled across insurers, weighted to Bradesco/Zurich (worst chunking).

### 7.2 Method

- Judge: cheap tier for iteration (OpenRouter `:free` or similar per #12); Anthropic Haiku reserved for the final before/after gate.
- `RunConfig(max_workers=1)` — already merged (PR #11).
- Metric focus: **CP and CR** (retrieval metrics — what the chunker directly targets). F/AC are secondary.
- Before/after uses the **same questions that have a Phase 7 baseline** → apple-to-apple.

### 7.3 Acceptance targets (to be ratified by CEO)

| Metric | Phase 7 baseline | Phase 2 target |
|---|---|---|
| `comparison` CP | 0.13 | **≥ 0.50** |
| `comparison` CR | 0.24 | **≥ 0.45** |
| `concept` CP | 0.41 | **≥ 0.55** |
| `concept` CR | 0.33 | **≥ 0.50** |
| `rate_prudential` / `rate_mag` CP·CR | ~1.00 | **no regression** (untouched) |

If Bradesco's slice of `comparison` doesn't move CP past ~0.40 in B2, the chunker design is wrong and goes back to the drawing board before spending on the other 126 docs.

---

## 8. Rollback / promote criteria

### 8.1 Promote (shadow → production) — ALL must hold

- Gate report for the insurer has **zero** G-boundary / G-page / G-insurer failures.
- Partial Ragas before/after shows CP improvement (per §7.3 targets) for that insurer's questions.
- Prod smoke on `/api/compare` and `/api/ask` returns chunks with real `page` + `section` metadata.
- `rate_*` trilhos show no regression.

Promote = one transaction per insurer: `valid_until = now()` on old chunks, shadow chunks already live.

### 8.2 Rollback — any of these triggers it

- Gate report shows systematic boundary failures → chunker bug.
- Partial Ragas CP **regresses or flat** vs Phase 7 baseline.
- Prod smoke shows broken citations or wrong-insurer leakage.
- Azure DI cost overruns the approved estimate by >30% without proportional page count.

Rollback = `UPDATE documents SET valid_until = NULL` on the old set + `valid_until = now()` on the shadow set. Old chunks were never deleted — fully reversible. Shadow set is kept for forensics.

### 8.3 Hard stops

- No paid Azure DI call before the F0 pilot (B0) is reviewed and approved.
- No promotion before partial Ragas before/after exists for that insurer.
- No big-bang re-ingestion — insurer-by-insurer, Bradesco first.

---

## 9. What this document does NOT do

- No code. No Azure DI account setup. No API call. No migration.
- No budget commitment — §2 is an estimate; the real spend gate is the F0 pilot review.
- No new `source_type` created yet — that happens in the implementation PRs.
- No touch to `rate_table_pdf` / `insurer_rate_tables`.

---

## 10. Next PR

**PR 3 — new layout-aware semantic chunker**, behind a flag, writing to the shadow set only. No production read-path change. Requires: CEO approval of this architecture + Azure DI account/key provisioned + F0 tier confirmed.

---

_End of architecture doc. Implementation (PR 3) requires CEO approval of this document and a provisioned Azure DI resource._
