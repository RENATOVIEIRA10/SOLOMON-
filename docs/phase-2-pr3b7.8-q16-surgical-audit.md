# SOLOMON — Phase 2 / Slice 3B.7.8 — Q16 surgical audit

_Generated 2026-05-17. Read-only investigation. No promotion, no DELETE, no read-path change, no Ragas, no embedder rerun._

**Predecessor:** PR #44 (slice 3B.7.7 — Track D scoped harness with corrected metric). Strategic stop fired only on the concept aggregate; per-question breakdown traced the regression almost entirely to Q16 (`carência suicídio Vida Inteira`).

**Question audited:**

> Qual o periodo de carencia para suicidio no Seguro Vida Inteira da Prudential?

**Current `expectedTokens`:** `['carencia', 'suicidio', '2 anos', 'vida inteira']`
**Julio-validated ground truth (`questions.jsonl`):** _"2 anos a contar da contratação da apólice."_

**Method:** embed the question once via the production OpenAI model, dispatch to `match_documents` and `match_shadow_documents` with the same args used by the harness (`match_count=10`, `match_threshold=0.0`, Prudential insurer filter), then dump every returned chunk with per-token presence + the chunk's `source_url`, `metadata.page`, `metadata.section`. Plus broad SQL searches for the canonical phrasing across the corpus.

This is the same script (`app/scripts/phase2/audit-q16.ts`) that ships in this PR for reproducibility.

---

## 1. Token-recall over the UNION of top-K

| token | legacy union (3 chunks) | shadow union (10 chunks) |
|---|---|---|
| `carencia` | yes | yes |
| `suicidio` | yes | yes |
| `2 anos` | **NO** | **NO** |
| `vida inteira` | yes | **NO** |

Two distinct misses, with two distinct causes (§3 and §4).

---

## 2. Top-K side-by-side

### Legacy top-K (3 chunks above similarity=0 — `match_documents` returned only 3 despite `match_count=10`)

| # | similarity | source_url | page | section | tokens found |
|---:|---:|---|---:|---|---|
| 1 | 0.669 | `vida-inteira-idades-especiais.pdf` | 0 | _(empty)_ | `carencia, suicidio, vida inteira` (content) |
| 2 | 0.642 | `vida-inteira-modificado-30.pdf` | 0 | _(empty)_ | `carencia, suicidio` (content); contains `"suicídio … nos 2 (dois) primeiros anos…"` literally |
| 3 | 0.641 | `vida-inteira-modificado-30.pdf` | 0 | _(empty)_ | `carencia, suicidio, vida inteira` (content) |

Legacy returned **3 highly relevant chunks** — all from `vida-inteira-*` PDFs, all containing `vida inteira` AND the suicide-carência clause. The "dois anos" wording is present verbatim in slot #2 (`2 (dois) primeiros anos`).

### Shadow top-K (10 chunks)

| # | similarity | source_url | page | section | tokens found (content/section) |
|---:|---:|---|---:|---|---|
| 1 | 0.741 | `condicoes-gerais-seguro-vida-em-grupo-express-ate-30-09-18.pdf` | 10 | `10. CARÊNCIA` | content=`carencia, suicidio` · section=`carencia` |
| 2 | 0.722 | `condicoes-gerais-seguro-vida-em-grupo-corporate-ate-30-09-18.pdf` | 12 | `16. Carência` | content=`carencia, suicidio` · section=`carencia` |
| 3 | 0.670 | `condicoes-gerais-vida-inteira.pdf` | 40 | `21 ACIONAMENTO DO SEGURO` | content=`carencia` · section=_(none)_ |
| 4 | 0.669 | `condicoes-gerais-vida-e-saude.pdf` | 8 | `4.1 Morte da pessoa segurada` | content=`carencia, suicidio` · section=_(none)_ |
| 5 | 0.665 | `Condições Gerais Seguro Prestamista Coletivo Capital Segurado Vinculado_Dez25.pdf` | 10 | `10.2. Constará das propostas de adesão campo espec` | content=∅ · section=∅ |
| 6 | 0.664 | `Condições Gerais e Especiais Capital Global_Dez-25.pdf` | 14 | `16. Carência` | content=`carencia, suicidio` · section=`carencia` |
| 7 | 0.663 | `condicoes-gerais-seguro-temporario-preferencial.pdf` | 8 | `4.1 Morte da pessoa segurada` | content=`carencia, suicidio` · section=_(none)_ |
| 8 | 0.662 | `condicoes-gerais-vida-inteira-modificado-30.pdf` | 8 | `4.1 Morte da pessoa segurada` | content=`carencia, suicidio` · section=_(none)_ |
| 9 | 0.660 | `condicoes-gerais-seguro-temporario.pdf` | 9 | `4.1 Morte da pessoa segurada` | content=`carencia, suicidio` · section=_(none)_ |
| 10 | 0.658 | `condicoes-gerais-vida-inteira-idades-especiais.pdf` | 8 | `4.1 Morte da pessoa segurada` | content=`carencia, suicidio` · section=_(none)_ |

