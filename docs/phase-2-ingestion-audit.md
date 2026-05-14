# SOLOMON — Phase 2 Ingestion Audit (`conditions_pdf` retrieval)

_Read-only audit. No code, schema, data, or migration changed. Generated 2026-05-14._

**Issue:** [#13 — Phase 2: Azure DI Layout redesign for conditions_pdf retrieval](https://github.com/RENATOVIEIRA10/SOLOMON-/issues/13)
**Driver:** Phase 7 baseline (run `20260514_182346`) measured `comparison` CP≈0.13 and `concept` weak (CP=0.41, CR=0.33). This audit finds the root cause in the ingestion pipeline and proposes the redesign.
**Sources of truth:** Supabase produto `ohmoyfbtfuznhlpjcbbk` (live queries) + repo at `master` HEAD `6f723bd`.

---

## TL;DR

1. **The chunker is a blind 2000-char window.** `app/src/services/embeddings/chunker.ts` slices PDF text every `CHUNK_SIZE_CHARS = 2000`, trying only to find a `.!?` inside a ±200-char window. When it can't, it **cuts mid-word, mid-clause, mid-index**. 13.817 of 14.251 `conditions_pdf` chunks (97%) are these ~1941-char mechanical slices.
2. **`page: 0` is hardcoded** (`chunker.ts:130`, comment: `pdf-parse doesn't provide per-page mapping easily`). **0 of 14.251 `conditions_pdf` chunks have a real page number.** 80% are `page=0`, 20% are `page=null`.
3. **`product_id` is NULL on 98.2%** of `conditions_pdf` chunks (only 262/14.251 populated). Root cause: `crawl-pdfs-playwright.ts` calls `indexChunks(db, chunks, embs, undefined, insurerId)` — `productId` is **always `undefined`**. `ingest-opin.ts` does pass it, but via fragile exact-URL matching.
4. **`product_name` is garbage on ~22%** — 3.191 chunks have the literal string `"Conditions PDF"` as product name (`chunker.ts` fallback `pdf.linkText || 'Conditions PDF'`).
5. **Two different content types are mixed under one `source_type`.** Most `conditions_pdf` rows are real PDF text; but ~56 rows are **OPIN catalog dumps** (`Seguradora:/Produto:/Coberturas:` formatted blobs, 12k–24k chars) or empty stubs (`Sem coberturas detalhadas`, 13–162 chars). One Zurich chunk is `len=13` — pure whitespace.
6. **This is exactly why `comparison` CP≈0.13.** When pgvector retrieves the semantically-closest chunk, it hands the LLM a fragment that **starts `"ilares que venham a ser aceitas..."`** (mid-word) or ends `"...4 .1 7."` (mid-index). The clause the comparison needs is split across two chunks or truncated. Context precision collapses because the retrieved context is structurally incomplete.

The fix is not "tune topK" or "add rerank" — it is **re-ingest `conditions_pdf` with a layout-aware pipeline** that produces clause/section-bounded chunks with real page numbers and a resolved `product_id`.

---

## 1. Current ingestion pipeline

Three stages, two entry-point scripts.

```
                ┌─────────────────────┐
  OPIN APIs ───▶│  ingest-opin.ts     │──┐
                └─────────────────────┘  │   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
                                         ├──▶│ chunkPdf()   │──▶│ embedChunks()│──▶│ indexChunks()│──▶ documents
  Insurer    ───┌─────────────────────┐  │   │ (chunker.ts) │   │ (embedder)   │   │ (indexer.ts) │
  websites      │ crawl-pdfs-         │──┘   └──────────────┘   └──────────────┘   └──────────────┘
                │ playwright.ts       │           │                                      │
                └─────────────────────┘           │ pdf-parse → raw text                 │ source_type='conditions_pdf' (hardcoded)
                                                  │ split every 2000 chars               │ product_id = caller-supplied or NULL
                                                  │ page = 0 (hardcoded)                 │ insurer_id  = caller-supplied or NULL
                                                  └──────────────────────────────────────┘
```

### 1.1 `chunker.ts` — the blind window

```ts
const CHUNK_SIZE_CHARS = 2000        // "~500 tokens"
const CHUNK_OVERLAP_CHARS = 200

function splitIntoChunks(text: string): string[] {
  // walk the string in 2000-char steps;
  // look for [.!?]\s within text.slice(end-200, end+200);
  // if found, break there; if NOT found, cut at exactly `end` (mid-word).
}

// chunkPdf():
metadata: {
  page: 0,                 // ← hardcoded. pdf-parse gives no page map.
  chunk_index: index,
  source_url, insurer_name, product_name,
}
```

Problems:
- **Extraction:** `pdf-parse` returns one flat text blob. No layout, no headings, no tables, no page boundaries.
- **Splitting:** fixed 2000-char window. The sentence-boundary search only covers ±200 chars; insurance condition PDFs have long enumerated clauses (`4.16.`, `a.2.)`, `b.4)`) where a `.!?\s` often isn't within reach → hard cut mid-token.
- **Metadata:** `page` is always 0. No `section`, no `clause`, no `effective_date`, no `confidence`.

### 1.2 `indexer.ts` — `product_id` is optional, `source_type` is hardcoded

```ts
const rows = batchChunks.map((chunk, idx) => ({
  source_type: 'conditions_pdf',          // ← hardcoded for everything via this path
  product_id: productId ?? null,          // ← NULL unless caller resolved it
  insurer_id: insurerId ?? null,
  metadata: chunk.metadata,
}))
```

### 1.3 The two callers diverge

| Caller | `insurer_id` | `product_id` | Covers |
|---|---|---|---|
| `ingest-opin.ts` | resolved via CNPJ | **passed** — but via `urlProductMap`, keyed by exact `terms_url === url` match | OPIN insurers (Bradesco, Prudential, Zurich, Tokio, SulAmerica, Porto, Santander) |
| `crawl-pdfs-playwright.ts` | resolved via CNPJ | **always `undefined`** (`indexChunks(db, chunks, embs, undefined, insurerId)`, lines 422 + 442) | Website-crawled insurers (MAG, Azos, MetLife, MAPFRE) |

`crawl-pdfs-playwright.ts` also sets `productName: pdf.linkText || 'Conditions PDF'` (line 365) — the chunk's product name is the **anchor text of the download link**, or the literal fallback string.

This explains the Phase 1 finding precisely: MAG/Azos/MetLife/MAPFRE had `product_id=0` because they come through the crawler that never passes it; OPIN insurers have partial coverage because the URL match is fragile.

---

## 2. Quantified state of `conditions_pdf` (14.251 chunks)

### 2.1 Chunk size distribution

| Bucket | Chunks | Avg len | Reading |
|---|---|---|---|
| `<200` (garbage) | 50 | 174 | empty stubs / whitespace-only |
| `200-500` | 191 | 347 | catalog stubs |
| `500-1000` | 61 | 705 | short tails |
| `1000-1800` | 122 | 1.531 | document tails |
| **`1800-2200` (the 2000 window)** | **13.817** | **1.941** | **97% — mechanical slices** |
| `2200-4000` | 4 | 2.718 | — |
| `>4000` (giant) | 6 | 14.530 | OPIN catalog dumps, not PDF text |

### 2.2 Metadata coverage

| Field | State |
|---|---|
| `page = 0` | 11.344 (80%) |
| `page = null` | 2.907 (20%) |
| **`page > 0` (real)** | **0** |
| **`product_id` populated** | **262 / 14.251 (1.8%)** |
| `product_name = "Conditions PDF"` (literal garbage) | 3.191 (22%) |
| distinct `product_name` values | 229 |
| distinct `source_url` (documents) | 157 |

### 2.3 Two content types mixed under `conditions_pdf`

**Type A — real PDF text** (~14.195 chunks). Example, Bradesco Vida Viva chunk_index 0–5:

| chunk | starts | ends |
|---|---|---|
| 0 | `1\nBradesco\nVida Viva\nSeguro de Vida Individual…` | `…MORTE ACIDENTAL DO CÔNJUGE\n 4 .1 7.` ← **mid-index** |
| 2 | `liada \nAssistência Cesta Básica…` ← **mid-word `(domici)liada`** | `…em decorrência de acidente coberto.` |
| 4 | `ilares que venham a ser aceitas…` ← **mid-word `(sim)ilares`** | `…durante o período da franquia.` |

**Type B — OPIN catalog dumps** (~56 chunks). Not PDF text at all — synthetic blobs:
```
Seguradora: Bradesco Seguros
Produto: PRESTAMISTA
Modalidade: VIDA
Processo SUSEP: 15414.004673/2004-86
Codigo: 861
Coberturas:
- MORTE: Capital min R$1 / max R$10000000 | Excluso...
```
or empty stubs: `Seguradora: Zurich\nProduto: MAIS PROTECAO\n...\nCoberturas:\nSem coberturas detalhadas` (144 chars), or pure whitespace (`len=13`).

These were indexed as `conditions_pdf` but are catalog metadata, not general conditions. They pollute retrieval and should be a different `source_type` (or excluded).

---

## 3. Why this produces `comparison` CP≈0.13 and weak `concept`

`compare.ts` fires 6 topic queries per insurer (`cobertura morte`, `invalidez`, `doenças graves`, `contestabilidade`, `assistência funeral`, `exclusões`). For each, pgvector returns the 3 closest chunks. With the current chunking:

1. **The relevant clause is split.** A "carência para doença preexistente" clause that spans ~3.000 chars lives across two 2000-char chunks. Retrieval gets one half. The LLM sees a truncated rule.
2. **Chunks start mid-thought.** A retrieved chunk that begins `"ilares que venham a ser aceitas pela classe médica-científica..."` has no anchor — the LLM can't tell which coverage or exclusion it belongs to.
3. **No section/clause metadata to re-anchor.** `buildContext()` can only label a chunk with insurer + product + (missing) page. It can't say "this is clause 4.16, Cobertura Morte" because that structure was never captured.
4. **Catalog dumps and whitespace stubs compete for topK slots.** A `len=13` whitespace chunk or a 24k-char catalog dump can be the cosine-nearest result for a vague query.

Ragas `context_precision` asks: *are the retrieved chunks relevant and usable?* Truncated, mis-anchored, mixed-type chunks score low by construction. **CP≈0.13 is the chunker's signature, not a retrieval-tuning gap.**

`rate_prudential` / `rate_mag` score CP=CR=1.0 in the same eval because they **bypass this pipeline entirely** — they use the structured `insurer_rate_tables`, not chunked text. That contrast is the proof: where the data is structured, retrieval is perfect; where it's blind-chunked, it's near-random.

---

## 4. Proposed new chunk contract

The redesign should make every `conditions_pdf` chunk satisfy this contract before it is embedded:

| Field | Today | Proposed | Why |
|---|---|---|---|
| `content` | 2000-char blind slice | **clause/section-bounded segment**, 300–1500 chars, never mid-word | retrieval returns a complete rule |
| `source_type` | `conditions_pdf` (mixed) | `conditions_pdf` (real text only) — catalog dumps move to `structured_product` or are dropped | one type per sourceType |
| `insurer_id` | resolved (CNPJ) | resolved (CNPJ) — keep | OK today |
| `product_id` | NULL on 98% | **resolved at ingestion** — match `(insurer, SUSEP process \| product code \| name)` against `public.products`; if no match, mark `metadata.product_unresolved=true` for review instead of silent NULL | filter_product_id stops being dead code |
| `metadata.page` | `0` hardcoded | **real page number** from the layout parser | citations can point to a page |
| `metadata.section` | absent | section/heading path (e.g. `"4. Coberturas > 4.16 Morte do Cônjuge"`) | `buildContext` can re-anchor the chunk |
| `metadata.clause` | absent | clause id when detectable (`4.16`, `a.2)`) | precise citation |
| `metadata.effective_date` | absent | document vigência when present | brief's `effectiveDate` filter |
| `metadata.confidence` | absent | layout-parser confidence per chunk | quality gate (Phase 3B) |
| `metadata.parser` | only on rate_table | always — `azure-di-layout-v3` | provenance / rollback |

**Hard rules** (carry over from the Phase 3A plan's spirit):
- Never mid-word, never mid-clause.
- One insurer, one product, one source_type per chunk.
- A chunk with no resolvable `product_id` is flagged, not silently NULL.
- Whitespace-only / empty-stub content is dropped, not indexed.

---

## 5. Azure DI Layout — proposed pipeline

The brief's Phase 2 intent: replace `pdf-parse` + blind window with **Azure Document Intelligence Layout**, which returns Markdown with structure (headings, paragraphs, tables, page numbers).

```
PDF bytes
  │
  ▼
Azure DI  ──── prebuilt-layout model ────▶  Markdown + per-element page numbers + table objects
  │                                          + bounding regions + confidence
  ▼
classify document  (conditions_pdf | rate_table | product_manual | unknown)
  │
  ▼
semantic chunker  ── split on Markdown headings / clause numbers, NOT char count
  │                   target 300-1500 chars, never crossing a clause boundary
  │                   carry section path + page + clause id into metadata
  ▼
resolve product_id  ── (insurer, SUSEP \| code \| fuzzy name) ↔ public.products
  │                     unresolved → metadata.product_unresolved = true
  ▼
quality gate  ── drop empty/whitespace; flag low-confidence; dedupe by content_hash
  │
  ▼
embed → index   (source_type set per classification; metadata contract enforced)
```

### 5.1 Scope decision for Phase 2

- **In scope:** the `conditions_pdf` path — both `ingest-opin.ts` and `crawl-pdfs-playwright.ts` feed the new chunker. This is what moves `comparison` and `concept`.
- **Out of scope:** `rate_table_pdf` / `insurer_rate_tables` — already structured, already scoring CP=CR=1.0. Do not touch.
- **Open question:** Azure DI is a paid API (per-page pricing). Re-ingesting 157 documents is a one-time cost — needs a budget estimate before the implementation PR (similar discipline to the eval-cost issue #12).

### 5.2 Migration safety (carry the Phase 3A gate discipline)

- New pipeline writes to a **shadow set** first (e.g. `metadata.parser='azure-di-layout-v3'`), validated against the old chunks before the old ones are superseded via `valid_until` / `superseded_by` (columns already exist, currently unused — Phase 1 audit §1.2).
- No `DELETE`. Old chunks get `valid_until` set; `match_documents` already filters on `valid_until IS NULL`.
- Re-ingest insurer-by-insurer, not big-bang. Bradesco first (worst `comparison` offender), measure, then proceed.

---

## 6. Partial Ragas eval for comparison + concept

Per issue #12 (eval cost policy), Phase 2 is a **RAG change** → partial Ragas, not full.

Proposed subset (`questions_phase2_subset.jsonl`, ~18 questions):
- **comparison: all 10** — this is the trilho the redesign must move (CP 0.13 → target ≥ 0.50).
- **concept: 8** — sample across insurers, focus on Bradesco/Zurich (worst chunking).
- Judge: cheap tier for iteration (per #12), Anthropic Haiku reserved for the before/after gate.
- Metric focus: **CP and CR** (retrieval metrics) — they are what the chunker redesign directly targets. F/AC are secondary here.

Acceptance target for Phase 2 (to be ratified by CEO):
- `comparison` CP: 0.13 → **≥ 0.50**
- `comparison` CR: 0.24 → **≥ 0.45**
- `concept` CP: 0.41 → **≥ 0.55**
- No regression on `rate_*` (untouched, must stay CP=CR≈1.0).

Before/after run uses the **same 38/45 questions** that have a Phase 7 baseline, so the comparison is apple-to-apple.

---

## 7. What this audit does NOT do

- No code, no migration, no re-ingestion. Read-only.
- No Azure DI integration written — §5 is a design, not an implementation.
- No new `source_type` created.
- No touch to `rate_table_pdf` / `insurer_rate_tables`.
- No budget commitment — the Azure DI per-page cost estimate is a prerequisite for the implementation PR, not part of this audit.

---

## 8. Proposed Phase 2 PR sequence

Mirrors the Phase 3A gate discipline — plan, preview, apply in small reversible steps.

1. **PR 1 — this audit** (read-only doc). ← you are here
2. **PR 2 — Azure DI cost estimate + ingestion architecture doc** (`docs/phase-2-azure-di-architecture.md`, read-only). Decide: budget, model (`prebuilt-layout`), shadow-set strategy, classification rules.
3. **PR 3 — new layout-aware chunker** behind a flag, writing to shadow set only. No production read path changes.
4. **PR 4 — product_id resolver** (the `(insurer, SUSEP|code|name) ↔ products` matcher). Read-only preview first (like Phase 3A G1), then apply.
5. **PR 5 — re-ingest Bradesco** into the shadow set, partial Ragas before/after on `comparison`.
6. **PR 6 — promote** (supersede old chunks) + re-ingest remaining insurers if PR 5 validates.
7. **PR 7 — full Ragas rebaseline** (release gate, per #12).

---

## 9. The one-line conclusion

`comparison` CP≈0.13 is not a retrieval bug — it is the **blind 2000-char chunker** handing the LLM truncated, mis-anchored fragments with no page, no section, and no `product_id`. Phase 2 must replace the chunker, not tune the retriever.

---

_End of audit. Phase 2 implementation requires CEO approval of the architecture doc (PR 2) before any code._
