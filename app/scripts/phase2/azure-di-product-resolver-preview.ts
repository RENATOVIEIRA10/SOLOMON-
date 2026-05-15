/**
 * Phase 2 / PR 3B slice 3B.4 — product-resolver preview (read-only).
 *
 * For each of the 3 priority insurers (Prudential P0, Azos P1, MAG P2):
 *   - Loads the `products` catalog for that insurer from Supabase.
 *   - Loads distinct (source_url, metadata.product_name) for active
 *     `conditions_pdf` chunks.
 *   - Runs {@link resolveProduct} per document with extracted signals.
 *   - Writes a Markdown report to docs/audit-runs/product-resolver-preview-<ts>/
 *
 * Read-only by contract:
 *   - Supabase reads only.
 *   - **No DB write.** No `INSERT`, no `UPDATE`, no `DELETE`, no migration.
 *   - No read-path import, no indexer call, no rate-lookup, no promotion.
 *
 * Run from app/ on a machine with Supabase access (the VPS):
 *   set -a && source /root/solomon/.azure-di.env   # not needed (Azure unused)
 *   set -a && source /root/solomon/repo/app/.env.local && set +a
 *   npm run phase2:azure-di:product-resolver:preview
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  extractSusepCandidates,
  nameCandidateFromUrl,
  resolveProduct,
  type ProductCatalogRow,
  type ProductResolution,
} from '../../src/services/azure-di/product-resolver'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

const TARGET_INSURERS = [
  { match: 'Prudential do Brasil', label: 'Prudential', priority: 'P0' },
  { match: 'Azos', label: 'Azos', priority: 'P1' },
  { match: 'MAG Seguros', label: 'MAG', priority: 'P2' },
] as const

interface DocumentRow {
  source_url: string
  product_name: string | null
  chunks: number
}

interface InsurerResolutionResult {
  label: string
  priority: string
  insurerId: string | null
  catalogSize: number
  documents: number
  perDoc: Array<{
    sourceUrl: string
    pname: string | null
    chunks: number
    resolution: ProductResolution
  }>
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function makeClient(): SupabaseClient {
  const url = envValue('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error(
      'Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.'
    )
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

async function findInsurerId(client: SupabaseClient, match: string): Promise<string | null> {
  const { data, error } = await client
    .from('insurers')
    .select('id, name')
    .ilike('name', `%${match}%`)
  if (error) throw error
  if (!data || data.length === 0) return null
  // Pick the row whose name matches most closely (shortest name containing match).
  const sorted = [...data].sort((a, b) => a.name.length - b.name.length)
  return sorted[0].id
}

async function loadCatalog(client: SupabaseClient, insurerId: string): Promise<ProductCatalogRow[]> {
  const { data, error } = await client
    .from('products')
    .select('id, name, code, susep_process, terms_url')
    .eq('insurer_id', insurerId)
  if (error) throw error
  return (data ?? []) as ProductCatalogRow[]
}

async function loadDocuments(client: SupabaseClient, insurerId: string): Promise<DocumentRow[]> {
  // Group by (source_url, metadata.product_name) on the Postgres side via .rpc would be cleanest,
  // but for read-only auditing we just stream the chunks and aggregate here.
  const PAGE = 1000
  const all: Array<{ source_url: string | null; metadata: Record<string, unknown> | null }> = []
  let from = 0
  while (true) {
    const { data, error } = await client
      .from('documents')
      .select('source_url, metadata')
      .eq('source_type', 'conditions_pdf')
      .is('valid_until', null)
      .eq('insurer_id', insurerId)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as typeof all))
    if (data.length < PAGE) break
    from += PAGE
  }
  const grouped = new Map<string, DocumentRow>()
  for (const row of all) {
    const url = (row.source_url ?? '').trim()
    if (url.length === 0) continue
    const pname = ((row.metadata?.product_name as string | undefined) ?? null)
    const key = `${url}::${pname ?? ''}`
    const existing = grouped.get(key)
    if (existing) {
      existing.chunks += 1
    } else {
      grouped.set(key, { source_url: url, product_name: pname, chunks: 1 })
    }
  }
  return [...grouped.values()].sort((a, b) => b.chunks - a.chunks)
}

function resolveForDocument(
  doc: DocumentRow,
  catalog: ProductCatalogRow[]
): ProductResolution {
  const nameFromUrl = nameCandidateFromUrl(doc.source_url)
  const productNameCandidates: string[] = []
  if (doc.product_name && doc.product_name !== 'Conditions PDF') {
    productNameCandidates.push(doc.product_name)
  }
  if (nameFromUrl) productNameCandidates.push(nameFromUrl)
  const susepCandidates = extractSusepCandidates(doc.source_url)
  return resolveProduct(
    {
      sourceUrl: doc.source_url,
      productNameCandidates,
      susepCandidates,
    },
    catalog
  )
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}

function renderReport(results: InsurerResolutionResult[], generatedAt: string): string {
  const lines: string[] = []
  lines.push('# Phase 2 PR 3B slice 3B.4 — product-resolver preview')
  lines.push('')
  lines.push(`Generated: ${generatedAt}`)
  lines.push('')
  lines.push('Scope: read-only audit of the 3 priority insurers (per PR #17).')
  lines.push('No DB write, no migration, no indexing. Evidence only.')
  lines.push('')

  // Summary table.
  lines.push('## Summary')
  lines.push('')
  lines.push('| Priority | Insurer | Catalog | Docs | Resolved | terms_url | susep | code | fuzzy | Unresolved |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const r of results) {
    const byStrategy = {
      terms_url: 0,
      susep_process: 0,
      code: 0,
      fuzzy_name: 0,
      unresolved: 0,
    }
    let resolved = 0
    for (const d of r.perDoc) {
      if (d.resolution.productUnresolved) byStrategy.unresolved++
      else {
        resolved++
        byStrategy[d.resolution.strategy as keyof typeof byStrategy]++
      }
    }
    const total = r.perDoc.length
    lines.push(
      `| ${r.priority} | ${r.label} | ${r.catalogSize} | ${total} | ${resolved} (${pct(resolved, total)}) | ${byStrategy.terms_url} | ${byStrategy.susep_process} | ${byStrategy.code} | ${byStrategy.fuzzy_name} | ${byStrategy.unresolved} |`
    )
  }
  lines.push('')

  // Per-insurer detail.
  for (const r of results) {
    lines.push(`## ${r.priority} ${r.label}`)
    lines.push('')
    lines.push(`Catalog rows: **${r.catalogSize}** · documents (active conditions_pdf): **${r.documents}**`)
    lines.push('')
    if (r.catalogSize === 0) {
      lines.push('> **Catalog is empty.** Every document for this insurer is expected to')
      lines.push('> resolve as `productUnresolved: true` with reason `catalog_empty`. This is')
      lines.push('> the contract — not a bug. See PR #17 §2 (Azos/MAG catalog seeding is a')
      lines.push('> separate effort outside PR 3B).')
      lines.push('')
    }
    if (r.perDoc.length === 0) {
      lines.push('_No documents._')
      lines.push('')
      continue
    }
    lines.push('| chunks | source_url | strategy | confidence | product / reason |')
    lines.push('|---:|---|---|---:|---|')
    for (const d of r.perDoc) {
      const res = d.resolution
      const product = res.productUnresolved
        ? `_unresolved: ${res.unresolvedReason}_`
        : `**${res.productName}**`
      const conf = res.productUnresolved ? '—' : res.confidence.toFixed(2)
      const urlShort = d.sourceUrl.length > 90 ? `${d.sourceUrl.slice(0, 87)}...` : d.sourceUrl
      lines.push(`| ${d.chunks} | \`${urlShort}\` | ${res.strategy} | ${conf} | ${product} |`)
    }
    lines.push('')
  }

  lines.push('## Guardrails honored')
  lines.push('')
  lines.push('- Read-only: queries against `insurers`, `products`, `documents` only.')
  lines.push('- No `INSERT` / `UPDATE` / `DELETE` issued.')
  lines.push('- No production read-path import, no indexer, no rate-lookup.')
  lines.push('- No promotion: this report is evidence, not a chunk write.')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const client = makeClient()
  const generatedAt = new Date().toISOString()
  const results: InsurerResolutionResult[] = []

  for (const target of TARGET_INSURERS) {
    const insurerId = await findInsurerId(client, target.match)
    if (!insurerId) {
      results.push({
        label: target.label,
        priority: target.priority,
        insurerId: null,
        catalogSize: 0,
        documents: 0,
        perDoc: [],
      })
      console.log(`! ${target.label}: insurer not found by ilike "${target.match}"`)
      continue
    }
    const [catalog, documents] = await Promise.all([
      loadCatalog(client, insurerId),
      loadDocuments(client, insurerId),
    ])
    const perDoc = documents.map((doc) => ({
      sourceUrl: doc.source_url,
      pname: doc.product_name,
      chunks: doc.chunks,
      resolution: resolveForDocument(doc, catalog),
    }))
    const resolved = perDoc.filter((d) => !d.resolution.productUnresolved).length
    console.log(
      `# ${target.label} (${target.priority}): catalog=${catalog.length} docs=${documents.length} resolved=${resolved}/${documents.length}`
    )
    results.push({
      label: target.label,
      priority: target.priority,
      insurerId,
      catalogSize: catalog.length,
      documents: documents.length,
      perDoc,
    })
  }

  const runId = generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const outDir = path.join('..', 'docs', 'audit-runs', `product-resolver-preview-${runId}`)
  await mkdir(outDir, { recursive: true })
  const reportPath = path.join(outDir, 'REPORT.md')
  await writeFile(reportPath, renderReport(results, generatedAt), 'utf8')
  console.log(`\nReport: ${reportPath}`)
}

main().catch((err) => {
  console.error('[product-resolver-preview] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
