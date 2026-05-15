/**
 * Azure Document Intelligence — prebuilt-layout response types.
 *
 * Models the `analyzeResult` payload of the Layout model, REST API
 * version `2024-11-30`. Faithful to the service shape: optional fields
 * are optional because the service omits them depending on the input.
 *
 * Phase 2 / PR 3B slice 3B.1. Types only — no runtime, no I/O.
 */

/** A span into the flat `content` string: `[offset, offset + length)`. */
export interface DocumentSpan {
  offset: number
  length: number
}

/** A region on a page: the 1-based page plus an 8-number polygon (x,y pairs). */
export interface BoundingRegion {
  pageNumber: number
  polygon?: number[]
}

/** Optional caption/footnote attached to a table or figure. */
export interface DocumentCaption {
  content: string
  spans: DocumentSpan[]
  boundingRegions?: BoundingRegion[]
}

/** A recognized word with its OCR `confidence` in `[0, 1]`. */
export interface DocumentWord {
  content: string
  span: DocumentSpan
  confidence: number
  polygon?: number[]
}

/** A recognized line of text. Lines carry no confidence — words do. */
export interface DocumentLine {
  content: string
  spans: DocumentSpan[]
  polygon?: number[]
}

/** A checkbox / radio-style mark with its detection `confidence` in `[0, 1]`. */
export interface DocumentSelectionMark {
  state: 'selected' | 'unselected'
  span: DocumentSpan
  confidence: number
  polygon?: number[]
}

/** One page of the document. `pageNumber` is 1-based. */
export interface DocumentPage {
  pageNumber: number
  angle?: number
  width?: number
  height?: number
  unit?: 'pixel' | 'inch'
  spans: DocumentSpan[]
  words?: DocumentWord[]
  lines?: DocumentLine[]
  selectionMarks?: DocumentSelectionMark[]
}

/** Layout role the model assigns to a paragraph, when it detects one. */
export type ParagraphRole =
  | 'pageHeader'
  | 'pageFooter'
  | 'pageNumber'
  | 'title'
  | 'sectionHeading'
  | 'footnote'
  | 'formulaBlock'

/** A paragraph of body text. `role` is set only for structural paragraphs. */
export interface DocumentParagraph {
  content: string
  spans: DocumentSpan[]
  role?: ParagraphRole
  boundingRegions?: BoundingRegion[]
}

/** One cell of a table. `kind` defaults to `content` when absent. */
export interface DocumentTableCell {
  rowIndex: number
  columnIndex: number
  content: string
  kind?: 'content' | 'rowHeader' | 'columnHeader' | 'stubHead' | 'description'
  rowSpan?: number
  columnSpan?: number
  spans: DocumentSpan[]
  boundingRegions?: BoundingRegion[]
}

/** A detected table with its cell grid. */
export interface DocumentTable {
  rowCount: number
  columnCount: number
  cells: DocumentTableCell[]
  spans: DocumentSpan[]
  boundingRegions?: BoundingRegion[]
  caption?: DocumentCaption
  footnotes?: DocumentCaption[]
}

/**
 * A section groups document elements (paragraphs, tables, figures) by
 * JSON-pointer references such as `/paragraphs/0` or `/tables/1`.
 */
export interface DocumentSection {
  spans: DocumentSpan[]
  elements?: string[]
}

/** A detected figure / image region. */
export interface DocumentFigure {
  id?: string
  spans?: DocumentSpan[]
  elements?: string[]
  boundingRegions?: BoundingRegion[]
  caption?: DocumentCaption
}

/** Output content format of the `content` field. */
export type ContentFormat = 'text' | 'markdown'

/**
 * The `analyzeResult` payload of a succeeded prebuilt-layout operation.
 * `content` is Markdown when the request used `outputContentFormat=markdown`.
 */
export interface LayoutAnalyzeResult {
  apiVersion: string
  modelId: string
  stringIndexType?: string
  content: string
  contentFormat?: ContentFormat
  pages: DocumentPage[]
  paragraphs?: DocumentParagraph[]
  tables?: DocumentTable[]
  sections?: DocumentSection[]
  figures?: DocumentFigure[]
}

/** Status of the long-running analyze operation. */
export type OperationStatus =
  | 'notStarted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'

/** Error detail returned by the service on a failed request or operation. */
export interface AzureDiErrorDetail {
  code?: string
  message?: string
  innererror?: unknown
}

/** The long-running-operation envelope returned while polling. */
export interface AnalyzeOperation {
  status: OperationStatus
  createdDateTime?: string
  lastUpdatedDateTime?: string
  error?: AzureDiErrorDetail
  analyzeResult?: LayoutAnalyzeResult
}
