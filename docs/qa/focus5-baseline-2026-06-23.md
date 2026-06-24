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
  - `concept`: 5
  - `comparison`: 5
  - `out_of_scope_commercial`: 1
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

Adjusted stop-signal scores excluding Q26 (`out_of_scope_commercial`):

- active rows: 25
- `llm_context_precision_with_reference`: 0.909
- `context_recall`: 0.829

Concept-only actionable scores excluding Q26:

- concept rows: 5
- `llm_context_precision_with_reference`: 0.547
- `context_recall`: 0.333

Interpretation: focus5 retrieval is healthy overall, but the remaining actionable gap is concentrated in concept questions.

## Concept gaps below 0.70

| ID | Topic | CP | CR | Notes |
|---|---|---:|---:|---|
| Q16 | Prudential Vida Inteira suicide waiting period | 0.333 | 0.500 | Retrieval selected Prudential Capital Global first instead of Vida Inteira. Answer is directionally safe but product-targeting is weak. |
| Q17 | Prudential Seguro Temporario renewal | 0.500 | 0.000 | Retrieval found Temporario products, but reference expects nuance about base temporary vs optional temporary coverage. |
| Q22 | MetLife additional life coverages | 0.325 | 0.000 | Retrieval is MetLife-only but starts with fragmented/generic collective chunks; coverage list recall is weak. |
| Q25 | Azos preexisting diseases | 0.576 | 0.667 | Answer is mostly aligned; needs better direct exclusion/DPS chunks. |
| Q29 | Icatu VG Global | 1.000 | 0.500 | Correct insurer/product appears first; recall misses part of the reference definition around capital global distribution. |

## Q26 scope correction

Q26 is retained in the focus5 file for visibility, but it is categorized as `out_of_scope_commercial`, not `concept`.

Reason: `docs/phase-2-pr3b7.5-q26-q37-token-audit.md` already proved that the "VG Express 2-500 / VG Corporate above 500" fact is commercial/product-positioning knowledge. It does not appear in indexed Prudential `conditions_pdf` or `rate_table_pdf` content; the previous retrieval signal came from synthetic metadata headers, not a source clause. Therefore Q26 must not feed the concept stop signal.

## Next engineering target

Do not work issue #66 first; it is Zurich vs Bradesco and outside the current focus.

Recommended next cycle:

1. Audit Q16/Q17/Q22/Q25/Q29 source chunks and ground truths.
2. Improve single-insurer concept retrieval for explicit product names in focus5 only, preserving rate lookup behavior.
3. Re-run `questions_focus5.jsonl` CP/CR and compare against this baseline.
