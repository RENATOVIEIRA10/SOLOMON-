/**
 * PDF Downloader
 *
 * Downloads terms & conditions PDFs from insurer URLs.
 * Deduplicates by URL hash and handles redirects.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const DOWNLOAD_TIMEOUT_MS = 60_000
const TEMP_DIR = join(process.cwd(), '.opin-pdfs')

export interface DownloadResult {
  url: string
  filePath: string | null
  skipped: boolean
  error?: string
}

/**
 * Generates a deterministic filename from a URL using SHA256.
 */
function urlToFilename(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
  return `${hash}.pdf`
}

/**
 * Ensures the download directory exists.
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Downloads a single PDF from the given URL.
 * Skips if the file already exists (by URL hash).
 */
export async function downloadPdf(
  url: string,
  outputDir: string = TEMP_DIR
): Promise<DownloadResult> {
  ensureDir(outputDir)

  const filename = urlToFilename(url)
  const filePath = join(outputDir, filename)

  // Skip if already downloaded
  if (existsSync(filePath)) {
    console.log(`[pdf] Skipped (exists): ${filename}`)
    return { url, filePath, skipped: true }
  }

  try {
    console.log(`[pdf] Downloading: ${url}`)
    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: 'follow',
      headers: {
        Accept: 'application/pdf,*/*',
        'User-Agent': 'SOLOMON-OPIN-Ingestor/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      console.warn(`[pdf] Unexpected content-type: ${contentType} for ${url}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    // Stream the response body to a file
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream)
    const fileStream = createWriteStream(filePath)
    await pipeline(nodeStream, fileStream)

    console.log(`[pdf] Saved: ${filename}`)
    return { url, filePath, skipped: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[pdf] Failed: ${url} - ${message}`)
    return { url, filePath: null, skipped: false, error: message }
  }
}

/**
 * Downloads multiple PDFs sequentially (to avoid overwhelming servers).
 */
export async function downloadPdfs(
  urls: string[],
  outputDir: string = TEMP_DIR
): Promise<DownloadResult[]> {
  console.log(`[pdf] Downloading ${urls.length} PDFs to ${outputDir}`)
  const results: DownloadResult[] = []

  for (const url of urls) {
    const result = await downloadPdf(url, outputDir)
    results.push(result)
  }

  const downloaded = results.filter((r) => !r.skipped && !r.error).length
  const skipped = results.filter((r) => r.skipped).length
  const failed = results.filter((r) => r.error).length

  console.log(`[pdf] Done: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`)
  return results
}
