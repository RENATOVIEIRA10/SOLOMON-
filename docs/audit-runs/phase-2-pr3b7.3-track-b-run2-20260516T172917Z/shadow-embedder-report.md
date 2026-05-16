# Phase 2 PR 3B.6.1 — shadow embedder report (live-write)

Generated: 2026-05-16T17:32:05.455Z

## Scope

- Prudential-only.
- Embeds ONLY rows where `metadata.shadow=true`, `metadata.hash_scheme=url-aware-v1`,
  `valid_until=1970-01-01T00:00:00Z`, and `embedding IS NULL`.
- No promotion. No DELETE. No read-path change. No new dependency.
- Embedding model: `text-embedding-3-small` (1536-dim).

## Inputs

- mode: `live-write`
- insurer: Prudential do Brasil (`dac17baa-c623-4023-9184-3ed2049a6237`)
- limit: (none)
- max-cost-usd: $5.00
- allow-cost-blast: no

## Preflights

| ok | check | detail |
|---|---|---|
| yes | documents.source_type CHECK includes conditions_pdf | supabase/migrations/20260422180000_baseline_snapshot.sql defines the constraint |
| yes | match_documents filters valid_until IS NULL (read path inert) | supabase/migrations/20260423180000_match_documents_exclude_rag_flagged.sql contains "valid_until IS NULL" |
| yes | answer.ts active-insurer probe filters valid_until null | src/services/rag/answer.ts calls .is('valid_until', null) |
| yes | embedder does not import or call match_documents | this CLI imports embedChunks + supabase-js only; no rag/ import. assertion is structural. |

## Pre-write counts

| metric | value |
|---|---:|
| shadow rows total | 1953 |
| shadow rows already embedded | 1035 |
| shadow rows eligible (embedding IS NULL) | 918 |
| **shadow leak baseline** (valid_until IS NULL AND shadow=true) | **0** |
| non-shadow Prudential rows with embedding (baseline) | 5620 |

## This run

| metric | value |
|---|---:|
| fetched eligible (capped by --limit) | 918 |
| embedded this run | 918 |
| skipped (would-overlap with --limit) | 0 |
| estimated tokens | 232839 |
| **estimated cost (USD, @ $0.02/1M tokens)** | **$0.0047** |

## Post-write probes

| probe | pre | post | Δ | expected |
|---|---:|---:|---:|---|
| shadow rows already embedded | 1035 | 1953 | 918 | == embedded this run (918) |
| **shadow leak** (active AND shadow=true) | 0 | 0 | 0 | **0 (MUST)** |
| **cross-set bleed** (non-shadow Prudential with embedding) | 5620 | 5620 | 0 | **0 (MUST)** |

## Guardrails honored

- Prudential-only insurer guard (assertPrudentialOnly).
- assertEmbeddingTargetIsShadow runs on every fetched row before UPDATE.
- UPDATE WHERE filters sentinel valid_until + hash_scheme + shadow=true + embedding IS NULL.
- Cost cap (USD); >$5 requires --allow-cost-blast.
- Idempotent: rows with embedding IS NOT NULL never re-enter the eligible set.
- No promotion (valid_until untouched).
- No DELETE. No read-path change. No edit of `match_documents`.