/**
 * Playwright PDF Crawler Pipeline (VPS)
 *
 * Navigates insurer websites with Playwright, downloads PDFs,
 * then chunks, embeds, and indexes them in Supabase.
 *
 * Designed to run on VPS via cron or manual SSH.
 *
 * Usage:
 *   npx tsx scripts/crawl-pdfs-playwright.ts
 *   npx tsx scripts/crawl-pdfs-playwright.ts --dry-run
 *   npx tsx scripts/crawl-pdfs-playwright.ts --insurer "Prudential"
 *   npx tsx scripts/crawl-pdfs-playwright.ts --skip-embeddings
 *   npx tsx scripts/crawl-pdfs-playwright.ts --opin-urls
 *
 * Options:
 *   --dry-run          List PDFs without downloading
 *   --insurer "name"   Filter by insurer name (partial match)
 *   --skip-embeddings  Index text without generating embeddings
 *   --opin-urls        Also crawl OPIN terms_url from products table
 *   --output-dir       Custom output directory for PDFs
 */

import { supabaseAdmin } from '@/lib/supabase-admin'
import { PLAYWRIGHT_CONFIGS, FETCH_CONFIGS, DIRECT_PDF_URLS, type CrawlerConfig } from '@/services/crawlers/crawler-config'
import { crawlAllInsurersWithPlaywright, type PlaywrightCrawlResult } from '@/services/crawlers/playwright-crawler'
import { crawlInsurer, type CrawlResult } from '@/services/crawlers/site-crawler'
import { chunkPdfs, type TextChunk } from '@/services/embeddings/chunker'
import { embedChunks } from '@/services/embeddings/embedder'
import { indexChunks, indexChunksWithoutEmbeddings } from '@/services/embeddings/indexer'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  dryRun: boolean
  insurerFilter: string | null
  skipEmbeddings: boolean
  crawlOpinUrls: boolean
  outputDir: string | null
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = {
    dryRun: false,
    insurerFilter: null,
    skipEmbeddings: false,
    crawlOpinUrls: false,
    outputDir: null,
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
      case '--opin-urls':
        result.crawlOpinUrls = true
        break
      case '--output-dir':
        result.outputDir = args[++i] ?? null
        break
      default:
        console.warn(`Unknown argument: ${args[i]}`)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// OPIN URL crawler
// ---------------------------------------------------------------------------

/**
 * Fetches terms_url from the products table and creates temporary
 * crawler configs for each unique URL, grouped by insurer.
 */
async function getOpinTermsConfigs(): Promise<CrawlerConfig[]> {
  console.log('[opin-urls] Fetching terms URLs from products table...')

  const { data, error } = await supabaseAdmin
    .from('products')
    .select('terms_url, insurers!inner(name, cnpj)')
    .not('terms_url', 'is', null)
    .not('terms_url', 'eq', '')

  if (error || !data) {
    console.error(`[opin-urls] Failed to fetch: ${error?.message}`)
    return []
  }

  // Group URLs by insurer
  const byInsurer = new Map<string, { name: string; cnpj: string; urls: Set<string> }>()

  for (const row of data) {
    const insurer = row.insurers as unknown as { name: string; cnpj: string }
    if (!insurer?.cnpj) continue

    const existing = byInsurer.get(insurer.cnpj) ?? {
      name: insurer.name,
      cnpj: insurer.cnpj,
      urls: new Set<string>(),
    }

    // Normalize URL
    const url = (row.terms_url as string).trim()
    if (url) {
      existing.urls.add(url)
    }

    byInsurer.set(insurer.cnpj, existing)
  }

  const configs: CrawlerConfig[] = []

  for (const [, insurer] of byInsurer) {
    if (insurer.urls.size === 0) continue

    configs.push({
      name: `${insurer.name} (OPIN URLs)`,
      cnpj: insurer.cnpj,
      urls: Array.from(insurer.urls),
      pdfPattern: /https?:\/\/[^\s"'<>]+\.pdf/gi,
      keywords: ['vida', 'condicoes', 'condições', 'cobertura', 'exclus', 'carencia'],
      needsPlaywright: true,
      source: 'opin',
    })
  }

  console.log(`[opin-urls] ${configs.length} insurers with ${data.length} unique URLs`)
  return configs
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

interface PipelineStats {
  insurersCrawled: number
  pagesVisited: number
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
  console.log('SOLOMON — Playwright PDF Crawler Pipeline')
  console.log('='.repeat(60))
  console.log(`Mode:       ${args.dryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`OPIN URLs:  ${args.crawlOpinUrls ? 'YES' : 'NO'}`)
  if (args.insurerFilter) console.log(`Filter:     ${args.insurerFilter}`)
  if (args.skipEmbeddings) console.log(`Embeddings: SKIPPED`)
  console.log('')

  const stats: PipelineStats = {
    insurersCrawled: 0,
    pagesVisited: 0,
    pdfLinksFound: 0,
    pdfsDownloaded: 0,
    pdfsUnchanged: 0,
    pdfsFailed: 0,
    chunksCreated: 0,
    chunksIndexed: 0,
    errors: [],
  }

  // -------------------------------------------------------------------------
  // Step 1: Build config list
  // -------------------------------------------------------------------------
  let playwrightConfigs = [...PLAYWRIGHT_CONFIGS]
  let fetchConfigs = [...FETCH_CONFIGS]

  // Add OPIN terms URLs if requested
  if (args.crawlOpinUrls) {
    const opinConfigs = await getOpinTermsConfigs()
    playwrightConfigs.push(...opinConfigs)
  }

  // Apply insurer filter
  if (args.insurerFilter) {
    const filter = args.insurerFilter.toLowerCase()
    playwrightConfigs = playwrightConfigs.filter((c) => c.name.toLowerCase().includes(filter))
    fetchConfigs = fetchConfigs.filter((c) => c.name.toLowerCase().includes(filter))
  }

  const totalInsurers = playwrightConfigs.length + fetchConfigs.length
  if (totalInsurers === 0) {
    console.error('No insurers match the filter.')
    process.exit(1)
  }

  console.log(`[1/5] ${playwrightConfigs.length} Playwright + ${fetchConfigs.length} fetch insurers`)

  // -------------------------------------------------------------------------
  // Step 2: Crawl with Playwright
  // -------------------------------------------------------------------------
  console.log('\n[2/5] Crawling with Playwright...')

  const crawlOptions = {
    dryRun: args.dryRun,
    outputDir: args.outputDir ?? undefined,
  }

  const pwResults: PlaywrightCrawlResult[] = playwrightConfigs.length > 0
    ? await crawlAllInsurersWithPlaywright(playwrightConfigs, crawlOptions)
    : []

  for (const r of pwResults) {
    stats.insurersCrawled++
    stats.pagesVisited += r.pagesVisited
    stats.pdfLinksFound += r.relevantLinks
    stats.pdfsDownloaded += r.downloaded
    stats.pdfsUnchanged += r.skipped
    stats.pdfsFailed += r.failed
    stats.errors.push(...r.errors)
  }

  // -------------------------------------------------------------------------
  // Step 2b: Download known direct PDF URLs (no Playwright needed)
  // -------------------------------------------------------------------------
  const directPdfDir = join(process.cwd(), '.crawler-pdfs')
  if (!existsSync(directPdfDir)) mkdirSync(directPdfDir, { recursive: true })

  let directPdfsToFilter = DIRECT_PDF_URLS
  if (args.insurerFilter) {
    const filter = args.insurerFilter.toLowerCase()
    directPdfsToFilter = directPdfsToFilter.filter((p) => p.insurerName.toLowerCase().includes(filter))
  }

  interface DirectDownloadResult {
    url: string
    filePath: string
    insurerName: string
    insurerCnpj: string
    productName: string
    changed: boolean
  }
  const directDownloaded: DirectDownloadResult[] = []

  if (directPdfsToFilter.length > 0) {
    console.log(`\n[2b] Downloading ${directPdfsToFilter.length} known direct PDFs...`)

    for (const pdf of directPdfsToFilter) {
      try {
        const urlHash = createHash('sha256').update(pdf.url).digest('hex').slice(0, 12)
        const slug = pdf.insurerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const urlPart = basename(new URL(pdf.url).pathname).replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
        const filename = `${slug}_${urlPart || urlHash}.pdf`
        const filePath = join(directPdfDir, filename)

        if (args.dryRun) {
          console.log(`  [DRY] ${pdf.insurerName}: ${pdf.productName} — ${pdf.url}`)
          continue
        }

        const response = await fetch(pdf.url, {
          headers: { Accept: 'application/pdf,*/*', 'User-Agent': 'Mozilla/5.0 SOLOMON-Crawler/1.0' },
          signal: AbortSignal.timeout(60_000),
        })

        if (!response.ok) {
          console.error(`  [FAIL] ${pdf.insurerName} ${pdf.productName}: HTTP ${response.status}`)
          stats.pdfsFailed++
          stats.errors.push(`Direct download ${response.status}: ${pdf.url}`)
          continue
        }

        const buffer = Buffer.from(await response.arrayBuffer())

        if (buffer.length < 5 || buffer.toString('utf-8', 0, 5) !== '%PDF-') {
          console.warn(`  [SKIP] Not a valid PDF: ${pdf.productName} (${buffer.length} bytes)`)
          stats.pdfsFailed++
          continue
        }

        writeFileSync(filePath, buffer)
        console.log(`  [OK] ${pdf.insurerName}: ${pdf.productName} (${(buffer.length / 1024).toFixed(0)} KB)`)

        stats.pdfsDownloaded++
        stats.pdfLinksFound++

        directDownloaded.push({
          url: pdf.url,
          filePath,
          insurerName: pdf.insurerName,
          insurerCnpj: pdf.insurerCnpj,
          productName: pdf.productName,
          changed: true,
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`  [FAIL] ${pdf.insurerName} ${pdf.productName}: ${msg}`)
        stats.pdfsFailed++
        stats.errors.push(`Direct download: ${pdf.insurerName} ${pdf.productName}: ${msg}`)
      }
    }

    console.log(`[2b] Direct downloads: ${directDownloaded.length} OK, ${stats.pdfsFailed} failed`)
  }

  // -------------------------------------------------------------------------
  // Step 3: Crawl simple sites with fetch
  // -------------------------------------------------------------------------
  if (fetchConfigs.length > 0) {
    console.log('\n[3/5] Crawling simple sites with fetch...')

    for (const config of fetchConfigs) {
      const result: CrawlResult = await crawlInsurer(config, crawlOptions)
      stats.insurersCrawled++
      stats.pdfLinksFound += result.relevantLinks
      stats.pdfsDownloaded += result.downloaded
      stats.pdfsUnchanged += result.skipped
      stats.pdfsFailed += result.failed
      stats.errors.push(...result.errors)
    }
  }

  if (args.dryRun) {
    console.log('\n[DRY RUN] No data saved. Exiting.')
    return
  }

  // -------------------------------------------------------------------------
  // Step 4: Chunk changed/new PDFs
  // -------------------------------------------------------------------------
  console.log('\n[4/5] Chunking new/changed PDFs...')

  const changedPdfs = pwResults.flatMap((r) =>
    r.pdfs.filter((p) => p.changed)
  )

  console.log(`[4/5] ${changedPdfs.length} Playwright + ${directDownloaded.length} direct PDFs to process`)

  const filesToChunk = [
    ...changedPdfs.map((pdf) => ({
      filePath: pdf.filePath,
      sourceUrl: pdf.url,
      insurerName: pdf.insurerName,
      productName: pdf.linkText || 'Conditions PDF',
    })),
    ...directDownloaded.map((pdf) => ({
      filePath: pdf.filePath,
      sourceUrl: pdf.url,
      insurerName: pdf.insurerName,
      productName: pdf.productName,
    })),
  ]

  let allChunks: TextChunk[] = []

  if (filesToChunk.length > 0) {
    allChunks = await chunkPdfs(filesToChunk)
    stats.chunksCreated = allChunks.length
  }

  console.log(`[4/5] Created ${stats.chunksCreated} chunks`)

  // -------------------------------------------------------------------------
  // Step 5: Embed + Index
  // -------------------------------------------------------------------------
  console.log('\n[5/5] Embedding and indexing...')

  if (allChunks.length > 0) {
    // Map PDF URL → CNPJ for DB linking
    const pdfByCnpj = new Map<string, string>()
    for (const pdf of changedPdfs) {
      pdfByCnpj.set(pdf.url, pdf.insurerCnpj)
    }
    for (const pdf of directDownloaded) {
      pdfByCnpj.set(pdf.url, pdf.insurerCnpj)
    }

    // Get insurer DB IDs
    const insurerDbIds = new Map<string, string>()
    const { data: insurers } = await db.from('insurers').select('id, cnpj')
    if (insurers) {
      for (const ins of insurers) {
        insurerDbIds.set(ins.cnpj, ins.id)
      }
    }

    if (args.skipEmbeddings) {
      console.log('[5/5] Embeddings skipped, indexing text only...')

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
      console.log(`[5/5] Generating embeddings for ${texts.length} chunks...`)
      const embeddings = await embedChunks(texts)

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

  console.log(`[5/5] Indexed ${stats.chunksIndexed} chunks`)

  // -------------------------------------------------------------------------
  // Save ingestion log
  // -------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  await db.from('ingestion_logs').insert({
    source: 'crawler_playwright',
    status: stats.errors.length > 0 ? 'partial' : 'success',
    started_at: new Date(startTime).toISOString(),
    finished_at: new Date().toISOString(),
    records_processed: stats.pdfLinksFound,
    records_new: stats.pdfsDownloaded,
    records_updated: 0,
    error_message: stats.errors.length > 0 ? stats.errors.join('; ').slice(0, 1000) : null,
  })

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60))
  console.log('PLAYWRIGHT PDF CRAWL COMPLETE')
  console.log('='.repeat(60))
  console.log(`Duration:     ${elapsed}s`)
  console.log(`Insurers:     ${stats.insurersCrawled}`)
  console.log(`Pages:        ${stats.pagesVisited}`)
  console.log(`PDF links:    ${stats.pdfLinksFound} relevant`)
  console.log(`PDFs:         ${stats.pdfsDownloaded} new, ${stats.pdfsUnchanged} unchanged, ${stats.pdfsFailed} failed`)
  console.log(`Chunks:       ${stats.chunksCreated} created, ${stats.chunksIndexed} indexed`)
  if (stats.errors.length > 0) {
    console.log(`Errors:       ${stats.errors.length}`)
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
