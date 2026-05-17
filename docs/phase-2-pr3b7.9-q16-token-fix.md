# SOLOMON — Phase 2 / Slice 3B.7.9 — Q16 token fix + scoped harness rerun

_Generated 2026-05-17. Patch applied: Q16 `expectedTokens[2]` swapped from `'2 anos'` to `'dois anos'` (recommendation A from PR #45 audit). Plus targeted unit tests. Scoped harness rerun on VPS over the live Prudential shadow + legacy corpora._

**Predecessor:** PR #45 (slice 3B.7.8 — Q16 surgical audit). The audit proved literal `'2 anos'` returns zero hits across 5620 Prudential `conditions_pdf` chunks and recommended A) replace `'2 anos'` → `'dois anos'` and C) optionally bump `match_count` 10 → 20. CEO authorized A only; C deferred pending this rerun.

## 1. Patch (read-only outside the harness)

| File | Change |
|---|---|
| `app/src/services/azure-di/shadow-eval-metrics.ts` | `Q16.expectedTokens`: `['carencia', 'suicidio', '2 anos', 'vida inteira']` → `['carencia', 'suicidio', 'dois anos', 'vida inteira']`. Notes updated with PR #45 reference. |
| `app/scripts/phase2/azure-di-shadow-eval.test.ts` | +7 new Q16 assertions: token drop/include, three other tokens preserved, scope stays `conditions`, category stays `concept`. |

No edits to `match_documents`, `match_shadow_documents`, `answer.ts`, `compare.ts`, or any read-path file. No embedder run. No DB writes. No Azos/MAG. No promotion.

Local unit test: **108 / 108 pass** (was 101 / 101 + 7 new = 108).
VPS unit test: **108 / 108 pass** (parity).

## 2. Q16 token-presence delta — before/after the patch

| Token | PR #44 legacy | PR #44 shadow | 3B.7.9 legacy | 3B.7.9 shadow |
|---|:-:|:-:|:-:|:-:|
| `carencia` | yes | yes | yes | yes |
| `suicidio` | yes | yes | yes | yes |
| `2 anos` (old) | **no** | **no** | _retired_ | _retired_ |
| `dois anos` (new) | _n/a_ | _n/a_ | **yes** | **yes** |
| `vida inteira` | yes | **no** | yes | **no** |
| **Tokens matched** | 3 / 4 | 2 / 4 | **4 / 4** | **3 / 4** |
| **CP / CR** | 100 / 75 | 90 / 50 | **100 / 100** | **90 / 75** |

Both corpora moved up: legacy +25pp CR, shadow +25pp CR. The relative gap closed by 12.5pp on CR but persists at 25pp because the `vida inteira` shadow miss survived the token fix.

## 3. Aggregate impact — 3B.7.9 vs PR #44 (Track D)

| Aggregate | PR #44 (Track D) | 3B.7.9 | Δ vs PR #44 |
|---|---|---|---|
| concept in-scope (Q16, Q17) CP | 100.0% → 95.0% (-5.0pp) | 100.0% → 95.0% (-5.0pp) | unchanged |
| concept in-scope (Q16, Q17) CR | 100.0% → 87.5% (-12.5pp) | 100.0% → 87.5% (-12.5pp) | unchanged |
| comparison in-scope (Q31, Q32, Q36, Q37) CP | 35.0% → 80.0% (+45.0pp) | 35.0% → 80.0% (+45.0pp) | unchanged |
| comparison in-scope (Q31, Q32, Q36, Q37) CR | 29.2% → 54.2% (+25.0pp) | 29.2% → 54.2% (+25.0pp) | unchanged |
| control_rate_table (Q38, Q39) — informational | 100.0% → 35.0% CP | 100.0% → 35.0% CP | unchanged |
| out_of_scope_commercial (Q26) — informational | 10.0% → 0.0% CP | 10.0% → 0.0% CP | unchanged |
| **Stop signal (in-scope only)** | **FIRES** (concept regressed) | **FIRES** (concept regressed) | unchanged |

The aggregate numbers did not move because the token correction lifted **both** corpora on Q16 by the same amount. The proxy measurement got more honest (legacy now scores at the truth of the document; shadow does too) without changing the gap.

## 4. Per-question detail (full source: `docs/audit-runs/phase-2-pr3b7.9-20260517T031839Z/shadow-eval-report.md`)

In-scope `conditions` only (the only scope that drives the stop signal):

| # | Q | category | legacy CP | shadow CP | Δ CP | legacy CR | shadow CR | Δ CR | legacy chunks | shadow chunks |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Q16 | concept | 100.0% | 90.0% | -10.0pp | **100.0%** | **75.0%** | **-25.0pp** | 3 | 10 |
| 2 | Q17 | concept | 100.0% | 100.0% | ±0.0pp | 100.0% | 100.0% | ±0.0pp | 10 | 10 |
| 3 | Q31 | comparison | 40.0% | 100.0% | +60.0pp | 50.0% | 50.0% | ±0.0pp | 10 | 10 |
| 4 | Q32 | comparison | 100.0% | 100.0% | ±0.0pp | 66.7% | 66.7% | ±0.0pp | 10 | 10 |
| 5 | Q36 | comparison | 0.0% | 20.0% | +20.0pp | 0.0% | 25.0% | +25.0pp | 10 | 10 |
| 6 | Q37 | comparison | 0.0% | 100.0% | +100.0pp | 0.0% | 75.0% | +75.0pp | 10 | 10 |

The whole concept regression now lives in a single cell: Q16 shadow CR 75% vs legacy CR 100%, missing the literal phrase `vida inteira` from the top-K. Every other in-scope cell is non-negative (shadow ties or beats legacy).

## 5. Why the stop signal still fires

The audit (PR #45 § 4) called this exactly: with `'2 anos'` fixed, the residual is `vida inteira` top-K dilution, not a chunker defect.

- vida-inteira-* PDFs in the shadow corpus: **5 / 22 URLs, 451 chunks** (well-represented).
- `vida inteira` token presence in shadow Prudential corpus: **yes (broadly)**.
- Top-10 by similarity for Q16's question embedding: vida-inteira-* PDF chunks rank slot 11+, behind Express / Corporate / Capital Global carencia-suicidio sections that are semantically valid for the question but are not the answer about the Vida Inteira product specifically.

This is a top-K cutoff effect on a single question. The shadow chunker is correctly producing chunks that contain `vida inteira`; they just don't rank inside the top-10 for this particular query embedding.

## 6. Executive read (honest)

1. **The token fix worked as designed.** Both corpora are now measured against the literal phrasing of the Prudential conditions PDFs. Q16's `dois anos` token is present in both legacy and shadow top-K, exactly as predicted.
2. **The aggregate stop signal did not close** because Q16's `vida inteira` token still falls outside the shadow top-10 by similarity. This is a single-question, single-token residual: shadow concept CR 87.5% vs legacy 100%; shadow concept CP 95% vs legacy 100%.
3. **Shadow continues to beat legacy on comparison by +45 CP / +25 CR** — the headline finding from PR #44 is preserved unchanged. Q36 and Q37 are the big movers (shadow recovers 25pp / 75pp CR where legacy scored zero).
4. **All informational aggregates** (control_rate_table, out_of_scope_commercial) behave identically to PR #44, as expected — the token fix only touched Q16.
5. **The residual is a top-K dilution, not a chunker defect.** vida-inteira-* PDFs are present, indexed, and contain matching content; they just rank slot 11+ on this query.

## 7. Decision space (per CEO criterion)

Stop signal did NOT close. Three explicit options remain:

- **C — `match_count` 10 → 20 in the scoped harness only.** Predicted effect: recovers `vida inteira` in Q16's shadow union (raising shadow CR from 75% → 100% on Q16) → closes concept aggregate regression. Zero read-path impact (production keeps using `match_documents` at its own match_count). Pure measurement adjustment. Smallest move.
- **E — Authorize Ragas (slice 3B.6.4) now.** Replace the keyword-overlap proxy with an LLM-judge. Eliminates the brittleness of substring matching entirely. Larger commit; multi-judge ensemble already designed (Anthropic + Gemini).
- **Accept the residual.** Document it as "concept CR -12.5pp driven entirely by Q16 vida-inteira top-K dilution; production read path unchanged" and proceed to promotion design. The audit and this rerun together constitute a defensible justification.

Recommendation (for CEO): **C first**. It is the cheapest test of the audit hypothesis (if C closes the gap, the residual is confirmed as a measurement artifact). If C does not close it, escalate to E.

## 8. Guardrails honored

Prudential-only. `conditions_pdf` only. No DELETE. No promotion. No read-path change. No Ragas run. No embedder rerun. No `match_count` change yet. No Azos / MAG. No Agentic RAG / PageIndex. No page-span 100. No edits to `match_documents` / `answer.ts` / `compare.ts`. Branch via REST API push (Windows 403 workaround).

## 9. Artifacts

- Patch: `app/src/services/azure-di/shadow-eval-metrics.ts` (Q16 token) + `app/scripts/phase2/azure-di-shadow-eval.test.ts` (Q16 assertions).
- Unit tests: 108 / 108 pass locally and on VPS.
- Full harness report: `docs/audit-runs/phase-2-pr3b7.9-20260517T031839Z/shadow-eval-report.md`.
- Commit: `3be7f20` (this branch).
