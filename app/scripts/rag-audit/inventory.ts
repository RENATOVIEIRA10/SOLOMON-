/**
 * RAG audit — global inventory.
 *
 * READ-ONLY. Surfaces what the SOLOMON RAG actually has indexed today:
 *   - sourceType distribution
 *   - per-insurer chunk counts + diversity
 *   - rate-table coverage (insurer_rate_tables)
 *   - missing critical metadata
 *
 * Usage (from app/):
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/inventory.ts > ../docs/audit-runs/inventory-$(date +%Y%m%d).md
 */

import { getClient, section, table } from './_lib'

async function main() {
  const sb = getClient()

  console.log(`# RAG inventory snapshot`)
  console.log(`_Generated: ${new Date().toISOString()}_`)

  section('1. SourceType distribution')
  const { data: srcTypes } = await sb
    .from('documents')
    .select('source_type')
  const histogram = new Map<string, number>()
  for (const row of srcTypes ?? []) {
    histogram.set(row.source_type, (histogram.get(row.source_type) ?? 0) + 1)
  }
  table(
    [...histogram.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([source_type, chunks]) => ({ source_type, chunks }))
  )

  section('2. Per-insurer chunk inventory')
  const { data: insurers } = await sb.from('insurers').select('id, name')
  const perInsurer: Array<Record<string, unknown>> = []
  for (const ins of insurers ?? []) {
    const { count: total } = await sb
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', ins.id)
    const { count: noEmbedding } = await sb
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', ins.id)
      .is('embedding', null)
    const { count: noProduct } = await sb
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', ins.id)
      .is('product_id', null)
    const { count: excluded } = await sb
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('insurer_id', ins.id)
      .eq('metadata->>rag_exclude', 'true')
    perInsurer.push({
      insurer: ins.name,
      chunks: total ?? 0,
      no_embedding: noEmbedding ?? 0,
      no_product_id: noProduct ?? 0,
      rag_excluded: excluded ?? 0,
    })
  }
  table(perInsurer.sort((a, b) => Number(b.chunks) - Number(a.chunks)))

  section('3. Insurer rate table coverage (insurer_rate_tables)')
  const { data: rateRows } = await sb
    .from('insurer_rate_tables')
    .select('insurer_id, product_code')
    .limit(1000000)
  const rateByInsurer = new Map<string, { rows: number; codes: Set<string> }>()
  for (const r of rateRows ?? []) {
    const ent = rateByInsurer.get(r.insurer_id) ?? { rows: 0, codes: new Set() }
    ent.rows++
    ent.codes.add(r.product_code)
    rateByInsurer.set(r.insurer_id, ent)
  }
  const insurerMap = new Map((insurers ?? []).map((i) => [i.id, i.name]))
  table(
    [...rateByInsurer.entries()]
      .map(([id, ent]) => ({
        insurer: insurerMap.get(id) ?? `(unknown ${id})`,
        rate_rows: ent.rows,
        distinct_product_codes: ent.codes.size,
      }))
      .sort((a, b) => b.rate_rows - a.rate_rows)
  )

  section('4. Insurers WITH conditions but WITHOUT rate-table coverage')
  const conditionsInsurers = new Set<string>()
  const { data: condRows } = await sb
    .from('documents')
    .select('insurer_id')
    .eq('source_type', 'conditions_pdf')
  for (const r of condRows ?? []) {
    if (r.insurer_id) conditionsInsurers.add(r.insurer_id)
  }
  const ratesInsurers = new Set(rateByInsurer.keys())
  const gap = [...conditionsInsurers].filter((id) => !ratesInsurers.has(id))
  table(
    gap.map((id) => ({ insurer: insurerMap.get(id) ?? id, has_rate_table: 'NO' }))
  )

  section('5. Active count vs match_documents-eligible')
  const { count: totalChunks } = await sb
    .from('documents')
    .select('id', { count: 'exact', head: true })
  const { count: eligible } = await sb
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null)
    .is('valid_until', null)
    .or('metadata->>rag_exclude.is.null,metadata->>rag_exclude.neq.true')
  table([
    { metric: 'total chunks', count: totalChunks ?? 0 },
    { metric: 'eligible for retrieval', count: eligible ?? 0 },
    {
      metric: 'gap',
      count: (totalChunks ?? 0) - (eligible ?? 0),
    },
  ])
}

main().catch((err) => {
  console.error('[rag-audit/inventory] fatal:', err)
  process.exit(1)
})
