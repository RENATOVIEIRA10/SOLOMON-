/**
 * OpenDataLoader-PDF → `LayoutAnalyzeResult` adapter.
 *
 * Lets the existing semantic chunker (`chunkLayoutResult`) consume documents
 * parsed locally by OpenDataLoader instead of Azure Document Intelligence.
 * The chunker only ever reads `content`, `pages[].spans`, `paragraphs[]` and
 * `tables[].cells` — so that is exactly what we build here.
 *
 * Why: the legacy text extractor collapses tables. The MAG carência table
 * became "Até 6 meses5%" and the 6-column age-reajuste table became
 * "16 anos-44 anos1,098872 anos1,0831" — unreadable to an LLM. OpenDataLoader
 * emits real table cells; this adapter preserves them.
 *
 * Invariants:
 * - `content` is a flat string; blocks are joined with a single `\n`.
 * - every span slices back to exactly its own text: `content.slice(o, o+l)`.
 * - `pages[].spans` cover the offsets of that page, so `buildPageIndex`
 *   resolves a chunk's offset to a real page number (never 0).
 *
 * Pure function. No network, no fs, no credentials.
 */

import type {
  DocumentPage,
  DocumentParagraph,
  DocumentSpan,
  DocumentTable,
  DocumentTableCell,
  LayoutAnalyzeResult,
  ParagraphRole,
} from '../azure-di/types'
import type { OdlDocument, OdlNode } from './types'

/** Parser stamp for documents produced through this adapter. */
export const OPENDATALOADER_PARSER = 'opendataloader-v1' as const

export function openDataLoaderToLayout(odl: OdlDocument): LayoutAnalyzeResult {
  const state: BuildState = {
    content: '',
    paragraphs: [],
    tables: [],
    pageSpans: new Map(),
  }

  for (const node of odl.kids ?? []) processNode(state, node, 0)

  const pages: DocumentPage[] = [...state.pageSpans.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, spans]) => ({ pageNumber, spans }))

  return {
    apiVersion: OPENDATALOADER_PARSER,
    modelId: 'opendataloader-pdf',
    content: state.content,
    contentFormat: 'text',
    pages,
    paragraphs: state.paragraphs,
    tables: state.tables,
  }
}

interface BuildState {
  content: string
  paragraphs: DocumentParagraph[]
  tables: DocumentTable[]
  pageSpans: Map<number, DocumentSpan[]>
}

function processNode(state: BuildState, node: OdlNode, inheritedPage: number): void {
  const page = node['page number'] ?? inheritedPage
  const text = typeof node.content === 'string' ? node.content.trim() : ''

  switch (node.type) {
    case 'heading':
      if (text) pushParagraph(state, text, page, 'sectionHeading')
      break
    case 'paragraph':
    case 'caption':
    case 'list item':
      if (text) pushParagraph(state, text, page)
      // a list item may nest further items or paragraphs
      for (const kid of node.kids ?? []) processNode(state, kid, page)
      break
    case 'list':
      for (const item of node['list items'] ?? []) processNode(state, item, page)
      break
    case 'table':
      emitTable(state, node, page)
      break
    default:
      // unknown container: descend so no text is silently dropped
      for (const kid of node.kids ?? []) processNode(state, kid, page)
  }
}

function pushParagraph(
  state: BuildState,
  text: string,
  page: number,
  role?: ParagraphRole,
): void {
  const span = appendBlock(state, text, page)
  const paragraph: DocumentParagraph = { content: text, spans: [span] }
  if (role) paragraph.role = role
  state.paragraphs.push(paragraph)
}

/** Append `text` as the next block; returns its span into the flat content. */
function appendBlock(state: BuildState, text: string, page: number): DocumentSpan {
  if (state.content.length > 0) state.content += '\n'
  const offset = state.content.length
  state.content += text
  const span: DocumentSpan = { offset, length: text.length }
  const spans = state.pageSpans.get(page) ?? []
  spans.push(span)
  state.pageSpans.set(page, spans)
  return span
}

function cellText(cell: OdlNode): string {
  return (cell.kids ?? [])
    .map((kid) => (typeof kid.content === 'string' ? kid.content : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function emitTable(state: BuildState, node: OdlNode, page: number): void {
  const cells: DocumentTableCell[] = []
  for (const row of node.rows ?? []) {
    for (const cell of row.cells ?? []) {
      cells.push({
        rowIndex: (cell['row number'] ?? 1) - 1,
        columnIndex: (cell['column number'] ?? 1) - 1,
        content: cellText(cell),
        rowSpan: cell['row span'] ?? 1,
        columnSpan: cell['column span'] ?? 1,
        spans: [],
      })
    }
  }

  const rowCount =
    node['number of rows'] ?? cells.reduce((max, c) => Math.max(max, c.rowIndex + 1), 0)
  const columnCount =
    node['number of columns'] ?? cells.reduce((max, c) => Math.max(max, c.columnIndex + 1), 0)

  // The chunker re-renders the table from `cells`, but it still needs a span
  // into the flat content to stamp source offsets.
  const flat = cells
    .map((c) => c.content)
    .join(' ')
    .trim()
  const span = appendBlock(state, flat, page)

  state.tables.push({
    rowCount,
    columnCount,
    cells,
    spans: [span],
    boundingRegions: [{ pageNumber: page }],
  })
}
