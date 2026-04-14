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

  const sources: ContextBlock[] = []
  let totalChars = 0

  for (let i = 0; i < results.length; i++) {
    const result = results[i]

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

  lines.push(`[${block.index}] ${block.insurerName} — ${block.productName}`)

  if (block.susepProcess) {
    lines.push(`Processo SUSEP: ${block.susepProcess}`)
  }

  if (block.sourceUrl) {
    lines.push(`Fonte: ${block.sourceUrl}`)
  }

  lines.push(block.content)

  return lines.join('\n')
}
