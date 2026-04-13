/**
 * Site Crawler
 *
 * Crawls insurer websites for terms & conditions PDFs.
 * Uses native fetch (no Playwright) to keep memory usage low.
 *
 * Flow:
 *   1. Fetch page HTML
 *   2. Extract PDF links via regex
 *   3. Filter for life-insurance keywords
 *   4. Download new/changed PDFs (URL-hash dedup)
 *   5. Track content hash for change detection
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { join, basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { CrawlerConfig } from './crawler-config'

const FETCH_TIMEOUT_MS = 30_000
const PDF_DOWNLOAD_TIMEOUT_MS = 120_000
const PDF_DIR = join(process.cwd(), '.crawler-pdfs')
const HASH_MANIFEST_FILE = join(PDF_DIR, '_manifest.json')

const USER_AGENT = 'SOLOMON-Crawler/1.0 (+https://solomon.app)'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawledPdf {
  url: string
  filePath: string
  insurerName: string
  insurerCnpj: string
  changed: boolean
  linkText: string
}

export interface CrawlResult {
  insurer: string
  cnpj: string
  pdfLinksFound: number
  relevantLinks: number
  downloaded: number
  skipped: number
  failed: number
  pdfs: CrawledPdf[]
  errors: string[]
}

interface HashManifest {
  [url: string]: {
    contentHash: string
    filePath: string
    crawledAt: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function urlToFilename(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
  return `${hash}.pdf`
}

function fileContentHash(filePath: string): string {
  const buffer = readFileSync(filePath)
  return createHash('sha256').update(buffer).digest('hex')
}

function loadManifest(): HashManifest {
  if (!existsSync(HASH_MANIFEST_FILE)) return {}
  try {
    return JSON.parse(readFileSync(HASH_MANIFEST_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveManifest(manifest: HashManifest): void {
  ensureDir(PDF_DIR)
  writeFileSync(HASH_MANIFEST_FILE, JSON.stringify(manifest, null, 2))
}

/**
 * Checks if a URL or link text contains any of the life insurance keywords.
 */
function isRelevantPdf(url: string, linkText: string, keywords: string[]): boolean {
  const combined = `${url} ${linkText}`.toLowerCase()
  return keywords.some((kw) => combined.includes(kw.toLowerCase()))
}

/**
 * Extracts all PDF links from HTML content.
 * Returns an array of { url, linkText } objects.
 */
