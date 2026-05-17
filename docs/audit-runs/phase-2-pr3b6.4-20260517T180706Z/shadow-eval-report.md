# SOLOMON -- Phase 2 / Slice 3B.6.4 -- Ragas CP + CR

## Config

- judge_backend: gemini
- embedding_model: text-embedding-3-small
- match_count: 10
- match_threshold: 0.0
- insurer: Prudential do Brasil
- metrics: context_precision (LLMContextPrecisionWithReference) + context_recall (LLMContextRecall)
- generated: 2026-05-17T18:10:22.222415Z

## Per-row scores

| id | scope | corpus | CP | CR | n_contexts |
|---|---|---|---:|---:|---:|
| Q16 | conditions | legacy | 1.000 | 0.500 | 3 |
| Q16 | conditions | shadow | 0.807 | 0.500 | 10 |
| Q17 | conditions | legacy | 0.526 | 0.000 | 10 |
| Q17 | conditions | shadow | 0.948 | 0.500 | 10 |
| Q26 | out_of_scope_commercial | legacy | 0.000 | 0.000 | 10 |
| Q26 | out_of_scope_commercial | shadow | 0.000 | 0.000 | 10 |
| Q31 | conditions | legacy | 0.500 | 0.000 | 10 |
| Q31 | conditions | shadow | 0.000 | 0.000 | 10 |
| Q32 | conditions | legacy | 0.000 | 0.000 | 10 |
| Q32 | conditions | shadow | 0.000 | 0.000 | 10 |
| Q36 | conditions | legacy | 0.000 | 0.250 | 10 |
| Q36 | conditions | shadow | 0.833 | 0.000 | 10 |
| Q37 | conditions | legacy | 0.000 | 0.000 | 0 |
| Q37 | conditions | shadow | 0.000 | 0.000 | 10 |
| Q38 | control_rate_table | legacy | 0.000 | 0.000 | 10 |
| Q38 | control_rate_table | shadow | 0.000 | 0.000 | 10 |
| Q39 | control_rate_table | legacy | 0.250 | 0.200 | 10 |
| Q39 | control_rate_table | shadow | 0.000 | 0.000 | 10 |

## Aggregates by scope

| scope | Qs | legacy CP | shadow CP | dCP | legacy CR | shadow CR | dCR |
|---|---:|---:|---:|---:|---:|---:|---:|
| conditions | 6 | 0.338 | 0.432 | +0.094 | 0.125 | 0.167 | +0.042 |
| control_rate_table | 2 | 0.125 | 0.000 | -0.125 | 0.100 | 0.000 | -0.100 |
| out_of_scope_commercial | 1 | 0.000 | 0.000 | +0.000 | 0.000 | 0.000 | +0.000 |

## Stop signal

**CLEAR** -- shadow >= legacy on in-scope conditions: dCP=+0.094, dCR=+0.042.
