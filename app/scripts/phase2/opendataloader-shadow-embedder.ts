/**
 * OpenDataLoader shadow embedder.
 *
 * Fills `documents.embedding` on the inert shadow rows written by the
 * OpenDataLoader shadow indexer. The stock azure-di embedder is hardcoded to
 * Prudential, so this one scopes by `metadata.parser = 'opendataloader-v1'`
 * instead and covers all four insurers.
 *
 * Safety (mirrors the azure-di embedder):
 *   - UPDATEs only rows that satisfy ALL of: `valid_until = sentinel`,
 *     `metadata.shadow = true`, `metadata.hash_scheme = 'url-aware-v1'`,
 *     `metadata.parser = 'opendataloader-v1'`, `embedding IS NULL`.
 *   - `assertEmbeddingTargetIsShadow` runs on every row before its UPDATE.
 *   - Idempotent: the UPDATE mirrors the WHERE, so a promoted or prod row is
 *     never touched, and re-runs skip rows already embedded.
 *   - No promotion: `valid_until` stays at the sentinel.
 *   - Cost cap on estimated USD (>$5 needs --allow-cost-blast).
 *
 * `--live` alone is rejected — writing requires `--live --write`.
 *
 * Run from app/:
 *   npm run phase2:odl:shadow-embedder -- --dry-run
 *   npm run phase2:odl:shadow-embedder -- --live --write [--limit N]
 */

import path from 'node:path'

import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { embedChunks } from '../../src/services/embeddings/embedder'
import {
  assertEmbeddingTargetIsShadow,
  formatEmbeddingVector,
  summarizeCost,
  type EmbeddingTargetRow,
} from '../../src/services/azure-di/shadow-embedder'
import { SHADOW_VALID_UNTIL_SENTINEL } from '../../src/services/azure-di/shadow-indexer'
import { OPENDATALOADER_PARSER } from '../../src/services/opendataloader/adapter'
import type { Database } from '../../src/types/database'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

const HASH_SCHEME = 'url-aware-v1'
const BATCH = 100
const DEFAULT_MAX_COST_USD = 5

interface CliOptions {
  write: boolean
  live: boolean
  limit?: number
  maxCostUsd: number
  allowCostBlast: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { write: false, live: false, maxCostUsd: DEFAULT_MAX_COST_USD, allowCostBlast: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') opts.write = false
    else if (arg === '--live') opts.live = true
    else if (arg === '--write') opts.write = true
    else if (arg === '--allow-cost-blast') opts.allowCostBlast = true
    else if (arg === '--limit') opts.limit = Number(argv[++i])
    else if (arg === '--max-cost-usd') opts.maxCostUsd = Number(argv[++i])
    else {
      console.error(`unknown flag: ${arg}`)
      process.exit(2)
    }
  }
  if (opts.write && !opts.live) {
    console.error('Refusing --write without --live. Writing embeddings costs money: use --live --write.')
    process.exit(2)
  }
  return opts
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
  if (!url || !key) throw new Error('Missing Supabase credentials in .env.local.')
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

async function fetchEligible(client: SupabaseClient<Database>, limit?: number): Promise<EmbeddingTargetRow[]> {
  const rows: EmbeddingTargetRow[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await client
      .from('documents')
      .select('id, content, content_hash, valid_until, embedding, metadata')
      .eq('valid_until', SHADOW_VALID_UNTIL_SENTINEL)
      .eq('metadata->>shadow', 'true')
      .eq('metadata->>hash_scheme', HASH_SCHEME)
      .eq('metadata->>parser', OPENDATALOADER_PARSER)
      .is('embedding', null)
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    rows.push(...(data as unknown as EmbeddingTargetRow[]))
    if (limit && rows.length >= limit) return rows.slice(0, limit)
    if (data.length < 1000) break
  }
  return rows
}

/** UPDATE mirrors the eligibility WHERE, so a promoted/prod row can never be hit. */
async function updateEmbedding(
  client: SupabaseClient<Database>,
  id: string,
  vector: number[],
): Promise<void> {
  const { error } = await client
    .from('documents')
    .update({ embedding: formatEmbeddingVector(vector) })
    .eq('id', id)
    .eq('valid_until', SHADOW_VALID_UNTIL_SENTINEL)
    .eq('metadata->>shadow', 'true')
    .eq('metadata->>parser', OPENDATALOADER_PARSER)
    .is('embedding', null)
  if (error) throw error
}

/** Rows that are opendataloader shadow AND visible to the read path. MUST be 0. */
async function probePromotion(client: SupabaseClient<Database>): Promise<number> {
  const { count, error } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('metadata->>parser', OPENDATALOADER_PARSER)
    .eq('metadata->>shadow', 'true')
    .is('valid_until', null)
  if (error) throw error
  return count ?? 0
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const client = makeSupabaseClient()

  console.log(`# opendataloader shadow-embedder  mode=${opts.write ? 'LIVE WRITE' : 'dry-run'}`)

  const eligible = await fetchEligible(client, opts.limit)
  const cost = summarizeCost(eligible.map((r) => r.content))
  console.log(
    `eligible rows=${cost.rowCount}  estimated_tokens=${cost.totalTokens}  estimated_cost_usd=$${cost.estimatedCostUsd.toFixed(4)}`,
  )

  if (cost.estimatedCostUsd > opts.maxCostUsd && !opts.allowCostBlast) {
    console.error(
      `ABORT: estimated $${cost.estimatedCostUsd.toFixed(2)} exceeds cap $${opts.maxCostUsd.toFixed(2)}. Use --allow-cost-blast to override.`,
    )
    process.exit(2)
  }

  if (!opts.write) {
    console.log('\nDry-run: no OpenAI call, no UPDATE. Re-run with --live --write to embed.')
    return
  }
  if (eligible.length === 0) {
    console.log('Nothing to embed.')
    return
  }

  const promotionBefore = await probePromotion(client)
  if (promotionBefore !== 0) {
    throw new Error(`ABORT: ${promotionBefore} opendataloader shadow rows are already visible before embedding.`)
  }

  let embedded = 0
  for (let i = 0; i < eligible.length; i += BATCH) {
    const batch = eligible.slice(i, i + BATCH)
    for (const row of batch) assertEmbeddingTargetIsShadow(row)
    const vectors = await embedChunks(batch.map((r) => r.content))
    if (vectors.length !== batch.length) {
      throw new Error(`embedChunks returned ${vectors.length} vectors for ${batch.length} rows`)
    }
    for (let j = 0; j < batch.length; j++) await updateEmbedding(client, batch[j].id, vectors[j])
    embedded += batch.length
    console.log(`  embedded ${embedded}/${eligible.length}`)
  }

  const promotionAfter = await probePromotion(client)
  if (promotionAfter !== 0) {
    throw new Error(`CONTRACT VIOLATION: ${promotionAfter} opendataloader shadow rows became visible to the read path.`)
  }

  const remaining = await fetchEligible(client, 1)
  console.log(
    `\nDone. embedded=${embedded}  promotion probe before/after=${promotionBefore}/${promotionAfter} (must be 0)  ` +
      `remaining eligible=${remaining.length}`,
  )
}

void main()
