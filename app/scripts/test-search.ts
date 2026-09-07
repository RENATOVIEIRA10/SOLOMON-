import { semanticSearch } from '@/services/rag/search'

async function main() {
  console.log('[test] Starting semantic search...')

  try {
    const results = await semanticSearch('exclusoes do seguro vida inteira Prudential', { topK: 3 })

    console.log(`[test] Found ${results.length} results`)

    for (const r of results) {
      console.log(`\n--- Result (similarity: ${r.similarity.toFixed(3)}) ---`)
      console.log(`Source: ${r.source_url}`)
      console.log(`Type: ${r.source_type}`)
      console.log(`Content: ${r.content.slice(0, 300)}...`)
    }

    if (results.length === 0) {
      console.log('[test] No results found. Possible issues:')
      console.log('  - OPENAI_API_KEY not set (needed to embed query)')
      console.log('  - No documents with embeddings in the database')
      console.log('  - Similarity threshold too high')
    }
  } catch (error) {
    console.error('[test] ERROR:', error)
  }
}

main()
