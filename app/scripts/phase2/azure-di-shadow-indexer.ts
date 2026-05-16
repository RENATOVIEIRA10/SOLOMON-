/**
 * Phase 2 / PR 3B slice 3B.5 — Azure DI shadow indexer CLI (Prudential-only).
 *
 * Drives the pure pipeline in
 * {@link ../../src/services/azure-di/shadow-indexer.ts} from a single PDF
 * URL to a set of inert `documents` rows tagged as shadow. This is the
 * first slice in PR 3B that writes to the database — every guardrail
 * exists to keep that write strictly off the production read path.
 *
 * Modes (lowest-impact first):
 *
 *   --dry-run            no Azure call, no DB write. Prints the plan
 *                        (insurer, URL, catalog size, max pages, paths).
 *                        Default when neither --live nor --write is set.
 *   --live               call Azure DI for real; build rows; report.
 *                        No DB write.
 *   --live --write       call Azure DI; build rows; preflight-check the
 *                        DB schema + read path; assert every row is
 *                        inert; upsert into `documents`.
 *
 * Mandatory args:
 *   --url <pdf_url>      Prudential PDF to ingest.
 *
 * Optional args:
 *   --insurer-match <s>  ilike substring to find the insurer row.
 *                        Default "Prudential do Brasil".
 *   --product-hint <s>   Free-text product-name hint for the resolver.
 *   --max-pages <n>      Hard cost cap. Default 10. >50 requires --allow-cost-blast.
 *   --allow-cost-blast   Permit --max-pages above the 50-page guard.
 *   --api-version <v>    Azure DI api-version. Default 2024-11-30.
 *   --out-root <dir>     Report root. Default ../docs/audit-runs.
 *
 * Hard constraints (all enforced before any write):
 *   - Insurer name must match "prudential" and must NOT match "azos"/"mag".
 *   - documents_source_type_check must still allow "conditions_pdf".
 *   - documents has UNIQUE (content_hash, chunk_index).
 *   - The active match_documents SQL filters `valid_until IS NULL`.
 *   - answer.ts active-insurer probe filters `valid_until IS NULL`.
 *   - Every row has non-null sentinel valid_until and `shadow-v3:` hash prefix.
 *   - After --write, a post-write probe must show zero rows with
 *     metadata.shadow=true AND valid_until IS NULL.
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow-indexer -- --url <pdf> [--dry-run]
 *   npm run phase2:azure-di:shadow-indexer -- --url <pdf> --live
 *   npm run phase2:azure-di:shadow-indexer -- --url <pdf> --live --write
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { AzureDiLayoutClient, maskEndpoint } from '../../src/services/azure-di/client'
import {
  SHADOW_HASH_PREFIX,
  SHADOW_VALID_UNTIL_SENTINEL,
  assertPrudentialOnly,
  assertRowsAreInert,
  buildShadowRows,
  type BuildShadowRowsResult,
} from '../../src/services/azure-di/shadow-indexer'
import {
  renderBatchReport,
  tallyAggregate,
  classifyWriteStatus,
  type DocResult,
  type FinalReadPathProbe,
  type ManifestEntry,
} from '../../src/services/azure-di/shadow-indexer-batch'
import type { ProductCatalogRow } from '../../src/services/azure-di/product-resolver'
import type { Database, TablesInsert } from '../../src/types/database'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

const DEFAULT_API_VERSION = '2024-11-30'
const DEFAULT_INSURER_MATCH = 'Prudential do Brasil'
const DEFAULT_MAX_PAGES = 10
const COST_BLAST_THRESHOLD = 50
const DEFAULT_OUT_ROOT = path.join('..', 'docs', 'audit-runs')
const SLICE_TAG = 'phase-2-pr3b5'

// File paths the preflights read (relative to app/). Static analysis only.
const MIGRATION_BASELINE = path.join(
  'supabase',
  'migrations',
  '20260422180000_baseline_snapshot.sql'
)
const MIGRATION_MATCH_DOCUMENTS = path.join(
  'supabase',
  'migrations',
  '20260423180000_match_documents_exclude_rag_flagged.sql'
)
const READ_PATH_ANSWER = path.join('src', 'services', 'rag', 'answer.ts')

interface CliOptions {
  /** Single-doc URL. Mutually exclusive with `batch`. */
  url?: string
  /** Batch mode: auto-discovers Prudential URLs from Supabase. */
  batch: boolean
  /** Cap on docs processed in batch mode. */
  limit?: number
  /**
   * Minimum legacy-prod chunk count for a URL to enter the batch manifest.
   * Filters single-chunk anomalies. Default {@link DEFAULT_MIN_CHUNKS}.
   */
  minChunks: number
  /**
   * Batch mode: skip URLs that already have shadow rows at the sentinel.
   * (single-doc mode is always idempotent via upsert, regardless of this flag).
   */
  resume: boolean
  /** Persist each `azure-layout-result.json` to outDir. Default: ON in single, OFF in batch. */
  saveLayouts: boolean
  insurerMatch: string
  productHint?: string
  maxPages: number
  allowCostBlast: boolean
  apiVersion: string
  outRoot: string
  live: boolean
  write: boolean
}

const DEFAULT_MIN_CHUNKS = 5

