/**
 * Playwright PDF Crawler
 *
 * Navigates insurer websites with full JS rendering to find and download
 * terms & conditions PDFs. Designed to run on VPS (headless Chromium).
 *
 * Why Playwright instead of fetch:
 *   - Many insurer sites are SPAs (Bradesco, Prudential)
 *   - PDF links are loaded dynamically via JS
 *   - Cookie banners, tabs, accordions hide content
 *   - Some PDFs require clicking through multiple pages
 *
 * Flow per insurer:
 *   1. Launch headless browser
 *   2. Navigate to each configured URL
 *   3. Wait for JS to render, dismiss popups
 *   4. Extract all PDF links (href + onclick + data-*)
 *   5. Filter by life insurance keywords
 *   6. Download PDFs via browser context (keeps cookies/auth)
 *   7. Track content hash for change detection
 */

import type { Browser, Page, BrowserContext } from 'playwright'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { CrawlerConfig } from './crawler-config'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PDF_DIR = join(process.cwd(), '.crawler-pdfs')
const HASH_MANIFEST_FILE = join(PDF_DIR, '_manifest.json')
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const NAVIGATION_TIMEOUT_MS = 45_000
const PAGE_SETTLE_MS = 3_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_PDFS_PER_INSURER = 50

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaywrightCrawledPdf {
  url: string
  filePath: string
  insurerName: string
  insurerCnpj: string
  changed: boolean
  linkText: string
  pageUrl: string
}

export interface PlaywrightCrawlResult {
  insurer: string
  cnpj: string
  pagesVisited: number
  pdfLinksFound: number
  relevantLinks: number
  downloaded: number
  skipped: number
  failed: number
  pdfs: PlaywrightCrawledPdf[]
  errors: string[]
  durationMs: number
}

interface HashManifest {
  [url: string]: {
    contentHash: string
    filePath: string
    crawledAt: string
    fileSize: number
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

function urlToFilename(url: string, insurerSlug: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12)
  // Try to keep a readable part from the URL
  const urlPart = basename(new URL(url).pathname)
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40)
  return `${insurerSlug}_${urlPart || hash}.pdf`
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function isRelevantPdf(url: string, linkText: string, keywords: string[]): boolean {
  const combined = `${url} ${linkText}`.toLowerCase()
  return keywords.some((kw) => combined.includes(kw.toLowerCase()))
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

/**
 * Dismisses common cookie banners, modals, overlays.
 */
async function dismissPopups(page: Page): Promise<void> {
  const selectors = [
    // Cookie banners
    'button:has-text("Aceitar")',
    'button:has-text("Aceito")',
    'button:has-text("OK")',
    'button:has-text("Concordo")',
    'button:has-text("Accept")',
    '[id*="cookie"] button',
    '[class*="cookie"] button',
    '[id*="lgpd"] button',
    '[class*="lgpd"] button',
    // Generic close buttons on modals
    '[class*="modal"] [class*="close"]',
    '[class*="popup"] [class*="close"]',
    '[aria-label="Fechar"]',
    '[aria-label="Close"]',
  ]

  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first()
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ timeout: 1000 })
        await page.waitForTimeout(300)
      }
    } catch {
      // Ignore — element not found or not clickable
    }
  }
}

/**
 * Expands accordions, tabs, and "show more" elements to reveal hidden PDF links.
 */
async function expandContent(page: Page): Promise<void> {
  const expandSelectors = [
    // Accordions
    '[class*="accordion"] button',
    '[class*="accordion"] [role="button"]',
    '[data-toggle="collapse"]',
    'details:not([open]) summary',
    // Tabs
    '[role="tab"]',
    '[class*="tab-"] a',
    // Show more
    'button:has-text("Ver mais")',
    'button:has-text("Mostrar mais")',
    'a:has-text("Ver mais")',
    'a:has-text("Ver todos")',
    // Specific insurer patterns
    '[class*="product"] [class*="expand"]',
    '[class*="card"] [class*="toggle"]',
  ]

  for (const selector of expandSelectors) {
    try {
      const elements = page.locator(selector)
      const count = await elements.count()
      // Click up to 20 expand elements
      for (let i = 0; i < Math.min(count, 20); i++) {
        try {
          const el = elements.nth(i)
          if (await el.isVisible({ timeout: 300 })) {
            await el.click({ timeout: 1000 })
            await page.waitForTimeout(200)
          }
        } catch {
          // Skip non-clickable elements
        }
      }
    } catch {
      // Selector not found
    }
  }

  // Wait for any lazy-loaded content
  await page.waitForTimeout(1500)
}

/**
 * Extracts all PDF links from the current page.
 * Goes beyond simple <a href=".pdf"> — also checks:
 *   - onclick handlers
 *   - data-href attributes
 *   - JS-generated download links
 *   - iframes with PDFs
 */
