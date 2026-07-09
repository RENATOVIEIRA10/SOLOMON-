/**
 * OpenDataLoader shadow indexer.
 *
 * Pipeline (local parse; no Azure, no OpenAI):
 *
 *   PDF  ->  runOpenDataLoader (java -jar)   ->  OdlDocument
 *        ->  openDataLoaderToLayout          ->  LayoutAnalyzeResult
 *        ->  buildShadowRows                 ->  inert `documents` rows
 *            (assertInsurer = 4-insurer allowlist,
 *             parserStamp   = opendataloader-v1,
 *             gateOptions.tablesAreAtomic = true)
 *        ->  assertRowsAreInert              ->  report / upsert
 *
 * Modes:
 *   (default)   dry-run: builds rows, runs the asserts, writes NOTHING.
 *   --write     upserts the inert rows, then proves nothing leaked.
 *
 * Rows are written with `embedding = null`. Embeddings are a separate,
 * explicit step (the shadow embedder CLI), so a parse bug can never cost
 * OpenAI money.
 *
 * Inertness contract (enforced, not assumed):
 *   - `valid_until` = sentinel  -> invisible to the read path
 *   - `metadata.shadow = true`, `content_hash` prefixed `shadow-v4:`
 *   - before AND after the write, zero rows may be both shadow and visible
 *   - `match_documents` (the real prod RPC) must return no shadow row
 *
 * Scope: the four commercial life insurers — Prudential, MAG, MetLife, Azos.
 * The Azure DI CLI is untouched and stays Prudential-only.
 *
 * Env:
 *   OPENDATALOADER_JAR   path to opendataloader-pdf-cli.jar (required)
 *   ODL_PDF_DIR          dir holding the condition PDFs (default: ./pdfs)
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Run from app/:
 *   npm run phase2:odl:shadow-indexer -- --all
 *   npm run phase2:odl:shadow-indexer -- --only mag
 *   npm run phase2:odl:shadow-indexer -- --only mag --write
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  SHADOW_VALID_UNTIL_SENTINEL,
  assertRowsAreInert,
  buildShadowRows,
  type BuildShadowRowsResult,
} from '../../src/services/azure-di/shadow-indexer'
import type { ProductCatalogRow } from '../../src/services/azure-di/product-resolver'
import type { Database, TablesInsert } from '../../src/types/database'
import {
  OPENDATALOADER_PARSER,
  openDataLoaderToLayout,
} from '../../src/services/opendataloader/adapter'
import { assertInsurerAllowed } from '../../src/services/opendataloader/guard'
import { runOpenDataLoader } from '../../src/services/opendataloader/runner'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

/**
 * Each condition PDF paired with the canonical `source_url` already present in
 * `documents`. The URL matters: it is mixed into the shadow `content_hash`, so
 * a wrong one would create duplicate rows instead of updating in place.
 */
interface ManifestEntry {
  insurer: string
  file: string
  sourceUrl: string
}

const MANIFEST: readonly ManifestEntry[] = [
  {
    insurer: 'MAG Seguros',
    file: 'mag-vida-inteira.pdf',
    sourceUrl:
      'https://magportaisinststgprd.blob.core.windows.net/magseguros/2023/09/2694-e-2695-Condicoes-Gerais-Vida-Inteira-Mar23.pdf',
  },
  {
    insurer: 'MetLife',
    file: 'metlife-vida-total.pdf',
    sourceUrl:
      'https://www.metlife.com.br/content/dam/metlifecom/br/homepage/pdfs/suporte/condicoes-gerais/cliente-individual/seguro-de-vida/cg-vida-total.pdf',
  },
  {
    insurer: 'Prudential do Brasil',
    file: 'prudential-vida-inteira.pdf',
    sourceUrl:
      'https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira.pdf',
  },
  {
    insurer: 'Azos',
    file: 'azos-especialista.pdf',
    sourceUrl: 'https://files.azos.com.br/f/especialista-outubro-2025.pdf',
  },
]

