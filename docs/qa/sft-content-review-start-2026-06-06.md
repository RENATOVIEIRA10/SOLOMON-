# SFT content review start - 2026-06-06

## Policy

- This pass does not impersonate domain approval by Julio.
- Evidence review can correct arithmetic, units, scope, and epistemic wording.
- `approved_for_sft: true` remains a human sign-off action.
- Product interpretation and contractual conclusions require specialist review.

## Existing queue triage

### Ready for human sign-off after evidence review

- Q01-Q05: deterministic Prudential rate calculations; arithmetic and monthly equivalents are consistent with the stated annual rates.
- Q31: `500 x 5.2009 = 2,600.45`; the answer correctly avoids inventing a Bradesco rate.
- Q32: correctly limits the exact comparison when competitor rate tables are unavailable; the Prudential rate still needs source-version confirmation at sign-off.
- Q38: the cited CIB5G/CIB5H rates and approximately 1.4% difference are already documented as a structured rate-table control.
- Q39: ordering and values for TM10/TM15/TM20 are consistent with the versioned rate-table audit.
- Q40: `1 - 136.45 / 324.19 = 57.91%`; the approximately 58% comparison is arithmetically correct.

### Requires product-specialist wording review

- Q06: confirm MAG code 2330 and period mapping against the current imported table version.
- Q34: confirm the commercial expansion and scope of `MAC+IPAM`, not only the two prices.
- Q37: confirm the explanation that WL10G is more expensive because of limited payment/capital-remido mechanics.

### Behavioral cases

- Q41: correct behavior is to request client, objective, budget, and coverage context before recommending.
- Q42: correct behavior is a concise out-of-scope redirect.

### Corrected in this pass

- Q43: changed from a market-wide product claim to the evidence-supported statement that no Prudential pet rate exists in the SOLOMON base.
- Q44: changed from saying HDI is unsupported in general to saying no HDI pricing table is available for a deterministic quote.

## New draft batch

- Added SFT001-SFT010 in `app/eval/ragas/questions_sft_expansion.jsonl`.
- The batch covers missing quote dimensions, deterministic calculation, incomplete comparisons, insurer separation, unknown codes, document versioning, rate units, ambiguous waiting periods, pre-claim evidence thresholds, and product scope.
- All ten remain unapproved and must pass human review before training.

## Second draft batch

- Added SFT011-SFT020 in `app/eval/ragas/questions_sft_expansion.jsonl`.
- The batch covers missing insurer sources, multi-insurer separation, citation provenance, AP comparison structure, incomplete rate calculations, monthly rate semantics, unit normalization, and explicit-evidence thresholds for pre-claim verdicts.
- All ten remain unapproved and must pass human review before training.

## Third draft batch

- Added SFT021-SFT030 in `app/eval/ragas/questions_sft_expansion.jsonl`.
- The batch covers low-confidence answers, product mismatches, citation coverage, ambiguous comparison axes, non-equivalent products, missing rate dimensions, and evidence boundaries between conditions and pricing tables.
- All ten remain unapproved and must pass human review before training.

## Fourth draft batch

- Added SFT031-SFT040, covering exhaustive exclusions and grace periods, rate-table boundaries, calculation caveats, provenance, and conflicting versions.

## Fifth draft batch

- Added SFT041-SFT050, covering claim-document requirements, DPS uncertainty, chronology, policy status, accident classification, and survival periods.

## Sixth draft batch

- Added SFT051-SFT060, covering contractual concepts, product discovery, commercial-data boundaries, temporal applicability, and beneficiaries.

## Final draft batch

- Added SFT061-SFT067, covering source conflicts, refusal to fabricate rates, monetary rounding, unit normalization, deduplication, rerank fallback, and answer closure.
- SFT001-SFT067 are drafts. None are approved for training until human review is recorded.

## Draft authoring complete

- New ground truths authored: 67/67.
- Existing review candidates before expansion: 17.
- Total deterministic review queue after expansion: 84.
- New examples still required if every current candidate is approved: 0.
- Approved examples remain 16/100 because authoring is not equivalent to human approval.
- The next gate is content review: approve, correct, or reject each candidate and record the reviewer before enabling training.
