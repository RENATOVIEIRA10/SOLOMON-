/**
 * Phase 2 / Slice 3B.7.8 — Q16 surgical audit (read-only).
 *
 * One-off audit tool. Embeds Q16's question via the same OpenAI model
 * production uses, dispatches both `match_documents` (prod) and
 * `match_shadow_documents` (slice 3B.6.2), and prints the full top-K
 * side-by-side with per-chunk token-presence breakdown so a reviewer
 * can see, chunk by chunk, why the scoped harness scored shadow 90/50
 * vs legacy 100/75 on Q16.
 *
 * Read-only. No DB write, no edits to read path, no Ragas, no
 * embedder run. The OpenAI call is for the QUESTION embedding only
 * (one tiny call; cost ≈ $0.00000004).
 *
 * Output is a Markdown table block on stdout; the caller captures it
 * into the audit doc.
 */

import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { embedChunks } from '../../src/services/embeddings/embedder'
import {
  SHADOW_EVAL_QUESTIONS,
  chunkContainsToken,
  getScoringText,
  normalize,
  type RetrievedChunk,
} from '../../src/services/azure-di/shadow-eval-metrics'
import { assertPrudentialOnly } from '../../src/services/azure-di/shadow-indexer'
import type { Database } from '../../src/types/database'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

