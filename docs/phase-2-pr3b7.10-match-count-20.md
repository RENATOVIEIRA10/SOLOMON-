# SOLOMON — Phase 2 / Slice 3B.7.10 — harness `match_count` 10 → 20

_Generated 2026-05-17. Patch applied to the scoped harness only. Production read path unchanged. Tests recommendation **C** from PR #45 audit and the residual diagnosis from PR #46._

**Predecessor:** PR #46 (slice 3B.7.9). After fixing Q16's `2 anos` → `dois anos` token, the concept aggregate still regressed by exactly Q16's `vida inteira` token falling outside the shadow top-10. The PR #45 audit predicted this was top-K dilution (vida-inteira-* chunks ranking slot 11+). This slice tests the prediction by doubling the harness cutoff.

## 1. Patch (harness-only)

| File | Change |
|---|---|
| `app/scripts/phase2/azure-di-shadow-eval.ts` | `DEFAULT_MATCH_COUNT`: `10` → `20`. Help text auto-updates (templated). CLI flag `--match-count <n>` preserved for overrides. |
| `app/scripts/phase2/azure-di-shadow-eval.test.ts` | +5 source-text assertions: default literal is 20, no leftover 10, CLI flag preserved, positive-int validation preserved, help text templated on the constant. |

**NOT touched:** `match_documents` (production RPC), `match_shadow_documents` (slice 3B.6.2 RPC), `answer.ts`, `compare.ts`, embedder, chunker, indexer. Production reads continue at whatever `match_count` the read path uses.

Unit tests: **113 / 113 pass** locally and on VPS.

## 2. Did `vida inteira` enter the shadow union at K=20? — **No.**

