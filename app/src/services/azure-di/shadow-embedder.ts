/**
 * Azure DI shadow embedder — pure helpers.
 *
 * Phase 2 / PR 3B.6.1. Companion to {@link ./shadow-indexer.ts}.
 *
 * The CLI (`scripts/phase2/azure-di-shadow-embedder.ts`) reuses
 * {@link ../../embeddings/embedder}'s `embedChunks` so the shadow set
 * uses bit-identical embedding model + settings as production. This
 * module only contains the pure formatting / cost / shadow-filter
 * guard helpers — no I/O, no DB, no OpenAI client, no rate-limit
 * concerns.
 *
 * Hard contract (mirrors the design doc §3.1, enforced by the CLI):
 *   - Only `documents` rows whose `metadata.shadow = true`,
 *     `metadata.hash_scheme = 'url-aware-v1'`, and `valid_until =
 *     SHADOW_VALID_UNTIL_SENTINEL` may be embedded.
 *   - `embedding` is written ONLY when it was `null` (idempotent).
 *   - No DB row is INSERTed, no row is DELETEd, no other column is
 *     touched.
 *
 * The pure assertion {@link assertEmbeddingTargetIsShadow} is what
 * the CLI calls before issuing every UPDATE so a stray code path
 * cannot embed a prod row.
 */

import {
  SHADOW_ALLOWED_PARSERS,
  SHADOW_HASH_PREFIX,
  SHADOW_HASH_SCHEME,
  SHADOW_VALID_UNTIL_SENTINEL,
  type ShadowParser,
} from './shadow-indexer'

/** OpenAI embedding model the shared `embedChunks` helper uses. Tracked here for the report. */
export const EMBEDDING_MODEL = 'text-embedding-3-small' as const

/** Dimension of the `documents.embedding` pgvector column. */
export const EMBEDDING_DIMENSIONS = 1536 as const

/** OpenAI text-embedding-3-small list price as of 2026-05-16. Conservative. */
export const EMBEDDING_USD_PER_MILLION_TOKENS = 0.02 as const

/**
 * Conservative token-count estimate from raw character length.
 * OpenAI tokenizers average ~4 characters per token for English /
 * Portuguese policy text. Slight over-estimate is fine — this metric
 * feeds the cost cap, where erring high is safer than erring low.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 4)
}

/** Estimated USD cost for `totalTokens` embedded with {@link EMBEDDING_MODEL}. */
export function estimateCostUsd(totalTokens: number): number {
  return (totalTokens / 1_000_000) * EMBEDDING_USD_PER_MILLION_TOKENS
}

/**
 * Formats an embedding vector for the pgvector column.
 *   `[0.1, 0.2, 0.3]` → `"[0.1,0.2,0.3]"`
 * Mirrors {@link ../../embeddings/indexer}'s private helper exactly.
 */
export function formatEmbeddingVector(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Subset of a `documents` row sufficient for the embedder's pre-update
 * shadow-membership check. Kept narrow so future schema additions do
 * not force this guard to evolve.
 */
export interface EmbeddingTargetRow {
  id: string
  content: string
  content_hash: string
  valid_until: string | null
  embedding: string | null
  metadata: Record<string, unknown> | null
}

/**
 * Returns true iff two ISO-8601 strings represent the same instant.
 * The sentinel constant uses the Zulu suffix (`...Z`), but PostgREST
 * round-trips `timestamptz` values as `...+00:00`. Both parse to the
 * same `Date.getTime()`, and that is what the guard compares.
 */
function isSentinelInstant(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  const a = new Date(value).getTime()
  const b = new Date(SHADOW_VALID_UNTIL_SENTINEL).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return a === b
}

/**
 * Throws if `row` is anything other than a v4 Prudential shadow row
 * with `embedding IS NULL`. This is the last defensive gate before
 * the CLI issues an UPDATE.
 */
export function assertEmbeddingTargetIsShadow(row: EmbeddingTargetRow): void {
  if (row.embedding !== null && row.embedding !== undefined) {
    throw new Error(
      `row ${row.id} already has an embedding — idempotency would write twice`
    )
  }
  if (!isSentinelInstant(row.valid_until)) {
    throw new Error(
      `row ${row.id} has valid_until=${String(row.valid_until)} (expected sentinel ${SHADOW_VALID_UNTIL_SENTINEL}) — refusing to embed a non-shadow row`
    )
  }
  if (!row.content_hash.startsWith(SHADOW_HASH_PREFIX)) {
    throw new Error(
      `row ${row.id} content_hash "${row.content_hash.slice(0, 16)}…" missing prefix "${SHADOW_HASH_PREFIX}" — refusing`
    )
  }
  const meta = row.metadata
  if (!meta || meta.shadow !== true) {
    throw new Error(`row ${row.id} metadata.shadow !== true — refusing`)
  }
  if (meta.hash_scheme !== SHADOW_HASH_SCHEME) {
    throw new Error(
      `row ${row.id} metadata.hash_scheme=${String(meta.hash_scheme)} (expected ${SHADOW_HASH_SCHEME}) — refusing`
    )
  }
  if (!SHADOW_ALLOWED_PARSERS.includes(meta.parser as ShadowParser)) {
    throw new Error(
      `row ${row.id} metadata.parser=${String(meta.parser)} (expected one of ${SHADOW_ALLOWED_PARSERS.join(', ')}) — refusing`
    )
  }
  if (typeof row.content !== 'string' || row.content.length === 0) {
    throw new Error(`row ${row.id} content is empty — refusing to embed`)
  }
}

/**
 * Aggregates the cost-estimate numbers from a list of texts.
 * Pure; the CLI uses this for the dry-run report and the cost cap.
 */
export interface CostEstimate {
  rowCount: number
  totalTokens: number
  estimatedCostUsd: number
}

export function summarizeCost(texts: readonly string[]): CostEstimate {
  let totalTokens = 0
  for (const t of texts) totalTokens += estimateTokens(t)
  return {
    rowCount: texts.length,
    totalTokens,
    estimatedCostUsd: estimateCostUsd(totalTokens),
  }
}
