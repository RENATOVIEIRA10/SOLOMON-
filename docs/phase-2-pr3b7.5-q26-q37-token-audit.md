# SOLOMON — Phase 2 / Slice 3B.7.5 — Q26 / Q37 token-curation audit

_Generated 2026-05-17. No promotion, no DELETE, no read-path change, no Ragas, no Agentic RAG/PageIndex._

**Predecessor:** PR #41 (slice 3B.7.4 — Track C scoped harness) — strategic stop fired with concept CR -30.6pp driven almost entirely by Q26 (0/0 shadow score).
**Decision phrase from CEO:** _"Antes de julgar o chunker de novo, limpar a régua de medição."_

This audit is read-only investigation against the live Supabase produto (`ohmoyfbtfuznhlpjcbbk`). It answers two questions:

1. **Q26 — `VG Corporate min vidas`**: do the expected tokens exist anywhere in the Prudential corpus? If not in pages 1-50, where DO they live?
2. **Q37 — `WL10G vs WL00G`**: are `wl10g` / `wl00g` rate-table codes (as suspected) and not conditions concepts? What body-text tokens would faithfully measure the Q37 retrieval question?

The investigation produces an audit table per question + a single objective recommendation (A / B / C / new variant).

---

## 1. Q26 audit — `["vg corporate", "vg express", "500 vidas"]`

### 1.1 Token-presence search across all Prudential chunks

Live SQL on the full Prudential corpus (legacy + shadow_v3 + shadow_v4):

| token (case-insensitive, full `content` body) | legacy_prod | shadow_v3 | shadow_v4 |
|---|---:|---:|---:|
| `vg corporate` | **1** | 0 | 0 |
| `vg express` | **1** | 0 | 0 |
| `500 vidas` | **0** | 0 | 0 |
| `minimo de vidas` / `mínimo de vidas` | 0 | 0 | 0 |
| `2 a 500` (range pattern) | 0 (false positives only — see §1.3) | 0 | 0 |

`500 vidas` does **not appear in any Prudential chunk** indexed in the produto database — neither in `conditions_pdf` nor `rate_table_pdf`, on any page, in either corpus.

### 1.2 What the single legacy hit actually contains

The 1 hit for `vg corporate` (and 1 hit for `vg express`) is the **same chunk**: `chunk_index = 0` of `condicoes-gerais-seguro-vida-em-grupo-corporate-ate-30-09-18.pdf`. It is a **synthetic metadata-summary chunk** the legacy ingestion pipeline injects as a "product card" at the top of each PDF:

```
Seguradora: Prudential do Brasil
Produto: VG CORPORATE E VG EXPRESS
Modalidade: VIDA
Processo SUSEP: 15414.901611/2017-39
Codigo: 163 e 164

Coberturas:
- MORTE: Capital min R$5000 / max R$3000000
- DOENCA_GRAVE: Capital min R$5000 / max R$3000000
…
```

This is **not body text** from the PDF. It is a structured header the legacy ingester computed from `products` catalog metadata. The new chunker (`azure-di-layout-v3`) does **not** inject synthetic chunks — every shadow chunk is real PDF text.

This explains Q26's legacy score (CP 10% / CR 66.7%): legacy gets 2 of 3 expected tokens (`vg corporate`, `vg express`) "for free" from the synthetic header, even though body text doesn't contain that info.

### 1.3 Where does the actual `min vidas` threshold live?

The Julio-validated ground truth says: _"VG Express: de 2 a 500 vidas. VG Corporate: acima de 500 vidas."_

Live search across the relevant VG group PDFs (both corpora):

| corpus | doc | total chunks | `500` | `minim*vidas` | `minim*segurados` | `2 (dois) a` | `estipulante` |
|---|---|---:|---:|---:|---:|---:|---:|
| legacy | corporate | 141 | 2 | 0 | 0 | 1 (false positive: "2 (dois) anos" — carência) | 50 |
| shadow_v4 | corporate | 103 | 0 | 0 | 0 | 1 (same false positive) | 33 |
| legacy | express | 97 | 0 | 0 | 0 | 0 | 29 |
| shadow_v4 | express | 107 | 0 | 0 | 0 | 0 | 30 |

The only chunk containing both `500` AND (`vidas`/`segurados`) is legacy chunk_index=123 of the corporate PDF, which talks about **excedente técnico** (loss-ratio result distribution), NOT product positioning:

> _"…para a aplicação da cláusula de excedente técnico, será necessário que os segurados tenham vínculo empregatício com o estipulante e, que, durante o período de vigência a ser apurado, o contrato tenha uma **média mensal mínima de 500 (quinhentos) segurados**."_

This is a different "500 segurados" rule (excedente técnico) — **not** the product-positioning threshold the question asks about.

