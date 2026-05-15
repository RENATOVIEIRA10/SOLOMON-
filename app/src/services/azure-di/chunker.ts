/**
 * Azure DI Layout → semantic chunker.
 *
 * Pure function. Takes a `LayoutAnalyzeResult` from {@link AzureDiLayoutClient}
 * and produces chunks that satisfy the Phase 2 chunk contract (PR #15 §4):
 *
 * - 300–1500 chars, never mid-word, never mid-clause
 * - real page number from the Layout page index (never `0`)
 * - section path built from the paragraph heading hierarchy
 * - clause id extracted from numbered/lettered list openers (e.g. `4.16`, `a)`)
 * - confidence = mean of constituent word confidences
 * - parser stamp `azure-di-layout-v3`
 *
 * Phase 2 / PR 3B slice 3B.2.
 * Scope guardrails: pure function, no DB write, no I/O, no insurer logic.
 * The shadow-set writer (slice 3B.5) consumes these chunks; this module
 * does not write them anywhere.
 */

import { createHash } from 'node:crypto'

import type {
  DocumentPage,
  DocumentParagraph,
  DocumentSpan,
  DocumentTable,
  LayoutAnalyzeResult,
  ParagraphRole,
} from './types'

/** Parser stamp written to `metadata.parser` on every chunk this module produces. */
export const SEMANTIC_CHUNKER_PARSER = 'azure-di-layout-v3' as const

export type SemanticChunkParser = typeof SEMANTIC_CHUNKER_PARSER

/** A chunk's structural metadata. */
export interface SemanticChunkMetadata {
  chunk_index: number
  /** 1-based page where the chunk's first content lives. */
  page: number
  /** Heading-path string, e.g. `"4. COBERTURAS > 4.1. COBERTURAS BÁSICAS"`. */
  section?: string
  /** Clause opener id detected on the chunk's first paragraph, e.g. `"4.16"` or `"a)"`. */
  clause?: string
  /** Mean word `confidence` in `[0, 1]` across the chunk's span. Undefined if no words. */
  confidence?: number
  parser: SemanticChunkParser
  /** True when the chunk's body is a rendered table (one chunk per detected table). */
  has_table?: boolean
  source_offset_start: number
  source_offset_end: number
}

/** A semantic chunk ready for embedding/indexing in a later slice. */
export interface SemanticChunk {
  content: string
  content_hash: string
  metadata: SemanticChunkMetadata
}

/** Options for {@link chunkLayoutResult}. */
export interface ChunkerOptions {
  /** Minimum char length below which a chunk merges with a same-section neighbor. Default 300. */
  minChunkChars?: number
  /** Hard char ceiling. Chunks (and split paragraphs) never exceed this. Default 1500. */
  maxChunkChars?: number
}

const DEFAULT_MIN = 300
const DEFAULT_MAX = 1500

const CHROME_ROLES: ReadonlySet<ParagraphRole> = new Set<ParagraphRole>([
  'pageHeader',
  'pageFooter',
  'pageNumber',
])
const HEADING_ROLES: ReadonlySet<ParagraphRole> = new Set<ParagraphRole>([
  'title',
  'sectionHeading',
])

const HEADING_HASH_RE = /^(#{1,6})\s+/
const CLAUSE_NUMBER_RE = /^\s*(\d+(?:\.\d+){0,4})[.)]?\s+\S/
// Lettered clauses, including sub-numbered variants like `a.1)`, `b.2.3)`.
const CLAUSE_LETTER_RE = /^\s*([a-z](?:\.\d+){0,3})\)\s+\S/i

interface HeadingEntry {
  level: number
  text: string
}

/**
 * Main entry point. Walks the Layout result in document order and emits
 * a list of chunks honoring the chunk contract.
 */
