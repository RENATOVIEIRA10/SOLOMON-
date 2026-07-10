/**
 * Azure DI Layout → quality gates.
 *
 * Pure function. Takes the chunks emitted by {@link chunkLayoutResult}
 * (slice 3B.2) plus the resolution context that the indexer will add
 * (insurer, product, source_type), and routes each chunk to
 * **accepted** or **quarantined** by running the 8 gates from the
 * architecture doc (PR #15 §5):
 *
 *   G-content      meaningful content, not pure whitespace/chrome
 *   G-boundary     within the 300–1500-char chunk window
 *   G-page         real page number (>= 1)
 *   G-insurer      resolvable insurer (id or canonical name)
 *   G-product      product_id resolved, OR explicitly product_unresolved=true
 *                   (silent NULL fails)
 *   G-confidence   mean word confidence at or above the configured floor
 *                   (undefined confidence passes — no word data ≠ bad)
 *   G-type         source_type is one of the allowed values for this run
 *   G-dedup        content_hash not already accepted in this batch
 *
 * Decision rule for under-300 chunks (CEO check-in 2026-05-15):
 *   - Same-section merging already happened in the chunker (3B.2).
 *   - Surviving under-300 chunks are genuinely orphan / chrome.
 *   - They are **quarantined**, never silently dropped, never force-merged
 *     across sections (that would mix unrelated clauses — the exact
 *     defect Phase 2 exists to fix), never allow-tail'd into the index
 *     (the 300-char floor is part of the chunk contract).
 *   - Quarantined chunks carry their failed-gate reasons so a reviewer
 *     can recover real content later.
 *
 * Phase 2 / PR 3B slice 3B.3.
 * Scope guardrails: pure function, no DB write, no read-path import,
 * no indexer call, no rate-lookup, no promotion, no insurer logic
 * beyond the context the caller passes in.
 */

import type { SemanticChunk } from './chunker'

/** The 8 gates by stable ID. */
export type GateId =
  | 'G-content'
  | 'G-boundary'
  | 'G-page'
  | 'G-insurer'
  | 'G-product'
  | 'G-confidence'
  | 'G-type'
  | 'G-dedup'

/** All gate IDs in canonical evaluation order (also the report column order). */
export const GATE_IDS: readonly GateId[] = [
  'G-content',
  'G-boundary',
  'G-page',
  'G-insurer',
  'G-product',
  'G-confidence',
  'G-type',
  'G-dedup',
] as const

/**
 * Resolution context for a chunk. Populated by the upstream pipeline
 * (insurer resolver at ingestion, product resolver at slice 3B.4) and
 * carried into the gate so G-insurer/G-product/G-type can check it.
 */
export interface ChunkContext {
  insurerId?: string
  insurerName?: string
  productId?: string
  productName?: string
  /** Set when the product resolver could not match — required when productId is absent. */
  productUnresolved?: boolean
  sourceType?: string
}

/** Input to {@link runChunkGates}: a chunk paired with its context. */
export interface GateInput {
  chunk: SemanticChunk
  context: ChunkContext
}

/** Options with sensible defaults; every key is optional. */
export interface GateOptions {
  /** Default 300. Chunks under this fail G-boundary. */
  minChunkChars?: number
  /** Default 1500. Chunks above this fail G-boundary. */
  maxChunkChars?: number
  /** Default 5. Trim-length below this fails G-content (pure chrome). */
  contentTrivialChars?: number
  /** Default 0.85. Mean confidence below this fails G-confidence. */
  minConfidence?: number
  /** Allowed `source_type` values. Default `['conditions_pdf']`. */
  allowedSourceTypes?: readonly string[]
  /**
   * Treat `has_table` chunks as atomic units.
   *
   * The chunker never merges a table with a neighbour, and never splits one —
   * both would destroy the grid. So the prose char-window (`minChunkChars` /
   * `maxChunkChars`) does not describe a legitimate table: a 234-char carência
   * table and a 1733-char age-reajuste table are both correct, and both would
   * otherwise be quarantined.
   *
   * When true, G-boundary skips the prose window for tables and applies
   * {@link GateOptions.maxTableChars} instead. Text chunks are unaffected.
   *
   * Default false, so the Azure DI path keeps its current behaviour.
   */
  tablesAreAtomic?: boolean
  /** Sanity ceiling for atomic table chunks. Default 8000. */
  maxTableChars?: number
}