### 1.4 Conclusion on Q26

| token | encontrado? | fonte | página | manter / trocar / remover | justificativa |
|---|---|---|---:|---|---|
| `vg corporate` | conditions_pdf — synthetic legacy header only | metadata-summary chunk | n/a | **remover** | Shadow chunker doesn't inject synthetic headers; legacy "win" is an ingestion artifact, not real retrieval. |
| `vg express` | same | same | n/a | **remover** | same |
| `500 vidas` | **não existe em nenhum corpus** | — | — | **remover** | The ground-truth fact is product-positioning commercial knowledge that lives in sales material, not in the legal `conditions_pdf` document. |

**Q26's ground truth fact is not extractable from conditions_pdf retrieval, regardless of page span.** No micro-run with `--max-pages 100` would help, because the threshold is **not in the PDF at all** (verified above).

Recommendation for Q26: **reclassify scope** from `conditions` → new scope value `out_of_scope_commercial`. Q26 stays in the harness for visibility (legacy's synthetic-header score is itself a finding — it tells us legacy is mixing structured catalog data into conditions retrieval), but it no longer feeds the stop signal. Mirror semantics of `control_rate_table` introduced in slice 3B.7.1.

---

## 2. Q37 audit — `["wl10g", "wl00g", "vida inteira", "capital remido"]`

### 2.1 Token-presence search by `source_type`

Live SQL across all Prudential chunks (legacy):

| token | conditions_pdf hits | rate_table_pdf hits |
|---|---:|---:|
| `wl10g` | **0** | **58** |
| `wl00g` | **0** | **57** |
| `vida inteira` | **269** | 0 |
| `capital remido` | **0** | **0** |
| `vida inteira modificado` | 56 | 0 |

**CEO's suspicion confirmed**: `wl10g` and `wl00g` are exclusively rate-table product codes (~58 / 57 hits in `rate_table_pdf`, **zero in conditions_pdf**).

`capital remido` returns **zero hits across the entire Prudential corpus** — not in any conditions PDF, not in any rate table. The token is a curation error from the original Q37 expected-set.

### 2.2 Why shadow_v4 has near-zero hits even for `vida inteira`

Looking at the 5 vida-inteira PDFs, shadow_v4 has 0-1 chunks per PDF mentioning the literal phrase "vida inteira" — vs legacy having 9-73 per PDF:

| URL | shadow_v4 total chunks | shadow_v4 with "vida inteira" | legacy chunks | legacy with "vida inteira" |
|---|---:|---:|---:|---:|
| inteira-idades-especiais | 76 | **1** | 218 | 60 |
| inteira-mais | 82 | **0** | 231 | 9 |
| inteira-modificado-30 | 73 | **1** | 232 | 73 |
| inteira-unico | 72 | **0** | 51 | 46 |
| inteira (base) | 73 | **1** | 241 | 63 |

Sampling shadow_v4 chunks reveals the cause: the new chunker (`azure-di-layout-v3`) correctly extracts section headings into `metadata.section` and leaves body content un-titled. Example from `condicoes-gerais-vida-inteira.pdf` chunk_index=0:

| field | value |
|---|---|
| `metadata.section` | `"SEGURO VIDA INTEIRA CONDIÇÕES GERAIS"` |
| `content` body | `"Prudential\n\nPrudential\n\nCONDIÇÕES GERAIS X Clique nos tópicos…"` |

The product name **is captured** — but in `metadata.section`, **not** in `content`. The harness's current `keywordRecall` only scans `content`, so it systematically misses shadow rows where the product name is in the section header. This is a separate methodological issue documented in §4.

### 2.3 Conclusion on Q37

| token | encontrado? | fonte | página | manter / trocar / remover | justificativa |
|---|---|---|---:|---|---|
| `wl10g` | conditions_pdf: **0**; rate_table_pdf: 58 | rate_table only | n/a | **remover** | Rate-table code; cannot be in conditions corpus by design. |
| `wl00g` | conditions_pdf: **0**; rate_table_pdf: 57 | rate_table only | n/a | **remover** | same |
| `vida inteira` | conditions_pdf legacy: 269; shadow_v4: 0-1/PDF | mostly metadata.section, rarely body | n/a | **manter** | High-value token; harness needs to also scan `metadata.section` for fair measurement (see §4). |
| `capital remido` | **0 anywhere** | — | — | **remover** | Doesn't exist in either corpus. Curation error. |

Recommended replacement tokens for Q37 (conditions-scope, body-text-anchored):

| novo token | shadow_v4 hits (vida-inteira URLs) | legacy hits | justificativa |
|---|---:|---:|---|
| `modificado` (substring; matches "modificado 30", "Vida Inteira Modificado", etc.) | covered by `modificado 30` count below | — | the actual differentiator in the chunker output |
| `modificado 30` | 1 | 57 | discriminating between the two WL variants |
| `vida inteira unico` / `único` | 0 | 46 | the other variant name |
| `pagamento limitado` | 0 | 1 | the WL10G economic concept |
| `vitalicia` / `vitalícia` | 0 | 10 | the WL00G concept |

Most of these have low shadow_v4 representation for the same reason as `vida inteira`: they live in section headings, not body text. **Until the harness searches `metadata.section`, shadow will lose on most product-name comparisons by definition.**

---

## 3. Recommendation (A / B / C / D)

CEO offered three baseline options: A) only adjust tokens, B) micro-run page-span 100 for Q26, C) both. The audit findings make none of those cleanly applicable. Recommending **D**, which is a hybrid:

