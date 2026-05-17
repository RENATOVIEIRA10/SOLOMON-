# Phase 2 PR 3B slice 3B.6.3 — legacy vs shadow eval report

Generated: 2026-05-17T03:37:17.374Z

## Scope

- Prudential-only.
- Compares `match_documents` (production) vs `match_shadow_documents` (slice 3B.6.2).
- Same query embedding dispatched to both functions per question.
- **No LLM judge.** CP / CR here are deterministic keyword-overlap proxies — see methodology below.
- No production read path import. No edit of match_documents/answer.ts/compare.ts.
- Scope tags (slice 3B.7.1 + 3B.7.5): `conditions` | `control_rate_table` | `out_of_scope_commercial`. Only `conditions` feeds the stop signal.

## Inputs

- insurer: Prudential do Brasil (`dac17baa-c623-4023-9184-3ed2049a6237`)
- questions: 9
- match_count: 20
- threshold: 0

## Methodology (proxy metric)

For each question, an explicit `expectedTokens` set (3-6 case- and accent-insensitive
tokens) encodes what a correct retrieval MUST surface. Both functions are scored by:

- **CP (proxy)** = fraction of retrieved chunks containing ≥1 expected token.
- **CR (proxy)** = fraction of expected tokens found in the UNION of retrieved chunks.

Same function applied to both corpora → Δ is fair. Not Ragas CP/CR; a deterministic
directional signal. Full Ragas (LLM judge) is gated as slice 3B.6.4.

## Per-question results — in-scope conditions_pdf (N=6)

These questions DRIVE the stop signal: their answers live in `conditions_pdf`, so
the shadow corpus is structurally capable of retrieving them.

| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Q16 | concept | 100.0% | 85.0% | -15.0pp | 100.0% | 75.0% | -25.0pp | 3 | 20 | legacy: all expected tokens found; shadow regressed |
| 2 | Q17 | concept | 100.0% | 100.0% | ±0.0pp | 100.0% | 100.0% | ±0.0pp | 13 | 20 | shadow: all expected tokens found; legacy: all expected tokens found |
| 3 | Q31 | comparison | 20.0% | 90.0% | +70.0pp | 50.0% | 50.0% | ±0.0pp | 20 | 20 |  |
| 4 | Q32 | comparison | 100.0% | 100.0% | ±0.0pp | 66.7% | 66.7% | ±0.0pp | 20 | 20 |  |
| 5 | Q36 | comparison | 0.0% | 25.0% | +25.0pp | 0.0% | 50.0% | +50.0pp | 20 | 20 |  |
| 6 | Q37 | comparison | 0.0% | 90.0% | +90.0pp | 0.0% | 75.0% | +75.0pp | 20 | 20 |  |

## Per-question results — control rate_table_pdf (N=2)

Informational only. These answers live in `rate_table_pdf` and the shadow corpus
is `conditions_pdf`-only by contract. Shadow is **not expected** to score and
these rows **never feed the stop signal**.

| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Q38 | comparison | 100.0% | 20.0% | -80.0pp | 33.3% | 33.3% | ±0.0pp | 20 | 20 | shadow regressed |
| 2 | Q39 | comparison | 95.0% | 25.0% | -70.0pp | 75.0% | 25.0% | -50.0pp | 20 | 20 | shadow regressed |

## Per-question results — out-of-scope commercial (N=1)

Informational only. These questions ask for product-positioning facts that
do not live in ANY indexed PDF (neither `conditions_pdf` nor `rate_table_pdf`).
Legacy may score artificially via synthetic metadata-header chunks the legacy
ingestion injects; shadow chunker does not. Reported for transparency about
legacy's structured-data injection behavior; **never feed the stop signal**.

| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Q26 | concept | 5.0% | 0.0% | -5.0pp | 66.7% | 0.0% | -66.7pp | 20 | 20 | shadow regressed |

## Per-question token detail

### Q16 — concept (conditions)

> Qual o periodo de carencia para suicidio no Seguro Vida Inteira da Prudential?