async function extractPdfLinks(page: Page): Promise<Array<{ url: string; linkText: string }>> {
  // Uses $$eval and content() instead of page.evaluate with closures,
  // because tsx/esbuild injects __name decorators that break in browser context.

  const baseUrl = page.url()
  const links: Array<{ url: string; linkText: string }> = []
  const seen = new Set<string>()

  // Domains that are not actual PDF hosts (share links, redirects, etc.)
  const BLOCKED_DOMAINS = ['wa.me', 'api.whatsapp.com', 't.me', 'facebook.com', 'twitter.com']

  const addLink = (href: string, text: string) => {
    try {
      const resolved = new URL(href, baseUrl).href
      const hostname = new URL(resolved).hostname
      if (
        !seen.has(resolved) &&
        resolved.toLowerCase().includes('.pdf') &&
        !BLOCKED_DOMAINS.some((d) => hostname.includes(d))
      ) {
        seen.add(resolved)
        links.push({ url: resolved, linkText: text.trim() })
      }
    } catch {
      // Invalid URL
    }
  }

  // 1. Standard <a href="*.pdf">
  const anchorLinks = await page.$$eval('a[href]', (anchors) =>
    anchors
      .filter((a) => (a.getAttribute('href') || '').toLowerCase().includes('.pdf'))
      .map((a) => ({ href: a.getAttribute('href') || '', text: a.textContent || '' }))
  )
  for (const { href, text } of anchorLinks) {
    addLink(href, text)
  }

  // 2. data-href, data-url, data-pdf, data-file attributes
  const dataLinks = await page.$$eval(
    '[data-href], [data-url], [data-pdf], [data-file]',
    (elements) => {
      const results: Array<{ href: string; text: string }> = []
      for (const el of elements) {
        for (const attr of ['data-href', 'data-url', 'data-pdf', 'data-file']) {
          const val = el.getAttribute(attr)
          if (val && val.toLowerCase().includes('.pdf')) {
            results.push({ href: val, text: el.textContent || '' })
          }
        }
      }
      return results
    }
  )
  for (const { href, text } of dataLinks) {
    addLink(href, text)
  }

  // 3. onclick handlers with PDF URLs
  const onclickLinks = await page.$$eval('[onclick]', (elements) => {
    const results: Array<{ href: string; text: string }> = []
    for (const el of elements) {
      const onclick = el.getAttribute('onclick') || ''
      const m = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/i)
      if (m) {
        results.push({ href: m[1], text: el.textContent || '' })
      }
    }
    return results
  })
  for (const { href, text } of onclickLinks) {
    addLink(href, text)
  }

  // 4. Scan full HTML for PDF URLs via regex
  const html = await page.content()
  const urlPattern = /https?:\/\/[^\s"'<>]+\.pdf/gi
  let match
  while ((match = urlPattern.exec(html)) !== null) {
    addLink(match[0], '')
  }

  // 5. Iframes with PDF src
  const iframeLinks = await page.$$eval('iframe[src]', (iframes) =>
    iframes
      .filter((f) => (f.getAttribute('src') || '').toLowerCase().includes('.pdf'))
      .map((f) => ({ href: f.getAttribute('src') || '', text: 'Embedded PDF' }))
  )
  for (const { href, text } of iframeLinks) {
    addLink(href, text)
  }

  return links
}

// ---------------------------------------------------------------------------
// PDF Download
// ---------------------------------------------------------------------------

/**
 * Downloads a PDF using the browser context (preserves cookies, auth).
 * Falls back to direct fetch if browser download fails.
 */
