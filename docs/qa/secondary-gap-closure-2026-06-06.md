# Secondary gap closure - 2026-06-06

## Closed

- Global lint reduced from 25 errors and 11 warnings to zero.
- Prudential missing embeddings reduced from 29 to zero.
- RAG readiness now reports 100% embedding coverage for all five audited
  insurers.

## SFT progress

- Approved examples increased from 6 to 16 using only examples with explicit
  prior review by Julio.
- The dataset builder now writes a deterministic review queue and reports the
  actual content deficit.
- Current state:
  - 16 approved examples.
  - 17 review candidates.
  - 13 examples requiring specialist review.
  - 67 new examples still required even if every current candidate is approved.

The 100-example training gate remains intentionally blocked. Reaching it now
requires domain review and new ground-truth authoring; lowering the threshold
or auto-approving unreviewed facts would weaken the quality gate.

## Validation

- `npm run lint`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- `npm run pageindex:qa -- --skip-api`
- `npm run rag:readiness`
- `npm run phase2:corpus-routing:test`
- `npm run phase2:retrieval-trace:test`
- `npm run e2e:operational` - 16/16 passed
- `npm run sft:dataset` - blocked as designed at 16/100
