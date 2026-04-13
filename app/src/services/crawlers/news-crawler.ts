/**
 * News Crawler
 *
 * Crawls insurance news sites for regulatory changes and industry news.
 * Indexes relevant articles for RAG retrieval.
 *
 * Sources:
 *   - CQCS (cqcs.com.br) — insurance news portal
 *   - Segs (segs.com.br) — insurance sector news
 *   - Sonho Seguro (sonhoseguro.com.br) — insurance consumer news
 *
 * Uses native fetch (no Playwright) for low memory usage.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const FETCH_TIMEOUT_MS = 20_000
const STATE_DIR = join(process.cwd(), '.crawler-pdfs')
const PROCESSED_URLS_FILE = join(STATE_DIR, '_news-processed.json')

const USER_AGENT = 'SOLOMON-NewsCrawler/1.0 (+https://solomon.app)'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewsSource {
  name: string
  /** Homepage or search URL to crawl for article links */
  urls: string[]
  /** Pattern to match article links in the HTML */
  articlePattern: RegExp
  /** Optional RSS feed URL (preferred over HTML scraping) */
  rssUrl?: string
}

export interface NewsArticle {
  url: string
  title: string
  content: string
  source: string
  publishedAt: string | null
  contentHash: string
}

export interface NewsCrawlResult {
  source: string
  articlesFound: number
  articlesNew: number
  articlesSkipped: number
  errors: string[]
  articles: NewsArticle[]
}

// ---------------------------------------------------------------------------
// News source configs
// ---------------------------------------------------------------------------

/**
 * Keywords to identify life-insurance-relevant news articles.
 */
const NEWS_KEYWORDS = [
  'seguro de vida',
  'seguro vida',
  'seguros de vida',
  'vida individual',
  'vida em grupo',
  'susep',
  'cnsp',
  'circular susep',
  'resolução cnsp',
  'morte acidental',
  'invalidez',
  'pecúlio',
  'previdência',
  'seguro prestamista',
  'seguro funeral',
  'seguro acidentes pessoais',
  'prudential',
  'metlife',
  'mag seguros',
  'azos',
  'mongeral',
  'icatu',
  'brasilprev',
  'regulamentação seguros',
]

export const NEWS_SOURCES: NewsSource[] = [
  {
    name: 'CQCS',
    urls: [
      'https://cqcs.com.br/category/seguros/',
      'https://cqcs.com.br/category/legislacao/',
    ],
    articlePattern: /<a\s[^>]*href=["'](https:\/\/cqcs\.com\.br\/\d{4}\/\d{2}\/[^"']+)["']/gi,
    rssUrl: 'https://cqcs.com.br/feed/',
  },
  {
    name: 'Segs',
    urls: [
      'https://www.segs.com.br/seguros',
    ],
    articlePattern: /<a\s[^>]*href=["'](https?:\/\/(?:www\.)?segs\.com\.br\/seguros\/[^"']+)["']/gi,
  },
  {
    name: 'Sonho Seguro',
    urls: [
      'https://sonhoseguro.com.br/category/seguros/',
      'https://sonhoseguro.com.br/category/regulacao/',
    ],
    articlePattern: /<a\s[^>]*href=["'](https?:\/\/sonhoseguro\.com\.br\/\d{4}\/\d{2}\/[^"']+)["']/gi,
  },
]

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function loadProcessedUrls(): Set<string> {
  if (!existsSync(PROCESSED_URLS_FILE)) return new Set()
  try {
    const data = JSON.parse(readFileSync(PROCESSED_URLS_FILE, 'utf-8'))
    return new Set(data)
  } catch {
    return new Set()
  }
}

function saveProcessedUrls(urls: Set<string>): void {
  ensureDir(STATE_DIR)
  writeFileSync(PROCESSED_URLS_FILE, JSON.stringify(Array.from(urls), null, 2))
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/**
 * Fetches a page and returns the HTML.
 */
async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.text()
}

/**
 * Strips HTML tags and normalizes whitespace.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extracts the page title from HTML.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (match) {
    return stripHtml(match[1]).trim()
  }

  // Fallback: try og:title
  const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
  if (ogMatch) {
    return ogMatch[1].trim()
  }

  // Fallback: first h1
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match) {
    return stripHtml(h1Match[1]).trim()
  }

  return 'Untitled'
}

/**
 * Extracts the main article content from HTML.
 * Tries common article container selectors.
 */
function extractArticleContent(html: string): string {
  // Try <article> tag first
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  if (articleMatch) {
    return stripHtml(articleMatch[1])
  }

  // Try common content class patterns
  const contentPatterns = [
    /<div[^>]*class=["'][^"']*(?:entry-content|post-content|article-content|article-body|content-area|single-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ]

  for (const pattern of contentPatterns) {
    const match = html.match(pattern)
    if (match) {
      return stripHtml(match[1])
    }
  }

  // Fallback: strip everything and return body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) {
    return stripHtml(bodyMatch[1]).slice(0, 5000) // Limit to avoid indexing navigation etc.
  }

  return stripHtml(html).slice(0, 5000)
}

/**
 * Extracts published date from HTML meta tags.
 */
function extractPublishedDate(html: string): string | null {
  const patterns = [
    /<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["']/i,
    /<time[^>]*datetime=["']([^"']+)["']/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) {
      return match[1]
    }
  }

  return null
}

/**
 * Checks if article content is relevant to life insurance.
 */
function isRelevantArticle(title: string, content: string): boolean {
  const text = `${title} ${content}`.toLowerCase()
  return NEWS_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()))
}

