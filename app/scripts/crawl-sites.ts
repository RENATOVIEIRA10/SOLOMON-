/**
 * Site Crawler Pipeline
 *
 * Crawls insurer websites for terms & conditions PDFs,
 * then chunks, embeds, and indexes them.
 *
 * Usage:
 *   npx tsx scripts/crawl-sites.ts
 *   npx tsx scripts/crawl-sites.ts --dry-run
 *   npx tsx scripts/crawl-sites.ts --insurer "MAG Seguros"
 *   npx tsx scripts/crawl-sites.ts --skip-embeddings
 */

import { supabaseAdmin } from '@/lib/supabase-admin'
import { CRAWLER_CONFIGS } from '@/services/crawlers/crawler-config'
import { crawlInsurer, type CrawlResult, type CrawledPdf } from '@/services/crawlers/site-crawler'
import { chunkPdfs, type TextChunk } from '@/services/embeddings/chunker'
import { embedChunks } from '@/services/embeddings/embedder'
import { indexChunks, indexChunksWithoutEmbeddings } from '@/services/embeddings/indexer'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  dryRun: boolean
  insurerFilter: string | null
  skipEmbeddings: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = {
    dryRun: false,
    insurerFilter: null,
    skipEmbeddings: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        result.dryRun = true
        break
      case '--insurer':
        result.insurerFilter = args[++i] ?? null
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
// Stats
// ---------------------------------------------------------------------------

interface CrawlStats {
  insurersCrawled: number
  pdfLinksFound: number
  pdfsDownloaded: number
  pdfsUnchanged: number
  pdfsFailed: number
  chunksCreated: number
  chunksIndexed: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now()
  const args = parseArgs()
  const db = supabaseAdmin

  console.log('='.repeat(60))
  console.log('SOLOMON — Site Crawler Pipeline')
  console.log('='.repeat(60))
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`)
  if (args.insurerFilter) console.log(`Filter: ${args.insurerFilter}`)
  if (args.skipEmbeddings) console.log('Embeddings: SKIPPED')
  console.log('')

  // Filter configs
  let configs = CRAWLER_CONFIGS
  if (args.insurerFilter) {
    const filter = args.insurerFilter.toLowerCase()
    configs = configs.filter((c) => c.name.toLowerCase().includes(filter))
    if (configs.length === 0) {
      console.error(`No insurers match filter: "${args.insurerFilter}"`)
      process.exit(1)
    }
  }

  const stats: CrawlStats = {
    insurersCrawled: configs.length,
    pdfLinksFound: 0,
    pdfsDownloaded: 0,
    pdfsUnchanged: 0,
    pdfsFailed: 0,
    chunksCreated: 0,
    chunksIndexed: 0,
    errors: [],
  }

  // -------------------------------------------------------------------------
  // Step 1: Crawl sites for PDFs
  // -------------------------------------------------------------------------
  console.log('[1/4] Crawling insurer websites...')

  const crawlResults: CrawlResult[] = []

  for (const config of configs) {
    const result = await crawlInsurer(config, { dryRun: args.dryRun })
    crawlResults.push(result)
    stats.pdfLinksFound += result.relevantLinks
    stats.pdfsDownloaded += result.downloaded
    stats.pdfsUnchanged += result.skipped
    stats.pdfsFailed += result.failed
    stats.errors.push(...result.errors)
  }

  if (args.dryRun) {
    console.log('\n[DRY RUN] No data saved. Exiting.')
    return
  }

  // -------------------------------------------------------------------------
  // Step 2: Upsert insurers in DB
  // -------------------------------------------------------------------------
  console.log('\n[2/4] Upserting insurers...')

  const insurerDbIds = new Map<string, string>()

  for (const config of configs) {
    const { data: insurerRow, error } = await db
      .from('insurers')
      .upsert(
        {
          name: config.name,
          cnpj: config.cnpj,
          source: 'crawler',
          active: true,
        },
        { onConflict: 'cnpj' }
      )
      .select('id')
      .single()

    if (error || !insurerRow) {
      const msg = `Failed to upsert insurer ${config.name}: ${error?.message}`
      console.error(`[2/4] ${msg}`)
      stats.errors.push(msg)
      continue
    }

    insurerDbIds.set(config.cnpj, insurerRow.id)
    console.log(`[2/4] ${config.name}: ${insurerRow.id}`)
  }

  // -------------------------------------------------------------------------
  // Step 3: Chunk changed/new PDFs
  // -------------------------------------------------------------------------
  console.log('\n[3/4] Chunking PDFs...')

  // Collect only new/changed PDFs
  const changedPdfs: CrawledPdf[] = crawlResults.flatMap((r) =>
    r.pdfs.filter((p) => p.changed)
  )

  console.log(`[3/4] ${changedPdfs.length} new/changed PDFs to process`)

  const filesToChunk = changedPdfs.map((pdf) => ({
    filePath: pdf.filePath,
    sourceUrl: pdf.url,
    insurerName: pdf.insurerName,
    productName: pdf.linkText || 'Conditions PDF',
  }))

  let allChunks: TextChunk[] = []

  if (filesToChunk.length > 0) {
    allChunks = await chunkPdfs(filesToChunk)
    stats.chunksCreated = allChunks.length
  }

  console.log(`[3/4] Created ${stats.chunksCreated} chunks`)

  // -------------------------------------------------------------------------
  // Step 4: Embed + Index
  // -------------------------------------------------------------------------
  console.log('\n[4/4] Embedding and indexing...')

  if (allChunks.length > 0) {
    // Group chunks by insurer CNPJ (via URL → pdf → cnpj)
    const pdfByCnpj = new Map<string, string>()
    for (const pdf of changedPdfs) {
      pdfByCnpj.set(pdf.url, pdf.insurerCnpj)
    }

    if (args.skipEmbeddings) {
      console.log('[4/4] Embeddings skipped, indexing text only...')

      // Group by source URL
      const chunksByUrl = new Map<string, TextChunk[]>()
      for (const chunk of allChunks) {
        const url = chunk.metadata.source_url
        const existing = chunksByUrl.get(url) ?? []
        existing.push(chunk)
        chunksByUrl.set(url, existing)
      }

      for (const [url, chunks] of chunksByUrl) {
        const cnpj = pdfByCnpj.get(url)
        const insurerId = cnpj ? insurerDbIds.get(cnpj) : undefined
        const result = await indexChunksWithoutEmbeddings(db, chunks, undefined, insurerId)
        stats.chunksIndexed += result.inserted
      }
    } else {
      const texts = allChunks.map((c) => c.content)
      console.log(`[4/4] Generating embeddings for ${texts.length} chunks...`)
      const embeddings = await embedChunks(texts)

      // Group by source URL
      const chunksByUrl = new Map<string, { chunks: TextChunk[]; embeddings: number[][] }>()
      for (let i = 0; i < allChunks.length; i++) {
        const url = allChunks[i].metadata.source_url
        const existing = chunksByUrl.get(url) ?? { chunks: [], embeddings: [] }
        existing.chunks.push(allChunks[i])
        existing.embeddings.push(embeddings[i])
        chunksByUrl.set(url, existing)
      }

      for (const [url, { chunks, embeddings: embs }] of chunksByUrl) {
        const cnpj = pdfByCnpj.get(url)
        const insurerId = cnpj ? insurerDbIds.get(cnpj) : undefined
        const result = await indexChunks(db, chunks, embs, undefined, insurerId)
        stats.chunksIndexed += result.inserted
      }
    }
  }

  console.log(`[4/4] Indexed ${stats.chunksIndexed} chunks`)

  // -------------------------------------------------------------------------
  // Save ingestion log
  // -------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  const { error: logError } = await db.from('ingestion_logs').insert({
    source: 'crawler_site',
    status: stats.errors.length > 0 ? 'partial' : 'success',
    started_at: new Date(startTime).toISOString(),
    finished_at: new Date().toISOString(),
    records_processed: stats.pdfLinksFound,
    records_new: stats.pdfsDownloaded,
    records_updated: 0,
    error_message: stats.errors.length > 0 ? stats.errors.join('; ').slice(0, 1000) : null,
  })

  if (logError) {
    console.error(`Failed to save ingestion log: ${logError.message}`)
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60))
  console.log('SITE CRAWL COMPLETE')
  console.log('='.repeat(60))
  console.log(`Duration:          ${elapsed}s`)
  console.log(`Insurers:          ${stats.insurersCrawled}`)
  console.log(`PDF links:         ${stats.pdfLinksFound} relevant`)
  console.log(`PDFs:              ${stats.pdfsDownloaded} new, ${stats.pdfsUnchanged} unchanged, ${stats.pdfsFailed} failed`)
  console.log(`Chunks:            ${stats.chunksCreated} created, ${stats.chunksIndexed} indexed`)
  if (stats.errors.length > 0) {
    console.log(`Errors:            ${stats.errors.length}`)
    for (const err of stats.errors.slice(0, 10)) {
      console.log(`  - ${err}`)
    }
  }
  console.log('='.repeat(60))
}

main().catch((error) => {
  console.error('FATAL:', error)
  process.exit(1)
})