interface CliOptions {
  all: boolean
  only?: string
  write: boolean
  pdfDir: string
  maxHeapMb: number
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    all: false,
    write: false,
    pdfDir: process.env.ODL_PDF_DIR ?? './pdfs',
    maxHeapMb: 512,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--all') opts.all = true
    else if (arg === '--only') opts.only = argv[++i]
    else if (arg === '--write') opts.write = true
    else if (arg === '--dry-run') opts.write = false
    else if (arg === '--pdf-dir') opts.pdfDir = argv[++i]
    else if (arg === '--max-heap-mb') opts.maxHeapMb = Number(argv[++i])
    else {
      console.error(`unknown flag: ${arg}`)
      process.exit(2)
    }
  }
  if (!opts.all && !opts.only) {
    console.error('usage: --all | --only <insurer-substring>   [--write]')
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
  if (!url || !key) {
    throw new Error(
      'Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.',
    )
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

/** Same shape as the azure-di loader, gated by the OpenDataLoader allowlist. */
async function loadInsurer(
  client: SupabaseClient<Database>,
  match: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await client.from('insurers').select('id, name').ilike('name', `%${match}%`)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`No insurer matches ilike "${match}". Aborting.`)
  const insurer = [...data].sort((a, b) => a.name.length - b.name.length)[0]
  assertInsurerAllowed(insurer.name)
  return insurer
}

async function loadCatalog(
  client: SupabaseClient<Database>,
  insurerId: string,
): Promise<ProductCatalogRow[]> {
  const { data, error } = await client
    .from('products')
    .select('id, name, code, susep_process, terms_url')
    .eq('insurer_id', insurerId)
  if (error) throw error
  return (data ?? []) as ProductCatalogRow[]
}

// --- write-path probes: the row must never be visible to production ---

/** Rows that are BOTH shadow AND visible to the read path. MUST be zero. */
async function probeShadowLeak(
  client: SupabaseClient<Database>,
  insurerId: string,
  sourceUrl: string,
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

/** Everything the read path sees for this (insurer, url) — legacy baseline. */
async function probeActiveRowsForUrl(
  client: SupabaseClient<Database>,
  insurerId: string,
  sourceUrl: string,
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

/** Shadow rows actually parked at the sentinel for this (insurer, url). */
async function countUpsertedShadow(
  client: SupabaseClient<Database>,
  insurerId: string,
  sourceUrl: string,
): Promise<number> {
  const { count, error } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('insurer_id', insurerId)
    .eq('source_url', sourceUrl)
    .eq('valid_until', SHADOW_VALID_UNTIL_SENTINEL)
    .eq('metadata->>hash_scheme', 'url-aware-v1')
  if (error) throw error
  return count ?? 0
}

async function upsertRows(
  client: SupabaseClient<Database>,
  rows: ReadonlyArray<TablesInsert<'documents'>>,
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
        `upsert batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(rows.length / BATCH)} failed: ${error.message}`,
      )
    }
  }
}

