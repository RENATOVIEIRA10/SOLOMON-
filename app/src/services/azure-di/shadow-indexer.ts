/**
 * Azure DI Layout → shadow-set row builder.
 *
 * Pure function. Integrates the three earlier 3B slices into a single
 * pipeline:
 *
 *   3B.2 chunker         → SemanticChunk[]
 *   3B.4 product resolver → ProductResolution
 *   3B.3 quality gates    → accepted / quarantined chunks
 *   THIS slice            → TablesInsert<'documents'> rows tagged as shadow
 *
 * Phase 2 / PR 3B slice 3B.5.
 *
 * Output rows are inert by contract:
 *   - `valid_until` is a non-null sentinel (default
 *     {@link SHADOW_VALID_UNTIL_SENTINEL}) so the production read path's
 *     `WHERE valid_until IS NULL` filter — present in both `match_documents`
 *     SQL and the JS active-insurer probe (answer.ts:629) — skips them.
 *   - `content_hash` is prefixed `{@link SHADOW_HASH_PREFIX}` so it cannot
 *     collide with a prod row's hash on the `(content_hash, chunk_index)`
 *     unique constraint.
 *   - `metadata.shadow = true`, `metadata.parser = 'azure-di-layout-v3'`
 *     are stamped on every row so downstream auditors can identify the
 *     shadow set without joining other tables.
 *   - `embedding` is always `null`. This slice writes text only.
 *
 * Scope guardrails (mirrors PR #17 §1 + CEO check-in 2026-05-15):
 *   - No DB read, no DB write, no Azure DI call from this module.
 *   - No read-path import. No rate-lookup. No promotion.
 *   - The caller (the CLI) is responsible for fetching the catalog,
 *     refusing non-Prudential insurers, performing preflight checks,
 *     and upserting accepted rows.
 */

import { createHash } from 'node:crypto'

import type { Json, TablesInsert } from '@/types/database'

import {
  SEMANTIC_CHUNKER_PARSER,
  chunkLayoutResult,
  type ChunkerOptions,
  type SemanticChunk,
} from './chunker'
import {
  runChunkGates,
  type ChunkContext,
  type GateInput,
  type GateOptions,
  type GateReport,
} from './chunk-gate'
import {
  extractSusepCandidates,
  nameCandidateFromUrl,
  resolveProduct,
  type ProductCatalogRow,
  type ProductResolution,
} from './product-resolver'
import type { LayoutAnalyzeResult } from './types'

/**
 * Prefix stamped on every shadow-row `content_hash`.
 *
 * Version history:
 *   - `shadow-v3:` (initial 3B.5 release): hash was just the chunker's
 *     content-only sha256. Cross-PDF boilerplate at the SAME chunk_index
 *     collided on the `documents_content_hash_chunk_index_key` UNIQUE
 *     constraint, and upsert silently overwrote `source_url`. Discovered
 *     in the first --batch --limit 5 run: vida-inteira chunk_index=1 and
 *     seguro-temporario chunk_index=2 share hash `b7d79450…` for the
 *     boilerplate "Estas condições gerais compõem o contrato…".
 *   - `shadow-v4:` (this patch): the post-prefix hash mixes `sourceUrl`
 *     into the digest, so two PDFs never produce the same shadow
 *     content_hash for byte-identical chunks. See {@link
 *     computeShadowContentHash}.
 *
 * Existing v3 rows in production stay in place as inert orphans (the
 * contract is "no DELETE"). New runs write v4 rows; subsequent reruns
 * of the same PDF re-hit the same v4 (hash, chunk_index) tuple → upsert
 * UPDATE → idempotent.
 */
export const SHADOW_HASH_PREFIX = 'shadow-v4:' as const

/**
 * Stamp on `metadata.hash_scheme` so downstream auditors can tell v4
 * rows apart from v3 orphans without parsing the prefix.
 */
