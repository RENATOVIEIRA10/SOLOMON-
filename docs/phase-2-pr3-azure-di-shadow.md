# Phase 2 PR 3A - Azure DI F0 Probe

Status: F0 probe and evidence generator for PR 3A.

This PR is not the final chunker implementation.

## Decision Constraints

- Bradesco-first.
- Probe/evidence only.
- No shadow set in the database.
- No chunk indexing.
- No production read-path change.
- No DELETE.
- Do not touch `rate-lookup.ts`.
- Do not promote Azure DI chunks before partial Ragas before/after.
- Real shadow set comes in the next PR.

## Provisioning Gate

Provision Azure Document Intelligence F0 first and export credentials in `app/.env.local` or the shell:

```bash
AZURE_DI_ENDPOINT=https://<resource>.cognitiveservices.azure.com
AZURE_DI_KEY=<key>
```

Accepted aliases:

```bash
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=...
AZURE_DOCUMENT_INTELLIGENCE_KEY=...
```

The script uses the REST `prebuilt-layout` model with API version `2024-11-30` and `outputContentFormat=markdown`.

## F0 Limitation Probe

Run from `app/`:

```bash
npm run phase2:azure-di:shadow -- --dry-run
npm run phase2:azure-di:shadow
```

The default run tests the first Bradesco seed PDF with two probes:

- `pages=1-2`: should succeed on F0 if the resource is usable for short pilot inputs.
- `pages=1-3`: validates the real F0 behavior for PDFs beyond the documented first-two-page limitation.

Output goes to:

```text
docs/audit-runs/azure-di-shadow-<timestamp>/
```

Each run writes:

- `REPORT.md`
- raw Azure DI JSON per probe
- markdown content per successful probe

`REPORT.md` records the Azure endpoint in masked form and never records the key. Raw Azure DI JSON files are service results only; the script does not write request headers, keys, or environment variables.

## Approval Criteria

1. `npm run phase2:azure-di:shadow -- --dry-run` works without real credentials.
2. With F0 credentials, `pages=1-2` returns useful Markdown.
3. `pages=1-3` confirms the real F0 limit behavior.
4. `REPORT.md` shows the endpoint masked and never shows the key.
5. No JSON artifact contains secrets.
6. No runtime change in `/ask`, `/compare`, or `rate`.

## Promotion Rule

This PR is not an ingestion migration and does not create the actual shadow set. Treat generated files as evidence only.

Promotion requires a later PR that:

1. Defines the target shadow schema or staging table.
2. Runs partial Ragas before/after for the ratified gates.
3. Shows no regression in `rate_prudential` and `rate_mag`.
4. Explicitly switches production read path only after approval.
