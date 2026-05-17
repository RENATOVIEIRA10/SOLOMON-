# Phase 2 PR 3B slice 3B.6.3 — legacy vs shadow eval report

Generated: 2026-05-17T01:23:29.178Z

## Scope

- Prudential-only.
- Compares `match_documents` (production) vs `match_shadow_documents` (slice 3B.6.2).
- Same query embedding dispatched to both functions per question.
- **No LLM judge.** CP / CR here are deterministic keyword-overlap proxies — see methodology below.
- No production read path import. No edit of match_documents/answer.ts/compare.ts.
- Slice 3B.7.1: questions tagged `scope: conditions | control_rate_table`. Only `conditions` feed the stop signal.

## Inputs

- insurer: Prudential do Brasil (`dac17baa-c623-4023-9184-3ed2049a6237`)
- questions: 9
- match_count: 10
- threshold: 0

## Methodology (proxy metric)

For each question, an explicit `expectedTokens` set (3-6 case- and accent-insensitive
tokens) encodes what a correct retrieval MUST surface. Both functions are scored by:

- **CP (proxy)** = fraction of retrieved chunks containing ≥1 expected token.
- **CR (proxy)** = fraction of expected tokens found in the UNION of retrieved chunks.

Same function applied to both corpora → Δ is fair. Not Ragas CP/CR; a deterministic
directional signal. Full Ragas (LLM judge) is gated as slice 3B.6.4.

## Per-question results — in-scope conditions_pdf (N=7)

These questions DRIVE the stop signal: their answers live in `conditions_pdf`, so
the shadow corpus is structurally capable of retrieving them.

| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Q16 | concept | 100.0% | 90.0% | -10.0pp | 75.0% | 50.0% | -25.0pp | 3 | 10 | shadow regressed |
| 2 | Q17 | concept | 100.0% | 100.0% | ±0.0pp | 100.0% | 100.0% | ±0.0pp | 10 | 10 | shadow: all expected tokens found; legacy: all expected tokens found |
| 3 | Q26 | concept | 10.0% | 0.0% | -10.0pp | 66.7% | 0.0% | -66.7pp | 10 | 10 | shadow regressed |
| 4 | Q31 | comparison | 40.0% | 100.0% | +60.0pp | 50.0% | 50.0% | ±0.0pp | 10 | 10 |  |
| 5 | Q32 | comparison | 100.0% | 100.0% | ±0.0pp | 66.7% | 66.7% | ±0.0pp | 10 | 10 |  |
| 6 | Q36 | comparison | 0.0% | 10.0% | +10.0pp | 0.0% | 25.0% | +25.0pp | 10 | 10 |  |
| 7 | Q37 | comparison | 40.0% | 0.0% | -40.0pp | 50.0% | 0.0% | -50.0pp | 10 | 10 | shadow regressed |

## Per-question results — control rate_table_pdf (N=2)

Informational only. These answers live in `rate_table_pdf` and the shadow corpus
is `conditions_pdf`-only by contract. Shadow is **not expected** to score and
these rows **never feed the stop signal**.

| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Q38 | comparison | 100.0% | 40.0% | -60.0pp | 33.3% | 33.3% | ±0.0pp | 10 | 10 | shadow regressed |
| 2 | Q39 | comparison | 100.0% | 30.0% | -70.0pp | 75.0% | 25.0% | -50.0pp | 10 | 10 | shadow regressed |

## Per-question token detail

### Q16 — concept (conditions)

> Qual o periodo de carencia para suicidio no Seguro Vida Inteira da Prudential?

- expected tokens (4): `[carencia, suicidio, 2 anos, vida inteira]`
- legacy matched: `[carencia, suicidio, vida inteira]` (3/4)
- shadow matched: `[carencia, suicidio]` (2/4)
- rationale: Julio-validated ground_truth: "2 anos a contar da contratacao". Tokens cover the right clause (carencia + suicidio) and the right product (vida inteira) plus the literal period. Scope=conditions: clause lives in conditions_pdf.

### Q17 — concept (conditions)

> O Seguro Temporario da Prudential tem renovacao automatica?

- expected tokens (4): `[temporario, renovacao, vigencia, apolice]`
- legacy matched: `[temporario, renovacao, vigencia, apolice]` (4/4)
- shadow matched: `[temporario, renovacao, vigencia, apolice]` (4/4)
- rationale: Julio-validated: renovacao depends on whether temporario is cobertura base or opcional. Tokens span product (temporario) and the clause topic (renovacao/vigencia). Scope=conditions.

### Q26 — concept (conditions)

> Qual o numero minimo de vidas para contratar o VG Corporate da Prudential?

- expected tokens (3): `[vg corporate, vg express, 500 vidas]`
- legacy matched: `[vg corporate, vg express]` (2/3)
- shadow matched: `[]` (0/3)
- rationale: Julio-validated: VG Corporate >500 vidas, VG Express 2-500. Tokens are the two product names plus the threshold. Scope=conditions.

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
- shadow matched: `[renda familiar]` (1/4)
- rationale: Q36: comparison between two renda-mensal products. Tokens are the Prudential product name + the clause concepts (renda mensal, morte do provedor, beneficiario). Scope=conditions.

### Q37 — comparison (conditions)

> Prudential Vida Inteira WL10G vs WL00G, mulher 35 anos.

- expected tokens (4): `[wl10g, wl00g, vida inteira, capital remido]`
- legacy matched: `[wl10g, wl00g]` (2/4)
- shadow matched: `[]` (0/4)
- rationale: Q37: distinguishes two Vida Inteira variants by code. Tokens cover both codes and the explanatory concept (capital remido). Scope=conditions: the differentiator (capital remido em 10 anos) is a conditions concept.

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
| comparison | 4 | 45.0% | 52.5% | +7.5pp | 41.7% | 35.4% | -6.3pp | **YES** |
| concept | 3 | 70.0% | 63.3% | -6.7pp | 80.6% | 50.0% | -30.6pp | **YES** |

## Control aggregate — rate_table_pdf (informational only, never a stop signal)

| scope | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | reading |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| control_rate_table | 2 | 100.0% | 35.0% | -65.0pp | 54.2% | 29.2% | -25.0pp | expected: shadow loses by design (corpus is conditions_pdf-only) |

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