export const SHADOW_HASH_SCHEME = 'url-aware-v1' as const

/**
 * Hash function for shadow rows. URL-aware so two PDFs sharing
 * boilerplate at the same chunk_index do not collide on the GLOBAL
 * `(content_hash, chunk_index)` UNIQUE constraint.
 *
 * Idempotent for the SAME (sourceUrl, chunkHash) pair — re-running the
 * same PDF reproduces the same shadow hash bit-for-bit.
 */
export function computeShadowContentHash(
  sourceUrl: string,
  chunkContentHash: string
): string {
  return createHash('sha256').update(`${sourceUrl}::${chunkContentHash}`).digest('hex')
}

/**
 * Non-null sentinel written to `valid_until` on every shadow row. The
 * production read path filters `valid_until IS NULL`, so the sentinel is
 * what makes the row inert. Using a fixed, far-past timestamp (rather
 * than `now()`) keeps the row's identity stable across reruns and makes
 * "this is a shadow row" obvious in pgAdmin.
 */
export const SHADOW_VALID_UNTIL_SENTINEL = '1970-01-01T00:00:00Z' as const

/** Insurer-name substrings that the Prudential-only guard rejects. */
const NON_PRUDENTIAL_INSURER_KEYWORDS = ['azos', 'mag'] as const

/** Source-type written on every shadow row. */
export const SHADOW_SOURCE_TYPE = 'conditions_pdf' as const

/** Input to {@link buildShadowRows}. All required unless marked optional. */
export interface BuildShadowRowsInput {
  /** Raw Azure DI prebuilt-layout result. */
  layout: LayoutAnalyzeResult
  /** Resolved insurer id (uuid) for this PDF. */
  insurerId: string
  /** Canonical insurer name — checked against {@link BuildShadowRowsInput.assertInsurer}. */
  insurerName: string
  /** PDF source URL. Forwarded to every row. */
  sourceUrl: string
  /** Product catalog for this insurer, fetched by the caller. */
  productCatalog: readonly ProductCatalogRow[]
  /** Optional content-addressed PDF hash, forwarded to `documents.pdf_hash`. */
  pdfHash?: string
  /** Optional product-name hint (e.g. from the catalog row title). */
  productNameHint?: string
  /** Chunker overrides. Defaults inherit from slice 3B.2. */
  chunkerOptions?: ChunkerOptions
  /** Gate overrides. Defaults inherit from slice 3B.3. */
  gateOptions?: GateOptions
  /** Sentinel for `valid_until`. Defaults to {@link SHADOW_VALID_UNTIL_SENTINEL}. */
  validUntilSentinel?: string
  /** `content_hash` prefix. Defaults to {@link SHADOW_HASH_PREFIX}. */
  hashPrefix?: string
  /**
   * Optional page-span string (e.g. `"1-5"`) that the CLI passed to
   * Azure DI for this run. Stamped on `metadata.page_span` so future
   * audits can tell two coexisting v4 rows for the same URL apart by
   * the run that produced them. Optional and never affects inertness.
   */
  pageSpan?: string
  /**
   * Insurer-scope guard. Defaults to {@link assertPrudentialOnly}, so the
   * Azure DI path stays Prudential-only exactly as before. The OpenDataLoader
   * path injects its own allowlist (see `services/opendataloader/guard`).
   *
   * This governs SCOPE only — which insurer may be indexed. Inertness is still
   * enforced by {@link assertRowsAreInert} and the read-path leak probes, which
   * no caller can opt out of.
   */
  assertInsurer?: (insurerName: string) => void
}

/** Per-PDF summary returned alongside the rows. */
export interface BuildShadowRowsSummary {
  pageCount: number
  chunkCount: number
  acceptedCount: number
  quarantinedCount: number
  productId: string | null
  productName: string | null
  productUnresolved: boolean
}

