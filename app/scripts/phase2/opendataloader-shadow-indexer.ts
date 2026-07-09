/**
 * OpenDataLoader shadow indexer — DRY-RUN ONLY.
 *
 * Pipeline (all local, no Azure, no OpenAI):
 *
 *   PDF  ->  runOpenDataLoader (java -jar)   ->  OdlDocument
 *        ->  openDataLoaderToLayout          ->  LayoutAnalyzeResult
 *        ->  buildShadowRows                 ->  inert `documents` rows
 *            (assertInsurer = 4-insurer allowlist, parserStamp = opendataloader-v1)
 *        ->  assertRowsAreInert              ->  report
 *
 * This command CANNOT write. There is no upsert path in this file, and no
 * embedding call: `--write` exits non-zero on purpose. Writing lands in a
 * follow-up commit, once a dry-run has been reviewed.
 *
 * Scope: the four commercial life insurers — Prudential, MAG, MetLife, Azos.
 * The Azure DI CLI is untouched and stays Prudential-only.
 *
 * Env:
 *   OPENDATALOADER_JAR   path to opendataloader-pdf-cli.jar (required)
 *   ODL_PDF_DIR          dir holding the condition PDFs (default: ./pdfs)
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (read-only here)
 *
 * Run from app/:
 *   npm run phase2:odl:shadow-indexer -- --all
 *   npm run phase2:odl:shadow-indexer -- --insurer "MAG Seguros" \
 *       --pdf /path/mag.pdf --source-url https://…/2694-e-2695-…pdf
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  assertRowsAreInert,
  buildShadowRows,
  type BuildShadowRowsResult,
} from '../../src/services/azure-di/shadow-indexer'
import type { ProductCatalogRow } from '../../src/services/azure-di/product-resolver'
import type { Database } from '../../src/types/database'
import { OPENDATALOADER_PARSER, openDataLoaderToLayout } from '../../src/services/opendataloader/adapter'
import { assertInsurerAllowed } from '../../src/services/opendataloader/guard'
import { runOpenDataLoader } from '../../src/services/opendataloader/runner'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

/**
 * The four commercial life insurers, each paired with the condition PDF and
 * the canonical `source_url` already present in `documents`. The URL matters:
 * it is mixed into the shadow `content_hash`, so a wrong one would create
 * duplicate rows on a future write.
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
  insurer?: string
  pdf?: string
  sourceUrl?: string
  pdfDir: string
  maxHeapMb: number
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    all: false,
    pdfDir: process.env.ODL_PDF_DIR ?? './pdfs',
    maxHeapMb: 512,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--all') opts.all = true
    else if (arg === '--dry-run') {
      /* default; accepted for symmetry with the azure-di CLI */
    } else if (arg === '--write' || arg === '--live') {
      console.error(
        `\nRefusing "${arg}": this command is dry-run only. It has no upsert path and no\n` +
          `embedding call. Writing lands in a follow-up commit, after a dry-run review.\n`,
      )
      process.exit(2)
    } else if (arg === '--insurer') opts.insurer = argv[++i]
    else if (arg === '--pdf') opts.pdf = argv[++i]
    else if (arg === '--source-url') opts.sourceUrl = argv[++i]
    else if (arg === '--pdf-dir') opts.pdfDir = argv[++i]
    else if (arg === '--max-heap-mb') opts.maxHeapMb = Number(argv[++i])
    else {
      console.error(`unknown flag: ${arg}`)
      process.exit(2)
    }
  }
  if (!opts.all && !(opts.insurer && opts.pdf && opts.sourceUrl)) {
    console.error('usage: --all   |   --insurer <name> --pdf <path> --source-url <url>')
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

/** Same shape as the azure-di loader, but gated by the OpenDataLoader allowlist. */
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

interface DryRunResult {
  insurer: string
  pdf: string
  build: BuildShadowRowsResult
  tableChunks: number
  biggestTable?: string
}

async function processOne(
  client: SupabaseClient<Database>,
  entry: { insurer: string; pdf: string; sourceUrl: string },
  maxHeapMb: number,
): Promise<DryRunResult> {
  if (!existsSync(entry.pdf)) throw new Error(`PDF not found: ${entry.pdf}`)

  const insurer = await loadInsurer(client, entry.insurer)
  const productCatalog = await loadCatalog(client, insurer.id)

  const odl = await runOpenDataLoader(entry.pdf, { maxHeapMb })
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
    // tables this pipeline exists to preserve (carência 234 chars, reajuste
    // 1733 chars). See scripts/phase2/opendataloader-table-gate.test.ts.
    gateOptions: { tablesAreAtomic: true },
  })

  // Inertness must hold even though nothing is written — a dry-run that would
  // have produced a leaking row must fail here, not in production.
  assertRowsAreInert(build.rows)

  const tables = build.gateReport.accepted.filter((c) => c.metadata.has_table)
  const biggest = [...tables].sort((a, b) => b.content.length - a.content.length)[0]

  return {
    insurer: insurer.name,
    pdf: path.basename(entry.pdf),
    build,
    tableChunks: tables.length,
    biggestTable: biggest?.content.slice(0, 400),
  }
}

function renderReport(results: DryRunResult[]): void {
  console.log('\n' + '='.repeat(78))
  console.log('DRY-RUN — nothing was written, no embeddings were requested')
  console.log('='.repeat(78))
  console.log(
    '\n| insurer              | pages | chunks | accepted | quarant. | TABLES | product |',
  )
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
  console.log(`\nWOULD UPSERT: ${totalRows} inert rows, of which ${totalTables} are table chunks.`)
  console.log(`Parser stamp: ${OPENDATALOADER_PARSER} (provenance separates them from azure-di rows).`)

  for (const r of results) {
    if (!r.biggestTable) continue
    console.log(`\n--- ${r.insurer}: biggest table chunk (preview) ---`)
    console.log(r.biggestTable)
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const client = makeSupabaseClient()

  const entries = opts.all
    ? MANIFEST.map((m) => ({
        insurer: m.insurer,
        pdf: path.resolve(opts.pdfDir, m.file),
        sourceUrl: m.sourceUrl,
      }))
    : [{ insurer: opts.insurer!, pdf: path.resolve(opts.pdf!), sourceUrl: opts.sourceUrl! }]

  const results: DryRunResult[] = []
  let failures = 0
  for (const entry of entries) {
    console.log(`\n>>> ${entry.insurer} — ${path.basename(entry.pdf)}`)
    try {
      const result = await processOne(client, entry, opts.maxHeapMb)
      const s = result.build.summary
      console.log(
        `    parsed ${s.pageCount}p -> ${s.chunkCount} chunks ` +
          `(${s.acceptedCount} accepted, ${result.tableChunks} tables)`,
      )
      results.push(result)
    } catch (err) {
      failures++
      console.error(`    FAILED: ${(err as Error).message}`)
    }
  }

  if (results.length > 0) renderReport(results)
  console.log(`\n${results.length} ok, ${failures} failed`)
  if (failures > 0) process.exit(1)
}

void main()
