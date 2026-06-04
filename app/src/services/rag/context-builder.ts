/**
 * Context Builder
 *
 * Takes semantic search results and builds a structured context string
 * with numbered citations for the LLM prompt.
 */

import type { SearchResult } from './search'

const MAX_CONTEXT_CHARS = 32_000 // ~8000 tokens

export interface ContextBlock {
  index: number
  insurerName: string
  productName: string
  susepProcess: string | null
  sourceUrl: string | null
  content: string
  page?: number | string
  sourceDoc?: string
}

export interface ContextBuildResult {
  contextText: string
  sources: ContextBlock[]
}

export interface EnrichmentData {
  insurers: Map<string, string> // id -> name
  products: Map<string, { name: string; susep_process: string | null }>
}

/**
 * Merges consecutive search results that belong to the same insurer, product,
 * and document (source_doc) when they share the same page or have adjacent pages.
 * This resolves segment fragmentation and reduces formatting overhead.
 */
function mergeAdjacentResults(results: SearchResult[]): SearchResult[] {
  if (results.length <= 1) return results

  const merged: SearchResult[] = []
  let current = { ...results[0] }

  for (let i = 1; i < results.length; i++) {
    const next = results[i]

    const sameInsurer = current.insurer_id === next.insurer_id
    const sameProduct = current.product_id === next.product_id
    
    const docCurrent = (current.metadata?.source_doc as string | undefined) ?? ''
    const docNext = (next.metadata?.source_doc as string | undefined) ?? ''
    const sameDoc = docCurrent !== '' && docCurrent === docNext

    const pageCurrentStr = String(current.metadata?.page ?? '')
    const pageNextStr = String(next.metadata?.page ?? '')
    const samePage = pageCurrentStr !== '' && pageCurrentStr === pageNextStr

    let isAdjacentPage = false
    let pageCurrentNum = NaN
    let pageNextNum = NaN
    if (!samePage && pageCurrentStr !== '' && pageNextStr !== '') {
      pageCurrentNum = Number(current.metadata?.page)
      pageNextNum = Number(next.metadata?.page)
      isAdjacentPage = !isNaN(pageCurrentNum) && !isNaN(pageNextNum) && Math.abs(pageCurrentNum - pageNextNum) <= 1
    }

    if (sameInsurer && sameProduct && sameDoc && (samePage || isAdjacentPage)) {
      const separator = samePage 
        ? '\n\n' 
        : `\n\n--- [Página ${pageNextNum}] ---\n\n`
      
      current.content += separator + next.content

      if (isAdjacentPage) {
        const existingPageStr = String(current.metadata?.page ?? '')
        if (!existingPageStr.includes(pageNextStr)) {
          current.metadata = {
            ...(current.metadata ?? {}),
            page: `${existingPageStr}-${pageNextStr}`
          }
        }
      }
    } else {
      merged.push(current)
      current = { ...next }
    }
  }

  merged.push(current)
  return merged
}

/**
 * Groups results by insurer + product and builds numbered reference blocks.
 * Truncates if total context exceeds MAX_CONTEXT_CHARS.
 */
export function buildContext(
  results: SearchResult[],
  enrichment?: EnrichmentData
): ContextBuildResult {
  if (results.length === 0) {
    return { contextText: '', sources: [] }
  }

  const mergedResults = mergeAdjacentResults(results)

  const sources: ContextBlock[] = []
  let totalChars = 0

  for (let i = 0; i < mergedResults.length; i++) {
    const result = mergedResults[i]

    const insurerName = enrichment?.insurers.get(result.insurer_id ?? '')
      ?? (result.metadata?.insurer_name as string)
      ?? 'Seguradora desconhecida'
    const productInfo = enrichment?.products.get(result.product_id ?? '')
    const productName = productInfo?.name
      ?? (result.metadata?.product_name as string)
      ?? 'Produto desconhecido'
    const susepProcess = productInfo?.susep_process ?? null

    const block: ContextBlock = {
      index: i + 1,
      insurerName,
      productName,
      susepProcess,
      sourceUrl: result.source_url,
      content: result.content,
      page: result.metadata?.page as number | string | undefined,
      sourceDoc: result.metadata?.source_doc as string | undefined,
    }

    // Check if adding this block would exceed the limit
    const blockText = formatBlock(block)
    if (totalChars + blockText.length > MAX_CONTEXT_CHARS) {
      // Try to fit a truncated version
      const remaining = MAX_CONTEXT_CHARS - totalChars - 200 // leave room for header
      if (remaining > 200) {
        block.content = result.content.slice(0, remaining) + '...'
        sources.push(block)
      }
      break
    }

    totalChars += blockText.length
    sources.push(block)
  }

  const contextText = sources.map(formatBlock).join('\n\n')

  return { contextText, sources }
}

function formatBlock(block: ContextBlock): string {
  const lines: string[] = []

  let header = `[${block.index}] ${block.insurerName} — ${block.productName}`
  if (block.sourceDoc) {
    header += ` | Documento: ${block.sourceDoc}`
  }
  if (block.page !== undefined && block.page !== null && block.page !== '') {
    header += ` | Página: ${block.page}`
  }
  lines.push(header)

  if (block.susepProcess) {
    lines.push(`Processo SUSEP: ${block.susepProcess}`)
  }

  if (block.sourceUrl) {
    lines.push(`Fonte: ${block.sourceUrl}`)
  }

  lines.push(block.content)

  return lines.join('\n')
}