/** Result of {@link buildShadowRows}. */
export interface BuildShadowRowsResult {
  /** Inert documents rows ready to upsert. Length == accepted chunk count. */
  rows: TablesInsert<'documents'>[]
  /** All chunks produced by the chunker (accepted + quarantined). */
  chunks: readonly SemanticChunk[]
  /** Gate report (per-gate tallies + quarantined chunks + reasons). */
  gateReport: GateReport
  /** Product resolution decision. */
  resolution: ProductResolution
  /** Headline counters for the CLI report. */
  summary: BuildShadowRowsSummary
}

/**
 * Raised when {@link assertPrudentialOnly} rejects an insurer name.
 * Carries the rejected name so callers can show it without re-parsing.
 */
export class ShadowIndexerGuardError extends Error {
  readonly insurerName: string
  constructor(insurerName: string) {
    super(
      `Shadow indexer is Prudential-only (PR 3B slice 3B.5). Refusing insurer "${insurerName}". Azos/MAG belong to Phase 2C — see issue #22.`
    )
    this.name = 'ShadowIndexerGuardError'
    this.insurerName = insurerName
  }
}

/**
 * Throws {@link ShadowIndexerGuardError} when `insurerName` contains a
 * non-Prudential keyword. Defense-in-depth: even if the CLI passes the
 * wrong insurer id, the pipeline still refuses.
 */
export function assertPrudentialOnly(insurerName: string): void {
  const normalized = insurerName.toLowerCase()
  for (const keyword of NON_PRUDENTIAL_INSURER_KEYWORDS) {
    if (normalized.includes(keyword)) {
      throw new ShadowIndexerGuardError(insurerName)
    }
  }
  if (!normalized.includes('prudential')) {
    throw new ShadowIndexerGuardError(insurerName)
  }
}

/**
 * Asserts that every row is inert (non-null sentinel `valid_until`,
 * `metadata.shadow=true`, prefixed `content_hash`, null embedding). Used
 * by the CLI immediately before upserting to make a "write that breaks
 * inertness" impossible without a code change.
 */
export function assertRowsAreInert(
  rows: ReadonlyArray<TablesInsert<'documents'>>,
  expectedPrefix: string = SHADOW_HASH_PREFIX
): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.valid_until === null || row.valid_until === undefined) {
      throw new Error(`shadow row[${i}] has null valid_until — would leak into the read path`)
    }
    if (row.embedding !== null && row.embedding !== undefined) {
      throw new Error(`shadow row[${i}] has non-null embedding — slice 3B.5 writes text only`)
    }
    if (!row.content_hash.startsWith(expectedPrefix)) {
      throw new Error(
        `shadow row[${i}] content_hash "${row.content_hash.slice(0, 16)}…" missing prefix "${expectedPrefix}"`
      )
    }
    const meta = row.metadata as Record<string, unknown> | null
    if (!meta || meta.shadow !== true) {
      throw new Error(`shadow row[${i}] metadata.shadow !== true`)
    }
    if (meta.parser !== SEMANTIC_CHUNKER_PARSER) {
      throw new Error(
        `shadow row[${i}] metadata.parser is "${String(meta.parser)}" (expected "${SEMANTIC_CHUNKER_PARSER}")`
      )
    }
    if (meta.hash_scheme !== SHADOW_HASH_SCHEME) {
      throw new Error(
        `shadow row[${i}] metadata.hash_scheme is "${String(meta.hash_scheme)}" (expected "${SHADOW_HASH_SCHEME}")`
      )
    }
    if (row.source_type !== SHADOW_SOURCE_TYPE) {
      throw new Error(
        `shadow row[${i}] source_type "${row.source_type}" violates the documents_source_type_check constraint`
      )
    }
  }
}

/**
 * Main entry point. Pure: no I/O, no side effects, never throws unless
 * `input.insurerName` violates the insurer-scope guard — Prudential-only by
 * default; see {@link BuildShadowRowsInput.assertInsurer}.
 */
