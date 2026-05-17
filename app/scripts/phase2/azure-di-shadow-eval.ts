/**
 * Phase 2 / PR 3B slice 3B.6.3 — legacy-vs-shadow eval harness (CLI).
 *
 * Reads the 9 Prudential-impacted Ragas questions baked into the pure
 * module, embeds each one once via the same model production uses
 * (text-embedding-3-small, 1536-dim), dispatches BOTH `match_documents`
 * (production) AND `match_shadow_documents` (slice 3B.6.2) with the same
 * embedding, computes the proxy keywordPrecision / keywordRecall, and
 * writes a side-by-side Markdown report.
 *
 * Strict isolation guardrails (CEO call on PR #32 merge):
 *   - NO import from `app/src/services/rag/*`.
 *   - NO edit of `match_documents`, `answer.ts`, `compare.ts`.
 *   - NO promotion. `valid_until` stays at the sentinel.
 *   - NO DELETE.
 *   - NO Azos / MAG.
 *   - Default mode is NO LLM (cost-free). Full Ragas remains a separate
 *     gated slice (3B.6.4) if/when needed.
 *
 * Stop signal: if `shadow CP < legacy CP` OR `shadow CR < legacy CR`
 * for ANY category aggregate, the harness exits 1. The report still
 * writes so the regression is auditable.
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow-eval -- [--limit N] [--match-count N]
 *                                          [--threshold X] [--out-root <dir>]
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { embedChunks } from '../../src/services/embeddings/embedder'
import { assertPrudentialOnly } from '../../src/services/azure-di/shadow-indexer'
import {
  SHADOW_EVAL_QUESTIONS,
  scoreQuestion,
  tallyCategoryAggregates,
  tallyControlAggregate,
  tallyOutOfScopeCommercialAggregate,
  type CategoryAggregate,
  type ControlAggregate,
  type OutOfScopeCommercialAggregate,
  type QuestionComparison,
  type RetrievedChunk,
  type ShadowEvalQuestion,
} from '../../src/services/azure-di/shadow-eval-metrics'
import type { Database } from '../../src/types/database'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

const DEFAULT_INSURER_MATCH = 'Prudential do Brasil'
const DEFAULT_MATCH_COUNT = 10
const DEFAULT_THRESHOLD = 0.0
const DEFAULT_OUT_ROOT = path.join('..', 'docs', 'audit-runs')
const SLICE_TAG = 'phase-2-pr3b6.3'

interface CliOptions {
  insurerMatch: string
  matchCount: number
  threshold: number
  limit?: number
  outRoot: string
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    insurerMatch: DEFAULT_INSURER_MATCH,
    matchCount: DEFAULT_MATCH_COUNT,
    threshold: DEFAULT_THRESHOLD,
    outRoot: DEFAULT_OUT_ROOT,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else if (arg === '--limit' && next) {
      opts.limit = Number(next)
      i++
    } else if (arg === '--match-count' && next) {
      opts.matchCount = Number(next)
      i++
    } else if (arg === '--threshold' && next) {
      opts.threshold = Number(next)
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
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error('--limit must be a positive integer')
  }
  if (!Number.isInteger(opts.matchCount) || opts.matchCount < 1) {
    throw new Error('--match-count must be a positive integer')
  }
  if (!Number.isFinite(opts.threshold) || opts.threshold < 0 || opts.threshold > 1) {
    throw new Error('--threshold must be a number in [0, 1]')
  }
  return opts
}

function printUsage(): void {
  console.log(`Phase 2 PR 3B slice 3B.6.3 — shadow eval harness (Prudential-only)

Usage:
  npm run phase2:azure-di:shadow-eval -- [options]

Options:
  --limit <n>          Cap on questions evaluated (default: all 9)
  --match-count <n>    top-K per retrieval (default ${DEFAULT_MATCH_COUNT})
  --threshold <x>      similarity threshold [0,1] (default ${DEFAULT_THRESHOLD})
  --insurer-match <s>  ilike substring (default "${DEFAULT_INSURER_MATCH}")
  --out-root <dir>     Report root (default ${DEFAULT_OUT_ROOT})

The harness exits 1 if shadow loses on CP or CR in any category aggregate.
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

type RpcResponse = {
  data: Array<{
    id: string
    content: string
    similarity: number
    metadata?: Record<string, unknown> | null
  }> | null
  error: { message: string } | null
}

async function callMatchFn(
  client: SupabaseClient<Database>,
  fn: 'match_documents' | 'match_shadow_documents',
  args: Record<string, unknown>
): Promise<RetrievedChunk[]> {
  // Cast through unknown because both RPC functions are user-defined and
  // not present in the generated Database type. Call as a method on
  // `client` so `this` stays bound (mirror of the slice 3B.5 fix on PR #28).
  //
  // Slice 3B.7.6: forward `metadata` so the proxy metric can scan
  // section/heading text alongside content via getScoringText().
  const rpc = client.rpc as unknown as (
    this: SupabaseClient<Database>,
    fnName: string,
    a: Record<string, unknown>
  ) => Promise<RpcResponse>
  const resp = await rpc.call(client, fn, args)
  if (resp.error) throw new Error(`${fn} RPC error: ${resp.error.message}`)
  return (resp.data ?? []).map((r) => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata ?? null,
  }))
}

interface PerQuestionRun {
  question: ShadowEvalQuestion
  legacyChunks: RetrievedChunk[]
  shadowChunks: RetrievedChunk[]
}

async function runOneQuestion(args: {
  client: SupabaseClient<Database>
  insurerId: string
  question: ShadowEvalQuestion
  queryEmbeddingPgVector: string
  matchCount: number
  threshold: number
}): Promise<PerQuestionRun> {
  const baseRpcArgs: Record<string, unknown> = {
    query_embedding: args.queryEmbeddingPgVector,
    match_threshold: args.threshold,
    match_count: args.matchCount,
    filter_insurer_id: args.insurerId,
  }
  const [legacyChunks, shadowChunks] = await Promise.all([
    callMatchFn(args.client, 'match_documents', baseRpcArgs),
    callMatchFn(args.client, 'match_shadow_documents', baseRpcArgs),
  ])
  return { question: args.question, legacyChunks, shadowChunks }
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function formatPct(x: number): string {
  return (x * 100).toFixed(1) + '%'
}

function formatDelta(x: number): string {
  const sign = x > 0 ? '+' : x < 0 ? '' : '±'
  return `${sign}${(x * 100).toFixed(1)}pp`
}

function renderPerQuestionRow(c: QuestionComparison, idx: number): string {
  const notes: string[] = []
  if (c.shadow.matchedTokens.length === c.question.expectedTokens.length) {
    notes.push('shadow: all expected tokens found')
  }
  if (c.legacy.matchedTokens.length === c.question.expectedTokens.length) {
    notes.push('legacy: all expected tokens found')
  }
  if (c.deltaCp < 0 || c.deltaCr < 0) notes.push('shadow regressed')
  return `| ${idx} | ${c.question.id} | ${c.question.category} | ${formatPct(c.legacy.keywordPrecision)} | ${formatPct(c.shadow.keywordPrecision)} | ${formatDelta(c.deltaCp)} | ${formatPct(c.legacy.keywordRecall)} | ${formatPct(c.shadow.keywordRecall)} | ${formatDelta(c.deltaCr)} | ${c.legacy.chunkCount} | ${c.shadow.chunkCount} | ${notes.join('; ')} |`
}

function renderReport(args: {
  generatedAt: string
  opts: CliOptions
  insurer: { id: string; name: string }
  comparisons: readonly QuestionComparison[]
  aggregates: readonly CategoryAggregate[]
  controlAggregate: ControlAggregate | null
  outOfScopeCommercialAggregate: OutOfScopeCommercialAggregate | null
}): string {
  const lines: string[] = []
  lines.push('# Phase 2 PR 3B slice 3B.6.3 — legacy vs shadow eval report')
  lines.push('')
  lines.push(`Generated: ${args.generatedAt}`)
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push('- Prudential-only.')
  lines.push('- Compares `match_documents` (production) vs `match_shadow_documents` (slice 3B.6.2).')
  lines.push('- Same query embedding dispatched to both functions per question.')
  lines.push('- **No LLM judge.** CP / CR here are deterministic keyword-overlap proxies — see methodology below.')
  lines.push('- No production read path import. No edit of match_documents/answer.ts/compare.ts.')
  lines.push(
    '- Scope tags (slice 3B.7.1 + 3B.7.5): `conditions` | `control_rate_table` | `out_of_scope_commercial`. Only `conditions` feeds the stop signal.'
  )
  lines.push('')
  lines.push('## Inputs')
  lines.push('')
  lines.push(`- insurer: ${args.insurer.name} (\`${args.insurer.id}\`)`)
  lines.push(`- questions: ${args.comparisons.length}`)
  lines.push(`- match_count: ${args.opts.matchCount}`)
  lines.push(`- threshold: ${args.opts.threshold}`)
  lines.push('')
  lines.push('## Methodology (proxy metric)')
  lines.push('')
  lines.push('For each question, an explicit `expectedTokens` set (3-6 case- and accent-insensitive')
  lines.push('tokens) encodes what a correct retrieval MUST surface. Both functions are scored by:')
  lines.push('')
  lines.push('- **CP (proxy)** = fraction of retrieved chunks containing ≥1 expected token.')
  lines.push('- **CR (proxy)** = fraction of expected tokens found in the UNION of retrieved chunks.')
  lines.push('')
  lines.push('Same function applied to both corpora → Δ is fair. Not Ragas CP/CR; a deterministic')
  lines.push('directional signal. Full Ragas (LLM judge) is gated as slice 3B.6.4.')
  lines.push('')

  // --- In-scope (conditions) per-question ---
  const inScope = args.comparisons.filter((c) => c.question.scope === 'conditions')
  const control = args.comparisons.filter((c) => c.question.scope === 'control_rate_table')
  const outOfScope = args.comparisons.filter((c) => c.question.scope === 'out_of_scope_commercial')
  lines.push(`## Per-question results — in-scope conditions_pdf (N=${inScope.length})`)
  lines.push('')
  lines.push('These questions DRIVE the stop signal: their answers live in `conditions_pdf`, so')
  lines.push('the shadow corpus is structurally capable of retrieving them.')
  lines.push('')
  lines.push(
    '| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |'
  )
  lines.push('|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  inScope.forEach((c, i) => {
    lines.push(renderPerQuestionRow(c, i + 1))
  })
  lines.push('')

  // --- Control (rate_table) per-question ---
  if (control.length > 0) {
    lines.push(`## Per-question results — control rate_table_pdf (N=${control.length})`)
    lines.push('')
    lines.push('Informational only. These answers live in `rate_table_pdf` and the shadow corpus')
    lines.push('is `conditions_pdf`-only by contract. Shadow is **not expected** to score and')
    lines.push('these rows **never feed the stop signal**.')
    lines.push('')
    lines.push(
      '| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |'
    )
    lines.push('|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|')
    control.forEach((c, i) => {
      lines.push(renderPerQuestionRow(c, i + 1))
    })
    lines.push('')
  }

  // --- Out-of-scope (commercial) per-question (slice 3B.7.5) ---
  if (outOfScope.length > 0) {
    lines.push(`## Per-question results — out-of-scope commercial (N=${outOfScope.length})`)
    lines.push('')
    lines.push("Informational only. These questions ask for product-positioning facts that")
    lines.push('do not live in ANY indexed PDF (neither `conditions_pdf` nor `rate_table_pdf`).')
    lines.push('Legacy may score artificially via synthetic metadata-header chunks the legacy')
    lines.push('ingestion injects; shadow chunker does not. Reported for transparency about')
    lines.push("legacy's structured-data injection behavior; **never feed the stop signal**.")
    lines.push('')
    lines.push(
      '| # | Q | category | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | legacy chunks | shadow chunks | notes |'
    )
    lines.push('|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|')
    outOfScope.forEach((c, i) => {
      lines.push(renderPerQuestionRow(c, i + 1))
    })
    lines.push('')
  }

  // --- Per-question token detail (unchanged section; both scopes) ---
  lines.push('## Per-question token detail')
  lines.push('')
  for (const c of args.comparisons) {
    lines.push(`### ${c.question.id} — ${c.question.category} (${c.question.scope})`)
    lines.push('')
    lines.push(`> ${c.question.question}`)
    lines.push('')
    lines.push(`- expected tokens (${c.question.expectedTokens.length}): \`[${c.question.expectedTokens.join(', ')}]\``)
    lines.push(`- legacy matched: \`[${c.legacy.matchedTokens.join(', ')}]\` (${c.legacy.matchedTokens.length}/${c.question.expectedTokens.length})`)
    lines.push(`- shadow matched: \`[${c.shadow.matchedTokens.join(', ')}]\` (${c.shadow.matchedTokens.length}/${c.question.expectedTokens.length})`)
    if (c.question.notes) lines.push(`- rationale: ${c.question.notes}`)
    lines.push('')
  }

  // --- Aggregates ---
  lines.push('## Category aggregates — in-scope conditions_pdf only')
  lines.push('')
  lines.push('These aggregates DRIVE the stop signal.')
  lines.push('')
  lines.push('| category | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | shadow regressed? |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const a of args.aggregates) {
    lines.push(
      `| ${a.category} | ${a.questionCount} | ${formatPct(a.legacyCp)} | ${formatPct(a.shadowCp)} | ${formatDelta(a.deltaCp)} | ${formatPct(a.legacyCr)} | ${formatPct(a.shadowCr)} | ${formatDelta(a.deltaCr)} | ${a.shadowRegressed ? '**YES**' : 'no'} |`
    )
  }
  lines.push('')

  if (args.controlAggregate) {
    const ca = args.controlAggregate
    lines.push('## Control aggregate — rate_table_pdf (informational only, never a stop signal)')
    lines.push('')
    lines.push('| scope | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | reading |')
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|')
    const reading =
      ca.deltaCp < 0 || ca.deltaCr < 0
        ? 'expected: shadow loses by design (corpus is conditions_pdf-only)'
        : 'shadow tied or beat legacy on rate questions — unexpected; check curation'
    lines.push(
      `| ${ca.scope} | ${ca.questionCount} | ${formatPct(ca.legacyCp)} | ${formatPct(ca.shadowCp)} | ${formatDelta(ca.deltaCp)} | ${formatPct(ca.legacyCr)} | ${formatPct(ca.shadowCr)} | ${formatDelta(ca.deltaCr)} | ${reading} |`
    )
    lines.push('')
  }

  if (args.outOfScopeCommercialAggregate) {
    const oa = args.outOfScopeCommercialAggregate
    lines.push(
      '## Out-of-scope commercial aggregate (informational only, never a stop signal)'
    )
    lines.push('')
    lines.push('Questions whose ground-truth fact lives only in commercial / sales material —')
    lines.push('NOT in any indexed PDF. Shadow is expected to score 0; any legacy lift here is')
    lines.push("a legacy-ingestion artifact (synthetic metadata-header chunk), not retrieval.")
    lines.push('')
    lines.push('| scope | Qs | Legacy CP | Shadow CP | Δ CP | Legacy CR | Shadow CR | Δ CR | reading |')
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|')
    const reading =
      oa.legacyCp > 0 || oa.legacyCr > 0
        ? "legacy scored via synthetic metadata-header (ingestion artifact, not retrieval)"
        : 'neither corpus surfaced the commercial-only facts (as expected)'
    lines.push(
      `| ${oa.scope} | ${oa.questionCount} | ${formatPct(oa.legacyCp)} | ${formatPct(oa.shadowCp)} | ${formatDelta(oa.deltaCp)} | ${formatPct(oa.legacyCr)} | ${formatPct(oa.shadowCr)} | ${formatDelta(oa.deltaCr)} | ${reading} |`
    )
    lines.push('')
  }

  const anyRegressed = args.aggregates.some((a) => a.shadowRegressed)
  lines.push('## Stop signal (CEO criterion: shadow CP < legacy CP OR shadow CR < legacy CR — IN-SCOPE only)')
  lines.push('')
  if (anyRegressed) {
    lines.push('> :warning: **STRATEGIC STOP** — shadow regressed on at least one in-scope category aggregate.')
    lines.push('> The harness exits with code 1. Investigate before any promotion discussion.')
  } else {
    lines.push('> :white_check_mark: shadow did NOT regress on any in-scope category aggregate. Exit code 0.')
  }
  lines.push('')

  lines.push('## Guardrails honored')
  lines.push('')
  lines.push('- No production read-path import (no `app/src/services/rag/*` import).')
  lines.push('- No edit of `match_documents`, `answer.ts`, `compare.ts`.')
  lines.push('- No LLM judge; metric is the deterministic keyword-overlap proxy described above.')
  lines.push('- No promotion. `valid_until` stays at the sentinel. No DELETE.')
  lines.push('- Prudential-only insurer guard via `assertPrudentialOnly`.')
  lines.push('- Stop signal restricted to `scope=conditions` aggregates per slice 3B.7.1.')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const runId = makeRunId()
  const outDir = path.join(opts.outRoot, `${SLICE_TAG}-${runId}`)
  await mkdir(outDir, { recursive: true })

  console.log('# shadow-eval harness')
  console.log(`outDir=${outDir}`)
  console.log(`match-count=${opts.matchCount} threshold=${opts.threshold}`)

  const client = makeSupabaseClient()
  const insurer = await loadInsurer(client, opts.insurerMatch)
  console.log(`insurer=${insurer.name} (${insurer.id})`)

  const limit = opts.limit ?? SHADOW_EVAL_QUESTIONS.length
  const questions = SHADOW_EVAL_QUESTIONS.slice(0, limit)
  console.log(`questions=${questions.length} of ${SHADOW_EVAL_QUESTIONS.length}`)

  // Embed all question texts in one OpenAI call (batched by embedChunks).
  const embeddings = await embedChunks(questions.map((q) => q.question))
  if (embeddings.length !== questions.length) {
    throw new Error(`expected ${questions.length} embeddings, got ${embeddings.length}`)
  }

  const perQuestion: PerQuestionRun[] = []
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const vec = embeddings[i]
    const pgVector = `[${vec.join(',')}]`
    console.log(`\n[${i + 1}/${questions.length}] ${q.id} (${q.category}) — ${q.question.slice(0, 70)}…`)
    const run = await runOneQuestion({
      client,
      insurerId: insurer.id,
      question: q,
      queryEmbeddingPgVector: pgVector,
      matchCount: opts.matchCount,
      threshold: opts.threshold,
    })
    console.log(`  legacy chunks=${run.legacyChunks.length} shadow chunks=${run.shadowChunks.length}`)
    perQuestion.push(run)
  }

  const comparisons: QuestionComparison[] = perQuestion.map((r) => {
    const legacy = scoreQuestion(r.legacyChunks, r.question.expectedTokens)
    const shadow = scoreQuestion(r.shadowChunks, r.question.expectedTokens)
    return {
      question: r.question,
      legacy,
      shadow,
      deltaCp: shadow.keywordPrecision - legacy.keywordPrecision,
      deltaCr: shadow.keywordRecall - legacy.keywordRecall,
    }
  })

  const aggregates = tallyCategoryAggregates(comparisons)
  const controlAggregate = tallyControlAggregate(comparisons)
  const outOfScopeCommercialAggregate = tallyOutOfScopeCommercialAggregate(comparisons)

  for (const a of aggregates) {
    console.log(
      `\nagg ${a.category} in-scope (${a.questionCount} Qs): CP ${formatPct(a.legacyCp)} → ${formatPct(a.shadowCp)} (${formatDelta(a.deltaCp)}), CR ${formatPct(a.legacyCr)} → ${formatPct(a.shadowCr)} (${formatDelta(a.deltaCr)})${a.shadowRegressed ? '  [shadow regressed]' : ''}`
    )
  }
  if (controlAggregate) {
    console.log(
      `\nagg control_rate_table (${controlAggregate.questionCount} Qs, informational): CP ${formatPct(controlAggregate.legacyCp)} → ${formatPct(controlAggregate.shadowCp)} (${formatDelta(controlAggregate.deltaCp)}), CR ${formatPct(controlAggregate.legacyCr)} → ${formatPct(controlAggregate.shadowCr)} (${formatDelta(controlAggregate.deltaCr)})  [never feeds stop signal]`
    )
  }
  if (outOfScopeCommercialAggregate) {
    const oa = outOfScopeCommercialAggregate
    console.log(
      `\nagg out_of_scope_commercial (${oa.questionCount} Qs, informational): CP ${formatPct(oa.legacyCp)} → ${formatPct(oa.shadowCp)} (${formatDelta(oa.deltaCp)}), CR ${formatPct(oa.legacyCr)} → ${formatPct(oa.shadowCr)} (${formatDelta(oa.deltaCr)})  [never feeds stop signal]`
    )
  }

  const report = renderReport({
    generatedAt: new Date().toISOString(),
    opts,
    insurer,
    comparisons,
    aggregates,
    controlAggregate,
    outOfScopeCommercialAggregate,
  })
  const reportPath = path.join(outDir, 'shadow-eval-report.md')
  await writeFile(reportPath, report, 'utf8')
  console.log(`\nReport: ${reportPath}`)

  const anyRegressed = aggregates.some((a) => a.shadowRegressed)
  if (anyRegressed) {
    console.error(
      '\nSTRATEGIC STOP: shadow regressed on at least one in-scope category aggregate. See report for details.'
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[phase2/azure-di-shadow-eval] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
