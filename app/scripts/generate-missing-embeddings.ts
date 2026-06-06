/**
 * Generate embeddings for documents that have content but no embedding.
 * Reads chunks from Supabase, generates embeddings via OpenAI, updates in place.
 *
 * Usage:
 *   npx tsx scripts/generate-missing-embeddings.ts
 *   npx tsx scripts/generate-missing-embeddings.ts --insurer "MetLife"
 *   npx tsx scripts/generate-missing-embeddings.ts --limit 500
 */

import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

const BATCH_SIZE = 100

const args = process.argv.slice(2)
const insurerFilter = args.includes('--insurer') ? args[args.indexOf('--insurer') + 1] : null
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 5000

async function main() {
  loadEnv({ path: resolve(process.cwd(), '.env.local') })
  loadEnv({ path: resolve(process.cwd(), '.env.ragas.local'), override: true })

  const [{ supabaseAdmin }, { embedChunks }] = await Promise.all([
    import('@/lib/supabase-admin'),
    import('@/services/embeddings/embedder'),
  ])

  const startTime = Date.now()
  const db = supabaseAdmin

  console.log('='.repeat(60))
  console.log('SOLOMON — Generate Missing Embeddings')
  console.log('='.repeat(60))
  if (insurerFilter) console.log(`Filter: ${insurerFilter}`)
  console.log(`Limit: ${limitArg}`)

  // Get insurer ID if filter provided
  let insurerId: string | null = null
  if (insurerFilter) {
    const { data } = await db.from('insurers').select('id, name').ilike('name', `%${insurerFilter}%`).single()
    if (!data) {
      console.error(`Insurer "${insurerFilter}" not found`)
      process.exit(1)
    }
    insurerId = data.id
    console.log(`Insurer: ${data.name} (${insurerId})`)
  }

  // Fetch documents without embeddings
  let query = db
    .from('documents')
    .select('id, content')
    .is('embedding', null)
    .not('content', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limitArg)

  if (insurerId) {
    query = query.eq('insurer_id', insurerId)
  }

  const { data: docs, error } = await query

  if (error) {
    console.error('Failed to fetch documents:', error.message)
    process.exit(1)
  }

  if (!docs || docs.length === 0) {
    console.log('No documents without embeddings found.')
    return
  }

  console.log(`\nFound ${docs.length} documents without embeddings\n`)

  let updated = 0
  let failed = 0

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(docs.length / BATCH_SIZE)

    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} docs)...`)

    try {
      const texts = batch.map((d) => d.content)
      const embeddings = await embedChunks(texts)

      // Update each doc with its embedding
      for (let j = 0; j < batch.length; j++) {
        const vectorStr = `[${embeddings[j].join(',')}]`
        const { error: updateError } = await db
          .from('documents')
          .update({ embedding: vectorStr })
          .eq('id', batch[j].id)

        if (updateError) {
          console.error(`  Failed to update ${batch[j].id}: ${updateError.message}`)
          failed++
        } else {
          updated++
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`  Batch ${batchNum} failed: ${msg}`)
      failed += batch.length
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n' + '='.repeat(60))
  console.log('EMBEDDINGS GENERATION COMPLETE')
  console.log('='.repeat(60))
  console.log(`Duration: ${elapsed}s`)
  console.log(`Updated:  ${updated}`)
  console.log(`Failed:   ${failed}`)
  console.log('='.repeat(60))
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