const DEFAULTS = {
  minChunkChars: 300,
  maxChunkChars: 1500,
  contentTrivialChars: 5,
  minConfidence: 0.85,
  allowedSourceTypes: ['conditions_pdf'] as readonly string[],
  tablesAreAtomic: false,
  maxTableChars: 8000,
}

/** Why a chunk failed a specific gate. */
export interface GateFailure {
  gate: GateId
  message: string
}

/** A chunk that did not pass all gates, with reasons. */
export interface QuarantinedChunk {
  chunk: SemanticChunk
  context: ChunkContext
  reasons: GateFailure[]
}

/** Per-gate pass/fail tallies. */
export type GateTallies = Record<GateId, { passed: number; failed: number }>

/** Full result of running the gates over a batch. */
export interface GateReport {
  accepted: SemanticChunk[]
  quarantined: QuarantinedChunk[]
  totals: {
    input: number
    accepted: number
    quarantined: number
  }
  byGate: GateTallies
}

interface ResolvedOptions {
  minChunkChars: number
  maxChunkChars: number
  contentTrivialChars: number
  minConfidence: number
  allowedSourceTypes: readonly string[]
  tablesAreAtomic: boolean
  maxTableChars: number
}

function resolveOptions(options: GateOptions = {}): ResolvedOptions {
  return {
    minChunkChars: options.minChunkChars ?? DEFAULTS.minChunkChars,
    maxChunkChars: options.maxChunkChars ?? DEFAULTS.maxChunkChars,
    contentTrivialChars: options.contentTrivialChars ?? DEFAULTS.contentTrivialChars,
    minConfidence: options.minConfidence ?? DEFAULTS.minConfidence,
    allowedSourceTypes: options.allowedSourceTypes ?? DEFAULTS.allowedSourceTypes,
    tablesAreAtomic: options.tablesAreAtomic ?? DEFAULTS.tablesAreAtomic,
    maxTableChars: options.maxTableChars ?? DEFAULTS.maxTableChars,
  }
}

function emptyTallies(): GateTallies {
  const out = {} as GateTallies
  for (const id of GATE_IDS) out[id] = { passed: 0, failed: 0 }
  return out
}

// --- individual gates (pure, return null on pass / message on fail) ---

export function checkContent(chunk: SemanticChunk, opts: ResolvedOptions): string | null {
  const trimmed = chunk.content.trim()
  if (trimmed.length === 0) return 'content is empty after trim'
  if (trimmed.length < opts.contentTrivialChars) {
    return `content has only ${trimmed.length} non-whitespace chars (trivial chrome)`
  }
  return null
}

export function checkBoundary(chunk: SemanticChunk, opts: ResolvedOptions): string | null {
  const len = chunk.content.length
  if (opts.tablesAreAtomic && chunk.metadata.has_table) {
    // A table is one semantic unit. The chunker neither merges nor splits it,
    // so the prose window says nothing useful here — only guard absurd sizes.
    if (len > opts.maxTableChars) {
      return `table chunk ${len} chars > maxTableChars ${opts.maxTableChars}`
    }
    return null
  }
  if (len < opts.minChunkChars) {
    return `chunk ${len} chars < minChunkChars ${opts.minChunkChars} (quarantine; merge already attempted upstream)`
  }
  if (len > opts.maxChunkChars) {
    return `chunk ${len} chars > maxChunkChars ${opts.maxChunkChars} (chunker should have split this)`
  }
  return null
}

export function checkPage(chunk: SemanticChunk): string | null {
  if (!Number.isInteger(chunk.metadata.page) || chunk.metadata.page < 1) {
    return `page is ${chunk.metadata.page} (must be a real 1-based page number)`
  }
  return null
}

export function checkInsurer(context: ChunkContext): string | null {
  const id = (context.insurerId ?? '').trim()
  const name = (context.insurerName ?? '').trim()
  if (id.length > 0 || name.length > 0) return null
  return 'insurer is unresolved (neither insurerId nor insurerName set)'
}

