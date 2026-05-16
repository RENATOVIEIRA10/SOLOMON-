/**
 * Azure DI shadow indexer — batch-mode pure helpers.
 *
 * Slice 3B.5 (CLI patch). The shadow-row contract lives in
 * {@link ./shadow-indexer}; this module only adds the pure data shapes
 * + classification + aggregation the batch CLI uses to summarize many
 * single-doc runs.
 *
 * No I/O. No DB. No Azure DI. No read-path import.
 */

/** Estimated Azure DI Layout (S0 tier) unit cost, USD per page. */
export const AZURE_DI_LAYOUT_S0_USD_PER_PAGE_ESTIMATE = 0.015 as const

/** One URL the batch discovered in Supabase. */
export interface ManifestEntry {
  source_url: string
  /** Count of active legacy `conditions_pdf` rows for this URL. */
  legacy_chunk_count: number
}

/**
 * Per-doc lifecycle status. Disjoint set: a doc lands in exactly one.
 *
 * Success (write happened, no leak):
 *   FRESH            pre=0, post=accepted
 *   IDEMPOTENT_HIT   pre=accepted, post=accepted
 *   OVERWRITE        0<pre<accepted, post=accepted
 *   ORPHAN_SUPERSET  post>accepted, leak=0
 *                    (this run's accepted rows are in DB AND extra
 *                    inert rows from prior runs at a different page
 *                    span persist alongside them. Benign — they have
 *                    sentinel valid_until and never reach the read
 *                    path. Reported as telemetry, not a stop signal.)
 *
 * Short-circuit (no write attempted):
 *   PLANNED          dry-run
 *   SKIPPED_RESUME   --resume found pre>0
 *   PIPELINE_ONLY    --live without --write
 *
 * Failure (hard stop):
 *   AZURE_ERROR      pipeline failed during analyze/build
 *   WRITE_ERROR      post<accepted, OR leak>0, OR upsert/probe threw
 */
export type DocStatus =
  | 'PLANNED'
  | 'SKIPPED_RESUME'
  | 'PIPELINE_ONLY'
  | 'FRESH'
  | 'IDEMPOTENT_HIT'
  | 'OVERWRITE'
  | 'ORPHAN_SUPERSET'
  | 'AZURE_ERROR'
  | 'WRITE_ERROR'

/** Per-doc record persisted in the batch report. */
export interface DocResult {
  sourceUrl: string
  legacyChunkCount: number
  status: DocStatus
  pages?: number
  chunks?: number
  accepted?: number
  quarantined?: number
  /** `true` when the product resolver matched; `false` when unresolved. `undefined` when pipeline didn't run. */
  resolved?: boolean
  productId?: string | null
  productName?: string | null
  unresolvedReason?: string
  /** Shadow rows already at sentinel before this run upserted. */
  preShadowCount?: number
  /** Shadow rows at sentinel after this run upserted. */
  upsertedCount?: number
  /**
   * `max(0, post - accepted)` — inert shadow rows alive for this URL
   * beyond what this run produced. Non-zero when prior runs at a
   * different `--max-pages` left v4 rows whose `chunk_index` we did
   * not revisit. Benign: rows are still at sentinel `valid_until`.
   * Surfaced for auditability.
   */
  extraInertShadowRows?: number
  /** `metadata.shadow=true` AND `valid_until IS NULL` — MUST be 0. */
  shadowLeak?: number
  /** `valid_until IS NULL` minus shadow leak — pre-existing legacy prod rows. */
  activeLegacyProd?: number
  errorMessage?: string
}

/** Rolled-up batch counters for the aggregate table. */
export interface BatchAggregate {
  docsPlanned: number
  docsSkippedResume: number
  docsRan: number
  docsFresh: number
  docsIdempotent: number
  docsOverwrite: number
  /** docs whose write was clean but DB has extra inert v4 rows beyond accepted. Benign. */
  docsOrphanSuperset: number
  docsAzureError: number
  docsWriteError: number
  docsUnresolved: number
  totalPages: number
  totalChunks: number
  totalAccepted: number
  totalQuarantined: number
  totalShadowUpserted: number
  totalShadowLeaks: number
  /** Sum of `extraInertShadowRows` across all docs — telemetry, never a hard stop. */
  totalExtraInertShadow: number
  estimatedCostUsd: number
}