Shadow top-K is **broader** (10 chunks, similarity 0.658-0.741) but **shallower** in product specificity: only 3 of the 10 chunks are from `vida-inteira-*` PDFs (#3, #8, #10), and none of those 3 have "vida inteira" in their `metadata.section` (the chunker's heading-stack landed on "21 Acionamento", "4.1 Morte", etc. for these chunks — not on a heading containing the product family name).

---

## 3. `'2 anos'` token — broken for BOTH corpora

The token does not match the PDF wording. Broad SQL across the entire Prudential corpus (legacy `conditions_pdf` + `rate_table_pdf` + shadow_v4):

| alias | legacy `conditions_pdf` | shadow_v4 |
|---|---:|---:|
| `2 anos` (literal) | **0 hits** | **0 hits** |
| `dois anos` | 7 hits with `suicidio` | **12 hits with `suicidio`** |
| `2 (dois) anos` / `2 (dois) primeiros anos` | 3 hits in legacy top-K | 5 hits in shadow top-K |

The PDFs use the legal-style spelling: _"2 (dois) primeiros anos"_, _"2 (dois) anos"_, _"dois anos"_. **The literal `2 anos` never appears in any Prudential conditions PDF.**

This means:
- **Legacy's CR=75% in PR #44 (3 of 4 tokens) came from `carencia`, `suicidio`, `vida inteira` — `2 anos` did NOT contribute.**
- **Shadow's CR=50% came from `carencia`, `suicidio` only.**
- The differential between legacy and shadow on Q16 is therefore driven by **one** real miss: `vida inteira`.

This is a token-curation defect of the same kind PR #42 found on Q26/Q37 (`capital remido` had 0 hits, `wl10g`/`wl00g` were rate-table). Q16 was missed by that audit because the slice 3B.7.4 report still showed legacy CR=75%, which felt "high enough" to leave alone.

Fix: replace `'2 anos'` with `'dois anos'` (matches 7 legacy + 12 shadow chunks with suicídio context). The token would then contribute to BOTH corpora's recall, not just to neither's.

---

## 4. `'vida inteira'` shadow miss — top-K composition, not chunker

The shadow corpus DOES contain `vida inteira` in `metadata.section` for many chunks (1952 of 1953 shadow rows have `metadata.section` populated; multiple `vida-inteira-*` PDFs have headings like `"SEGURO VIDA INTEIRA CONDIÇÕES GERAIS"`, `"Características do seguro de vida"`, etc.). Slice 3B.7.6's metric scans those headings — verified by the +25-30pp lift on PR #44.

But for **this particular question embedding**, the top-10 cosine-similarity neighbours are concentrated on "carência" sections of GROUP-life products (VG Express, VG Corporate, Capital Global) and on `4.1 Morte da pessoa segurada` sections of individual products — not on the heading that names the Vida Inteira product family. The model's embedding for _"Qual o periodo de carencia para suicidio no Seguro Vida Inteira"_ apparently weights "carência + suicídio" more than "Vida Inteira"; the retrieval surfaces carência clauses across MANY products, diluting the Vida-Inteira heading representation.

Legacy doesn't have this issue because `match_documents` returned only 3 chunks (similarity 0.641-0.669), and all 3 happen to be from `vida-inteira-*` PDFs with the phrase literally in content.

**This is a retrieval-parameter behaviour, not a chunker defect.** The relevant Vida-Inteira chunks ARE in the shadow corpus; they just rank slots 11+ for this query.

Possible mitigations:
- bump `match_count` in the harness (e.g., 10 → 20) so more Vida-Inteira chunks make it through
- accept the gap as a parameter trade-off the harness's proxy metric exaggerates
- in production, the actual answer LLM would receive the top-K context AND the question; with carência + suicídio + Vida Inteira all explicitly in the query, the LLM can map the retrieved clauses correctly even when the heading doesn't name the product

---

## 5. Hypothesis check (CEO's seven)

| # | hypothesis | result |
|---|---|---|
| 1 | trecho relevante não foi recuperado | **PARCIAL**: shadow recovered 8/10 carência+suicídio chunks; just not from Vida Inteira PDFs specifically. Legacy got 3/3 from Vida Inteira but only 3 chunks total. |
| 2 | trecho relevante foi recuperado mas fragmentado | NO: chunks are well-formed; no evidence of mid-clause splits in either top-K. |
| 3 | trecho relevante foi quarantined | NO: shadow corpus has 12 chunks with `suicidio + dois anos`; they exist (not quarantined). |
| 4 | trecho relevante está fora do top-K | **YES (for `vida inteira` token)**: Vida-Inteira-PDF chunks with strong topical match likely sit at rank 11-20 in shadow. |
| 5 | trecho aparece em outro produto/documento | **YES (intentionally)**: shadow surfaced Express / Corporate / Capital Global / Temporário Preferencial carência clauses — semantically the same rule, different product PDFs. |
| 6 | problema é normalização/token "2 anos" | **YES (confirmed broken for BOTH corpora)**: the PDF wording is `dois anos`, not `2 anos`. |
| 7 | problema é produto/section errada no shadow | NO: shadow's sections are correct ("10. CARÊNCIA", "16. Carência", etc.); they just don't carry the product family name in the same metadata field. |

---

## 6. Conclusion + recommendation

| option | does it apply? | rationale |
|---|---|---|
| **A — ajustar token/normalização** | **YES — primary fix** | `'2 anos'` is broken across both corpora. Replace with `'dois anos'` (matches 7 legacy + 12 shadow chunks with suicídio context). Cost: 1-line token edit + test. |
| B — ajustar chunker/gate | NO | Chunker output is correct; no fragmentation/quarantine; no chunker-fix needed. |
| **C — aumentar top-K só no harness** | **YES — secondary, optional** | Shadow's `vida inteira` miss is top-K dilution. Bumping `match_count` from 10 → 20 would let more Vida-Inteira PDF chunks through. Cost: CLI flag default + test. Risk: changes the comparison-aggregate baseline (need to re-baseline). |
| D — aceitar como gap residual | NO | Q16 is the only remaining concept regression and it's instrument noise, not a chunker problem. Worth fixing. |
| E — autorizar Ragas depois | NO (not yet) | A real LLM judge would map "Vida Inteira" semantically across the retrieved chunks regardless of token literalness — would likely score Q16 as a shadow tie. But Ragas is a bigger commitment; A alone may close the gap. |

### Recommended sequence

1. **Apply A first** (slice 3B.7.9): change Q16's `expectedTokens` from `['carencia', 'suicidio', '2 anos', 'vida inteira']` to `['carencia', 'suicidio', 'dois anos', 'vida inteira']`. Re-run harness; check if concept aggregate stops regressing.
2. If A alone closes the gap → done; CEO decides on promotion design.
3. If A leaves a residual gap → consider **C** (`match_count` bump) as a parameter knob, NOT as a chunker change.
4. If A+C both leave a gap → **then** authorize **E** (Ragas LLM judge, slice 3B.6.4) as a more robust measurement.

---

## 7. Guardrails honored throughout this audit

- Read-only SQL + one tiny audit script (`scripts/phase2/audit-q16.ts`) that imports existing helpers and prints to stdout. No DB writes.
- One OpenAI embedding call for Q16's question (~$0.00000004).
- No edits to `match_documents` / `match_shadow_documents` / `answer.ts` / `compare.ts`.
- No Ragas / LLM judge.
- No promotion (`valid_until` still at sentinel for all 1953 shadow rows).
- No DELETE.
- No Azos / MAG queries.
- No Agentic RAG / PageIndex.

The audit script is committed for reproducibility; CEO can re-run it any time the question embedding model or the shadow corpus changes.
