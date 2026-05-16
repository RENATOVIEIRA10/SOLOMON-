/**
 * Phase 2 / PR 3B.6 slice 3B.6.1 — Azure DI shadow embedder CLI.
 *
 * Embeds the v4 Prudential shadow rows written by slice 3B.5.
 * Production read path is untouched, `match_documents` is not edited.
 *
 * Hard contract:
 *   - Embedder only ever UPDATEs `documents.embedding` on rows that
 *     satisfy ALL of: `valid_until = SHADOW_VALID_UNTIL_SENTINEL`,
 *     `metadata.shadow = true`, `metadata.hash_scheme = 'url-aware-v1'`,
 *     `embedding IS NULL`. The WHERE clause is mirrored on every
 *     UPDATE as defense-in-depth, in addition to the in-memory
 *     {@link assertEmbeddingTargetIsShadow} pre-check.
 *   - Idempotent. Re-runs skip rows whose embedding is already set.
 *   - Cost cap on estimated USD. >$5 requires `--allow-cost-blast`.
 *   - Prudential-only. {@link assertPrudentialOnly} guards the
 *     insurer-name lookup before any DB write.
 *   - No promotion. `valid_until` stays at the sentinel.
 *   - No read-path change. No DELETE. No new dependency.
 *
 * Modes:
 *   --dry-run         (default) plan-only: count eligible, count
 *                     already-embedded, total cost estimate. No
 *                     OpenAI call, no DB write.
 *   --live --write    call OpenAI, UPDATE embeddings, run probes.
 *                     `--live` alone is rejected — every embedding
 *                     call costs money so we don't expose a
 *                     fetch-only mode.
 *
 * Probes the CLI runs after `--write`:
 *   - shadow embedding count delta = UPDATE row count = expected?
 *   - cross-set bleed: non-shadow Prudential rows with embedding
 *     IS NOT NULL — value must not have moved versus the pre-write
 *     baseline.
 *   - accidental promotion: rows with metadata.shadow=true AND
 *     valid_until IS NULL — must remain 0.
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow-embedder -- [--limit N] [--dry-run|--live --write]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { embedChunks } from '../../src/services/embeddings/embedder'
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_USD_PER_MILLION_TOKENS,
  assertEmbeddingTargetIsShadow,
  formatEmbeddingVector,
  summarizeCost,
  type EmbeddingTargetRow,
} from '../../src/services/azure-di/shadow-embedder'
import {
  SHADOW_HASH_SCHEME,
  SHADOW_VALID_UNTIL_SENTINEL,
  assertPrudentialOnly,
} from '../../src/services/azure-di/shadow-indexer'
import type { Database } from '../../src/types/database'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

const DEFAULT_INSURER_MATCH = 'Prudential do Brasil'
const DEFAULT_COST_CAP_USD = 5.0
const DEFAULT_OUT_ROOT = path.join('..', 'docs', 'audit-runs')
const SLICE_TAG = 'phase-2-pr3b6.1'

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
  insurerMatch: string
  limit?: number
  maxCostUsd: number
  allowCostBlast: boolean
  outRoot: string
  live: boolean
  write: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> = {
    insurerMatch: DEFAULT_INSURER_MATCH,
    maxCostUsd: DEFAULT_COST_CAP_USD,
    allowCostBlast: false,
    outRoot: DEFAULT_OUT_ROOT,
    live: false,
    write: false,
  }
  let dryRunSeen = false

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
    } else if (arg === '--limit' && next) {
      opts.limit = Number(next)
      i++
    } else if (arg === '--max-cost-usd' && next) {
      opts.maxCostUsd = Number(next)
      i++
    } else if (arg === '--insurer-match' && next) {
      opts.insurerMatch = next
      i++
    } else if (arg === '--out-root' && next) {
      opts.outRoot = next
      i++
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  if (opts.live && !opts.write) {
    throw new Error('--live requires --write (no fetch-only mode; embedding costs money)')
  }
  if (opts.write && !opts.live) {
    throw new Error('--write requires --live')
  }
  if (dryRunSeen && (opts.live || opts.write)) {
    throw new Error('--dry-run conflicts with --live/--write')
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error('--limit must be a positive integer')
  }
  if (!Number.isFinite(opts.maxCostUsd) || (opts.maxCostUsd ?? 0) <= 0) {
    throw new Error('--max-cost-usd must be a positive number')
  }
  return opts as CliOptions
}

function printUsage(): void {
  console.log(`Azure DI shadow embedder (PR 3B slice 3B.6.1, Prudential-only)

Usage:
  npm run phase2:azure-di:shadow-embedder -- [options]

Modes (default: --dry-run):
  --dry-run            no OpenAI call, no DB write; plan-only
  --live --write       OpenAI + UPDATE embeddings + post-write probes

Options:
  --limit <n>          Cap on rows embedded this run
  --max-cost-usd <n>   USD cost cap (default ${DEFAULT_COST_CAP_USD})
  --allow-cost-blast   Permit estimated cost above --max-cost-usd
  --insurer-match <s>  ilike substring (default "${DEFAULT_INSURER_MATCH}")
  --out-root <dir>     Report root (default ${DEFAULT_OUT_ROOT})
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
  // 1. constraint sanity (carried from slice 3B.5)
  try {
    const sql = await readFile(MIGRATION_BASELINE, 'utf8')
    const ok =
      sql.includes('documents_source_type_check') && sql.includes("'conditions_pdf'")
    out.push({
      ok,
      label: 'documents.source_type CHECK includes conditions_pdf',
      detail: ok
        ? `${MIGRATION_BASELINE} defines the constraint`
        : `${MIGRATION_BASELINE} missing the constraint definition`,
    })
  } catch (err) {
    out.push({
      ok: false,
      label: 'documents.source_type CHECK includes conditions_pdf',
      detail: `failed to read ${MIGRATION_BASELINE}: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  // 2. read-path inertness (carried from slice 3B.5)
  try {
    const sql = await readFile(MIGRATION_MATCH_DOCUMENTS, 'utf8')
    const ok = sql.includes('valid_until IS NULL')
    out.push({
      ok,
      label: 'match_documents filters valid_until IS NULL (read path inert)',
      detail: ok
        ? `${MIGRATION_MATCH_DOCUMENTS} contains "valid_until IS NULL"`
        : `${MIGRATION_MATCH_DOCUMENTS} missing the inertness filter`,
    })
  } catch (err) {
    out.push({
      ok: false,
      label: 'match_documents filters valid_until IS NULL (read path inert)',
      detail: `failed to read ${MIGRATION_MATCH_DOCUMENTS}: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  // 3. answer.ts active-insurer probe filter
  try {
    const ts = await readFile(READ_PATH_ANSWER, 'utf8')
    const ok = ts.includes(".is('valid_until', null)")
    out.push({
      ok,
      label: 'answer.ts active-insurer probe filters valid_until null',
      detail: ok
        ? `${READ_PATH_ANSWER} calls .is('valid_until', null)`
        : `${READ_PATH_ANSWER} missing the inertness filter`,
    })
  } catch (err) {
    out.push({
      ok: false,
      label: 'answer.ts active-insurer probe filters valid_until null',
      detail: `failed to read ${READ_PATH_ANSWER}: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  // 4. embedder will NOT touch match_documents
  out.push({
    ok: true,
    label: 'embedder does not import or call match_documents',
    detail:
      "this CLI imports embedChunks + supabase-js only; no rag/ import. assertion is structural.",
  })
  return out
}

async function loadInsurer(
  client: SupabaseClient<Database>,
  match: string
): Promise<{ id: string; name: string }> {
  const { data, error } = await client.from('insurers').select('id, name').ilike('name', `%${match}%`)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`No insurer matches ilike "${match}"`)
  const sorted = [...data].sort((a, b) => a.name.length - b.name.length)
  const insurer = sorted[0]
  assertPrudentialOnly(insurer.name)
  return insurer
}

interface CountSnapshot {
  shadowRowsTotal: number
  shadowRowsAlreadyEmbedded: number
  shadowRowsEligible: number
  nonShadowEmbeddings: number
  shadowLeak: number
}

async function snapshotCounts(
  client: SupabaseClient<Database>,
  insurerId: string
): Promise<CountSnapshot> {
  // Five orthogonal counters. `nonShadowEmbeddings` is computed as
  // `totalPrudentialEmbeddings - shadowEmbeddings` so we don't fight
  // PostgREST's three-valued logic for nullable JSON keys.
  const [total, shadowEmbedded, leak, prudentialEmbedded] = await Promise.all([
    client
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', insurerId)
      .eq('valid_until', SHADOW_VALID_UNTIL_SENTINEL)
      .eq('metadata->>shadow', 'true')
      .eq('metadata->>hash_scheme', 'url-aware-v1'),
    client
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', insurerId)
      .eq('valid_until', SHADOW_VALID_UNTIL_SENTINEL)
      .eq('metadata->>shadow', 'true')
      .eq('metadata->>hash_scheme', 'url-aware-v1')
      .not('embedding', 'is', null),
    client
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', insurerId)
      .is('valid_until', null)
      .eq('metadata->>shadow', 'true'),
    client
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', insurerId)
      .not('embedding', 'is', null),
  ])
  if (total.error) throw total.error
  if (shadowEmbedded.error) throw shadowEmbedded.error
  if (leak.error) throw leak.error
  if (prudentialEmbedded.error) throw prudentialEmbedded.error
  const shadowRowsTotal = total.count ?? 0
  const shadowRowsAlreadyEmbedded = shadowEmbedded.count ?? 0
  const totalPrudentialEmbeddings = prudentialEmbedded.count ?? 0
  const nonShadowEmbeddings = Math.max(0, totalPrudentialEmbeddings - shadowRowsAlreadyEmbedded)
  return {
    shadowRowsTotal,
    shadowRowsAlreadyEmbedded,
    shadowRowsEligible: Math.max(0, shadowRowsTotal - shadowRowsAlreadyEmbedded),
    nonShadowEmbeddings,
    shadowLeak: leak.count ?? 0,
  }
}

interface EligibleRow {
  id: string
  content: string
  content_hash: string
  valid_until: string | null
  embedding: string | null
  metadata: Record<string, unknown> | null
}

async function fetchEligibleRows(
  client: SupabaseClient<Database>,
  insurerId: string,
  limit?: number
): Promise<EligibleRow[]> {
  // Sort by content_hash for deterministic ordering across runs.
  let query = client
    .from('documents')
    .select('id, content, content_hash, valid_until, embedding, metadata')
    .eq('insurer_id', insurerId)
    .eq('valid_until', SHADOW_VALID_UNTIL_SENTINEL)
    .eq('metadata->>shadow', 'true')
    .eq('metadata->>hash_scheme', 'url-aware-v1')
    .is('embedding', null)
    .order('content_hash', { ascending: true })
  if (limit !== undefined) query = query.limit(limit)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as EligibleRow[]
}

async function updateEmbeddingForRow(
  client: SupabaseClient<Database>,
  rowId: string,
  embeddingPgVector: string
): Promise<number> {
  // Defense-in-depth: every shadow-filter predicate is repeated on the
  // UPDATE WHERE clause itself. A stray code path that called this
  // function with a prod row id would still hit zero rows.
  const { error, count } = await client
    .from('documents')
    .update({ embedding: embeddingPgVector }, { count: 'exact' })
    .eq('id', rowId)
    .eq('valid_until', SHADOW_VALID_UNTIL_SENTINEL)
    .eq('metadata->>shadow', 'true')
    .eq('metadata->>hash_scheme', 'url-aware-v1')
    .is('embedding', null)
  if (error) throw new Error(`update failed for row ${rowId}: ${error.message}`)
  return count ?? 0
}

interface RunResult {
  fetchedEligible: number
  embeddedThisRun: number
  skipped: number
  costEstimate: { totalTokens: number; estimatedCostUsd: number }
  preCounts: CountSnapshot
  postCounts?: CountSnapshot
  writeError?: string
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function renderReport(args: {
  generatedAt: string
  mode: 'dry-run' | 'live-write'
  opts: CliOptions
  insurer: { id: string; name: string }
  preflights: PreflightOutcome[]
  result: RunResult
}): string {
  const lines: string[] = []
  lines.push(`# Phase 2 PR 3B.6.1 — shadow embedder report (${args.mode})`)
  lines.push('')
  lines.push(`Generated: ${args.generatedAt}`)
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push('- Prudential-only.')
  lines.push(
    `- Embeds ONLY rows where \`metadata.shadow=true\`, \`metadata.hash_scheme=${SHADOW_HASH_SCHEME}\`,`
  )
  lines.push(`  \`valid_until=${SHADOW_VALID_UNTIL_SENTINEL}\`, and \`embedding IS NULL\`.`)
  lines.push('- No promotion. No DELETE. No read-path change. No new dependency.')
  lines.push(`- Embedding model: \`${EMBEDDING_MODEL}\` (${EMBEDDING_DIMENSIONS}-dim).`)
  lines.push('')
  lines.push('## Inputs')
  lines.push('')
  lines.push(`- mode: \`${args.mode}\``)
  lines.push(`- insurer: ${args.insurer.name} (\`${args.insurer.id}\`)`)
  lines.push(`- limit: ${args.opts.limit ?? '(none)'}`)
  lines.push(`- max-cost-usd: $${args.opts.maxCostUsd.toFixed(2)}`)
  lines.push(`- allow-cost-blast: ${args.opts.allowCostBlast ? 'yes' : 'no'}`)
  lines.push('')

  lines.push('## Preflights')
  lines.push('')
  lines.push('| ok | check | detail |')
  lines.push('|---|---|---|')
  for (const p of args.preflights) {
    lines.push(`| ${p.ok ? 'yes' : 'NO'} | ${p.label} | ${p.detail.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')

  const pre = args.result.preCounts
  lines.push('## Pre-write counts')
  lines.push('')
  lines.push('| metric | value |')
  lines.push('|---|---:|')
  lines.push(`| shadow rows total | ${pre.shadowRowsTotal} |`)
  lines.push(`| shadow rows already embedded | ${pre.shadowRowsAlreadyEmbedded} |`)
  lines.push(`| shadow rows eligible (embedding IS NULL) | ${pre.shadowRowsEligible} |`)
  lines.push(`| **shadow leak baseline** (valid_until IS NULL AND shadow=true) | **${pre.shadowLeak}** |`)
  lines.push(
    `| non-shadow Prudential rows with embedding (baseline) | ${pre.nonShadowEmbeddings} |`
  )
  lines.push('')

  lines.push('## This run')
  lines.push('')
  lines.push('| metric | value |')
  lines.push('|---|---:|')
  lines.push(`| fetched eligible (capped by --limit) | ${args.result.fetchedEligible} |`)
  lines.push(`| embedded this run | ${args.result.embeddedThisRun} |`)
  lines.push(`| skipped (would-overlap with --limit) | ${args.result.skipped} |`)
  lines.push(`| estimated tokens | ${args.result.costEstimate.totalTokens} |`)
  lines.push(
    `| **estimated cost (USD, @ $${EMBEDDING_USD_PER_MILLION_TOKENS}/1M tokens)** | **$${args.result.costEstimate.estimatedCostUsd.toFixed(4)}** |`
  )
  lines.push('')

  if (args.result.postCounts) {
    const post = args.result.postCounts
    const delta = {
      embedded: post.shadowRowsAlreadyEmbedded - pre.shadowRowsAlreadyEmbedded,
      shadowLeak: post.shadowLeak - pre.shadowLeak,
      nonShadow: post.nonShadowEmbeddings - pre.nonShadowEmbeddings,
    }
    lines.push('## Post-write probes')
    lines.push('')
    lines.push('| probe | pre | post | Δ | expected |')
    lines.push('|---|---:|---:|---:|---|')
    lines.push(
      `| shadow rows already embedded | ${pre.shadowRowsAlreadyEmbedded} | ${post.shadowRowsAlreadyEmbedded} | ${delta.embedded} | == embedded this run (${args.result.embeddedThisRun}) |`
    )
    lines.push(
      `| **shadow leak** (active AND shadow=true) | ${pre.shadowLeak} | ${post.shadowLeak} | ${delta.shadowLeak} | **0 (MUST)** |`
    )
    lines.push(
      `| **cross-set bleed** (non-shadow Prudential with embedding) | ${pre.nonShadowEmbeddings} | ${post.nonShadowEmbeddings} | ${delta.nonShadow} | **0 (MUST)** |`
    )
    lines.push('')
    if (post.shadowLeak > 0 || delta.nonShadow !== 0 || delta.embedded !== args.result.embeddedThisRun) {
      lines.push('> :warning: One or more probes failed. See deltas above.')
      lines.push('')
    }
  }

  if (args.result.writeError) {
    lines.push('## Write error')
    lines.push('')
    lines.push('```')
    lines.push(args.result.writeError)
    lines.push('```')
    lines.push('')
  }

  lines.push('## Guardrails honored')
  lines.push('')
  lines.push('- Prudential-only insurer guard (assertPrudentialOnly).')
  lines.push('- assertEmbeddingTargetIsShadow runs on every fetched row before UPDATE.')
  lines.push('- UPDATE WHERE filters sentinel valid_until + hash_scheme + shadow=true + embedding IS NULL.')
  lines.push('- Cost cap (USD); >$5 requires --allow-cost-blast.')
  lines.push('- Idempotent: rows with embedding IS NOT NULL never re-enter the eligible set.')
  lines.push('- No promotion (valid_until untouched).')
  lines.push('- No DELETE. No read-path change. No edit of `match_documents`.')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const mode: 'dry-run' | 'live-write' = opts.write ? 'live-write' : 'dry-run'

  const runId = makeRunId()
  const outDir = path.join(opts.outRoot, `${SLICE_TAG}-${runId}`)
  await mkdir(outDir, { recursive: true })

  console.log(`# shadow-embedder mode=${mode}`)
  console.log(`outDir=${outDir}`)
  console.log(`limit=${opts.limit ?? '(none)'}`)
  console.log(`max-cost-usd=$${opts.maxCostUsd.toFixed(2)}`)

  const preflights = await runStaticPreflights()
  for (const p of preflights) console.log(`preflight ${p.ok ? 'OK ' : 'FAIL'} ${p.label}`)
  if (!preflights.every((p) => p.ok) && opts.write) {
    throw new Error('Static preflights failed. Refusing to --write.')
  }

  const client = makeSupabaseClient()
  const insurer = await loadInsurer(client, opts.insurerMatch)
  console.log(`insurer=${insurer.name} (${insurer.id})`)

  const preCounts = await snapshotCounts(client, insurer.id)
  console.log(
    `pre-write: shadow_total=${preCounts.shadowRowsTotal} already_embedded=${preCounts.shadowRowsAlreadyEmbedded} eligible=${preCounts.shadowRowsEligible} shadow_leak=${preCounts.shadowLeak} non_shadow_emb_baseline=${preCounts.nonShadowEmbeddings}`
  )

  if (preCounts.shadowLeak > 0) {
    throw new Error(
      `HARD STOP: ${preCounts.shadowLeak} shadow rows already leaking into read path before this run. Investigate before embedding.`
    )
  }

  const eligible = await fetchEligibleRows(client, insurer.id, opts.limit)
  // Defense: every fetched row must pass the in-memory shadow guard.
  for (const row of eligible) {
    assertEmbeddingTargetIsShadow(row as EmbeddingTargetRow)
  }
  const cost = summarizeCost(eligible.map((r) => r.content))
  const skipped = Math.max(0, preCounts.shadowRowsEligible - eligible.length)
  console.log(
    `fetched=${eligible.length} skipped=${skipped} estimated_tokens=${cost.totalTokens} estimated_cost_usd=$${cost.estimatedCostUsd.toFixed(4)}`
  )

  if (cost.estimatedCostUsd > opts.maxCostUsd && !opts.allowCostBlast) {
    throw new Error(
      `HARD STOP: estimated cost $${cost.estimatedCostUsd.toFixed(4)} exceeds --max-cost-usd $${opts.maxCostUsd.toFixed(2)}. Pass --allow-cost-blast to override.`
    )
  }

  const result: RunResult = {
    fetchedEligible: eligible.length,
    embeddedThisRun: 0,
    skipped,
    costEstimate: { totalTokens: cost.totalTokens, estimatedCostUsd: cost.estimatedCostUsd },
    preCounts,
  }

  if (mode === 'dry-run') {
    const report = renderReport({
      generatedAt: new Date().toISOString(),
      mode,
      opts,
      insurer,
      preflights,
      result,
    })
    const reportPath = path.join(outDir, 'shadow-embedder-report.md')
    await writeFile(reportPath, report, 'utf8')
    console.log(`\nReport: ${reportPath}`)
    return
  }

  // --live --write
  if (eligible.length === 0) {
    console.log('nothing to embed (eligible=0). Writing report.')
  } else {
    try {
      const texts = eligible.map((r) => r.content)
      const embeddings = await embedChunks(texts)
      if (embeddings.length !== eligible.length) {
        throw new Error(
          `embedChunks returned ${embeddings.length} embeddings for ${eligible.length} texts`
        )
      }
      for (let i = 0; i < eligible.length; i++) {
        const row = eligible[i]
        const vec = embeddings[i]
        if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `row ${row.id}: embedding has ${Array.isArray(vec) ? vec.length : 'non-array'} dims (expected ${EMBEDDING_DIMENSIONS})`
          )
        }
        const updated = await updateEmbeddingForRow(client, row.id, formatEmbeddingVector(vec))
        if (updated !== 1) {
          throw new Error(
            `row ${row.id}: UPDATE affected ${updated} rows (expected 1) — defense filters rejected the write or row already had embedding`
          )
        }
        result.embeddedThisRun += 1
        if ((i + 1) % 25 === 0 || i + 1 === eligible.length) {
          console.log(`  embedded ${i + 1}/${eligible.length}`)
        }
      }
    } catch (err) {
      result.writeError = err instanceof Error ? err.message : String(err)
      console.error(`write FAIL: ${result.writeError}`)
    }
  }

  result.postCounts = await snapshotCounts(client, insurer.id)
  const post = result.postCounts
  console.log(
    `post-write: shadow_total=${post.shadowRowsTotal} already_embedded=${post.shadowRowsAlreadyEmbedded} shadow_leak=${post.shadowLeak} non_shadow_emb=${post.nonShadowEmbeddings}`
  )

  const report = renderReport({
    generatedAt: new Date().toISOString(),
    mode,
    opts,
    insurer,
    preflights,
    result,
  })
  const reportPath = path.join(outDir, 'shadow-embedder-report.md')
  await writeFile(reportPath, report, 'utf8')
  console.log(`\nReport: ${reportPath}`)

  // Final exit-code logic mirrors slice 3B.5: leak > 0, bleed != 0, or
  // UPDATE delta != expected → exit 1.
  const deltaEmbedded = post.shadowRowsAlreadyEmbedded - preCounts.shadowRowsAlreadyEmbedded
  const deltaBleed = post.nonShadowEmbeddings - preCounts.nonShadowEmbeddings
  let exitCode = 0
  if (post.shadowLeak > 0) {
    console.error(`FATAL: shadow leak = ${post.shadowLeak} (must be 0)`)
    exitCode = 1
  }
  if (deltaBleed !== 0) {
    console.error(
      `FATAL: cross-set bleed delta = ${deltaBleed} (must be 0). Non-shadow Prudential embeddings changed.`
    )
    exitCode = 1
  }
  if (deltaEmbedded !== result.embeddedThisRun) {
    console.error(
      `FATAL: embedded-count delta = ${deltaEmbedded}, expected ${result.embeddedThisRun}.`
    )
    exitCode = 1
  }
  if (result.writeError) exitCode = 1
  if (exitCode !== 0) process.exit(exitCode)
}

main().catch((err) => {
  console.error('[phase2/azure-di-shadow-embedder] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