function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> = {
    insurerMatch: DEFAULT_INSURER_MATCH,
    maxPages: DEFAULT_MAX_PAGES,
    allowCostBlast: false,
    apiVersion: DEFAULT_API_VERSION,
    outRoot: DEFAULT_OUT_ROOT,
    live: false,
    write: false,
    batch: false,
    minChunks: DEFAULT_MIN_CHUNKS,
    resume: false,
  }
  let dryRunSeen = false
  let saveLayoutsSeen: boolean | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else if (arg === '--dry-run') {
      dryRunSeen = true
    } else if (arg === '--live') {
      opts.live = true
    } else if (arg === '--write') {
      opts.write = true
    } else if (arg === '--allow-cost-blast') {
      opts.allowCostBlast = true
    } else if (arg === '--batch') {
      opts.batch = true
    } else if (arg === '--resume') {
      opts.resume = true
    } else if (arg === '--save-layouts') {
      saveLayoutsSeen = true
    } else if (arg === '--no-save-layouts') {
      saveLayoutsSeen = false
    } else if (arg === '--url' && next) {
      opts.url = next
      i++
    } else if (arg === '--limit' && next) {
      opts.limit = Number(next)
      i++
    } else if (arg === '--min-chunks' && next) {
      opts.minChunks = Number(next)
      i++
    } else if (arg === '--insurer-match' && next) {
      opts.insurerMatch = next
      i++
    } else if (arg === '--product-hint' && next) {
      opts.productHint = next
      i++
    } else if (arg === '--max-pages' && next) {
      opts.maxPages = Number(next)
      i++
    } else if (arg === '--api-version' && next) {
      opts.apiVersion = next
      i++
    } else if (arg === '--out-root' && next) {
      opts.outRoot = next
      i++
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  if (!opts.url && !opts.batch) {
    throw new Error('Either --url <pdf> or --batch is required')
  }
  if (opts.url && opts.batch) {
    throw new Error('--url and --batch are mutually exclusive')
  }
  if (!opts.batch && opts.resume) {
    throw new Error('--resume is only valid with --batch (single --url is always idempotent via upsert)')
  }
  if (!opts.batch && opts.limit !== undefined) {
    throw new Error('--limit is only valid with --batch')
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error('--limit must be a positive integer')
  }
  if (!Number.isInteger(opts.minChunks) || (opts.minChunks ?? 0) < 1) {
    throw new Error('--min-chunks must be a positive integer')
  }
  if (!Number.isInteger(opts.maxPages) || (opts.maxPages ?? 0) < 1) {
    throw new Error('--max-pages must be a positive integer')
  }
  if ((opts.maxPages ?? 0) > COST_BLAST_THRESHOLD && !opts.allowCostBlast) {
    throw new Error(
      `--max-pages ${opts.maxPages} > ${COST_BLAST_THRESHOLD}. Pass --allow-cost-blast to override.`
    )
  }
  if (opts.write && !opts.live) {
    throw new Error('--write requires --live (cannot write a row without analyzing the PDF first)')
  }
  if (dryRunSeen && (opts.live || opts.write)) {
    throw new Error('--dry-run conflicts with --live/--write')
  }
  // Default for saveLayouts: ON in single mode (preserves prior behavior),
  // OFF in batch mode (keeps the run directory lean over 20+ PDFs).
  opts.saveLayouts = saveLayoutsSeen ?? !opts.batch
  return opts as CliOptions
}