// ---------------------------------------------------------------------------
// RSS parsing (simple)
// ---------------------------------------------------------------------------

interface RssItem {
  url: string
  title: string
}

/**
 * Simple RSS parser — extracts item links and titles.
 * Does NOT use a full XML parser to keep dependencies minimal.
 */
function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemPattern.exec(xml)) !== null) {
    const itemXml = match[1]

    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i)
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i)

    if (linkMatch) {
      const url = stripHtml(linkMatch[1]).trim()
      const title = titleMatch ? stripHtml(titleMatch[1]).trim() : ''
      if (url.startsWith('http')) {
        items.push({ url, title })
      }
    }
  }

  return items
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Crawls a single news source for relevant articles.
 */
export async function crawlNewsSource(
  source: NewsSource,
  processedUrls: Set<string>,
  options: { dryRun?: boolean; maxArticles?: number } = {}
): Promise<NewsCrawlResult> {
  const maxArticles = options.maxArticles ?? 20

  const result: NewsCrawlResult = {
    source: source.name,
    articlesFound: 0,
    articlesNew: 0,
    articlesSkipped: 0,
    errors: [],
    articles: [],
  }

  console.log(`\n[news] === ${source.name} ===`)

  // Collect article URLs
  const articleUrls = new Map<string, string>() // url → title

  // Try RSS first
  if (source.rssUrl) {
    try {
      console.log(`[news] Fetching RSS: ${source.rssUrl}`)
      const xml = await fetchPage(source.rssUrl)
      const items = parseRss(xml)
      console.log(`[news] RSS: ${items.length} items`)
      for (const item of items) {
        articleUrls.set(item.url, item.title)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[news] RSS failed for ${source.name}: ${message}`)
      result.errors.push(`RSS: ${message}`)
    }
  }

  // Crawl HTML pages for article links
  for (const pageUrl of source.urls) {
    try {
      console.log(`[news] Fetching page: ${pageUrl}`)
      const html = await fetchPage(pageUrl)

      const pattern = new RegExp(source.articlePattern.source, 'gi')
      let match
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1]
        if (!articleUrls.has(url)) {
          articleUrls.set(url, '')
        }
      }

      console.log(`[news] Found links on ${pageUrl}: ${articleUrls.size} total`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[news] Failed to crawl ${pageUrl}: ${message}`)
      result.errors.push(`Page ${pageUrl}: ${message}`)
    }
  }

  result.articlesFound = articleUrls.size

  // Filter out already-processed URLs
  const newUrls = Array.from(articleUrls.entries()).filter(
    ([url]) => !processedUrls.has(url)
  )

  result.articlesSkipped = articleUrls.size - newUrls.length
  console.log(`[news] ${newUrls.length} new articles (${result.articlesSkipped} already processed)`)

  if (options.dryRun) {
    console.log(`[news] [DRY RUN] Would process ${newUrls.length} articles`)
    return result
  }

  // Process new articles (up to maxArticles)
  const toProcess = newUrls.slice(0, maxArticles)

  for (const [url, rssTitle] of toProcess) {
    try {
      console.log(`[news] Processing: ${url}`)
      const html = await fetchPage(url)
      const title = rssTitle || extractTitle(html)
      const content = extractArticleContent(html)
      const publishedAt = extractPublishedDate(html)

      // Check relevance
      if (!isRelevantArticle(title, content)) {
        console.log(`[news] Skipped (not relevant): ${title.slice(0, 60)}`)
        processedUrls.add(url) // Mark as processed even if not relevant
        continue
      }

      if (content.length < 100) {
        console.log(`[news] Skipped (too short): ${title.slice(0, 60)}`)
        processedUrls.add(url)
        continue
      }

      const contentHash = createHash('sha256')
        .update(content)
        .digest('hex')

      const article: NewsArticle = {
        url,
        title,
        content,
        source: source.name,
        publishedAt,
        contentHash,
      }

      result.articles.push(article)
      result.articlesNew++
      processedUrls.add(url)

      console.log(`[news] Indexed: ${title.slice(0, 60)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[news] Failed to process ${url}: ${message}`)
      result.errors.push(`Article ${url}: ${message}`)
      processedUrls.add(url) // Don't retry failed articles
    }
  }

  console.log(`[news] ${source.name}: ${result.articlesNew} new articles indexed`)
  return result
}

/**
 * Crawls all configured news sources.
 */
export async function crawlAllNewsSources(
  options: { dryRun?: boolean; maxArticlesPerSource?: number } = {}
): Promise<NewsCrawlResult[]> {
  const processedUrls = loadProcessedUrls()
  const results: NewsCrawlResult[] = []

  for (const source of NEWS_SOURCES) {
    const result = await crawlNewsSource(source, processedUrls, {
      dryRun: options.dryRun,
      maxArticles: options.maxArticlesPerSource ?? 20,
    })
    results.push(result)
  }

  // Save processed URLs state
  if (!options.dryRun) {
    saveProcessedUrls(processedUrls)
  }

  return results
}