- expected tokens (4): `[carencia, suicidio, dois anos, vida inteira]`
- legacy matched: `[carencia, suicidio, dois anos, vida inteira]` (4/4)
- shadow matched: `[carencia, suicidio, dois anos]` (3/4)
- rationale: Julio-validated ground_truth: "2 anos a contar da contratacao". The Prudential CG always writes the period as "dois anos" / "2 (dois) anos" / "2 (dois) primeiros anos" -- literal "2 anos" appears in zero chunks across legacy and shadow corpora (slice 3B.7.8 audit, PR #45). Token uses "dois anos" so the proxy substring matches the document phrasing while staying case+accent insensitive. Tokens cover the right clause (carencia + suicidio) and the right product (vida inteira) plus the literal period. Scope=conditions: clause lives in conditions_pdf.

### Q17 — concept (conditions)

> O Seguro Temporario da Prudential tem renovacao automatica?

- expected tokens (4): `[temporario, renovacao, vigencia, apolice]`
- legacy matched: `[temporario, renovacao, vigencia, apolice]` (4/4)
- shadow matched: `[temporario, renovacao, vigencia, apolice]` (4/4)
- rationale: Julio-validated: renovacao depends on whether temporario is cobertura base or opcional. Tokens span product (temporario) and the clause topic (renovacao/vigencia). Scope=conditions.

### Q26 — concept (out_of_scope_commercial)

> Qual o numero minimo de vidas para contratar o VG Corporate da Prudential?

- expected tokens (3): `[vg corporate, vg express, 500 vidas]`
- legacy matched: `[vg corporate, vg express]` (2/3)
- shadow matched: `[]` (0/3)
- rationale: Audited in slice 3B.7.5 (docs/phase-2-pr3b7.5-q26-q37-token-audit.md). The Julio-validated ground truth (VG Corporate >500 vidas, VG Express 2-500) is PRODUCT-POSITIONING knowledge from commercial material — it does NOT live in any conditions_pdf or rate_table_pdf in the indexed Prudential corpus. Verified: "500 vidas" returns zero hits across all corpora; the only "vg corporate"/"vg express" hits are a synthetic metadata-header chunk legacy ingestion injects. Reclassified scope to out_of_scope_commercial so this question never feeds the stop signal. Kept in the harness for transparency about the legacy-ingestion artifact.

### Q31 — comparison (conditions)

> Comparar premio Seguro Temporario Prudential TM10 (capital 500k) versus Bradesco Tranquilidade Familiar.

- expected tokens (4): `[tm10, temporario, capital, premio]`
- legacy matched: `[temporario, capital]` (2/4)
- shadow matched: `[temporario, capital]` (2/4)
- rationale: Q31 hits conditions-text for Temporario TM10 product naming + capital/premio (the answer cites a Prudential per-1000 rate). Bradesco-side has no tables imported, expected. Scope=conditions: the conditions retrieval is what we want to measure.

### Q32 — comparison (conditions)

> Compare Seguro Doencas Graves Plus da Prudential (DDR5G) com outras seguradoras.

- expected tokens (3): `[ddr5g, doencas graves, prudential]`
- legacy matched: `[ddr5g, prudential]` (2/3)
- shadow matched: `[doencas graves, prudential]` (2/3)
- rationale: Q32: the chunker must surface DDR5G clauses or doencas graves clauses. Other-insurer tables are not imported, so we score Prudential-side only. Scope=conditions.

### Q36 — comparison (conditions)

> Como Prudential Renda Familiar compara ao Bradesco Tranquilidade Familiar?

- expected tokens (4): `[renda familiar, renda mensal, morte, beneficiario]`
- legacy matched: `[]` (0/4)
- shadow matched: `[renda familiar, morte]` (2/4)
- rationale: Q36: comparison between two renda-mensal products. Tokens are the Prudential product name + the clause concepts (renda mensal, morte do provedor, beneficiario). Scope=conditions.

### Q37 — comparison (conditions)

> Prudential Vida Inteira WL10G vs WL00G, mulher 35 anos.

- expected tokens (4): `[vida inteira, modificado, vitalicia, pagamento]`
- legacy matched: `[]` (0/4)
- shadow matched: `[vida inteira, modificado, pagamento]` (3/4)
- rationale: Audited in slice 3B.7.5. Original tokens ["wl10g","wl00g","vida inteira","capital remido"] were rate-table-flavoured: wl10g/wl00g exist exclusively in rate_table_pdf (58/57 hits each, ZERO in conditions_pdf); "capital remido" returns zero hits across the entire Prudential corpus. Replaced with body-text-anchored conditions tokens: vida inteira (product family), modificado (the WL10G "modificado 30" variant differentiator), vitalicia (the WL00G permanent-life concept), pagamento (the economic differentiator — limited-payment vs ongoing). Scope=conditions: this question IS measurable on the new chunker.

### Q38 — comparison (control_rate_table)

> Prudential Seguro Cirurgia CIB5G vs CIB5H, qual mais barato?

- expected tokens (3): `[cib5g, cib5h, cirurgia]`
- legacy matched: `[cirurgia]` (1/3)
- shadow matched: `[cirurgia]` (1/3)
- rationale: Q38: pure rate question (ground_truth: 20,4928 vs 20,2133 per_1000_annual). Legacy hits this via the structured rate_table_pdf path; shadow is conditions_pdf-only by contract and CANNOT score by design. Reclassified to control_rate_table in slice 3B.7.1; informational only — never feeds the stop signal.

### Q39 — comparison (control_rate_table)

> Prudential Temporario TM10, TM15 e TM20 para homem 35 anos.

- expected tokens (4): `[tm10, tm15, tm20, temporario]`
- legacy matched: `[tm10, tm15, tm20]` (3/4)
- shadow matched: `[temporario]` (1/4)
- rationale: Q39: pure rate question (3 rate values for 3 temporario term variants). Same shape as Q38 — rate_table_pdf scope. Reclassified to control_rate_table in slice 3B.7.1; informational only.

## Category aggregates — in-scope conditions_pdf only

These aggregates DRIVE the stop signal.

| category | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | shadow regressed? |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| comparison | 4 | 30.0% | 76.3% | +46.3pp | 29.2% | 60.4% | +31.3pp | no |
| concept | 2 | 100.0% | 92.5% | -7.5pp | 100.0% | 87.5% | -12.5pp | **YES** |

## Control aggregate — rate_table_pdf (informational only, never a stop signal)

| scope | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | reading |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| control_rate_table | 2 | 97.5% | 22.5% | -75.0pp | 54.2% | 29.2% | -25.0pp | expected: shadow loses by design (corpus is conditions_pdf-only) |

## Out-of-scope commercial aggregate (informational only, never a stop signal)

Questions whose ground-truth fact lives only in commercial / sales material —
NOT in any indexed PDF. Shadow is expected to score 0; any legacy lift here is
a legacy-ingestion artifact (synthetic metadata-header chunk), not retrieval.

| scope | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | reading |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| out_of_scope_commercial | 1 | 5.0% | 0.0% | -5.0pp | 66.7% | 0.0% | -66.7pp | legacy scored via synthetic metadata-header (ingestion artifact, not retrieval) |

## Stop signal (CEO criterion: shadow CP < legacy CP OR shadow CR < legacy CR — IN-SCOPE only)

> :warning: **STRATEGIC STOP** — shadow regressed on at least one in-scope category aggregate.
> The harness exits with code 1. Investigate before any promotion discussion.

## Guardrails honored

- No production read-path import (no `app/src/services/rag/*` import).
- No edit of `match_documents`, `answer.ts`, `compare.ts`.
- No LLM judge; metric is the deterministic keyword-overlap proxy described above.
- No promotion. `valid_until` stays at the sentinel. No DELETE.
- Prudential-only insurer guard via `assertPrudentialOnly`.
- Stop signal restricted to `scope=conditions` aggregates per slice 3B.7.1.