export function chunkLayoutResult(
  result: LayoutAnalyzeResult,
  options: ChunkerOptions = {}
): SemanticChunk[] {
  const minChars = options.minChunkChars ?? DEFAULT_MIN
  const maxChars = options.maxChunkChars ?? DEFAULT_MAX

  const pageIndex = buildPageIndex(result.pages)
  const chunks: SemanticChunk[] = []
  const headingStack: HeadingEntry[] = []

  // Body paragraph accumulator.
  let buffer: DocumentParagraph[] = []
  let bufferChars = 0

  const flush = (): void => {
    if (buffer.length === 0) return
    const chunk = buildChunkFromParagraphs(
      buffer,
      headingStack,
      pageIndex,
      result.pages,
      chunks.length
    )
    if (chunk) chunks.push(chunk)
    buffer = []
    bufferChars = 0
  }

  for (const paragraph of result.paragraphs ?? []) {
    if (paragraph.role && CHROME_ROLES.has(paragraph.role)) continue
    if (paragraph.role && HEADING_ROLES.has(paragraph.role)) {
      flush()
      const { level, text } = parseHeading(paragraph.content)
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop()
      }
      headingStack.push({ level, text })
      continue
    }

    const content = paragraph.content
    if (content.trim().length === 0) continue

    if (content.length > maxChars) {
      flush()
      for (const piece of splitOversizedContent(content, maxChars)) {
        const synthetic: DocumentParagraph = {
          content: piece,
          spans: estimatePieceSpans(paragraph, piece, content),
          role: paragraph.role,
          boundingRegions: paragraph.boundingRegions,
        }
        const chunk = buildChunkFromParagraphs(
          [synthetic],
          headingStack,
          pageIndex,
          result.pages,
          chunks.length
        )
        if (chunk) chunks.push(chunk)
      }
      continue
    }

    const join = buffer.length > 0 ? 2 : 0
    if (bufferChars + join + content.length > maxChars) {
      flush()
    }
    buffer.push(paragraph)
    bufferChars += content.length + (buffer.length > 1 ? 2 : 0)
  }

  flush()

  for (const table of result.tables ?? []) {
    const tableChunk = buildTableChunk(
      table,
      headingStack,
      pageIndex,
      result.pages,
      chunks.length
    )
    if (tableChunk) chunks.push(tableChunk)
  }

  return reindexAndMergeUndersized(chunks, minChars, maxChars)
}

// --- helpers (some exported for unit tests) ---

function buildChunkFromParagraphs(
  paragraphs: DocumentParagraph[],
  headingStack: HeadingEntry[],
  pageIndex: PageIndex,
  pages: DocumentPage[],
  chunkIndex: number
): SemanticChunk | null {
  const content = paragraphs
    .map((p) => p.content)
    .join('\n\n')
    .trim()
  if (content.length === 0) return null

  const firstP = paragraphs[0]
  const lastP = paragraphs[paragraphs.length - 1]
  const offsetStart = firstParagraphOffset(firstP)
  const offsetEnd = lastParagraphOffsetEnd(lastP)
  const page = pageIndex.pageOf(offsetStart)
  const section = headingPath(headingStack)
  const clause = detectClauseId(firstP.content)
  const confidence = meanWordConfidence(pages, offsetStart, offsetEnd)

  return {
    content,
    content_hash: sha256(content),
    metadata: {
      chunk_index: chunkIndex,
      page,
      section,
      clause,
      confidence,
      parser: SEMANTIC_CHUNKER_PARSER,
      source_offset_start: offsetStart,
      source_offset_end: offsetEnd,
    },
  }
}

