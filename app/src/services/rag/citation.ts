/**
 * Citation Formatter
 *
 * Extracts [N] references from LLM response text and maps them
 * to the source ContextBlocks used in the prompt.
 */

import type { ContextBlock } from './context-builder'

export interface Citation {
  index: number
  insurerName: string
  productName: string
  susepProcess: string | null
  sourceUrl: string | null
  excerpt: string
}

/**
 * Finds all [N] references in the response text and maps them
 * to the provided sources array.
 *
 * Returns only citations that were actually referenced in the response.
 */
export function extractCitations(
  responseText: string,
  sources: ContextBlock[]
): Citation[] {
  if (!responseText || sources.length === 0) {
    return []
  }

  // Find all [N] patterns in the response
  const refPattern = /\[(\d+)\]/g
  const referencedIndices = new Set<number>()

  let match: RegExpExecArray | null
  while ((match = refPattern.exec(responseText)) !== null) {
    referencedIndices.add(parseInt(match[1], 10))
  }

  // Map referenced indices to citations
  const citations: Citation[] = []

  for (const source of sources) {
    if (!referencedIndices.has(source.index)) continue

    citations.push({
      index: source.index,
      insurerName: source.insurerName,
      productName: source.productName,
      susepProcess: source.susepProcess,
      sourceUrl: source.sourceUrl,
      excerpt: truncateExcerpt(source.content, 200),
    })
  }

  // Sort by index
  citations.sort((a, b) => a.index - b.index)

  return citations
}

/**
 * Truncates content to a short excerpt for citation display.
 */
function truncateExcerpt(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content

  // Cut at last space before maxLength to avoid broken words
  const truncated = content.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  return (lastSpace > maxLength * 0.5 ? truncated.slice(0, lastSpace) : truncated) + '...'
}