/**
 * Classifies the outcome of a single --write run. Pure.
 *
 *   leak > 0                          → WRITE_ERROR (catastrophic)
 *   post < accepted                   → WRITE_ERROR (some rows didn't land)
 *   post > accepted, leak == 0        → ORPHAN_SUPERSET (benign telemetry:
 *                                       this run's rows are all in DB
 *                                       plus extra inert orphans from a
 *                                       prior run at a different page span)
 *   post == accepted, pre == 0        → FRESH
 *   post == accepted, pre == accepted → IDEMPOTENT_HIT
 *   post == accepted, 0 < pre < accepted → OVERWRITE
 */
export function classifyWriteStatus(
  preShadowCount: number,
  acceptedCount: number,
  postShadowCount: number,
  shadowLeakCount: number = 0
): DocStatus {
  if (shadowLeakCount > 0) return 'WRITE_ERROR'
  if (postShadowCount < acceptedCount) return 'WRITE_ERROR'
  if (postShadowCount > acceptedCount) return 'ORPHAN_SUPERSET'
  // post === accepted
  if (preShadowCount === 0) return 'FRESH'
  if (preShadowCount === acceptedCount) return 'IDEMPOTENT_HIT'
  return 'OVERWRITE'
}

/** Returns a zero-initialized {@link BatchAggregate}. */
export function emptyAggregate(): BatchAggregate {
  return {
    docsPlanned: 0,
    docsSkippedResume: 0,
    docsRan: 0,
    docsFresh: 0,
    docsIdempotent: 0,
    docsOverwrite: 0,
    docsOrphanSuperset: 0,
    docsAzureError: 0,
    docsWriteError: 0,
    docsUnresolved: 0,
    totalPages: 0,
    totalChunks: 0,
    totalAccepted: 0,
    totalQuarantined: 0,
    totalShadowUpserted: 0,
    totalShadowLeaks: 0,
    totalExtraInertShadow: 0,
    estimatedCostUsd: 0,
  }
}

/**
 * Tallies a list of {@link DocResult}s into a {@link BatchAggregate}.
 * Status categories are disjoint (a doc lands in exactly one).
 * `docsRan` counts everything except SKIPPED_RESUME and PLANNED.
 */
export function tallyAggregate(results: readonly DocResult[]): BatchAggregate {
  const agg = emptyAggregate()
  agg.docsPlanned = results.length
  for (const r of results) {
    switch (r.status) {
      case 'SKIPPED_RESUME':
        agg.docsSkippedResume += 1
        break
      case 'PLANNED':
        // dry-run placeholder — not counted as "ran"
        break
      default:
        agg.docsRan += 1
        break
    }
    if (r.status === 'FRESH') agg.docsFresh += 1
    if (r.status === 'IDEMPOTENT_HIT') agg.docsIdempotent += 1
    if (r.status === 'OVERWRITE') agg.docsOverwrite += 1
    if (r.status === 'ORPHAN_SUPERSET') agg.docsOrphanSuperset += 1
    if (r.status === 'AZURE_ERROR') agg.docsAzureError += 1
    if (r.status === 'WRITE_ERROR') agg.docsWriteError += 1
    if (r.resolved === false) agg.docsUnresolved += 1
    if (r.pages !== undefined) agg.totalPages += r.pages
    if (r.chunks !== undefined) agg.totalChunks += r.chunks
    if (r.extraInertShadowRows !== undefined) agg.totalExtraInertShadow += r.extraInertShadowRows
    if (r.accepted !== undefined) agg.totalAccepted += r.accepted
    if (r.quarantined !== undefined) agg.totalQuarantined += r.quarantined
    if (r.upsertedCount !== undefined) agg.totalShadowUpserted += r.upsertedCount
    if (r.shadowLeak !== undefined) agg.totalShadowLeaks += r.shadowLeak
  }
  agg.estimatedCostUsd =
    Math.round(agg.totalPages * AZURE_DI_LAYOUT_S0_USD_PER_PAGE_ESTIMATE * 100) / 100
  return agg
}

/** Result of the final `match_documents` RPC sanity probe. */
export interface FinalReadPathProbe {
  totalReturned: number
  shadowReturned: number
  nonNullValidUntilReturned: number
  threshold: number
  topK: number
  /** Set when the probe could not run (no active embedding, RPC error, …). */
  skipped?: string
}