function printUsage(): void {
  console.log(`Azure DI shadow indexer (PR 3B slice 3B.5, Prudential-only)

Two modes:
  Single:  --url <pdf>
  Batch:   --batch        (auto-discovers Prudential URLs from Supabase)

Usage:
  npm run phase2:azure-di:shadow-indexer -- --url <pdf>  [--dry-run|--live [--write]]
  npm run phase2:azure-di:shadow-indexer -- --batch      [--limit N] [--resume]
                                                          [--dry-run|--live [--write]]

Required (one of):
  --url <pdf_url>        Single Prudential PDF
  --batch                Auto-discover Prudential URLs from active conditions_pdf

Single-mode-only:
  --product-hint <s>     Hint for the product resolver

Batch-mode-only:
  --limit <n>            Cap on docs processed
  --min-chunks <n>       Filter URLs with < n active legacy chunks (default ${DEFAULT_MIN_CHUNKS})
  --resume               Skip URLs that already have shadow rows at the sentinel

Shared:
  --insurer-match <s>    ilike substring (default "${DEFAULT_INSURER_MATCH}")
  --max-pages <n>        Per-doc page cap (default ${DEFAULT_MAX_PAGES}, >${COST_BLAST_THRESHOLD} needs --allow-cost-blast)
  --allow-cost-blast     Permit --max-pages above the ${COST_BLAST_THRESHOLD}-page guard
  --api-version <v>      Azure DI api-version (default ${DEFAULT_API_VERSION})
  --out-root <dir>       Report root (default ${DEFAULT_OUT_ROOT})
  --save-layouts         Force-save per-doc azure-layout-result.json (default: on in single, off in batch)
  --no-save-layouts      Force-skip per-doc layout artifact (default: off in single, on in batch)
  --dry-run              No Azure call, no DB write (default mode)
  --live                 Call Azure DI; no DB write
  --live --write         Call Azure DI; preflight; upsert inert rows
`)
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name]
    if (v && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function makeSupabaseClient(): SupabaseClient<Database> {
  const url = envValue('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error(
      'Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.'
    )
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

interface PreflightOutcome {
  ok: boolean
  label: string
  detail: string
}

async function runStaticPreflights(): Promise<PreflightOutcome[]> {
  const out: PreflightOutcome[] = []

  // 1. source_type CHECK constraint still allows conditions_pdf.
  try {
    const sql = await readFile(MIGRATION_BASELINE, 'utf8')
    const allows =
      sql.includes('documents_source_type_check') &&
      sql.includes("'conditions_pdf'")
    out.push({
      ok: allows,
      label: 'documents.source_type CHECK includes conditions_pdf',
      detail: allows
        ? `${MIGRATION_BASELINE} defines documents_source_type_check with conditions_pdf`
        : `${MIGRATION_BASELINE} missing documents_source_type_check or conditions_pdf literal`,
    })
  } catch (err) {
    out.push({
      ok: false,
      label: 'documents.source_type CHECK includes conditions_pdf',
      detail: `failed to read ${MIGRATION_BASELINE}: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  // 2. UNIQUE (content_hash, chunk_index) is the dedup key.
  try {
    const sql = await readFile(MIGRATION_BASELINE, 'utf8')
    const has =
      sql.includes('documents_content_hash_chunk_index_key') &&
      sql.includes('UNIQUE (content_hash, chunk_index)')
    out.push({
      ok: has,
      label: 'documents UNIQUE (content_hash, chunk_index) constraint',
      detail: has
        ? `${MIGRATION_BASELINE} defines documents_content_hash_chunk_index_key`
        : `${MIGRATION_BASELINE} missing the UNIQUE constraint — upsert onConflict would be unsafe`,
    })
  } catch (err) {
    out.push({
      ok: false,
      label: 'documents UNIQUE (content_hash, chunk_index) constraint',
      detail: `failed to read ${MIGRATION_BASELINE}: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  // 3. match_documents SQL filters valid_until IS NULL.
  try {
    const sql = await readFile(MIGRATION_MATCH_DOCUMENTS, 'utf8')
    const filters = sql.includes('valid_until IS NULL')
    out.push({
      ok: filters,
      label: 'match_documents filters valid_until IS NULL (read path inert)',
      detail: filters
        ? `${MIGRATION_MATCH_DOCUMENTS} contains "valid_until IS NULL"`
        : `${MIGRATION_MATCH_DOCUMENTS} missing the valid_until inertness filter`,
    })
  } catch (err) {
    out.push({
      ok: false,
      label: 'match_documents filters valid_until IS NULL (read path inert)',
      detail: `failed to read ${MIGRATION_MATCH_DOCUMENTS}: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  // 4. answer.ts active-insurer probe filters valid_until IS NULL.
  try {
    const ts = await readFile(READ_PATH_ANSWER, 'utf8')
    const filters = ts.includes(".is('valid_until', null)")
    out.push({
      ok: filters,
      label: 'answer.ts active-insurer probe filters valid_until null',
      detail: filters
        ? `${READ_PATH_ANSWER} calls .is('valid_until', null) — shadow rows skipped`
        : `${READ_PATH_ANSWER} missing the valid_until inertness filter`,
    })
  } catch (err) {
    out.push({
      ok: false,
      label: 'answer.ts active-insurer probe filters valid_until null',
      detail: `failed to read ${READ_PATH_ANSWER}: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  return out
}

async function loadInsurer(
  client: SupabaseClient<Database>,
  match: string
): Promise<{ id: string; name: string }> {
  const { data, error } = await client
    .from('insurers')
    .select('id, name')
    .ilike('name', `%${match}%`)
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(`No insurer matches ilike "${match}". Aborting.`)
  }
  const sorted = [...data].sort((a, b) => a.name.length - b.name.length)
  const insurer = sorted[0]
  assertPrudentialOnly(insurer.name)
  return insurer
}

async function loadCatalog(
  client: SupabaseClient<Database>,
  insurerId: string
): Promise<ProductCatalogRow[]> {
  const { data, error } = await client
    .from('products')
    .select('id, name, code, susep_process, terms_url')
    .eq('insurer_id', insurerId)
  if (error) throw error
  return (data ?? []) as ProductCatalogRow[]
}

interface PostWriteProbe {
  /**
   * REAL leak: rows that carry the shadow signature
   * (`metadata.shadow = true`) AND are visible to the read path
   * (`valid_until IS NULL`). MUST be zero. Any non-zero is a contract
   * violation that requires investigation.
   */
  shadowLeakCount: number
  /**
   * Active legacy prod rows for the same (insurer, source_url). These
   * are pre-existing rows from the old ingestion pipeline — informational
   * only. The shadow indexer does NOT touch them (different content_hash
   * prefix, no UPDATE/DELETE).
   *
   * NOT a leak. Computed as: rows with `valid_until IS NULL` minus the
   * shadow-leak count, so a sudden spike here can also be flagged.
   */
  activeLegacyProdCount: number
  /**
   * Shadow rows written by this slice — `valid_until = sentinel`. Should
   * equal the accepted-chunk count produced by the pipeline.
   */
  upsertedCount: number
}

/**
 * Counts rows visible to the read path that ALSO carry the shadow
 * signature. This is the only metric that names "leak". On a clean
 * run it MUST be zero.
 */
async function probeShadowLeak(
  client: SupabaseClient<Database>,
  insurerId: string,
  sourceUrl: string
): Promise<number> {
  const { count, error } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('insurer_id', insurerId)
    .eq('source_url', sourceUrl)
    .is('valid_until', null)
    .eq('metadata->>shadow', 'true')
  if (error) throw error
  return count ?? 0
}

/**
 * Counts all rows visible to the read path for the same (insurer, url),
 * regardless of shadow flag. Subtracting {@link probeShadowLeak} gives
 * the legacy-prod baseline — pre-existing rows from the old pipeline
 * that this slice does not touch. Informational, not a leak metric.
 */
async function probeActiveRowsForUrl(
  client: SupabaseClient<Database>,
  insurerId: string,
  sourceUrl: string
): Promise<number> {
  const { count, error } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('insurer_id', insurerId)
    .eq('source_url', sourceUrl)
    .is('valid_until', null)
  if (error) throw error
  return count ?? 0
}

/**
 * Counts shadow rows for this (insurer, url) at the sentinel `valid_until`
 * AND with `metadata.hash_scheme='url-aware-v1'`. The hash_scheme filter
 * keeps v3 orphans (from the pre-fix release) out of this metric so
 * `classifyWriteStatus` works correctly during the v3→v4 transition.
 */
async function countUpsertedShadow(
  client: SupabaseClient<Database>,
  insurerId: string,
  sourceUrl: string,
  sentinel: string
): Promise<number> {
  const { count, error } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('insurer_id', insurerId)
    .eq('source_url', sourceUrl)
    .eq('valid_until', sentinel)
    .eq('metadata->>hash_scheme', 'url-aware-v1')
  if (error) throw error
  return count ?? 0
}

async function upsertRows(
  client: SupabaseClient<Database>,
  rows: ReadonlyArray<TablesInsert<'documents'>>
): Promise<void> {
  if (rows.length === 0) return
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await client
      .from('documents')
      .upsert(batch as TablesInsert<'documents'>[], {
        onConflict: 'content_hash,chunk_index',
        ignoreDuplicates: false,
      })
    if (error) {
      throw new Error(
        `upsert batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(rows.length / BATCH)} failed: ${error.message}`
      )
    }
  }
}

// --- batch-mode I/O helpers ---

/**
 * Pages through `documents` for the given insurer and groups by source_url,
 * filtering to active conditions_pdf rows. Returns the manifest sorted by
 * legacy-chunk count desc, with URLs below `minChunks` filtered out.
 */
async function discoverPrudentialManifest(
  client: SupabaseClient<Database>,
  insurerId: string,
  minChunks: number
): Promise<ManifestEntry[]> {
  const PAGE = 1000
  const counts = new Map<string, number>()
  let from = 0
  for (;;) {
    const { data, error } = await client
      .from('documents')
      .select('source_url')
      .eq('source_type', 'conditions_pdf')
      .eq('insurer_id', insurerId)
      .is('valid_until', null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const url = (row.source_url ?? '').trim()
      if (url.length === 0) continue
      counts.set(url, (counts.get(url) ?? 0) + 1)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  const entries: ManifestEntry[] = []
  for (const [source_url, legacy_chunk_count] of counts) {
    if (legacy_chunk_count >= minChunks) entries.push({ source_url, legacy_chunk_count })
  }
  entries.sort((a, b) => b.legacy_chunk_count - a.legacy_chunk_count)
  return entries
}

/**
 * Picks any active `conditions_pdf` row's embedding for the insurer, to
 * use as the query vector in the final `match_documents` RPC probe.
 * Returns `null` if no such row exists.
 */
async function pickActiveEmbedding(
  client: SupabaseClient<Database>,
  insurerId: string
): Promise<string | null> {
  const { data, error } = await client
    .from('documents')
    .select('embedding')
    .eq('insurer_id', insurerId)
    .is('valid_until', null)
    .not('embedding', 'is', null)
    .limit(1)
  if (error || !data || data.length === 0) return null
  return (data[0].embedding as string | null) ?? null
}

/**
 * Final sanity check: calls `match_documents` with a real Prudential
 * embedding at threshold 0.0 / top_k 50, then classifies the returned
 * ids. Both `shadowReturned` and `nonNullValidUntilReturned` MUST be 0.
 */
async function runFinalReadPathProbe(
  client: SupabaseClient<Database>,
  insurerId: string
): Promise<FinalReadPathProbe> {
  const threshold = 0.0
  const topK = 50
  const queryEmbedding = await pickActiveEmbedding(client, insurerId)
  if (!queryEmbedding) {
    return {
      totalReturned: 0,
      shadowReturned: 0,
      nonNullValidUntilReturned: 0,
      threshold,
      topK,
      skipped: 'no active embedding available to probe with',
    }
  }
  // Cast through `unknown` because `match_documents` is a user-defined
  // RPC not present in the generated Database type. Call as a METHOD on
  // `client` so `this` stays bound to the Supabase client (the earlier
  // version stored client.rpc into a local and lost `this`, which threw
  // "Cannot read properties of undefined (reading 'rest')").
  type RpcResponse = {
    data: Array<{ id: string }> | null
    error: { message: string } | null
  }
  let rpcResp: RpcResponse
  try {
    rpcResp = (await (
      client.rpc as unknown as (
        this: SupabaseClient<Database>,
        fn: string,
        args: Record<string, unknown>
      ) => Promise<RpcResponse>
    ).call(client, 'match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: topK,
    })) as RpcResponse
  } catch (err) {
    return {
      totalReturned: 0,
      shadowReturned: 0,
      nonNullValidUntilReturned: 0,
      threshold,
      topK,
      skipped: `match_documents threw: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const { data, error } = rpcResp
  if (error) {
    return {
      totalReturned: 0,
      shadowReturned: 0,
      nonNullValidUntilReturned: 0,
      threshold,
      topK,
      skipped: `match_documents error: ${error.message}`,
    }
  }
  const ids = (data ?? []).map((r) => r.id)
  if (ids.length === 0) {
    return { totalReturned: 0, shadowReturned: 0, nonNullValidUntilReturned: 0, threshold, topK }
  }
  const { data: classify, error: e3 } = await client
    .from('documents')
    .select('id, valid_until, metadata')
    .in('id', ids)
  if (e3 || !classify) {
    return {
      totalReturned: ids.length,
      shadowReturned: 0,
      nonNullValidUntilReturned: 0,
      threshold,
      topK,
      skipped: `classify error: ${e3?.message ?? 'unknown'}`,
    }
  }
  let shadowReturned = 0
  let nonNullValidUntilReturned = 0
  for (const r of classify) {
    if (r.valid_until !== null) nonNullValidUntilReturned += 1
    const meta = (r.metadata as Record<string, unknown> | null) ?? null
    if (meta && meta.shadow === true) shadowReturned += 1
  }
  return { totalReturned: ids.length, shadowReturned, nonNullValidUntilReturned, threshold, topK }
}

interface ProcessOneDocArgs {
  client: SupabaseClient<Database>
  azureClient: AzureDiLayoutClient
  insurer: { id: string; name: string }
  catalog: readonly ProductCatalogRow[]
  pageSpan: string
  opts: CliOptions
  outDir: string
  manifestEntry: ManifestEntry
}

/**
 * Runs the slice-3B.5 pipeline for one URL: optional resume short-circuit,
 * Azure DI analyze + buildShadowRows, optional --write with assertRowsAreInert
 * + upsert + 3 post-write probes. Returns a {@link DocResult} that never
 * throws — errors surface as `AZURE_ERROR` or `WRITE_ERROR` status.
 */
async function processOneDocument(args: ProcessOneDocArgs): Promise<DocResult> {
  const {
    client,
    azureClient,
    insurer,
    catalog,
    pageSpan,
    opts,
    outDir,
    manifestEntry,
  } = args
  const result: DocResult = {
    sourceUrl: manifestEntry.source_url,
    legacyChunkCount: manifestEntry.legacy_chunk_count,
    status: 'PLANNED',
  }

  if (opts.resume) {
    const preCount = await countUpsertedShadow(
      client,
      insurer.id,
      manifestEntry.source_url,
      SHADOW_VALID_UNTIL_SENTINEL
    )
    if (preCount > 0) {
      result.status = 'SKIPPED_RESUME'
      result.preShadowCount = preCount
      return result
    }
  }

  if (!opts.live) {
    result.status = 'PLANNED'
    return result
  }

  let build: BuildShadowRowsResult
  try {
    const layout = await azureClient.analyzeUrlSource(manifestEntry.source_url, {
      pages: pageSpan,
    })
    if (opts.saveLayouts) {
      const safe = manifestEntry.source_url.replace(/[^a-zA-Z0-9]+/g, '_').slice(-80)
      const layoutPath = path.join(outDir, 'layouts', `${safe}.json`)
      await mkdir(path.dirname(layoutPath), { recursive: true })
      await writeFile(layoutPath, JSON.stringify(layout, null, 2), 'utf8')
    }
    build = buildShadowRows({
      layout,
      insurerId: insurer.id,
      insurerName: insurer.name,
      sourceUrl: manifestEntry.source_url,
      productCatalog: catalog,
      pageSpan,
    })
  } catch (err) {
    result.status = 'AZURE_ERROR'
    result.errorMessage = err instanceof Error ? err.message : String(err)
    return result
  }
  result.pages = build.summary.pageCount
  result.chunks = build.summary.chunkCount
  result.accepted = build.summary.acceptedCount
  result.quarantined = build.summary.quarantinedCount
  result.resolved = !build.resolution.productUnresolved
  result.productId = build.resolution.productUnresolved ? null : build.resolution.productId ?? null
  result.productName = build.resolution.productUnresolved
    ? null
    : build.resolution.productName ?? null
  if (build.resolution.productUnresolved) {
    result.unresolvedReason = build.resolution.unresolvedReason
  }

  if (!opts.write) {
    result.status = 'PIPELINE_ONLY'
    return result
  }

  try {
    const preShadowCount = await countUpsertedShadow(
      client,
      insurer.id,
      manifestEntry.source_url,
      SHADOW_VALID_UNTIL_SENTINEL
    )
    result.preShadowCount = preShadowCount
    assertRowsAreInert(build.rows, SHADOW_HASH_PREFIX)
    await upsertRows(client, build.rows)
    const [shadowLeakCount, activeRowsForUrl, postUpserted] = await Promise.all([
      probeShadowLeak(client, insurer.id, manifestEntry.source_url),
      probeActiveRowsForUrl(client, insurer.id, manifestEntry.source_url),
      countUpsertedShadow(
        client,
        insurer.id,
        manifestEntry.source_url,
        SHADOW_VALID_UNTIL_SENTINEL
      ),
    ])
    result.upsertedCount = postUpserted
    result.extraInertShadowRows = Math.max(0, postUpserted - build.summary.acceptedCount)
    result.shadowLeak = shadowLeakCount
    result.activeLegacyProd = Math.max(0, activeRowsForUrl - shadowLeakCount)
    result.status = classifyWriteStatus(
      preShadowCount,
      build.summary.acceptedCount,
      postUpserted,
      shadowLeakCount
    )
  } catch (err) {
    result.status = 'WRITE_ERROR'
    result.errorMessage = err instanceof Error ? err.message : String(err)
  }
  return result
}

async function runBatch(args: {
  client: SupabaseClient<Database>
  insurer: { id: string; name: string }
  catalog: readonly ProductCatalogRow[]
  preflights: readonly PreflightOutcome[]
  opts: CliOptions
  outDir: string
  endpoint: string | undefined
  endpointMasked: string
}): Promise<{ exitCode: number }> {
  const { client, insurer, catalog, preflights, opts, outDir, endpoint, endpointMasked } = args
  const mode: 'dry-run' | 'live' | 'live-write' = opts.write
    ? 'live-write'
    : opts.live
      ? 'live'
      : 'dry-run'
  const pageSpan = `1-${opts.maxPages}`
  const generatedAt = new Date().toISOString()

  console.log('# batch mode')
  const manifest = await discoverPrudentialManifest(client, insurer.id, opts.minChunks)
  const limited = opts.limit !== undefined ? manifest.slice(0, opts.limit) : manifest
  console.log(
    `manifest: discovered=${manifest.length} min-chunks>=${opts.minChunks} after-limit=${limited.length}`
  )

  let azureClient: AzureDiLayoutClient | undefined
  if (mode !== 'dry-run') {
    if (!endpoint) {
      throw new Error('AZURE_DI_ENDPOINT (or AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT) is unset')
    }
    azureClient = new AzureDiLayoutClient({ apiVersion: opts.apiVersion })
  }

  const results: DocResult[] = []
  for (let i = 0; i < limited.length; i++) {
    const entry = limited[i]
    console.log(`\n[${i + 1}/${limited.length}] ${entry.source_url}`)
    if (mode === 'dry-run') {
      results.push({
        sourceUrl: entry.source_url,
        legacyChunkCount: entry.legacy_chunk_count,
        status: 'PLANNED',
      })
      continue
    }
    const r = await processOneDocument({
      client,
      azureClient: azureClient!,
      insurer,
      catalog,
      pageSpan,
      opts,
      outDir,
      manifestEntry: entry,
    })
    console.log(
      `  status=${r.status} pages=${r.pages ?? '-'} accepted=${r.accepted ?? '-'} upserted=${r.upsertedCount ?? '-'} extra_inert=${r.extraInertShadowRows ?? '-'} leak=${r.shadowLeak ?? '-'}`
    )
    results.push(r)
  }

  const aggregate = tallyAggregate(results)
  let finalProbe: FinalReadPathProbe | undefined
  if (mode === 'live-write') {
    finalProbe = await runFinalReadPathProbe(client, insurer.id)
    console.log(
      `\nfinal read-path probe: returned=${finalProbe.totalReturned} shadow=${finalProbe.shadowReturned} non_null_valid_until=${finalProbe.nonNullValidUntilReturned}${finalProbe.skipped ? ` skipped="${finalProbe.skipped}"` : ''}`
    )
  }

  const report = renderBatchReport({
    generatedAt,
    mode,
    insurer,
    catalogSize: catalog.length,
    preflights: [...preflights],
    endpointMasked,
    pageSpan,
    minChunks: opts.minChunks,
    limit: opts.limit,
    resume: opts.resume,
    manifest: limited,
    results,
    aggregate,
    finalProbe,
  })
  const reportPath = path.join(outDir, 'shadow-indexer-batch-report.md')
  await writeFile(reportPath, report, 'utf8')
  console.log(`\nReport: ${reportPath}`)

  let exitCode = 0
  if (aggregate.totalShadowLeaks > 0) {
    console.error(`FATAL: ${aggregate.totalShadowLeaks} shadow rows leaked into read path`)
    exitCode = 1
  }
  if (aggregate.docsAzureError + aggregate.docsWriteError > 0) exitCode = 1
  if (finalProbe && (finalProbe.shadowReturned > 0 || finalProbe.nonNullValidUntilReturned > 0)) {
    console.error('FATAL: final read-path probe surfaced shadow rows')
    exitCode = 1
  }
  return { exitCode }
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function renderReport(args: {
  generatedAt: string
  opts: CliOptions
  insurer: { id: string; name: string }
  catalogSize: number
  preflights: PreflightOutcome[]
  endpointMasked: string
  pageSpan: string
  build?: BuildShadowRowsResult
  postWrite?: PostWriteProbe
  mode: 'dry-run' | 'live' | 'live-write'
  azureError?: string
  writeError?: string
}): string {
  const lines: string[] = []
  lines.push(`# Phase 2 PR 3B slice 3B.5 — shadow-indexer report (${args.mode})`)
  lines.push('')
  lines.push(`Generated: ${args.generatedAt}`)
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push('- Prudential-only first write of PR 3B.')
  lines.push('- Rows are inert: `valid_until` = sentinel, `metadata.shadow=true`,')
  lines.push('  `metadata.parser=azure-di-layout-v3`, `content_hash` prefixed `shadow-v3:`.')
  lines.push('- No embeddings. No DELETE. No read-path change. No product mutation.')
  lines.push('- Azos/MAG belong to Phase 2C (issue #22) — refused here by the Prudential-only guard.')
  lines.push('')
  lines.push('## Inputs')
  lines.push('')
  lines.push(`- mode: \`${args.mode}\``)
  lines.push(`- insurer: ${args.insurer.name} (\`${args.insurer.id}\`)`)
  lines.push(`- catalog size: ${args.catalogSize}`)
  lines.push(`- source url: ${args.opts.url}`)
  if (args.opts.productHint) lines.push(`- product hint: ${args.opts.productHint}`)
  lines.push(`- max pages: ${args.opts.maxPages} (page span \`${args.pageSpan}\`)`)
  lines.push(`- Azure DI endpoint: ${args.endpointMasked}`)
  lines.push(`- API version: ${args.opts.apiVersion}`)
  lines.push('')
  lines.push('## Preflights')
  lines.push('')
  lines.push('| ok | check | detail |')
  lines.push('|---|---|---|')
  for (const p of args.preflights) {
    lines.push(`| ${p.ok ? 'yes' : 'NO'} | ${p.label} | ${p.detail.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')

  if (args.build) {
    const b = args.build
    lines.push('## Pipeline')
    lines.push('')
    lines.push(`- pages: ${b.summary.pageCount}`)
    lines.push(`- chunks: ${b.summary.chunkCount}`)
    lines.push(`- accepted: ${b.summary.acceptedCount}`)
    lines.push(`- quarantined: ${b.summary.quarantinedCount}`)
    const resStr = b.resolution.productUnresolved
      ? `_unresolved (${b.resolution.unresolvedReason})_`
      : `${b.resolution.productName} (\`${b.resolution.productId}\`) via ${b.resolution.strategy} @ ${b.resolution.confidence.toFixed(2)}`
    lines.push(`- product resolution: ${resStr}`)
    lines.push('')
    lines.push('### Gate tallies')
    lines.push('')
    lines.push('| gate | passed | failed |')
    lines.push('|---|---:|---:|')
    for (const [gate, t] of Object.entries(b.gateReport.byGate)) {
      lines.push(`| ${gate} | ${t.passed} | ${t.failed} |`)
    }
    lines.push('')
    if (b.gateReport.quarantined.length > 0) {
      lines.push('### Quarantined chunks')
      lines.push('')
      lines.push('| chunk_index | page | chars | failed gates |')
      lines.push('|---:|---:|---:|---|')
      for (const q of b.gateReport.quarantined) {
        const gates = q.reasons.map((r) => r.gate).join(', ')
        lines.push(
          `| ${q.chunk.metadata.chunk_index} | ${q.chunk.metadata.page} | ${q.chunk.content.length} | ${gates} |`
        )
      }
      lines.push('')
    }
    lines.push('### First accepted rows (preview)')
    lines.push('')
    lines.push('| chunk_index | page | chars | content_hash | valid_until |')
    lines.push('|---:|---:|---:|---|---|')
    for (const row of b.rows.slice(0, 5)) {
      const hashShort = `${row.content_hash.slice(0, 24)}…`
      lines.push(
        `| ${row.chunk_index ?? '?'} | ${(row.metadata as Record<string, unknown> | null)?.page ?? '?'} | ${row.content.length} | \`${hashShort}\` | \`${row.valid_until}\` |`
      )
    }
    lines.push('')
  }

  if (args.azureError) {
    lines.push('## Azure DI error')
    lines.push('')
    lines.push('```')
    lines.push(args.azureError)
    lines.push('```')
    lines.push('')
  }

  if (args.postWrite) {
    const pw = args.postWrite
    lines.push('## Post-write probe')
    lines.push('')
    lines.push('| metric | count | meaning |')
    lines.push('|---|---:|---|')
    lines.push(
      `| shadow leak (\`metadata.shadow=true\` AND \`valid_until IS NULL\`) | **${pw.shadowLeakCount}** | MUST be 0. Any non-zero is a contract violation. |`
    )
    lines.push(
      `| active legacy prod rows (\`valid_until IS NULL\` minus shadow leak) | ${pw.activeLegacyProdCount} | pre-existing rows from the old pipeline, untouched by this slice. Informational. NOT a leak. |`
    )
    lines.push(
      `| upserted shadow rows (\`valid_until = sentinel\`) | ${pw.upsertedCount} | rows written by this run. Should equal accepted-chunk count. |`
    )
    lines.push('')
    if (pw.shadowLeakCount > 0) {
      lines.push('> :warning: **Shadow leak detected.** A row with `metadata.shadow=true` is')
      lines.push('> currently visible to the read path. Investigate before continuing.')
      lines.push('')
    }
  }

  if (args.writeError) {
    lines.push('## Write error')
    lines.push('')
    lines.push('```')
    lines.push(args.writeError)
    lines.push('```')
    lines.push('')
  }

  lines.push('## Guardrails honored')
  lines.push('')
  lines.push('- Prudential-only insurer guard (Azos/MAG refused).')
  lines.push('- 4 static preflights run before any DB write.')
  lines.push('- Cost cap: `--max-pages` enforced; >50 requires `--allow-cost-blast`.')
  lines.push('- `assertRowsAreInert` verifies every row before upsert.')
  lines.push('- Post-write probe verifies the shadow set never appears in the read path.')
  lines.push('- No DELETE; idempotent upsert on `(content_hash, chunk_index)`.')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const mode: 'dry-run' | 'live' | 'live-write' = opts.write
    ? 'live-write'
    : opts.live
      ? 'live'
      : 'dry-run'

  const runId = makeRunId()
  const outDir = path.join(opts.outRoot, `${SLICE_TAG}-${runId}`)
  await mkdir(outDir, { recursive: true })

  const endpoint = envValue('AZURE_DI_ENDPOINT', 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT')
  const endpointMasked = maskEndpoint(endpoint ?? '')

  console.log(`# shadow-indexer mode=${mode}${opts.batch ? ' (batch)' : ''}`)
  console.log(`outDir=${outDir}`)
  if (opts.url) console.log(`url=${opts.url}`)
  console.log(`max-pages=${opts.maxPages}`)
  console.log(`azure-endpoint=${endpointMasked}`)

  const preflights = await runStaticPreflights()
  for (const p of preflights) console.log(`preflight ${p.ok ? 'OK ' : 'FAIL'} ${p.label}`)
  const preflightsOk = preflights.every((p) => p.ok)
  if (!preflightsOk && opts.write) {
    throw new Error('Static preflights failed. Refusing to --write.')
  }

  const client = makeSupabaseClient()
  const insurer = await loadInsurer(client, opts.insurerMatch)
  console.log(`insurer=${insurer.name} (${insurer.id})`)
  const catalog = await loadCatalog(client, insurer.id)
  console.log(`catalog-size=${catalog.length}`)

  const pageSpan = `1-${opts.maxPages}`
  const generatedAt = new Date().toISOString()

  if (opts.batch) {
    const { exitCode } = await runBatch({
      client,
      insurer,
      catalog,
      preflights,
      opts,
      outDir,
      endpoint,
      endpointMasked,
    })
    if (exitCode !== 0) process.exit(exitCode)
    return
  }

  // --- single-URL flow below ---

  if (!opts.url) throw new Error('internal: --url missing after parseArgs')
  const singleUrl: string = opts.url

  if (mode === 'dry-run') {
    const report = renderReport({
      generatedAt,
      opts,
      insurer,
      catalogSize: catalog.length,
      preflights,
      endpointMasked,
      pageSpan,
      mode,
    })
    const reportPath = path.join(outDir, 'shadow-indexer-report.md')
    await writeFile(reportPath, report, 'utf8')
    console.log(`\nReport: ${reportPath}`)
    return
  }

  // --live or --live --write
  if (!endpoint) {
    throw new Error('AZURE_DI_ENDPOINT (or AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT) is unset')
  }

  const azureClient = new AzureDiLayoutClient({ apiVersion: opts.apiVersion })
  let build: BuildShadowRowsResult | undefined
  let azureError: string | undefined

  try {
    const layout = await azureClient.analyzeUrlSource(singleUrl, { pages: pageSpan })
    if (opts.saveLayouts) {
      const layoutPath = path.join(outDir, 'azure-layout-result.json')
      await writeFile(layoutPath, JSON.stringify(layout, null, 2), 'utf8')
      console.log(`saved layout=${layoutPath}`)
    }

    build = buildShadowRows({
      layout,
      insurerId: insurer.id,
      insurerName: insurer.name,
      sourceUrl: singleUrl,
      productCatalog: catalog,
      productNameHint: opts.productHint,
      pageSpan,
    })
    console.log(
      `pipeline: pages=${build.summary.pageCount} chunks=${build.summary.chunkCount} accepted=${build.summary.acceptedCount} quarantined=${build.summary.quarantinedCount}`
    )
  } catch (err) {
    azureError = err instanceof Error ? err.message : String(err)
    console.error(`azure-pipeline FAIL: ${azureError}`)
  }

  let postWrite: PostWriteProbe | undefined
  let writeError: string | undefined

  if (mode === 'live-write' && build) {
    try {
      assertRowsAreInert(build.rows, SHADOW_HASH_PREFIX)
      await upsertRows(client, build.rows)
      const [shadowLeakCount, activeRowsForUrl, upsertedCount] = await Promise.all([
        probeShadowLeak(client, insurer.id, singleUrl),
        probeActiveRowsForUrl(client, insurer.id, singleUrl),
        countUpsertedShadow(client, insurer.id, singleUrl, SHADOW_VALID_UNTIL_SENTINEL),
      ])
      const activeLegacyProdCount = Math.max(0, activeRowsForUrl - shadowLeakCount)
      postWrite = { shadowLeakCount, activeLegacyProdCount, upsertedCount }
      console.log(
        `post-write: upserted=${upsertedCount} shadow-leak=${shadowLeakCount} active-legacy-prod=${activeLegacyProdCount}`
      )
    } catch (err) {
      writeError = err instanceof Error ? err.message : String(err)
      console.error(`write FAIL: ${writeError}`)
    }
  }

  const report = renderReport({
    generatedAt,
    opts,
    insurer,
    catalogSize: catalog.length,
    preflights,
    endpointMasked,
    pageSpan,
    build,
    postWrite,
    mode,
    azureError,
    writeError,
  })
  const reportPath = path.join(outDir, 'shadow-indexer-report.md')
  await writeFile(reportPath, report, 'utf8')
  console.log(`\nReport: ${reportPath}`)

  if (azureError || writeError) process.exit(1)
}

main().catch((err) => {
  console.error('[phase2/azure-di-shadow-indexer] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