async function downloadPdfWithBrowser(
  context: BrowserContext,
  url: string,
  outputPath: string
): Promise<boolean> {
  try {
    const response = await context.request.get(url, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: {
        Accept: 'application/pdf,*/*',
      },
    })

    if (!response.ok()) {
      console.error(`[pw-crawler] HTTP ${response.status()} for ${url}`)
      return false
    }

    const body = await response.body()

    // Validate it's actually a PDF (starts with %PDF)
    if (body.length < 5 || body.toString('utf-8', 0, 5) !== '%PDF-') {
      console.warn(`[pw-crawler] Not a valid PDF: ${url} (${body.length} bytes, starts with: ${body.toString('utf-8', 0, 20)})`)
      return false
    }

    writeFileSync(outputPath, body)
    console.log(`[pw-crawler] Downloaded: ${basename(outputPath)} (${(body.length / 1024).toFixed(0)} KB)`)
    return true
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[pw-crawler] Download failed ${url}: ${msg}`)
    return false
  }
}

// ---------------------------------------------------------------------------
// Core: Crawl single insurer
// ---------------------------------------------------------------------------

export async function crawlInsurerWithPlaywright(
  browser: Browser,
  config: CrawlerConfig,
  options: { dryRun?: boolean; outputDir?: string } = {}
): Promise<PlaywrightCrawlResult> {
  const startTime = Date.now()
  const outputDir = options.outputDir ?? PDF_DIR
  const manifest = loadManifest()
  const insurerSlug = slugify(config.name)

  const result: PlaywrightCrawlResult = {
    insurer: config.name,
    cnpj: config.cnpj,
    pagesVisited: 0,
    pdfLinksFound: 0,
    relevantLinks: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    pdfs: [],
    errors: [],
    durationMs: 0,
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`[pw-crawler] ${config.name} (${config.cnpj})`)
  console.log(`${'='.repeat(60)}`)

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'pt-BR',
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
  })

  try {
    const allLinks: Array<{ url: string; linkText: string; pageUrl: string }> = []

    for (const pageUrl of config.urls) {
      try {
        const page = await context.newPage()

        // Block heavy resources to speed up crawling
        await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot,mp4,webm}', (route: { abort: () => void }) =>
          route.abort()
        )

        console.log(`[pw-crawler] Navigating: ${pageUrl}`)
        await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: NAVIGATION_TIMEOUT_MS,
        })

        // Wait for dynamic content
        await page.waitForTimeout(PAGE_SETTLE_MS)

        // Dismiss cookie banners etc.
        await dismissPopups(page)

        // Expand accordions, tabs
        await expandContent(page)

        // Extract PDF links
        const links = await extractPdfLinks(page)
        console.log(`[pw-crawler] Found ${links.length} PDF links on ${pageUrl}`)

        for (const link of links) {
          allLinks.push({ ...link, pageUrl })
        }

        result.pagesVisited++
        await page.close()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[pw-crawler] Failed to crawl ${pageUrl}: ${msg}`)
        result.errors.push(`Page ${pageUrl}: ${msg}`)
      }
    }

    // Deduplicate
    const uniqueLinks = new Map<string, { linkText: string; pageUrl: string }>()
    for (const link of allLinks) {
      if (!uniqueLinks.has(link.url)) {
        uniqueLinks.set(link.url, { linkText: link.linkText, pageUrl: link.pageUrl })
      }
    }

    result.pdfLinksFound = uniqueLinks.size

    // Filter relevant (or accept all if site is life-insurance specific)
    const allEntries = Array.from(uniqueLinks.entries())
    const relevant = config.acceptAllPdfs
      ? allEntries
      : allEntries.filter(([url, { linkText }]) => isRelevantPdf(url, linkText, config.keywords))

    result.relevantLinks = relevant.length
    console.log(
      config.acceptAllPdfs
        ? `[pw-crawler] ${relevant.length} PDFs (acceptAllPdfs=true)`
        : `[pw-crawler] ${relevant.length}/${uniqueLinks.size} match life insurance keywords`
    )

    if (options.dryRun) {
      console.log(`[pw-crawler] [DRY RUN] Would download ${relevant.length} PDFs:`)
      for (const [url, { linkText }] of relevant) {
        console.log(`  - ${linkText || basename(url)}: ${url}`)
      }
      result.durationMs = Date.now() - startTime
      return result
    }

    // Download PDFs (limit per insurer)
    const toDownload = relevant.slice(0, MAX_PDFS_PER_INSURER)
    if (relevant.length > MAX_PDFS_PER_INSURER) {
      console.warn(`[pw-crawler] Capping downloads at ${MAX_PDFS_PER_INSURER} (found ${relevant.length})`)
    }

    ensureDir(outputDir)

    for (const [url, { linkText, pageUrl }] of toDownload) {
      const filename = urlToFilename(url, insurerSlug)
      const filePath = join(outputDir, filename)

      const success = await downloadPdfWithBrowser(context, url, filePath)

      if (!success) {
        result.failed++
        result.errors.push(`Download failed: ${url}`)
        continue
      }

      // Check content hash for change detection
      const newHash = fileContentHash(filePath)
      const previousEntry = manifest[url]
      const changed = !previousEntry || previousEntry.contentHash !== newHash
      const fileSize = readFileSync(filePath).length

      manifest[url] = {
        contentHash: newHash,
        filePath,
        crawledAt: new Date().toISOString(),
        fileSize,
      }

      if (changed) {
        result.downloaded++
        console.log(`[pw-crawler] NEW/CHANGED: ${filename}`)
      } else {
        result.skipped++
        console.log(`[pw-crawler] UNCHANGED: ${filename}`)
      }

      result.pdfs.push({
        url,
        filePath,
        insurerName: config.name,
        insurerCnpj: config.cnpj,
        changed,
        linkText,
        pageUrl,
      })
    }

    saveManifest(manifest)
  } finally {
    await context.close()
  }

  result.durationMs = Date.now() - startTime
  console.log(
    `[pw-crawler] ${config.name}: ${result.downloaded} new, ${result.skipped} unchanged, ${result.failed} failed (${(result.durationMs / 1000).toFixed(1)}s)`
  )

  return result
}

// ---------------------------------------------------------------------------
// Core: Crawl all insurers
// ---------------------------------------------------------------------------

export async function crawlAllInsurersWithPlaywright(
  configs: CrawlerConfig[],
  options: { dryRun?: boolean; outputDir?: string } = {}
): Promise<PlaywrightCrawlResult[]> {
  console.log(`\n[pw-crawler] Launching Chromium (headless)...`)

  // Dynamic import — playwright is only installed on VPS, not in Next.js build
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  })

  const results: PlaywrightCrawlResult[] = []

  try {
    for (const config of configs) {
      const result = await crawlInsurerWithPlaywright(browser, config, options)
      results.push(result)
    }
  } finally {
    await browser.close()
  }

  return results
}
