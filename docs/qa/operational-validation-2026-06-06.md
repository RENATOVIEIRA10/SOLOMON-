# Operational validation - 2026-06-06

Target: `https://app-atalaia.vercel.app`

## Passed gates

- Operational Playwright E2E: 16/16 passed.
- Public availability: landing, login, and signup.
- Unauthenticated page protection: 8/8 protected pages redirect to login.
- Unauthenticated API protection: 5/5 sensitive APIs return HTTP 401.
- TypeScript: `npx tsc --noEmit --pretty false`.
- Focused ESLint for the changed E2E and routing-test files.
- Production build: `npm run build`.
- PageIndex Lite QA: passed with `--skip-api`.
- RAG readiness: all five insurer checks passed.
- Existing Phase 2 tests: all passed after updating one stale source-wiring assertion.

## Concrete gaps

1. Authenticated critical flows are not covered by E2E because no dedicated test
   broker credentials or isolated test data lifecycle exists.
2. Global `npm run lint` fails with 25 errors and 11 warnings. The errors are
   existing debt concentrated in CommonJS scripts and explicit `any` usage.
3. The SFT dataset is not training-ready: 6 approved examples against a minimum
   of 100.
4. Prudential has 29 documents without embeddings, for 99.62% embedding
   coverage.
5. The operational suite currently validates Chromium only; cross-browser and
   mobile coverage are not configured.

## Automation added

- `npm run e2e:operational`
- Daily GitHub Actions schedule plus manual execution with an overridable base
  URL.
- Playwright HTML report, trace, and failure screenshots retained as CI
  artifacts.
- The first three CI runs exposed browser-download timeouts from the Playwright
  CDN. CI now uses the Google Chrome already installed on `ubuntu-latest`;
  local runs continue to use Playwright-managed Chromium.
