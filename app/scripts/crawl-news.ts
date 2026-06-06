/**
 * News Crawler Pipeline
 *
 * Crawls insurance news sites, extracts articles,
 * then chunks, embeds, and indexes them.
 *
 * Usage:
 *   npx tsx scripts/crawl-news.ts
 *   npx tsx scripts/crawl-news.ts --dry-run
 *   npx tsx scripts/crawl-news.ts --max-articles 10
 *   npx tsx scripts/crawl-news.ts --skip-embeddings
 */

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { crawlAllNewsSources, type NewsArticle } from '@/services/crawlers/news-crawler'
import { embedChunks } from '@/services/embeddings/embedder'
import type { TextChunk } from '@/services/embeddings/chunker'
import type { TablesInsert, Json } from '@/types/database'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  dryRun: boolean
  maxArticles: number
  skipEmbeddings: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = {
    dryRun: false,
    maxArticles: 20,
    skipEmbeddings: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        result.dryRun = true
        break
      case '--max-articles':
        result.maxArticles = parseInt(args[++i], 10) || 20
        break
      case '--skip-embeddings':
        result.skipEmbeddings = true
        break
      default:
        console.warn(`Unknown argument: ${args[i]}`)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Article → TextChunk conversion
// ---------------------------------------------------------------------------

/**
 * Splits a news article into chunks suitable for embedding.
 * Uses a simpler approach than PDF chunker since articles are shorter.
 */
function articleToChunks(article: NewsArticle): TextChunk[] {
  const CHUNK_SIZE = 1500
  const OVERLAP = 150
  const chunks: TextChunk[] = []

  const text = `${article.title}\n\n${article.content}`

  if (text.length <= CHUNK_SIZE) {
    chunks.push({
      content: text,
      content_hash: createHash('sha256').update(text, 'utf-8').digest('hex'),
      metadata: {
        page: 0,
        chunk_index: 0,
        source_url: article.url,
        insurer_name: article.source,
        product_name: article.title,
      },
    })
    return chunks
  }

  let start = 0
  let chunkIndex = 0

  while (start < text.length) {
    let end = start + CHUNK_SIZE

    if (end >= text.length) {
      const slice = text.slice(start).trim()
      if (slice.length > 50) {
        chunks.push({
          content: slice,
          content_hash: createHash('sha256').update(slice, 'utf-8').digest('hex'),
          metadata: {
            page: 0,
            chunk_index: chunkIndex,
            source_url: article.url,
            insurer_name: article.source,
            product_name: article.title,
          },
        })
      }
      break
    }

    // Try to break at sentence boundary
    const window = text.slice(end - 100, end + 100)
    const sentenceBreak = window.search(/[.!?]\s/)
    if (sentenceBreak !== -1) {
      end = end - 100 + sentenceBreak + 2
    }

    const slice = text.slice(start, end).trim()
    if (slice.length > 50) {
      chunks.push({
        content: slice,
        content_hash: createHash('sha256').update(slice, 'utf-8').digest('hex'),
        metadata: {
          page: 0,
          chunk_index: chunkIndex,
          source_url: article.url,
          insurer_name: article.source,
          product_name: article.title,
        },
      })
      chunkIndex++
    }

    start = end - OVERLAP
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now()
  const args = parseArgs()
  const db = supabaseAdmin

  console.log('='.repeat(60))
  console.log('SOLOMON — News Crawler Pipeline')
  console.log('='.repeat(60))
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Max articles per source: ${args.maxArticles}`)
  if (args.skipEmbeddings) console.log('Embeddings: SKIPPED')
  console.log('')

  // -------------------------------------------------------------------------
  // Step 1: Crawl news sources
  // -------------------------------------------------------------------------
  console.log('[1/3] Crawling news sources...')

  const crawlResults = await crawlAllNewsSources({
    dryRun: args.dryRun,
    maxArticlesPerSource: args.maxArticles,
  })

  const totalArticles = crawlResults.reduce((sum, r) => sum + r.articlesNew, 0)
  const totalSkipped = crawlResults.reduce((sum, r) => sum + r.articlesSkipped, 0)
  const totalFound = crawlResults.reduce((sum, r) => sum + r.articlesFound, 0)

  console.log(`\n[1/3] Found ${totalFound} articles, ${totalArticles} new, ${totalSkipped} already processed`)

  if (args.dryRun) {
    console.log('\n[DRY RUN] No data saved. Exiting.')
    return
  }

  // Collect all new articles
  const allArticles = crawlResults.flatMap((r) => r.articles)

  if (allArticles.length === 0) {
    console.log('\nNo new articles to index. Done.')
    return
  }

  // -------------------------------------------------------------------------
  // Step 2: Convert articles to chunks
  // -------------------------------------------------------------------------
  console.log('\n[2/3] Chunking articles...')

  const allChunks: TextChunk[] = []
  for (const article of allArticles) {
    const chunks = articleToChunks(article)
    allChunks.push(...chunks)
  }

  console.log(`[2/3] Created ${allChunks.length} chunks from ${allArticles.length} articles`)

  // -------------------------------------------------------------------------
  // Step 3: Embed + Index
  // -------------------------------------------------------------------------
  console.log('\n[3/3] Embedding and indexing...')

  if (args.skipEmbeddings) {
    console.log('[3/3] Embeddings skipped, indexing text only...')

    const BATCH_SIZE = 100

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE)

      const rows: TablesInsert<'documents'>[] = batch.map((chunk) => ({
        content: chunk.content,
        content_hash: chunk.content_hash,
        chunk_index: chunk.metadata.chunk_index,
        source_type: 'news',
        source_url: chunk.metadata.source_url,
        embedding: null,
        metadata: chunk.metadata as unknown as Json,
      }))

      const { error } = await db
        .from('documents')
        .upsert(rows, {
          onConflict: 'content_hash,chunk_index',
          ignoreDuplicates: false,
        })

      if (error) {
        console.error(`[3/3] Batch error: ${error.message}`)
      } else {
        console.log(`[3/3] Indexed batch: ${batch.length} rows`)
      }
    }
  } else {
    const texts = allChunks.map((c) => c.content)
    console.log(`[3/3] Generating embeddings for ${texts.length} chunks...`)
    const embeddings = await embedChunks(texts)

    const BATCH_SIZE = 100

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batchChunks = allChunks.slice(i, i + BATCH_SIZE)
      const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE)

      const rows: TablesInsert<'documents'>[] = batchChunks.map((chunk, idx) => ({
        content: chunk.content,
        content_hash: chunk.content_hash,
        chunk_index: chunk.metadata.chunk_index,
        source_type: 'news',
        source_url: chunk.metadata.source_url,
        embedding: `[${batchEmbeddings[idx].join(',')}]`,
        metadata: chunk.metadata as unknown as Json,
      }))

      const { error } = await db
        .from('documents')
        .upsert(rows, {
          onConflict: 'content_hash,chunk_index',
          ignoreDuplicates: false,
        })

      if (error) {
        console.error(`[3/3] Batch error: ${error.message}`)
      } else {
        console.log(`[3/3] Indexed batch: ${batchChunks.length} rows`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Save ingestion log
  // -------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const allErrors = crawlResults.flatMap((r) => r.errors)

  const { error: logError } = await db.from('ingestion_logs').insert({
    source: 'crawler_news',
    status: allErrors.length > 0 ? 'partial' : 'success',
    started_at: new Date(startTime).toISOString(),
    finished_at: new Date().toISOString(),
    records_processed: totalFound,
    records_new: totalArticles,
    records_updated: 0,
    error_message: allErrors.length > 0 ? allErrors.join('; ').slice(0, 1000) : null,
  })

  if (logError) {
    console.error(`Failed to save ingestion log: ${logError.message}`)
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60))
  console.log('NEWS CRAWL COMPLETE')
  console.log('='.repeat(60))
  console.log(`Duration:          ${elapsed}s`)
  console.log(`Sources:           ${crawlResults.length}`)
  console.log(`Articles:          ${totalFound} found, ${totalArticles} new, ${totalSkipped} skipped`)
  console.log(`Chunks:            ${allChunks.length} created and indexed`)
  if (allErrors.length > 0) {
    console.log(`Errors:            ${allErrors.length}`)
    for (const err of allErrors.slice(0, 10)) {
      console.log(`  - ${err}`)
    }
  }
  console.log('='.repeat(60))
}

main().catch((error) => {
  console.error('FATAL:', error)
  process.exit(1)
})