function buildTableChunk(
  table: DocumentTable,
  headingStack: HeadingEntry[],
  pageIndex: PageIndex,
  pages: DocumentPage[],
  chunkIndex: number
): SemanticChunk | null {
  const content = renderTableMarkdown(table)
  if (content.length === 0) return null
  const firstSpan = table.spans[0]
  const lastSpan = table.spans[table.spans.length - 1] ?? firstSpan
  const offsetStart = firstSpan?.offset ?? 0
  const offsetEnd = (lastSpan?.offset ?? 0) + (lastSpan?.length ?? 0)
  const page =
    table.boundingRegions?.[0]?.pageNumber ?? pageIndex.pageOf(offsetStart)
  const confidence = meanWordConfidence(pages, offsetStart, offsetEnd)
  return {
    content,
    content_hash: sha256(content),
    metadata: {
      chunk_index: chunkIndex,
      page,
      section: headingPath(headingStack),
      confidence,
      parser: SEMANTIC_CHUNKER_PARSER,
      has_table: true,
      source_offset_start: offsetStart,
      source_offset_end: offsetEnd,
    },
  }
}

/** Detects a `# `-style markdown heading level on a heading paragraph. */
export function parseHeading(content: string): HeadingEntry {
  const trimmed = content.trim()
  const match = trimmed.match(HEADING_HASH_RE)
  if (match) {
    return { level: match[1].length, text: trimmed.slice(match[0].length).trim() }
  }
  // No `#` prefix: assume a generic top-level heading.
  return { level: 1, text: trimmed }
}

function headingPath(stack: HeadingEntry[]): string | undefined {
  if (stack.length === 0) return undefined
  return stack.map((h) => h.text).join(' > ')
}

/**
 * Detects a leading clause id on a paragraph: numbered (`4.16`, `4.1.1`) or
 * lettered (`a)`, `b)`). Returns the bare id without the trailing punctuation.
 */
export function detectClauseId(content: string): string | undefined {
  const trimmed = content.trim()
  const numbered = trimmed.match(CLAUSE_NUMBER_RE)
  if (numbered) return numbered[1]
  const lettered = trimmed.match(CLAUSE_LETTER_RE)
  if (lettered) return `${lettered[1].toLowerCase()})`
  return undefined
}

interface PageIndex {
  pageOf(offset: number): number
}

/**
 * Builds an offset-to-page lookup from the Layout pages array. Used to
 * stamp every chunk with a real (1-based) page number.
 */
export function buildPageIndex(pages: DocumentPage[]): PageIndex {
  interface Entry {
    offset: number
    length: number
    pageNumber: number
  }
  const entries: Entry[] = []
  for (const page of pages) {
    for (const span of page.spans ?? []) {
      entries.push({ offset: span.offset, length: span.length, pageNumber: page.pageNumber })
    }
  }
  entries.sort((a, b) => a.offset - b.offset)

  return {
    pageOf(offset: number): number {
      for (const entry of entries) {
        if (offset >= entry.offset && offset < entry.offset + entry.length) {
          return entry.pageNumber
        }
      }
      if (entries.length === 0) return 0
      let best = entries[0]
      for (const entry of entries) {
        if (entry.offset <= offset) best = entry
      }
      return best.pageNumber
    },
  }
}

/**
 * Mean of all word confidences whose span overlaps `[offsetStart, offsetEnd)`.
 * Returns `undefined` when the result has no word-level data.
 */
export function meanWordConfidence(
  pages: DocumentPage[],
  offsetStart: number,
  offsetEnd: number
): number | undefined {
  let sum = 0
  let count = 0
  for (const page of pages) {
    if (!page.words) continue
    for (const word of page.words) {
      const wordEnd = word.span.offset + word.span.length
      if (wordEnd <= offsetStart || word.span.offset >= offsetEnd) continue
      sum += word.confidence
      count++
    }
  }
  if (count === 0) return undefined
  return roundTo(sum / count, 3)
}

/**
 * Splits a paragraph whose content exceeds `maxChars` into pieces that
 * each fit, breaking only at whitespace (never mid-word) and preferring
 * a sentence boundary `[.!?]` within the last 200 chars of the window.
 */
