/**
 * OPIN Data Ingestion Pipeline
 *
 * Orchestrates the full flow:
 *   discover → fetch → parse → save to DB → download PDFs → chunk → embed → index
 *
 * Usage:
 *   npx tsx scripts/ingest-opin.ts
 *   npx tsx scripts/ingest-opin.ts --dry-run
 *   npx tsx scripts/ingest-opin.ts --insurer "Prudential do Brasil"
 *   npx tsx scripts/ingest-opin.ts --skip-embeddings
 */

import { supabaseAdmin } from '@/lib/supabase-admin'
import { discoverInsurers, getFallbackInsurers } from '@/services/opin/discovery'
import { fetchAllInsurers } from '@/services/opin/fetcher'
import { parseOPINResults, extractTermsUrls } from '@/services/opin/parser'
import { downloadPdfs, type DownloadResult } from '@/services/opin/pdf-downloader'
import { chunkPdfs, type TextChunk } from '@/services/embeddings/chunker'
import { embedChunks } from '@/services/embeddings/embedder'
import { indexChunks, indexChunksWithoutEmbeddings } from '@/services/embeddings/indexer'

// ---------------------------------------------------------------------------
// CLI argument parsing
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
// Ingestion stats
// ---------------------------------------------------------------------------

interface IngestionStats {
  insurersDiscovered: number
  insurersFetched: number
  productsFound: number
  productsSaved: number
  coveragesSaved: number
  coveragesSkipped: number
  pdfsDownloaded: number
  pdfsSkipped: number
  pdfsFailed: number
  chunksCreated: number
  chunksIndexed: number
  errors: string[]
}

