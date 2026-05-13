/**
 * RAG audit — test sourceType routing.
 *
 * READ-ONLY. Verifies the claim from the brief:
 *   "perguntas sobre taxa/prêmio retornavam conditions_pdf em vez de
 *    rate_table_pdf, porque o texto das condições era semanticamente mais denso"
 *
 * Strategy: embed a small set of synthetic rate-intent queries and a small set
 * of synthetic concept queries, then for each query call match_documents without
 * any source_type filter and check the type distribution of the top-10 hits.
 *
 * Limitation: this script does NOT exercise the rate-lookup fast-path in
 * services/rag/rate-lookup.ts (that one bypasses match_documents entirely when
 * rate intent is detected). Goal here is to characterise the raw pgvector
 * behaviour, which is what compare.ts and the global concept search rely on.
 *
 * Usage (from app/):
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/test-source-type-routing.ts
 */

import { getClient, section, table } from './_lib'
import { embedChunks } from '../../src/services/embeddings/embedder'

const RATE_QUERIES = [
  'qual a taxa para homem 40 anos vida inteira capital 500 mil',
  'quanto custa o seguro Prudential WL10G',
  'premio mensal DIT MAG grupo 1 franquia 7 dias',
  'cotacao seguro vida feminino 35 anos',
]

const CONCEPT_QUERIES = [
  'qual a carencia para morte natural',
  'o que e contestabilidade no seguro de vida',
  'cobertura de doencas graves quais CIDs',
  'invalidez majorada como funciona',
]

async function topTypes(sb: ReturnType<typeof getClient>, query: string) {
  const [embedding] = await embedChunks([query])
  const { data, error } = await sb.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: 0.0,
    match_count: 10,
  } as never)
  if (error) {
    return { rate_table_pdf: 0, conditions_pdf: 0, other: 0, total: 0, err: error.message }
  }
  const hits = (data as Array<{ source_type: string }>) ?? []
  let rate = 0
  let cond = 0
  let other = 0
  for (const h of hits) {
    if (h.source_type === 'rate_table_pdf') rate++
    else if (h.source_type === 'conditions_pdf') cond++
    else other++
  }
  return { rate_table_pdf: rate, conditions_pdf: cond, other, total: hits.length }
}

async function main() {
  const sb = getClient()

  console.log(`# SourceType routing test`)
  console.log(`_Generated: ${new Date().toISOString()}_`)

  section('Rate-intent queries — expected: rate_table_pdf should dominate')
  const rateResults: Array<Record<string, unknown>> = []
  for (const q of RATE_QUERIES) {
    const t = await topTypes(sb, q)
    rateResults.push({ query: q.slice(0, 50) + '...', ...t })
  }
  table(rateResults)

  section('Concept queries — expected: conditions_pdf should dominate')
  const conceptResults: Array<Record<string, unknown>> = []
  for (const q of CONCEPT_QUERIES) {
    const t = await topTypes(sb, q)
    conceptResults.push({ query: q.slice(0, 50) + '...', ...t })
  }
  table(conceptResults)

  section('Verdict heuristic')
  const rateLeak = rateResults.filter((r) => Number(r.conditions_pdf) > Number(r.rate_table_pdf)).length
  const conceptLeak = conceptResults.filter((r) => Number(r.rate_table_pdf) > Number(r.conditions_pdf)).length
  console.log(`- Rate queries dominated by conditions: ${rateLeak}/${RATE_QUERIES.length}`)
  console.log(`- Concept queries dominated by rate tables: ${conceptLeak}/${CONCEPT_QUERIES.length}`)
  console.log(
    `\n**If either is > 0, the source_type filter is needed at the RAG level (not only in the fast-path).**`
  )
}

main().catch((err) => {
  console.error('[rag-audit/test-source-type-routing] fatal:', err)
  process.exit(1)
})