export function buildShadowRows(input: BuildShadowRowsInput): BuildShadowRowsResult {
  const assertInsurer = input.assertInsurer ?? assertPrudentialOnly
  assertInsurer(input.insurerName)

  const resolution = resolveProduct(
    {
      sourceUrl: input.sourceUrl,
      productNameCandidates: collectNameCandidates(input),
      susepCandidates: extractSusepCandidates(input.sourceUrl),
    },
    input.productCatalog
  )

  const chunks = chunkLayoutResult(input.layout, input.chunkerOptions)

  const context: ChunkContext = {
    insurerId: input.insurerId,
    insurerName: input.insurerName,
    productId: resolution.productUnresolved ? undefined : resolution.productId,
    productName: resolution.productUnresolved ? undefined : resolution.productName,
    productUnresolved: resolution.productUnresolved || undefined,
    sourceType: SHADOW_SOURCE_TYPE,
  }
  const gateInputs: GateInput[] = chunks.map((chunk) => ({ chunk, context }))
  const gateReport = runChunkGates(gateInputs, input.gateOptions)

  const sentinel = input.validUntilSentinel ?? SHADOW_VALID_UNTIL_SENTINEL
  const hashPrefix = input.hashPrefix ?? SHADOW_HASH_PREFIX

  const rows = gateReport.accepted.map((chunk) =>
    toShadowRow(chunk, input, resolution, sentinel, hashPrefix)
  )

  return {
    rows,
    chunks,
    gateReport,
    resolution,
    summary: {
      pageCount: input.layout.pages?.length ?? 0,
      chunkCount: chunks.length,
      acceptedCount: gateReport.totals.accepted,
      quarantinedCount: gateReport.totals.quarantined,
      productId: resolution.productUnresolved ? null : resolution.productId ?? null,
      productName: resolution.productUnresolved ? null : resolution.productName ?? null,
      productUnresolved: resolution.productUnresolved,
    },
  }
}

function collectNameCandidates(input: BuildShadowRowsInput): string[] {
  const out: string[] = []
  if (input.productNameHint && input.productNameHint.trim().length > 0) {
    out.push(input.productNameHint.trim())
  }
  const fromUrl = nameCandidateFromUrl(input.sourceUrl)
  if (fromUrl && fromUrl.length > 0) out.push(fromUrl)
  return out
}

function toShadowRow(
  chunk: SemanticChunk,
  input: BuildShadowRowsInput,
  resolution: ProductResolution,
  sentinel: string,
  hashPrefix: string
): TablesInsert<'documents'> {
  const productId = resolution.productUnresolved ? null : resolution.productId ?? null
  const productName = resolution.productUnresolved ? null : resolution.productName ?? null
  const metadata: Record<string, unknown> = {
    ...chunk.metadata,
    shadow: true,
    parser: SEMANTIC_CHUNKER_PARSER,
    hash_scheme: SHADOW_HASH_SCHEME,
    page_span: input.pageSpan ?? null,
    insurer_id: input.insurerId,
    insurer_name: input.insurerName,
    product_id: productId,
    product_name: productName,
    product_unresolved: resolution.productUnresolved,
    product_resolution_strategy: resolution.strategy,
    product_resolution_confidence: resolution.confidence,
    product_resolution_reason: resolution.reason,
    source_url: input.sourceUrl,
  }
  return {
    insurer_id: input.insurerId,
    product_id: productId,
    source_type: SHADOW_SOURCE_TYPE,
    source_url: input.sourceUrl,
    chunk_index: chunk.metadata.chunk_index,
    content: chunk.content,
    content_hash: `${hashPrefix}${computeShadowContentHash(input.sourceUrl, chunk.content_hash)}`,
    pdf_hash: input.pdfHash ?? null,
    embedding: null,
    valid_until: sentinel,
    metadata: metadata as unknown as Json,
  }
}