| Q16 token | K=10 (PR #46) | K=20 (this slice) |
|---|:-:|:-:|
| `carencia` (shadow) | yes | yes |
| `suicidio` (shadow) | yes | yes |
| `dois anos` (shadow) | yes | yes |
| **`vida inteira`** (shadow) | **no** | **no (still)** |
| **Shadow tokens matched** | **3 / 4** | **3 / 4** |
| Shadow chunks retrieved | 10 | 20 |
| Shadow CR | 75% | 75% (unchanged) |
| Shadow CP | 90% | **85%** (dilution: more chunks, proportionally fewer with tokens) |

The audit's hypothesis (vida-inteira-* chunks ranking slot 11+) was too conservative. **Vida-inteira-* chunks rank deeper than slot 20** for Q16's question embedding. Doubling the cutoff bought zero recall and cost 5pp of CP precision on Q16.

## 3. Aggregate impact — K=20 vs K=10

| Aggregate | K=10 (PR #46) | K=20 (this slice) | delta |
|---|---|---|---|
| concept in-scope CP | 100.0 → 95.0 (-5.0pp) | 100.0 → 92.5 (-7.5pp) | **worse by 2.5pp** |
| concept in-scope CR | 100.0 → 87.5 (-12.5pp) | 100.0 → 87.5 (-12.5pp) | unchanged |
| comparison in-scope CP | 35.0 → 80.0 (+45.0pp) | 30.0 → 76.3 (+46.3pp) | better by 1.3pp |
| comparison in-scope CR | 29.2 → 54.2 (+25.0pp) | 29.2 → 60.4 (+31.3pp) | better by 6.3pp |
| control_rate_table CP (informational) | 100.0 → 35.0 (-65.0pp) | 97.5 → 22.5 (-75.0pp) | wider gap (informational) |
| out_of_scope_commercial (informational) | -10.0pp CP, -66.7pp CR | -5.0pp CP, -66.7pp CR | similar |
| **Stop signal (in-scope only)** | **FIRES** (concept regressed) | **FIRES (still)** | unchanged |

K=20 helped comparison slightly (more recall) and hurt concept slightly (dilution). The stop signal stays open. The residual is **not** a top-K artifact.

## 4. Per-question detail at K=20 (in-scope `conditions` only)

| # | Q | category | legacy CP | shadow CP | Δ CP | legacy CR | shadow CR | Δ CR | legacy chunks | shadow chunks |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Q16 | concept | 100.0% | **85.0%** | **-15.0pp** | 100.0% | **75.0%** | **-25.0pp** | 3 | 20 |
| 2 | Q17 | concept | 100.0% | 100.0% | ±0.0pp | 100.0% | 100.0% | ±0.0pp | 13 | 20 |
| 3 | Q31 | comparison | 20.0% | 90.0% | +70.0pp | 50.0% | 50.0% | ±0.0pp | 20 | 20 |
| 4 | Q32 | comparison | 100.0% | 100.0% | ±0.0pp | 66.7% | 66.7% | ±0.0pp | 20 | 20 |
| 5 | Q36 | comparison | 0.0% | 25.0% | +25.0pp | 0.0% | 50.0% | +50.0pp | 20 | 20 |
| 6 | Q37 | comparison | 0.0% | 90.0% | +90.0pp | 0.0% | 75.0% | +75.0pp | 20 | 20 |

The whole concept regression is still concentrated in Q16, same root cause as PR #46. Every other in-scope cell is non-negative.

## 5. Why the audit hypothesis failed

PR #45 audit (§ 4) predicted vida-inteira-* chunks rank slot 11+ on Q16's query embedding. This slice falsified that — they rank deeper than slot 20. Two structural reasons explain why:

1. **The query embedding is overwhelmingly about `carencia + suicidio`.** "Vida Inteira" is a product qualifier; the semantic mass of the question is the clause topic. Embeddings prefer clause-rich chunks (Express, Corporate, Capital Global carencia sections) over product-rich chunks from vida-inteira-* PDFs whose suicide clauses use the exact same legal language.
2. **The conditions clause text for suicide carencia is nearly identical across Prudential life products.** All variants write some form of "no caso de suicidio... durante os 2 (dois) primeiros anos de vigencia da apolice". When the chunker correctly preserves that uniform clause across many products, it dilutes the discriminative power of the product-name token for retrieval.

This is fundamentally a limit of substring-overlap as a retrieval proxy, not a chunker problem.

## 6. Executive read — conclusion against the CEO's A/B/C menu

The CEO's criterion was: A) stop closed, B) stop did not close and needs Ragas, C) stop did not close but residual is acceptable / documented.

**Conclusion: B + C combined.**

- **B** because the keyword-overlap proxy has reached its evidentiary limit. The single residual cell (Q16 shadow CR 75% vs legacy 100%) is driven by a token that is verifiably present in the indexed shadow corpus but does not co-occur with the carencia-suicidio clause in the chunks that rank top-20. A judge that reads the retrieved evidence and grades the actual answer would not penalize this.
- **C** because the residual is now fully diagnosed and well-bounded:
  - Single question (Q16) out of 6 in-scope.
  - Single token (`vida inteira`) out of 4 expected.
  - Shadow chunker output is correct (vida-inteira-* PDFs indexed, content present, just below the K=20 cutoff for this query).
  - Production read path is unchanged and unaffected.
  - All other in-scope cells: shadow ties (Q17, Q31 on CR, Q32) or beats legacy (Q31 CP +70pp, Q36 +25/+50pp, Q37 +90/+75pp).

The honest read: **shadow is the better corpus for everything except Q16's product-disambiguation token**, and that gap is at the limit of what a keyword-overlap proxy can resolve. Resolving it requires either escalating to a judge that understands the answer (Ragas, slice 3B.6.4) or accepting the residual with this evidence package as the justification.

## 7. Decision space (per CEO criterion)

- **B — authorize Ragas (slice 3B.6.4).** Replaces the keyword proxy with an LLM judge that grades the actual answer. Eliminates substring brittleness; multi-judge ensemble already designed.
- **C — accept the residual as documented.** Proceed to promotion design (slice 3C). The audit + this rerun + the evidence above constitute a defensible justification.

Recommendation (for CEO): **B first**. Ragas is the next gated slice anyway in the Phase 2 plan, and it is the right tool to resolve a sub-token residual that proxy metrics cannot capture. If Ragas confirms shadow is at least neutral on Q16's correctness, then promote. If Ragas also flags Q16, then we have a real chunker issue to investigate (would re-open slices 3B.2/3B.3).

## 8. Guardrails honored

Prudential-only. `conditions_pdf` only. No DELETE. No promotion. No read-path change. No Ragas run yet. No embedder rerun. No production `match_count` change (harness only). No Azos / MAG. No Agentic RAG / PageIndex. No page-span 100. No edits to `match_documents` / `answer.ts` / `compare.ts`. Branch via REST API push (Windows 403 workaround).

## 9. Artifacts

- Patch: `app/scripts/phase2/azure-di-shadow-eval.ts` (default constant) + `app/scripts/phase2/azure-di-shadow-eval.test.ts` (assertions).
- Unit tests: 113 / 113 pass.
- Full harness report: `docs/audit-runs/phase-2-pr3b7.10-20260517T033712Z/shadow-eval-report.md`.
- Commit: `e80944a` (this branch).