const Q16_ID = 'Q16'
const INSURER_MATCH = 'Prudential do Brasil'
const MATCH_COUNT = 10
const THRESHOLD = 0.0

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name]
    if (v && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function makeClient(): SupabaseClient<Database> {
  const url = envValue('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing Supabase credentials')
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

type RpcRow = {
  id: string
  content: string
  similarity: number
  metadata?: Record<string, unknown> | null
  source_url?: string | null
}

async function callRpc(
  client: SupabaseClient<Database>,
  fn: 'match_documents' | 'match_shadow_documents',
  args: Record<string, unknown>
): Promise<RpcRow[]> {
  const rpc = client.rpc as unknown as (
    this: SupabaseClient<Database>,
    fnName: string,
    a: Record<string, unknown>
  ) => Promise<{ data: RpcRow[] | null; error: { message: string } | null }>
  const resp = await rpc.call(client, fn, args)
  if (resp.error) throw new Error(`${fn} RPC error: ${resp.error.message}`)
  return resp.data ?? []
}

function shortUrl(url: string | null | undefined): string {
  if (!url) return '(no url)'
  return url.replace(/^https:\/\/www\.prudential\.com\.br\/content\/dam\/prudential\//, '...')
}

function findTokensIn(text: string, tokens: readonly string[]): string[] {
  return tokens.filter((t) => chunkContainsToken(text, t))
}

async function main(): Promise<void> {
  const q = SHADOW_EVAL_QUESTIONS.find((x) => x.id === Q16_ID)
  if (!q) throw new Error(`Q16 not found in SHADOW_EVAL_QUESTIONS`)
  console.log(`# Q16 surgical audit`)
  console.log(``)
  console.log(`question: ${q.question}`)
  console.log(`scope:    ${q.scope}`)
  console.log(`tokens:   [${q.expectedTokens.join(', ')}]`)
  console.log(``)

  const client = makeClient()
  const { data: insurers, error: insErr } = await client
    .from('insurers')
    .select('id, name')
    .ilike('name', `%${INSURER_MATCH}%`)
  if (insErr || !insurers || insurers.length === 0) throw new Error('insurer not found')
  const insurer = [...insurers].sort((a, b) => a.name.length - b.name.length)[0]
  assertPrudentialOnly(insurer.name)
  console.log(`insurer:  ${insurer.name} (${insurer.id})`)
  console.log(``)

  const [embedding] = await embedChunks([q.question])
  const pgVector = `[${embedding.join(',')}]`

  const rpcArgs = {
    query_embedding: pgVector,
    match_threshold: THRESHOLD,
    match_count: MATCH_COUNT,
    filter_insurer_id: insurer.id,
  }

  const [legacy, shadow] = await Promise.all([
    callRpc(client, 'match_documents', rpcArgs),
    callRpc(client, 'match_shadow_documents', rpcArgs),
  ])
  console.log(`legacy chunks: ${legacy.length}`)
  console.log(`shadow chunks: ${shadow.length}`)
  console.log(``)

  // --- Side-by-side per-chunk table ---
  console.log(`## Legacy top-K`)
  console.log(``)
  console.log(`| # | id | similarity | source_url | page | section | tokens (content/section) | snippet |`)
  console.log(`|---:|---|---:|---|---:|---|---|---|`)
  legacy.forEach((r, i) => {
    const meta = r.metadata ?? {}
    const page = typeof meta.page === 'string' || typeof meta.page === 'number' ? String(meta.page) : ''
    const section = typeof meta.section === 'string' ? meta.section : ''
    const inContent = findTokensIn(r.content, q.expectedTokens)
    const inSection = section ? findTokensIn(section, q.expectedTokens) : []
    const snippet = r.content.replace(/\s+/g, ' ').slice(0, 120)
    console.log(
      `| ${i + 1} | ${r.id.slice(0, 8)} | ${r.similarity.toFixed(3)} | ${shortUrl(r.source_url)} | ${page} | ${section.slice(0, 50)} | content=[${inContent.join(',')}] section=[${inSection.join(',')}] | ${snippet}… |`
    )
  })
  console.log(``)

  console.log(`## Shadow top-K`)
  console.log(``)
  console.log(`| # | id | similarity | source_url | page | section | tokens (content/section) | snippet |`)
  console.log(`|---:|---|---:|---|---:|---|---|---|`)
  shadow.forEach((r, i) => {
    const meta = r.metadata ?? {}
    const page = typeof meta.page === 'string' || typeof meta.page === 'number' ? String(meta.page) : ''
    const section = typeof meta.section === 'string' ? meta.section : ''
    const inContent = findTokensIn(r.content, q.expectedTokens)
    const inSection = section ? findTokensIn(section, q.expectedTokens) : []
    const snippet = r.content.replace(/\s+/g, ' ').slice(0, 120)
    console.log(
      `| ${i + 1} | ${r.id.slice(0, 8)} | ${r.similarity.toFixed(3)} | ${shortUrl(r.source_url)} | ${page} | ${section.slice(0, 50)} | content=[${inContent.join(',')}] section=[${inSection.join(',')}] | ${snippet}… |`
    )
  })
  console.log(``)

  // --- Token-by-token recall against the UNION ---
  console.log(`## Token recall (UNION of top-K)`)
  console.log(``)
  console.log(`| token | found in legacy union? | found in shadow union? |`)
  console.log(`|---|---|---|`)
  for (const token of q.expectedTokens) {
    const inLegacy = legacy.some((r) => {
      const haystack = getScoringText({
        id: r.id,
        content: r.content,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      } as RetrievedChunk)
      return chunkContainsToken(haystack, token)
    })
    const inShadow = shadow.some((r) => {
      const haystack = getScoringText({
        id: r.id,
        content: r.content,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      } as RetrievedChunk)
      return chunkContainsToken(haystack, token)
    })
    console.log(`| \`${token}\` | ${inLegacy ? 'yes' : '**NO**'} | ${inShadow ? 'yes' : '**NO**'} |`)
  }
  console.log(``)

  // --- Existence of '2 anos' / 'dois anos' anywhere in retrieved top-K ---
  const concreteAliases = ['2 anos', 'dois anos', '2 (dois) anos']
  console.log(`## "2 anos" alias presence in retrieved top-K`)
  console.log(``)
  console.log(`| alias (normalized) | legacy chunks containing | shadow chunks containing |`)
  console.log(`|---|---:|---:|`)
  for (const a of concreteAliases) {
    const legacyHits = legacy.filter((r) => normalize(r.content).includes(normalize(a))).length
    const shadowHits = shadow.filter((r) => normalize(r.content).includes(normalize(a))).length
    console.log(`| \`${a}\` | ${legacyHits} | ${shadowHits} |`)
  }
}

main().catch((err) => {
  console.error('[audit-q16] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
