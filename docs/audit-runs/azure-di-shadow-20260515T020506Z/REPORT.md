# Phase 2 PR 3A - Azure DI F0 Probe

Generated: 2026-05-15T02:05:20.301Z

Scope: Bradesco-first Azure DI F0 validation. No DB write. Production read path untouched.

## PR Boundary

- This PR does not create a shadow set in the database.
- This PR does not index chunks.
- This PR only validates Azure DI F0 behavior and generates evidence.
- The real shadow set comes in the next PR.

## Azure Resource

- Endpoint: https://***.cognitiveservices.azure.com
- API version: 2024-11-30
- Key: not recorded

## Documents

| Insurer | Product | URL |
|---|---|---|
| Bradesco Seguros | Vida Viva | https://www.bradescoseguros.com.br/wcm/connect/27d3efc8-319b-48d5-ba61-0269f0d6a5a2/Condi%C3%A7%C3%B5es_Gerais_Vida_Viva_Corretor_Maio24.pdf?MOD=AJPERES |

## F0 Interpretation

- Vida Viva: F0_LIMIT_NOT_OBSERVED: pages 1-3 returned 3 pages. Resource may not be F0, or the service behavior differs from the documented F0 PDF/TIFF limit.

## Probe Results

| Product | Probe | Pages | OK | HTTP | Error | Elapsed ms | Page count | Chars | Paragraphs | Tables | Sections | Headings |
|---|---|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Vida Viva | f0-pages-1-2 | 1-2 | yes |  |  | 6976 | 2 | 996 | 27 | 0 | 6 | 4 |
| Vida Viva | f0-pages-1-3 | 1-3 | yes |  |  | 6814 | 3 | 2082 | 52 | 0 | 7 | 5 |

## Output Files

### Vida Viva
- f0-pages-1-2: vida-viva-f0-pages-1-2.json
- f0-pages-1-2: vida-viva-f0-pages-1-2.md
- f0-pages-1-3: vida-viva-f0-pages-1-3.json
- f0-pages-1-3: vida-viva-f0-pages-1-3.md

## Guardrails

- Probe artifact only; do not insert into `documents` from this run.
- Do not use this probe output as a chunker implementation.
- Keep `rate-lookup.ts` and production `/api/ask` / `/api/compare` read paths unchanged.
- Run partial Ragas before/after before promoting any Azure DI chunks.