/** Holds the data the batch report renderer needs. */
export interface BatchRenderInput {
  generatedAt: string
  mode: 'dry-run' | 'live' | 'live-write'
  insurer: { id: string; name: string }
  catalogSize: number
  preflights: ReadonlyArray<{ ok: boolean; label: string; detail: string }>
  endpointMasked: string
  pageSpan: string
  minChunks: number
  limit?: number
  resume: boolean
  manifest: readonly ManifestEntry[]
  results: readonly DocResult[]
  aggregate: BatchAggregate
  finalProbe?: FinalReadPathProbe
}

const MAX_URL_LEN_IN_TABLE = 80

function shortenUrl(url: string): string {
  if (url.length <= MAX_URL_LEN_IN_TABLE) return url
  return '…' + url.slice(-(MAX_URL_LEN_IN_TABLE - 1))
}

/**
 * Renders the batch report markdown. Pure: no I/O, no clock reads.
 */
export function renderBatchReport(args: BatchRenderInput): string {
  const lines: string[] = []
  lines.push(`# Phase 2 PR 3B slice 3B.5 — shadow-indexer batch report (${args.mode})`)
  lines.push('')
  lines.push(`Generated: ${args.generatedAt}`)
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push('- Batch mode. Prudential-only auto-discovery from Supabase.')
  lines.push('- Per-doc inertness contract identical to single-URL mode.')
  lines.push('- No embeddings. No DELETE. No read-path change. No product mutation.')
  lines.push('')
  lines.push('## Inputs')
  lines.push('')
  lines.push(`- mode: \`${args.mode}\``)
  lines.push(`- insurer: ${args.insurer.name} (\`${args.insurer.id}\`)`)
  lines.push(`- catalog size: ${args.catalogSize}`)
  lines.push(`- min-chunks filter: ${args.minChunks}`)
  lines.push(`- limit: ${args.limit ?? '(none)'}`)
  lines.push(`- resume: ${args.resume ? 'yes' : 'no'}`)
  lines.push(`- page span per doc: \`${args.pageSpan}\``)
  lines.push(`- Azure DI endpoint: ${args.endpointMasked}`)
  lines.push('')
  lines.push('## Preflights')
  lines.push('')
  lines.push('| ok | check | detail |')
  lines.push('|---|---|---|')
  for (const p of args.preflights) {
    lines.push(`| ${p.ok ? 'yes' : 'NO'} | ${p.label} | ${p.detail.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')

  lines.push('## Manifest')
  lines.push('')
  lines.push(
    `Discovered ${args.manifest.length} Prudential URL(s) with active \`conditions_pdf\` chunks >= ${args.minChunks}.`
  )
  if (args.limit !== undefined) {
    lines.push(`Limited to first ${args.limit} after sort by legacy-chunk count desc.`)
  }
  lines.push('')

  lines.push('## Per-doc results')
  lines.push('')
  lines.push(
    '| # | source_url | legacy chunks | pages | chunks | accepted_current_run | quarantined | product | v4_sentinel_rows_for_url | extra_inert | leak | active legacy | status |'
  )
  lines.push('|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|')
  args.results.forEach((r, i) => {
    const product =
      r.resolved === undefined
        ? '-'
        : r.resolved
          ? r.productName ?? '?'
          : `_unresolved (${r.unresolvedReason ?? '?'})_`
    lines.push(
      `| ${i + 1} | \`${shortenUrl(r.sourceUrl)}\` | ${r.legacyChunkCount} | ${r.pages ?? '-'} | ${r.chunks ?? '-'} | ${r.accepted ?? '-'} | ${r.quarantined ?? '-'} | ${product} | ${r.upsertedCount ?? '-'} | ${r.extraInertShadowRows ?? '-'} | ${r.shadowLeak ?? '-'} | ${r.activeLegacyProd ?? '-'} | ${r.status} |`
    )
  })
  lines.push('')
  const orphanSupersets = args.results.filter((r) => r.status === 'ORPHAN_SUPERSET')
  if (orphanSupersets.length > 0) {
    lines.push('### ORPHAN_SUPERSET notes')
    lines.push('')
    lines.push(
      '> Benign: this run\'s accepted rows are in DB; DB also has extra inert v4 rows from'
    )
    lines.push(
      "> a prior run at a different `--max-pages`. The chunker's `chunk_index` depends on"
    )
    lines.push(
      '> the Azure DI layout, which changes with page span — so the same text can land at'
    )
    lines.push(
      '> different chunk_indices across runs, producing distinct `(content_hash,'
    )
    lines.push(
      '> chunk_index)` tuples that all coexist. All rows are at sentinel `valid_until`'
    )
    lines.push(
      '> and never reach the read path. Not a stop signal. `metadata.page_span` on each'
    )
    lines.push('> row tells you which run produced it.')
    lines.push('')
    for (const r of orphanSupersets) {
      lines.push(
        `- \`${r.sourceUrl}\` -- accepted=${r.accepted}, v4_sentinel_rows_for_url=${r.upsertedCount}, extra_inert=${r.extraInertShadowRows}`
      )
    }
    lines.push('')
  }

  const errored = args.results.filter((r) => r.errorMessage)
  if (errored.length > 0) {
    lines.push('### Errors')
    lines.push('')
    for (const r of errored) {
      lines.push(`- **${r.status}** \`${r.sourceUrl}\`: ${r.errorMessage}`)
    }
    lines.push('')
  }

  lines.push('## Aggregate')
  lines.push('')
  lines.push('| metric | value |')
  lines.push('|---|---:|')
  lines.push(`| docs planned | ${args.aggregate.docsPlanned} |`)
  lines.push(`| docs skipped (resume) | ${args.aggregate.docsSkippedResume} |`)
  lines.push(`| docs ran | ${args.aggregate.docsRan} |`)
  lines.push(`| docs FRESH (pre=0) | ${args.aggregate.docsFresh} |`)
  lines.push(`| docs IDEMPOTENT_HIT | ${args.aggregate.docsIdempotent} |`)
  lines.push(`| docs OVERWRITE | ${args.aggregate.docsOverwrite} |`)
  lines.push(`| docs ORPHAN_SUPERSET (benign) | ${args.aggregate.docsOrphanSuperset} |`)
  lines.push(`| docs AZURE_ERROR | ${args.aggregate.docsAzureError} |`)
  lines.push(`| docs WRITE_ERROR | ${args.aggregate.docsWriteError} |`)
  lines.push(`| docs unresolved | ${args.aggregate.docsUnresolved} |`)
  lines.push(`| total pages (Azure) | ${args.aggregate.totalPages} |`)
  lines.push(`| total chunks | ${args.aggregate.totalChunks} |`)
  lines.push(`| total accepted | ${args.aggregate.totalAccepted} |`)
  lines.push(`| total quarantined | ${args.aggregate.totalQuarantined} |`)
  lines.push(`| total v4 shadow rows upserted | ${args.aggregate.totalShadowUpserted} |`)
  lines.push(`| total extra inert shadow (benign) | ${args.aggregate.totalExtraInertShadow} |`)
  lines.push(`| **total shadow leaks** | **${args.aggregate.totalShadowLeaks}** |`)
  lines.push(
    `| estimated Azure cost (USD, @ $${AZURE_DI_LAYOUT_S0_USD_PER_PAGE_ESTIMATE}/page) | $${args.aggregate.estimatedCostUsd.toFixed(2)} |`
  )
  lines.push('')

  if (args.finalProbe) {
    lines.push('## Final read-path probe (`match_documents` RPC)')
    lines.push('')
    if (args.finalProbe.skipped) {
      lines.push(`> Probe skipped: ${args.finalProbe.skipped}`)
    } else {
      lines.push(
        `- threshold=${args.finalProbe.threshold}, top_k=${args.finalProbe.topK}, rows returned=${args.finalProbe.totalReturned}`
      )
      lines.push(
        `- rows with \`metadata.shadow=true\`: **${args.finalProbe.shadowReturned}** (MUST be 0)`
      )
      lines.push(
        `- rows with non-null \`valid_until\`: **${args.finalProbe.nonNullValidUntilReturned}** (MUST be 0)`
      )
    }
    lines.push('')
  }

  lines.push('## Guardrails honored')
  lines.push('')
  lines.push('- Prudential-only insurer guard (Azos/MAG refused at module level).')
  lines.push('- Per-doc 4 static preflights, evaluated once at batch start.')
  lines.push('- Per-doc cost cap (`--max-pages`); >50 requires `--allow-cost-blast`.')
  lines.push('- `assertRowsAreInert` runs before every per-doc upsert.')
  lines.push(
    '- Idempotent: upsert on `(content_hash, chunk_index)`. `--resume` short-circuits already-shadowed URLs.'
  )
  lines.push('- No DELETE. No embeddings. No read-path change. No product mutation.')
  return lines.join('\n')
}