async function pickActiveEmbedding(
  client: SupabaseClient<Database>,
  insurerId: string,
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
 * Calls the REAL production RPC and asserts none of the ids it returns is a
 * shadow row. This is the check that would catch a broken sentinel/filter.
 */
async function probeReadPath(
  client: SupabaseClient<Database>,
  insurerId: string,
): Promise<{ returned: number; shadowReturned: number; skipped?: string }> {
  const queryEmbedding = await pickActiveEmbedding(client, insurerId)
  if (!queryEmbedding) return { returned: 0, shadowReturned: 0, skipped: 'no active embedding to probe with' }

  type RpcResponse = { data: Array<{ id: string }> | null; error: { message: string } | null }
  let resp: RpcResponse
  try {
    // Call as a method so `this` stays bound to the client.
    resp = (await (
      client.rpc as unknown as (
        this: SupabaseClient<Database>,
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<RpcResponse>
    ).call(client, 'match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.0,
      match_count: 50,
    })) as RpcResponse
  } catch (err) {
    return { returned: 0, shadowReturned: 0, skipped: `match_documents threw: ${(err as Error).message}` }
  }
  if (resp.error) return { returned: 0, shadowReturned: 0, skipped: `match_documents: ${resp.error.message}` }

  const ids = (resp.data ?? []).map((r) => r.id)
  if (ids.length === 0) return { returned: 0, shadowReturned: 0 }

  const { count, error } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .in('id', ids)
    .eq('metadata->>shadow', 'true')
  if (error) throw error
  return { returned: ids.length, shadowReturned: count ?? 0 }
}

// --- orchestration ---

interface RunResult {
  insurer: string
  pdf: string
  build: BuildShadowRowsResult
  tableChunks: number
  biggestTable?: string
  written?: { upserted: number; leakBefore: number; leakAfter: number; activeBaseline: number }
}

async function processOne(
  client: SupabaseClient<Database>,
  entry: ManifestEntry & { pdf: string },
  opts: CliOptions,
): Promise<RunResult> {
  if (!existsSync(entry.pdf)) throw new Error(`PDF not found: ${entry.pdf}`)

  const insurer = await loadInsurer(client, entry.insurer)
  const productCatalog = await loadCatalog(client, insurer.id)

  const odl = await runOpenDataLoader(entry.pdf, { maxHeapMb: opts.maxHeapMb })
  const layout = openDataLoaderToLayout(odl)

  const build = buildShadowRows({
    layout,
    insurerId: insurer.id,
    insurerName: insurer.name,
    sourceUrl: entry.sourceUrl,
    productCatalog,
    assertInsurer: (name) => assertInsurerAllowed(name),
    parserStamp: OPENDATALOADER_PARSER,
    // Tables are atomic: the prose char-window would quarantine the very
    // tables this pipeline exists to preserve (carência 234, reajuste 1733).
    gateOptions: { tablesAreAtomic: true },
  })

  // Must hold whether or not we write. A dry-run that would have produced a
  // leaking row fails here, not in production.
  assertRowsAreInert(build.rows)

  const tables = build.gateReport.accepted.filter((c) => c.metadata.has_table)
  const biggest = [...tables].sort((a, b) => b.content.length - a.content.length)[0]

  const result: RunResult = {
    insurer: insurer.name,
    pdf: path.basename(entry.pdf),
    build,
    tableChunks: tables.length,
    biggestTable: biggest?.content.slice(0, 400),
  }

  if (!opts.write) return result

  const leakBefore = await probeShadowLeak(client, insurer.id, entry.sourceUrl)
  if (leakBefore !== 0) {
    throw new Error(`ABORT: ${leakBefore} shadow rows are already visible before writing.`)
  }
  const activeBaseline = await probeActiveRowsForUrl(client, insurer.id, entry.sourceUrl)

  await upsertRows(client, build.rows)

  const leakAfter = await probeShadowLeak(client, insurer.id, entry.sourceUrl)
  if (leakAfter !== 0) {
    throw new Error(
      `CONTRACT VIOLATION: ${leakAfter} shadow rows became visible to the read path. Investigate now.`,
    )
  }
  const upserted = await countUpsertedShadow(client, insurer.id, entry.sourceUrl)

  const readPath = await probeReadPath(client, insurer.id)
  if (readPath.shadowReturned > 0) {
    throw new Error(
      `CONTRACT VIOLATION: match_documents returned ${readPath.shadowReturned} shadow rows.`,
    )
  }
  console.log(
    `    read-path probe: match_documents returned ${readPath.returned} rows, ${readPath.shadowReturned} shadow` +
      (readPath.skipped ? ` (skipped: ${readPath.skipped})` : ''),
  )

  result.written = { upserted, leakBefore, leakAfter, activeBaseline }
  return result
}

function renderReport(results: RunResult[], wrote: boolean): void {
  console.log('\n' + '='.repeat(78))
  console.log(wrote ? 'WRITE — inert rows upserted (embedding = null)' : 'DRY-RUN — nothing written, no embeddings')
  console.log('='.repeat(78))
  console.log('\n| insurer              | pages | chunks | accepted | quarant. | TABLES | product |')
  console.log('|---|---|---|---|---|---|---|')
  for (const r of results) {
    const s = r.build.summary
    const product = s.productUnresolved ? 'unresolved' : (s.productName ?? '—').slice(0, 24)
    console.log(
      `| ${r.insurer.padEnd(20)} | ${String(s.pageCount).padStart(5)} | ${String(s.chunkCount).padStart(6)} | ` +
        `${String(s.acceptedCount).padStart(8)} | ${String(s.quarantinedCount).padStart(8)} | ` +
        `${String(r.tableChunks).padStart(6)} | ${product} |`,
    )
  }

  const totalRows = results.reduce((n, r) => n + r.build.rows.length, 0)
  const totalTables = results.reduce((n, r) => n + r.tableChunks, 0)
  console.log(
    `\n${wrote ? 'UPSERTED' : 'WOULD UPSERT'}: ${totalRows} inert rows, of which ${totalTables} are table chunks.`,
  )
  console.log(`Parser stamp: ${OPENDATALOADER_PARSER}`)

  if (wrote) {
    for (const r of results) {
      if (!r.written) continue
      console.log(
        `\n${r.insurer}: upserted=${r.written.upserted} shadow rows at sentinel · ` +
          `leak before=${r.written.leakBefore} after=${r.written.leakAfter} (both must be 0) · ` +
          `legacy active rows for this url=${r.written.activeBaseline} (untouched)`,
      )
    }
    console.log('\nNext: embeddings are a separate step (rows carry embedding = null).')
  } else {
    for (const r of results) {
      if (!r.biggestTable) continue
      console.log(`\n--- ${r.insurer}: biggest table chunk (preview) ---`)
      console.log(r.biggestTable)
    }
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const client = makeSupabaseClient()

  const selected = opts.all
    ? MANIFEST
    : MANIFEST.filter((m) => m.insurer.toLowerCase().includes(opts.only!.toLowerCase()))
  if (selected.length === 0) {
    console.error(`--only "${opts.only}" matched no manifest entry`)
    process.exit(2)
  }

  if (opts.write) {
    console.log(`\n*** WRITE MODE — will upsert inert rows for ${selected.length} document(s) ***`)
  }

  const results: RunResult[] = []
  let failures = 0
  for (const m of selected) {
    const entry = { ...m, pdf: path.resolve(opts.pdfDir, m.file) }
    console.log(`\n>>> ${entry.insurer} — ${m.file}`)
    try {
      const result = await processOne(client, entry, opts)
      const s = result.build.summary
      console.log(
        `    parsed ${s.pageCount}p -> ${s.chunkCount} chunks (${s.acceptedCount} accepted, ${result.tableChunks} tables)`,
      )
      results.push(result)
    } catch (err) {
      failures++
      console.error(`    FAILED: ${(err as Error).message}`)
    }
  }

  if (results.length > 0) renderReport(results, opts.write)
  console.log(`\n${results.length} ok, ${failures} failed`)
  if (failures > 0) process.exit(1)
}

void main()
