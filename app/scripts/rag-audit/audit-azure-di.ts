/**
 * RAG audit — Azure Document Intelligence footprint.
 *
 * READ-ONLY. Surfaces every chunk whose metadata claims an Azure DI origin
 * (parser starts with `azure-`) and reports:
 *   - which insurers and source_types used Azure DI
 *   - which documents are covered
 *   - quality signals stored alongside (confidence, page, table_source_pages)
 *
 * Premise: brief assumes Azure DI is the canonical ingestion path. Current
 * state has Azure DI ONLY in rate_table_pdf (Prudential + MAG). Conditions
 * (~14k chunks) come from a different parser. This script proves it.
 *
 * Usage (from app/):
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/audit-azure-di.ts
 */

import { getClient, section, table } from './_lib'

async function main() {
  const sb = getClient()

  console.log(`# Azure DI footprint audit`)
  console.log(`_Generated: ${new Date().toISOString()}_`)

  section('1. Parsers in use (metadata.parser histogram)')
  const { data: rows } = await sb
    .from('documents')
    .select('metadata, source_type, insurer_id, source_url')
    .not('metadata->parser', 'is', null)
  const parserHist = new Map<string, { chunks: number; insurers: Set<string>; types: Set<string>; docs: Set<string> }>()
  for (const r of rows ?? []) {
    const p = (r.metadata as Record<string, unknown>)?.parser as string | undefined
    if (!p) continue
    const ent = parserHist.get(p) ?? {
      chunks: 0,
      insurers: new Set(),
      types: new Set(),
      docs: new Set(),
    }
    ent.chunks++
    if (r.insurer_id) ent.insurers.add(r.insurer_id)
    ent.types.add(r.source_type)
    if (r.source_url) ent.docs.add(r.source_url)
    parserHist.set(p, ent)
  }
  table(
    [...parserHist.entries()].map(([parser, ent]) => ({
      parser,
      chunks: ent.chunks,
      distinct_insurers: ent.insurers.size,
      source_types: [...ent.types].join(','),
      distinct_docs: ent.docs.size,
    }))
  )

  section('2. Azure DI chunks — quality signals present')
  let azureChunks = 0
  let withConfidence = 0
  let withPage = 0
  let withTableSourcePages = 0
  let withDocTitle = 0
  let withSection = 0
  let withClause = 0
  for (const r of rows ?? []) {
    const meta = r.metadata as Record<string, unknown>
    const p = meta?.parser as string | undefined
    if (!p?.startsWith('azure')) continue
    azureChunks++
    if ('confidence' in meta) withConfidence++
    if ('page' in meta) withPage++
    if ('table_source_pages' in meta) withTableSourcePages++
    if ('doc_title' in meta) withDocTitle++
    if ('section' in meta) withSection++
    if ('clause' in meta) withClause++
  }
  table([
    { signal: 'total azure chunks', n: azureChunks },
    { signal: 'has confidence', n: withConfidence },
    { signal: 'has page', n: withPage },
    { signal: 'has table_source_pages', n: withTableSourcePages },
    { signal: 'has doc_title', n: withDocTitle },
    { signal: 'has section', n: withSection },
    { signal: 'has clause', n: withClause },
  ])

  section('3. Coverage gap: conditions_pdf is NOT from Azure DI')
  const { count: conditionsTotal } = await sb
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('source_type', 'conditions_pdf')
  const { count: conditionsAzure } = await sb
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('source_type', 'conditions_pdf')
    .like('metadata->>parser', 'azure%')
  table([
    { metric: 'conditions_pdf total', n: conditionsTotal ?? 0 },
    { metric: 'conditions_pdf via Azure DI', n: conditionsAzure ?? 0 },
    {
      metric: '% conditions reachable by Azure DI',
      n: ((conditionsAzure ?? 0) / Math.max(1, conditionsTotal ?? 1) * 100).toFixed(1) + '%',
    },
  ])
}

main().catch((err) => {
  console.error('[rag-audit/azure-di] fatal:', err)
  process.exit(1)
})
