/**
 * OPIN Product Fetcher
 *
 * Fetches life insurance products from each insurer's OPIN API endpoint.
 * Handles pagination, retries with exponential backoff, and timeouts.
 */

import type { DiscoveredInsurer } from './discovery'

const API_PATHS = [
  '/open-insurance/products-services/v1/person',
  '/open-insurance/products-services/v1/life-pension',
] as const

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1_000
const REQUEST_TIMEOUT_MS = 30_000

export interface OPINProductResponse {
  data: OPINProduct[]
  links: { self: string; next?: string }
  meta: { totalRecords: number; totalPages: number }
}

export interface OPINProduct {
  name: string
  code?: string
  category?: string
  modality?: string
  coverages?: OPINCoverage[]
  termsAndConditions?: {
    susepProcessNumber?: string
    definition?: string
    url?: string
  }
  [key: string]: unknown
}

export interface OPINCoverage {
  type?: string
  attributes?: {
    minValue?: { amount?: number; currency?: string }
    maxValue?: { amount?: number; currency?: string }
    gracePeriod?: { amount?: number; unit?: string }
    excludedRisks?: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface FetchResult {
  insurer: DiscoveredInsurer
  apiPath: string
  products: OPINProduct[]
  error?: string
}

/**
 * Fetches a single URL with retry and exponential backoff.
 */
async function fetchWithRetry(url: string, attempt = 1): Promise<Response> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
    return response
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      throw error
    }
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
    console.log(`[fetcher] Retry ${attempt}/${MAX_RETRIES} for ${url} in ${delay}ms`)
    await sleep(delay)
    return fetchWithRetry(url, attempt + 1)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Extracts products from OPIN response body.
 * OPIN wraps products in: data.brand.companies[].products[]
 * Some endpoints may also return data[] directly.
 */
function extractProducts(body: Record<string, unknown>): OPINProduct[] {
  const data = body.data as Record<string, unknown> | unknown[] | undefined

  // Format 1: data[] (direct array)
  if (Array.isArray(data)) {
    return data as OPINProduct[]
  }

  // Format 2: data.brand.companies[].products[] (OPIN standard)
  if (data && typeof data === 'object') {
    const brand = (data as Record<string, unknown>).brand as Record<string, unknown> | undefined
    if (brand) {
      const companies = brand.companies as Array<Record<string, unknown>> | undefined
      if (Array.isArray(companies)) {
        const products: OPINProduct[] = []
        for (const company of companies) {
          const companyProducts = company.products as OPINProduct[] | undefined
          if (Array.isArray(companyProducts)) {
            products.push(...companyProducts)
          }
        }
        return products
      }
    }
  }

  return []
}

/**
 * Fetches all pages of products from a given URL, following pagination links.
 */
async function fetchAllPages(baseUrl: string): Promise<OPINProduct[]> {
  const allProducts: OPINProduct[] = []
  let currentUrl: string | undefined = baseUrl
  let page = 1

  while (currentUrl) {
    const response = await fetchWithRetry(currentUrl)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const body = await response.json() as Record<string, unknown>
    const products = extractProducts(body)
    for (const p of products) {
      allProducts.push(p)
    }

    console.log(`[fetcher]   Page ${page}: ${products.length} products (total so far: ${allProducts.length})`)

    // Follow pagination via response body links
    const links = body.links as Record<string, string> | undefined
    currentUrl = links?.next || undefined

    // Also check Link header as fallback
    if (!currentUrl) {
      const linkHeader = response.headers.get('Link')
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
        if (nextMatch) {
          currentUrl = nextMatch[1]
        }
      }
    }

    page++

    // Safety: cap at 50 pages to prevent infinite loops
    if (page > 50) {
      console.warn(`[fetcher] Reached page limit (50), stopping pagination`)
      break
    }
  }

  return allProducts
}

/**
 * Fetches products from a single insurer across all relevant API paths.
 */
export async function fetchInsurerProducts(insurer: DiscoveredInsurer): Promise<FetchResult[]> {
  const results: FetchResult[] = []

  for (const apiPath of API_PATHS) {
    const url = `${insurer.endpoint_base}${apiPath}`
    console.log(`[fetcher] Fetching ${insurer.name} → ${apiPath}`)

    try {
      const products = await fetchAllPages(url)
      results.push({
        insurer,
        apiPath,
        products,
      })
      console.log(`[fetcher] ${insurer.name} ${apiPath}: ${products.length} products`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[fetcher] ${insurer.name} ${apiPath}: FAILED - ${message}`)
      results.push({
        insurer,
        apiPath,
        products: [],
        error: message,
      })
    }
  }

  return results
}

/**
 * Fetches products from all insurers. Processes sequentially to avoid
 * overwhelming the APIs (they're rate-limited).
 */
export async function fetchAllInsurers(insurers: DiscoveredInsurer[]): Promise<FetchResult[]> {
  const allResults: FetchResult[] = []

  for (const insurer of insurers) {
    const results = await fetchInsurerProducts(insurer)
    allResults.push(...results)

    // Small delay between insurers to be polite
    await sleep(500)
  }

  return allResults
}