function extractPdfLinks(
  html: string,
  baseUrl: string,
  pattern: RegExp
): Array<{ url: string; linkText: string }> {
  const links: Array<{ url: string; linkText: string }> = []
  const seen = new Set<string>()

  // Strategy 1: Match explicit PDF URLs via the provided pattern
  const urlMatches = html.matchAll(new RegExp(pattern.source, 'gi'))
  for (const match of urlMatches) {
    let url = match[0].replace(/["'<>].*$/, '') // Clean trailing chars
    url = resolveUrl(url, baseUrl)
    if (!seen.has(url)) {
      seen.add(url)
      links.push({ url, linkText: '' })
    }
  }

  // Strategy 2: Parse <a> tags with href containing .pdf
  const anchorPattern = /<a\s[^>]*href=["']([^"']*\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let anchorMatch
  while ((anchorMatch = anchorPattern.exec(html)) !== null) {
    let url = anchorMatch[1]
    const text = anchorMatch[2].replace(/<[^>]+>/g, '').trim()
    url = resolveUrl(url, baseUrl)
    if (!seen.has(url)) {
      seen.add(url)
      links.push({ url, linkText: text })
    } else {
      // Enrich existing entry with link text if we didn't have it
      const existing = links.find((l) => l.url === url)
      if (existing && !existing.linkText && text) {
        existing.linkText = text
      }
    }
  }

  return links
}

/**
 * Resolves a potentially relative URL against a base URL.
 */
function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href
  } catch {
    return href
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Fetches the HTML content of a page.
 */
async function fetchPage(url: string): Promise<string> {
  console.log(`[crawler] Fetching page: ${url}`)

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.text()
}

/**
 * Downloads a PDF and checks for content changes.
 * Returns the file path and whether the content has changed.
 */
async function downloadPdf(
  url: string,
  manifest: HashManifest,
  outputDir: string
): Promise<{ filePath: string; changed: boolean } | null> {
  ensureDir(outputDir)

  const filename = urlToFilename(url)
  const filePath = join(outputDir, filename)

  try {
    console.log(`[crawler] Downloading PDF: ${url}`)

    const response = await fetch(url, {
      signal: AbortSignal.timeout(PDF_DOWNLOAD_TIMEOUT_MS),
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/pdf,*/*',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    // Stream to file
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream)
    const fileStream = createWriteStream(filePath)
    await pipeline(nodeStream, fileStream)

    // Check content hash for change detection
    const newHash = fileContentHash(filePath)
    const previousEntry = manifest[url]
    const changed = !previousEntry || previousEntry.contentHash !== newHash

    // Update manifest
    manifest[url] = {
      contentHash: newHash,
      filePath,
      crawledAt: new Date().toISOString(),
    }

    if (changed) {
      console.log(`[crawler] New/changed PDF saved: ${filename}`)
    } else {
      console.log(`[crawler] PDF unchanged: ${filename}`)
    }

    return { filePath, changed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[crawler] Failed to download ${url}: ${message}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Crawls a single insurer's website for PDFs.
 */
export async function crawlInsurer(
  config: CrawlerConfig,
  options: { dryRun?: boolean; outputDir?: string } = {}
): Promise<CrawlResult> {
  const outputDir = options.outputDir ?? PDF_DIR
  const manifest = loadManifest()

  const result: CrawlResult = {
    insurer: config.name,
    cnpj: config.cnpj,
    pdfLinksFound: 0,
    relevantLinks: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    pdfs: [],
    errors: [],
  }

  console.log(`\n[crawler] === ${config.name} (${config.cnpj}) ===`)

  // Crawl each URL for PDF links
  const allLinks: Array<{ url: string; linkText: string }> = []

  for (const pageUrl of config.urls) {
    try {
      const html = await fetchPage(pageUrl)
      const links = extractPdfLinks(html, pageUrl, config.pdfPattern)
      console.log(`[crawler] Found ${links.length} PDF links on ${pageUrl}`)
      allLinks.push(...links)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[crawler] Failed to crawl ${pageUrl}: ${message}`)
      result.errors.push(`Page ${pageUrl}: ${message}`)
    }
  }

  // Deduplicate by URL
  const uniqueLinks = new Map<string, string>()
  for (const link of allLinks) {
    if (!uniqueLinks.has(link.url)) {
      uniqueLinks.set(link.url, link.linkText)
    }
  }

  result.pdfLinksFound = uniqueLinks.size

  // Filter for relevant PDFs
  const relevant = Array.from(uniqueLinks.entries()).filter(([url, text]) =>
    isRelevantPdf(url, text, config.keywords)
  )

  result.relevantLinks = relevant.length
  console.log(`[crawler] ${relevant.length}/${uniqueLinks.size} links match life insurance keywords`)

  if (options.dryRun) {
    console.log(`[crawler] [DRY RUN] Would download ${relevant.length} PDFs`)
    for (const [url, text] of relevant) {
      console.log(`  - ${text || basename(url)} : ${url}`)
    }
    return result
  }

  // Download relevant PDFs
  for (const [url, linkText] of relevant) {
    const downloadResult = await downloadPdf(url, manifest, outputDir)

    if (!downloadResult) {
      result.failed++
      result.errors.push(`Download failed: ${url}`)
      continue
    }

    if (!downloadResult.changed) {
      result.skipped++
    } else {
      result.downloaded++
    }

    result.pdfs.push({
      url,
      filePath: downloadResult.filePath,
      insurerName: config.name,
      insurerCnpj: config.cnpj,
      changed: downloadResult.changed,
      linkText,
    })
  }

  // Save manifest after all downloads
  saveManifest(manifest)

  console.log(
    `[crawler] ${config.name}: ${result.downloaded} new, ${result.skipped} unchanged, ${result.failed} failed`
  )

  return result
}

/**
 * Crawls all configured insurers.
 */
export async function crawlAllInsurers(
  configs: CrawlerConfig[],
  options: { dryRun?: boolean; outputDir?: string } = {}
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  for (const config of configs) {
    const result = await crawlInsurer(config, options)
    results.push(result)
  }

  return results
}