export function splitOversizedContent(content: string, maxChars: number): string[] {
  const pieces: string[] = []
  let start = 0
  while (start < content.length) {
    if (start + maxChars >= content.length) {
      const tail = content.slice(start).trim()
      if (tail.length > 0) pieces.push(tail)
      break
    }
    let end = start + maxChars
    // Never mid-word: walk back to a whitespace char.
    while (end > start && !/\s/.test(content[end])) end--
    // Prefer a sentence boundary within the trailing window.
    const windowStart = Math.max(start, end - 200)
    const window = content.slice(windowStart, end)
    const sentenceMatches = [...window.matchAll(/[.!?]\s+/g)]
    if (sentenceMatches.length > 0) {
      const last = sentenceMatches[sentenceMatches.length - 1]
      const lastEnd = (last.index ?? 0) + last[0].length
      const candidate = windowStart + lastEnd
      if (candidate > start && candidate <= start + maxChars) end = candidate
    }
    if (end <= start) end = start + maxChars
    const piece = content.slice(start, end).trim()
    if (piece.length > 0) pieces.push(piece)
    start = end
  }
  return pieces
}

function estimatePieceSpans(
  original: DocumentParagraph,
  piece: string,
  fullContent: string
): DocumentSpan[] {
  const baseOffset = original.spans[0]?.offset ?? 0
  const relative = fullContent.indexOf(piece)
  return [
    {
      offset: baseOffset + (relative >= 0 ? relative : 0),
      length: piece.length,
    },
  ]
}

function firstParagraphOffset(p: DocumentParagraph): number {
  return p.spans[0]?.offset ?? 0
}

function lastParagraphOffsetEnd(p: DocumentParagraph): number {
  const last = p.spans[p.spans.length - 1]
  if (!last) return firstParagraphOffset(p)
  return last.offset + last.length
}

function renderTableMarkdown(table: DocumentTable): string {
  if (table.cells.length === 0) return ''
  const rows: string[][] = []
  for (let r = 0; r < table.rowCount; r++) {
    rows.push(new Array(table.columnCount).fill(''))
  }
  for (const cell of table.cells) {
    if (cell.rowIndex < table.rowCount && cell.columnIndex < table.columnCount) {
      rows[cell.rowIndex][cell.columnIndex] = cell.content.replace(/\s+/g, ' ').trim()
    }
  }
  const lines: string[] = []
  for (let r = 0; r < rows.length; r++) {
    lines.push(`| ${rows[r].join(' | ')} |`)
    if (r === 0) lines.push(`|${rows[0].map(() => '---').join('|')}|`)
  }
  return lines.join('\n')
}

/**
 * Merges chunks under `minChunkChars` into the previous chunk when they
 * share a section and the merge stays under `maxChunkChars`. Skips merges
 * across table chunks. Reassigns `chunk_index` after merging.
 */
function reindexAndMergeUndersized(
  chunks: SemanticChunk[],
  minChars: number,
  maxChars: number
): SemanticChunk[] {
  const merged: SemanticChunk[] = []
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1]
    const canMerge =
      prev !== undefined &&
      chunk.content.length < minChars &&
      prev.metadata.section === chunk.metadata.section &&
      !prev.metadata.has_table &&
      !chunk.metadata.has_table &&
      prev.content.length + 2 + chunk.content.length <= maxChars
    if (canMerge) {
      const combined = `${prev.content}\n\n${chunk.content}`
      merged[merged.length - 1] = {
        content: combined,
        content_hash: sha256(combined),
        metadata: {
          ...prev.metadata,
          source_offset_end: chunk.metadata.source_offset_end,
          confidence: averageDefined([
            prev.metadata.confidence,
            chunk.metadata.confidence,
          ]),
          clause: prev.metadata.clause ?? chunk.metadata.clause,
        },
      }
      continue
    }
    merged.push(chunk)
  }
  return merged.map((c, i) => ({
    ...c,
    metadata: { ...c.metadata, chunk_index: i },
  }))
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((v): v is number => typeof v === 'number')
  if (defined.length === 0) return undefined
  const sum = defined.reduce((a, b) => a + b, 0)
  return roundTo(sum / defined.length, 3)
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex')
}