### D — recommended

1. **Q26 — reclassify scope.** Move Q26 from `conditions` → new scope value `out_of_scope_commercial`. Q26 stays visible in the harness report but never feeds the stop signal. No tokens change for Q26 (they remain as evidence of legacy's synthetic-header behavior). Mirrors how `control_rate_table` works.
2. **Q37 — token revision.** Replace expectedTokens from `['wl10g', 'wl00g', 'vida inteira', 'capital remido']` to `['vida inteira', 'modificado', 'vitalicia', 'pagamento']`. Keep `vida inteira` (still discriminating; needs §4 to score fairly), add `modificado` (discriminates WL10G vs WL00G), add `vitalicia` (the "permanent" alternative), add `pagamento` (the economic concept differentiator). Drop the rate-table codes and the non-existent `capital remido`.
3. **Do NOT run** Track A re-expansion (`--max-pages 100`). The audit proves Q26's data is not in any conditions_pdf; expanding pages won't help.
4. **Defer** harness `metadata.section` scan (§4) to a separate slice. It's a real bias but the patch is meaningful enough to warrant CEO approval as its own decision.

Net effect after D: the strategic stop signal in the next harness run will reflect chunker quality on questions the chunker can actually answer, with body-text-anchored tokens.

### Alternatives (rejected)

- **B (only)** — micro-run pages 51-100 for Q26: **rejected.** Audit shows Q26's threshold language doesn't exist in any conditions PDF page; more pages won't surface it.
- **A (only)** — only adjust Q37 tokens: **rejected.** Q26 still drives concept CR -67% by itself; stop signal stays noisy.
- **C** — both A and B: **rejected** for the same B-rejection reason.
- **Drop Q26 entirely** — discussed but rejected. Q26's behavior is itself an evidence: it surfaces how legacy injects synthetic structured data into conditions retrieval. Keeping Q26 in `out_of_scope_commercial` preserves that signal.

---

## 4. Separate finding — harness metric blindspot on `metadata.section`

While not part of the CEO-scoped audit, the investigation surfaced an orthogonal bias worth flagging:

- The new chunker correctly extracts section/heading text into `metadata.section`.
- The harness's `chunkContainsToken` only scans `content`.
- Result: product-name tokens like `vida inteira` that legitimately live in chunk headings score 0 on shadow even when the chunk IS relevant.

A small follow-up slice would extend the harness's RPC return shape to include `metadata`, then have `scoreQuestion` search both `content` and `metadata.section`. This is a separate decision; **not implemented in this PR** unless CEO authorizes it explicitly.

---

## 5. Guardrails honored throughout the audit

- Read-only SQL only.
- No DB write, no DELETE, no promotion.
- No read-path change (no edit to `match_documents`, `answer.ts`, `compare.ts`).
- No Ragas / LLM judge.
- No Agentic RAG / PageIndex.
- No Azos / MAG (queries scoped to Prudential `insurer_id`).
- No `--max-pages 100` run, no embedder run, no Track A/B/C re-execution.

---

## 6. Implementation in this PR

The accompanying code patch implements **option D** with the minimum-viable diff:

1. Add `'out_of_scope_commercial'` to `ShadowEvalQuestionScope`.
2. Q26 → `scope: 'out_of_scope_commercial'`, tokens unchanged (curation rationale documented in notes).
3. Q37 → tokens replaced to `['vida inteira', 'modificado', 'vitalicia', 'pagamento']`; scope remains `conditions`.
4. `tallyCategoryAggregates` filters out **both** `control_rate_table` AND `out_of_scope_commercial` (strategic stop signal applies to `conditions` only — unchanged semantic from slice 3B.7.1).
5. New helper `tallyOutOfScopeCommercialAggregate` mirrors `tallyControlAggregate`.
6. Renderer gets a new "out-of-scope (commercial)" section after the control section.
7. Tests updated to cover the new scope value + per-question expected tokens.

No harness re-run on the VPS in this PR — pure code + audit doc. CEO's call when to re-run.