export function checkProduct(context: ChunkContext): string | null {
  const id = (context.productId ?? '').trim()
  if (id.length > 0) return null
  if (context.productUnresolved === true) return null
  return 'product is silently NULL — set productId or mark productUnresolved=true'
}

export function checkConfidence(
  chunk: SemanticChunk,
  opts: ResolvedOptions
): string | null {
  const conf = chunk.metadata.confidence
  if (conf === undefined) return null
  if (conf < opts.minConfidence) {
    return `confidence ${conf.toFixed(3)} < minConfidence ${opts.minConfidence}`
  }
  return null
}

export function checkType(
  context: ChunkContext,
  opts: ResolvedOptions
): string | null {
  const t = context.sourceType
  if (!t) return 'source_type is not set'
  if (!opts.allowedSourceTypes.includes(t)) {
    return `source_type "${t}" is not in allowedSourceTypes [${opts.allowedSourceTypes.join(', ')}]`
  }
  return null
}

/**
 * Pure check: reports duplicate iff the hash is already in `seen`.
 * The caller mutates `seen` only for ultimately accepted chunks
 * (see {@link runChunkGates}) so a chunk that fails another gate
 * does not poison dedup for legitimate later twins.
 */
export function checkDedup(chunk: SemanticChunk, seen: ReadonlySet<string>): string | null {
  if (seen.has(chunk.content_hash)) {
    return `content_hash ${chunk.content_hash.slice(0, 12)} already accepted in this batch`
  }
  return null
}

// --- batch runner ---

/**
 * Runs all 8 gates over a batch of chunks + context. Returns a
 * {@link GateReport} with separate `accepted` and `quarantined` streams
 * and per-gate tallies. Pure: mutates no input.
 */
export function runChunkGates(
  inputs: readonly GateInput[],
  options: GateOptions = {}
): GateReport {
  const opts = resolveOptions(options)
  const seenAcceptedHashes = new Set<string>()
  const accepted: SemanticChunk[] = []
  const quarantined: QuarantinedChunk[] = []
  const byGate = emptyTallies()

  for (const input of inputs) {
    const failures: GateFailure[] = []

    const record = (gate: GateId, message: string | null): void => {
      if (message === null) {
        byGate[gate].passed += 1
      } else {
        byGate[gate].failed += 1
        failures.push({ gate, message })
      }
    }

    record('G-content', checkContent(input.chunk, opts))
    record('G-boundary', checkBoundary(input.chunk, opts))
    record('G-page', checkPage(input.chunk))
    record('G-insurer', checkInsurer(input.context))
    record('G-product', checkProduct(input.context))
    record('G-confidence', checkConfidence(input.chunk, opts))
    record('G-type', checkType(input.context, opts))
    record('G-dedup', checkDedup(input.chunk, seenAcceptedHashes))

    if (failures.length === 0) {
      accepted.push(input.chunk)
      seenAcceptedHashes.add(input.chunk.content_hash)
    } else {
      quarantined.push({ chunk: input.chunk, context: input.context, reasons: failures })
    }
  }

  return {
    accepted,
    quarantined,
    totals: {
      input: inputs.length,
      accepted: accepted.length,
      quarantined: quarantined.length,
    },
    byGate,
  }
}

/**
 * Renders a short human-readable summary of a {@link GateReport}.
 * Useful for CLI output / commit messages / PR descriptions; the
 * structured report is the source of truth.
 */
export function formatGateReport(report: GateReport): string {
  const lines: string[] = []
  lines.push(
    `chunks: ${report.totals.input} in → ${report.totals.accepted} accepted, ${report.totals.quarantined} quarantined`
  )
  for (const id of GATE_IDS) {
    const t = report.byGate[id]
    lines.push(`  ${id.padEnd(13)} pass ${t.passed} · fail ${t.failed}`)
  }
  if (report.quarantined.length > 0) {
    lines.push('quarantined reasons:')
    for (const q of report.quarantined) {
      const reasonStr = q.reasons.map((r) => r.gate).join(',')
      lines.push(
        `  chunk ${q.chunk.metadata.chunk_index} (page ${q.chunk.metadata.page}, ${q.chunk.content.length} chars): ${reasonStr}`
      )
    }
  }
  return lines.join('\n')
}
