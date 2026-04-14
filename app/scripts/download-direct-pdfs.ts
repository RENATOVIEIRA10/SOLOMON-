/**
 * Direct PDF Downloader + Indexer
 *
 * Downloads known PDF URLs (no Playwright needed), chunks, embeds, and indexes.
 * Can run on any machine — just needs OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:
 *   npx tsx scripts/download-direct-pdfs.ts
 *   npx tsx scripts/download-direct-pdfs.ts --skip-embeddings
 *   npx tsx scripts/download-direct-pdfs.ts --insurer "MAPFRE"
 */

import { supabaseAdmin } from '@/lib/supabase-admin'
import { DIRECT_PDF_URLS } from '@/services/crawlers/crawler-config'
import { chunkPdfs, type TextChunk } from '@/services/embeddings/chunker'
import { embedChunks } from '@/services/embeddings/embedder'
import { indexChunks, indexChunksWithoutEmbeddings } from '@/services/embeddings/indexer'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PDF_DIR = join(process.cwd(), '.crawler-pdfs')
const args = process.argv.slice(2)
const skipEmbeddings = args.includes('--skip-embeddings')
const insurerFilter = args.includes('--insurer') ? args[args.indexOf('--insurer') + 1]?.toLowerCase() : null

async function main() {
  const startTime = Date.now()
  const db = supabaseAdmin

  if (!existsSync(PDF_DIR)) mkdirSync(PDF_DIR, { recursive: true })

  let pdfs = DIRECT_PDF_URLS
  if (insurerFilter) {
    pdfs = pdfs.filter((p) => p.insurerName.toLowerCase().includes(insurerFilter))
  }

  console.log('='.repeat(60))
  console.log(`SOLOMON — Direct PDF Download + Index (${pdfs.length} PDFs)`)
  console.log('='.repeat(60))

  // Get insurer DB IDs
  const insurerDbIds = new Map<string, string>()
  const { data: insurers } = await db.from('insurers').select('id, cnpj')
  if (insurers) {
    for (const ins of insurers) {
      insurerDbIds.set(ins.cnpj, ins.id)
    }
  }

  // Also check for non-OPIN insurers (MAG, MetLife, Azos) that might not be in DB yet
  const missingInsurers = new Map<string, { name: string; cnpj: string }>()
  for (const pdf of pdfs) {
    if (!insurerDbIds.has(pdf.insurerCnpj)) {
      missingInsurers.set(pdf.insurerCnpj, { name: pdf.insurerName, cnpj: pdf.insurerCnpj })
    }
  }
  if (missingInsurers.size > 0) {
    console.log(`\nAdding ${missingInsurers.size} missing insurers to DB...`)
    for (const [, ins] of missingInsurers) {
      const { data, error } = await db
        .from('insurers')
        .upsert({ name: ins.name, cnpj: ins.cnpj }, { onConflict: 'cnpj' })
        .select('id')
        .single()
      if (data) {
        insurerDbIds.set(ins.cnpj, data.id)
        console.log(`  Added: ${ins.name} (${ins.cnpj}) → ${data.id}`)
      } else if (error) {
        console.error(`  Failed: ${ins.name}: ${error.message}`)
      }
    }
  }

  // Download PDFs
  const downloaded: Array<{
    filePath: string
    url: string
    insurerName: string
    insurerCnpj: string
    productName: string
  }> = []

  let failed = 0

  console.log('\n[1/3] Downloading PDFs...\n')

  for (const pdf of pdfs) {
    try {
      const urlHash = createHash('sha256').update(pdf.url).digest('hex').slice(0, 12)
      const slug = pdf.insurerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const filename = `${slug}_${urlHash}.pdf`
      const filePath = join(PDF_DIR, filename)

      // Skip if already downloaded (same hash)
      if (existsSync(filePath)) {
        console.log(`  [SKIP] ${pdf.insurerName}: ${pdf.productName} (already exists)`)
        downloaded.push({ filePath, url: pdf.url, insurerName: pdf.insurerName, insurerCnpj: pdf.insurerCnpj, productName: pdf.productName })
        continue
      }

      const response = await fetch(pdf.url, {
        headers: { Accept: 'application/pdf,*/*', 'User-Agent': 'Mozilla/5.0 SOLOMON-Crawler/1.0' },
        signal: AbortSignal.timeout(60_000),
      })

      if (!response.ok) {
        console.error(`  [FAIL] ${pdf.insurerName}: ${pdf.productName} — HTTP ${response.status}`)
        failed++
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())

      if (buffer.length < 5 || buffer.toString('utf-8', 0, 5) !== '%PDF-') {
        console.warn(`  [SKIP] Not a PDF: ${pdf.productName} (${buffer.length} bytes)`)
        failed++
        continue
      }

      writeFileSync(filePath, buffer)
      console.log(`  [OK] ${pdf.insurerName}: ${pdf.productName} (${(buffer.length / 1024).toFixed(0)} KB)`)
      downloaded.push({ filePath, url: pdf.url, insurerName: pdf.insurerName, insurerCnpj: pdf.insurerCnpj, productName: pdf.productName })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`  [FAIL] ${pdf.insurerName}: ${pdf.productName} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[1/3] Done: ${downloaded.length} OK, ${failed} failed`)

  if (downloaded.length === 0) {
    console.log('No PDFs to process. Exiting.')
    return
  }

  // Chunk PDFs
  console.log('\n[2/3] Chunking PDFs...\n')

  const filesToChunk = downloaded.map((pdf) => ({
    filePath: pdf.filePath,
    sourceUrl: pdf.url,
    insurerName: pdf.insurerName,
    productName: pdf.productName,
  }))

  const allChunks = await chunkPdfs(filesToChunk)
  console.log(`\n[2/3] Created ${allChunks.length} chunks`)

  if (allChunks.length === 0) {
    console.log('No chunks created. Exiting.')
    return
  }

  // Embed + Index
  console.log('\n[3/3] Embedding and indexing...\n')

  const pdfByCnpj = new Map<string, string>()
  for (const pdf of downloaded) {
    pdfByCnpj.set(pdf.url, pdf.insurerCnpj)
  }

  if (skipEmbeddings) {
    console.log('Embeddings skipped, indexing text only...')

    const chunksByUrl = new Map<string, TextChunk[]>()
    for (const chunk of allChunks) {
      const url = chunk.metadata.source_url
      const existing = chunksByUrl.get(url) ?? []
      existing.push(chunk)
      chunksByUrl.set(url, existing)
    }

    let indexed = 0
    for (const [url, chunks] of chunksByUrl) {
      const cnpj = pdfByCnpj.get(url)
      const insurerId = cnpj ? insurerDbIds.get(cnpj) : undefined
      const result = await indexChunksWithoutEmbeddings(db, chunks, undefined, insurerId)
      indexed += result.inserted
    }
    console.log(`Indexed ${indexed} chunks (no embeddings)`)
  } else {
    const texts = allChunks.map((c) => c.content)
    console.log(`Generating embeddings for ${texts.length} chunks...`)
    const embeddings = await embedChunks(texts)

    const chunksByUrl = new Map<string, { chunks: TextChunk[]; embeddings: number[][] }>()
    for (let i = 0; i < allChunks.length; i++) {
      const url = allChunks[i].metadata.source_url
      const existing = chunksByUrl.get(url) ?? { chunks: [], embeddings: [] }
      existing.chunks.push(allChunks[i])
      existing.embeddings.push(embeddings[i])
      chunksByUrl.set(url, existing)
    }

    let indexed = 0
    for (const [url, { chunks, embeddings: embs }] of chunksByUrl) {
      const cnpj = pdfByCnpj.get(url)
      const insurerId = cnpj ? insurerDbIds.get(cnpj) : undefined
      const result = await indexChunks(db, chunks, embs, undefined, insurerId)
      indexed += result.inserted
    }
    console.log(`Indexed ${indexed} chunks with embeddings`)
  }

  // Log
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  await db.from('ingestion_logs').insert({
    source: 'direct_pdf_download',
    status: failed > 0 ? 'partial' : 'success',
    started_at: new Date(startTime).toISOString(),
    finished_at: new Date().toISOString(),
    records_processed: pdfs.length,
    records_new: downloaded.length,
    records_updated: 0,
    error_message: failed > 0 ? `${failed} downloads failed` : null,
  })

  console.log('\n' + '='.repeat(60))
  console.log('DIRECT PDF PIPELINE COMPLETE')
  console.log('='.repeat(60))
  console.log(`Duration:  ${elapsed}s`)
  console.log(`PDFs:      ${downloaded.length} OK, ${failed} failed`)
  console.log(`Chunks:    ${allChunks.length}`)
  console.log('='.repeat(60))
}

main().catch((error) => {
  console.error('FATAL:', error)
  process.exit(1)
})