function createStats(): IngestionStats {
  return {
    insurersDiscovered: 0,
    insurersFetched: 0,
    productsFound: 0,
    productsSaved: 0,
    coveragesSaved: 0,
    coveragesSkipped: 0,
    pdfsDownloaded: 0,
    pdfsSkipped: 0,
    pdfsFailed: 0,
    chunksCreated: 0,
    chunksIndexed: 0,
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now()
  const args = parseArgs()
  const stats = createStats()
  const db = supabaseAdmin

  console.log('='.repeat(60))
  console.log('SOLOMON — OPIN Data Ingestion Pipeline')
  console.log('='.repeat(60))
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`)
  if (args.insurerFilter) console.log(`Filter: ${args.insurerFilter}`)
  if (args.skipEmbeddings) console.log('Embeddings: SKIPPED')
  console.log('')

  // -----------------------------------------------------------------------
  // Step 1: Discover insurers
  // -----------------------------------------------------------------------
  console.log('[1/7] Discovering insurers...')
  let insurers = await discoverInsurers()

  // If discovery returned nothing, use fallback
  if (insurers.length === 0) {
    console.log('[1/7] No insurers found, using fallback list')
    insurers = getFallbackInsurers()
  }

  // Apply filter
  if (args.insurerFilter) {
    const filter = args.insurerFilter.toLowerCase()
    insurers = insurers.filter((ins) =>
      ins.name.toLowerCase().includes(filter)
    )
    if (insurers.length === 0) {
      console.error(`No insurers match filter: "${args.insurerFilter}"`)
      process.exit(1)
    }
  }

  stats.insurersDiscovered = insurers.length
  console.log(`[1/7] ${insurers.length} insurers to process\n`)

  // -----------------------------------------------------------------------
  // Step 2: Fetch products from OPIN APIs
  // -----------------------------------------------------------------------
  console.log('[2/7] Fetching products from OPIN APIs...')
  const fetchResults = await fetchAllInsurers(insurers)
  stats.insurersFetched = insurers.length

  const totalProducts = fetchResults.reduce((sum, r) => sum + r.products.length, 0)
  stats.productsFound = totalProducts
  console.log(`[2/7] Fetched ${totalProducts} products total\n`)

  if (args.dryRun) {
    console.log('[DRY RUN] Would process:')
    for (const insurer of insurers) {
      const results = fetchResults.filter((r) => r.insurer.cnpj === insurer.cnpj)
      const count = results.reduce((sum, r) => sum + r.products.length, 0)
      console.log(`  - ${insurer.name}: ${count} products`)
    }
    console.log('\n[DRY RUN] No data saved. Exiting.')
    return
  }

  // -----------------------------------------------------------------------
  // Step 3: Upsert insurers + parse + save products/coverages
  // -----------------------------------------------------------------------
  console.log('[3/7] Saving insurers and products to database...')

  // Map to track insurer DB IDs by CNPJ
  const insurerDbIds = new Map<string, string>()
  // Map to track product DB IDs by insurer CNPJ + product code/name
  const productDbMap = new Map<string, { id: string; name: string; insurerName: string }>()

  for (const insurer of insurers) {
    // Upsert insurer
    const { data: insurerRow, error: insurerError } = await db
      .from('insurers')
      .upsert(
        {
          name: insurer.name,
          cnpj: insurer.cnpj,
          opin_endpoint: insurer.endpoint_base,
          source: 'opin',
          active: true,
        },
        { onConflict: 'cnpj' }
      )
      .select('id')
      .single()

    if (insurerError || !insurerRow) {
      const msg = `Failed to upsert insurer ${insurer.name}: ${insurerError?.message}`
      console.error(`[3/7] ${msg}`)
      stats.errors.push(msg)
      continue
    }

    const insurerId = insurerRow.id
    insurerDbIds.set(insurer.cnpj, insurerId)

    // Get fetch results for this insurer
    const results = fetchResults.filter((r) => r.insurer.cnpj === insurer.cnpj)
    const parsed = parseOPINResults(results, insurerId)

    stats.coveragesSkipped += parsed.skippedCoverages

    console.log(`[3/7] ${insurer.name}: ${parsed.products.length} products, ${parsed.totalCoverages} coverages (${parsed.skippedCoverages} skipped)`)

    // Save products + coverages — use insert (first run) with duplicate check
    for (const { product, coverages } of parsed.products) {
      // Check if product already exists (by insurer_id + code, or insurer_id + name)
      let productRow: { id: string } | null = null

      if (product.code) {
        const { data } = await db
          .from('products')
          .select('id')
          .eq('insurer_id', product.insurer_id)
          .eq('code', product.code)
          .maybeSingle()
        productRow = data
      }

      if (!productRow) {
        // Insert new product
        const { data: insertedRow, error: insertError } = await db
          .from('products')
          .insert(product)
          .select('id')
          .single()

        if (insertError || !insertedRow) {
          const msg = `Failed to save product ${product.name}: ${insertError?.message}`
          stats.errors.push(msg)
          continue
        }
        productRow = insertedRow
      }

      stats.productsSaved++
      const key = `${insurer.cnpj}::${product.code ?? product.name}`
      productDbMap.set(key, { id: productRow.id, name: product.name, insurerName: insurer.name })

      // Save coverages
      if (coverages.length > 0) {
        const coverageRows = coverages.map((c) => ({ ...c, product_id: productRow.id }))
        const { error: covError } = await db.from('coverages').insert(coverageRows)
        if (covError) {
          console.error(`[3/7] Coverage error for ${product.name}: ${covError.message}`)
        } else {
          stats.coveragesSaved += coverages.length
        }
      }
    }
  }

  console.log(`[3/7] Saved ${stats.productsSaved} products, ${stats.coveragesSaved} coverages\n`)

  // -----------------------------------------------------------------------
  // Step 4: Collect terms URLs for PDF download
  // -----------------------------------------------------------------------
  console.log('[4/7] Collecting terms URLs...')

  // Build a map of URL → {productId, insurerId, productName, insurerName}
  const urlProductMap = new Map<string, {
    productId: string
    insurerId: string
    productName: string
    insurerName: string
  }>()

  for (const insurer of insurers) {
    const insurerId = insurerDbIds.get(insurer.cnpj)
    if (!insurerId) continue

    const results = fetchResults.filter((r) => r.insurer.cnpj === insurer.cnpj)
    const parsed = parseOPINResults(results, insurerId)
    const urls = extractTermsUrls(parsed.products)

    for (const url of urls) {
      // Find the product that has this URL
      const matchingProduct = parsed.products.find((p) => p.product.terms_url === url)
      if (!matchingProduct) continue

      const key = `${insurer.cnpj}::${matchingProduct.product.code ?? matchingProduct.product.name}`
      const dbInfo = productDbMap.get(key)

      if (dbInfo) {
        urlProductMap.set(url, {
          productId: dbInfo.id,
          insurerId,
          productName: dbInfo.name,
          insurerName: insurer.name,
        })
      }
    }
  }

  const allUrls = Array.from(urlProductMap.keys())
  console.log(`[4/7] Found ${allUrls.length} unique terms URLs\n`)

  // -----------------------------------------------------------------------
  // Step 5: Download PDFs
  // -----------------------------------------------------------------------
  console.log('[5/7] Downloading PDFs...')
  let downloadResults: DownloadResult[] = []

  if (allUrls.length > 0) {
    downloadResults = await downloadPdfs(allUrls)
    stats.pdfsDownloaded = downloadResults.filter((r) => !r.skipped && !r.error).length
    stats.pdfsSkipped = downloadResults.filter((r) => r.skipped).length
    stats.pdfsFailed = downloadResults.filter((r) => r.error).length
  }

  console.log(`[5/7] PDFs: ${stats.pdfsDownloaded} new, ${stats.pdfsSkipped} cached, ${stats.pdfsFailed} failed\n`)

  // -----------------------------------------------------------------------
  // Step 6: Chunk PDFs
  // -----------------------------------------------------------------------
  console.log('[6/7] Chunking PDFs...')

  const filesToChunk = downloadResults
    .filter((r) => r.filePath !== null)
    .map((r) => {
      const info = urlProductMap.get(r.url)!
      return {
        filePath: r.filePath!,
        sourceUrl: r.url,
        insurerName: info.insurerName,
        productName: info.productName,
      }
    })

  let allChunks: TextChunk[] = []

  if (filesToChunk.length > 0) {
    allChunks = await chunkPdfs(filesToChunk)
    stats.chunksCreated = allChunks.length
  }

  console.log(`[6/7] Created ${stats.chunksCreated} text chunks\n`)

  // -----------------------------------------------------------------------
  // Step 7: Embed + Index
  // -----------------------------------------------------------------------
  console.log('[7/7] Embedding and indexing...')

  if (allChunks.length > 0) {
    if (args.skipEmbeddings) {
      console.log('[7/7] Embeddings skipped, indexing text only...')

      // Group chunks by source URL for product/insurer linking
      const chunksByUrl = new Map<string, TextChunk[]>()
      for (const chunk of allChunks) {
        const url = chunk.metadata.source_url
        const existing = chunksByUrl.get(url) ?? []
        existing.push(chunk)
        chunksByUrl.set(url, existing)
      }

      for (const [url, chunks] of chunksByUrl) {
        const info = urlProductMap.get(url)
        const result = await indexChunksWithoutEmbeddings(
          db,
          chunks,
          info?.productId,
          info?.insurerId
        )
        stats.chunksIndexed += result.inserted
      }
    } else {
      // Generate embeddings
      const texts = allChunks.map((c) => c.content)
      console.log(`[7/7] Generating embeddings for ${texts.length} chunks...`)
      const embeddings = await embedChunks(texts)

      // Group chunks by source URL for product/insurer linking
      const chunksByUrl = new Map<string, { chunks: TextChunk[]; embeddings: number[][] }>()
      for (let i = 0; i < allChunks.length; i++) {
        const url = allChunks[i].metadata.source_url
        const existing = chunksByUrl.get(url) ?? { chunks: [], embeddings: [] }
        existing.chunks.push(allChunks[i])
        existing.embeddings.push(embeddings[i])
        chunksByUrl.set(url, existing)
      }

      for (const [url, { chunks, embeddings: embs }] of chunksByUrl) {
        const info = urlProductMap.get(url)
        const result = await indexChunks(
          db,
          chunks,
          embs,
          info?.productId,
          info?.insurerId
        )
        stats.chunksIndexed += result.inserted
      }
    }
  }

  console.log(`[7/7] Indexed ${stats.chunksIndexed} chunks\n`)

  // -----------------------------------------------------------------------
  // Save ingestion log
  // -----------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  const { error: logError } = await db.from('ingestion_logs').insert({
    source: 'opin',
    status: stats.errors.length > 0 ? 'failed' : 'success',
    started_at: new Date(startTime).toISOString(),
    finished_at: new Date().toISOString(),
    records_processed: stats.productsFound,
    records_new: stats.productsSaved,
    records_updated: 0,
    error_message: stats.errors.length > 0 ? stats.errors.join('; ') : null,
  })

  if (logError) {
    console.error(`Failed to save ingestion log: ${logError.message}`)
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('='.repeat(60))
  console.log('INGESTION COMPLETE')
  console.log('='.repeat(60))
  console.log(`Duration:          ${elapsed}s`)
  console.log(`Insurers:          ${stats.insurersDiscovered} discovered, ${stats.insurersFetched} fetched`)
  console.log(`Products:          ${stats.productsFound} found, ${stats.productsSaved} saved`)
  console.log(`Coverages:         ${stats.coveragesSaved} saved, ${stats.coveragesSkipped} skipped`)
  console.log(`PDFs:              ${stats.pdfsDownloaded} downloaded, ${stats.pdfsSkipped} cached, ${stats.pdfsFailed} failed`)
  console.log(`Chunks:            ${stats.chunksCreated} created, ${stats.chunksIndexed} indexed`)
  if (stats.errors.length > 0) {
    console.log(`Errors:            ${stats.errors.length}`)
    for (const err of stats.errors.slice(0, 10)) {
      console.log(`  - ${err}`)
    }
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more`)
    }
  }
  console.log('='.repeat(60))
}

main().catch((error) => {
  console.error('FATAL:', error)
  process.exit(1)
})
