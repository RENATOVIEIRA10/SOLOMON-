/**
 * RAG audit — test that rag_exclude=true chunks are actually excluded from retrieval.
 *
 * READ-ONLY. For each excluded chunk we pick the FIRST chunk and run match_documents
 * with the same embedding it has, then verify it does NOT appear in the result.
 *
 * This is the same test that exposed bug solomon-audit-exact-dup-prudential-202604231700
 * (flag was inert because match_documents didn't filter it). Migration
 * 20260423180000_match_documents_exclude_rag_flagged.sql added the filter.
 *
 * Usage (from app/):
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/test-rag-exclude.ts
 */

import { getClient, section, table } from './_lib'

async function main() {
  const sb = getClient()

  console.log(`# rag_exclude retrieval guard test`)
  console.log(`_Generated: ${new Date().toISOString()}_`)

  section('Sample 5 excluded chunks and verify match_documents does NOT return them')

  const { data: excluded } = await sb
    .from('documents')
    .select('id, embedding, metadata, source_type, insurer_id')
    .eq('metadata->>rag_exclude', 'true')
    .not('embedding', 'is', null)
    .limit(5)

  if (!excluded || excluded.length === 0) {
    console.log('_No excluded chunks with embedding found._')
    return
  }

  const results: Array<Record<string, unknown>> = []
  for (const ex of excluded) {
    // Call match_documents with this chunk's own embedding — if filter works,
    // its id should NOT appear in the top-10.
    const { data, error } = await sb.rpc('match_documents', {
      query_embedding: ex.embedding,
      match_threshold: 0.0,
      match_count: 10,
    } as never)
    if (error) {
      results.push({ id: ex.id, status: 'ERROR', detail: error.message })
      continue
    }
    const hits = (data as Array<{ id: string }> | null) ?? []
    const leaked = hits.some((h) => h.id === ex.id)
    results.push({
      id: ex.id.slice(0, 8),
      source_type: ex.source_type,
      status: leaked ? 'LEAKED' : 'OK',
      top_hits: hits.length,
    })
  }

  table(results)

  const leaked = results.filter((r) => r.status === 'LEAKED').length
  console.log(
    `\n**Verdict:** ${leaked === 0 ? 'PASS — rag_exclude filter is enforced.' : `FAIL — ${leaked} chunks leaked.`}`
  )
}

main().catch((err) => {
  console.error('[rag-audit/test-rag-exclude] fatal:', err)
  process.exit(1)
})
