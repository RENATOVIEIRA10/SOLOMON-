# SOLOMON focus 5 baseline

Date: 2026-06-23
Endpoint: `https://app-atalaia.vercel.app/api/ask`
Raw run: `/tmp/solomon-focus5-results/20260623_193208/raw.jsonl` on VPS
Question set: `app/eval/ragas/questions_focus5.jsonl`

## Scope decision

The active product/RAG focus is limited to:

- Azos
- Prudential
- Icatu
- MAG
- MetLife

Zurich, Bradesco, SulAmerica, Tokio, Porto, MAPFRE, Caixa, Santander, and other insurers remain out of priority unless explicitly requested.

## Smoke result

- Questions: 26
- HTTP OK: 26/26
- Categories:
  - `rate_prudential`: 5
  - `rate_mag`: 10
  - `concept`: 6
  - `comparison`: 5
- Actual model routing:
  - `rate-table-lookup`: 20
  - `gemini-2.5-flash`: 6

## Retrieval metrics

Ran CP/CR from the collected raw responses, without re-calling production:

```bash
cd /root/solomon/repo/app/eval/ragas
set -a && source /root/agents/config/.env && source /root/solomon/repo/app/.env.local && set +a
.venv/bin/python run_cpcr_from_raw.py \
  --raw /tmp/solomon-focus5-results/20260623_193208/raw.jsonl \
  --out-dir /tmp/solomon-focus5-results/20260623_193208 \
  --judge-backend openai \
  --max-workers 1 \
  --timeout 300
```

Scores:

- `llm_context_precision_with_reference`: 0.879
- `context_recall`: 0.797

Interpretation: focus5 retrieval is healthy overall, but the remaining gap is concentrated in concept questions.

## Concept gaps below 0.70

| ID | Topic | CP | CR | Notes |
|---|---|---:|---:|---|
| Q16 | Prudential Vida Inteira suicide waiting period | 0.333 | 0.500 | Retrieval selected Prudential Capital Global first instead of Vida Inteira. Answer is directionally safe but product-targeting is weak. |
| Q17 | Prudential Seguro Temporario renewal | 0.500 | 0.000 | Retrieval found Temporario products, but reference expects nuance about base temporary vs optional temporary coverage. |
| Q22 | MetLife additional life coverages | 0.325 | 0.000 | Retrieval is MetLife-only but starts with fragmented/generic collective chunks; coverage list recall is weak. |
| Q25 | Azos preexisting diseases | 0.576 | 0.667 | Answer is mostly aligned; needs better direct exclusion/DPS chunks. |
| Q26 | Prudential VG Corporate minimum lives | 0.125 | 0.000 | Answer returned 3 lives from retrieved VG Corporate source, while reference says VG Express 2-500 and VG Corporate above 500. Requires product/source audit before code change. |
| Q29 | Icatu VG Global | 1.000 | 0.500 | Correct insurer/product appears first; recall misses part of the reference definition around capital global distribution. |

## Next engineering target

Do not work issue #66 first; it is Zurich vs Bradesco and outside the current focus.

Recommended next cycle:

1. Audit Q16/Q17/Q22/Q25/Q26/Q29 source chunks and ground truths.
2. Decide whether Q26 is a stale ground truth or a source/product resolver problem.
3. Improve single-insurer concept retrieval for explicit product names in focus5 only, preserving rate lookup behavior.
4. Re-run `questions_focus5.jsonl` CP/CR and compare against this baseline.
