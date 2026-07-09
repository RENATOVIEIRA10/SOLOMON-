/**
 * Shape of the OpenDataLoader-PDF JSON output (`opendataloader-pdf --format json`).
 *
 * The tool emits a tree of typed `kids`. Keys carry spaces exactly as written
 * by the Java CLI (`page number`, `list items`, `number of rows`, …), so they
 * are quoted here rather than camel-cased.
 *
 * Only the fields the adapter reads are modelled; the index signature keeps
 * the rest addressable without pretending we understand it.
 */

export type OdlNodeType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'list item'
  | 'table'
  | 'table row'
  | 'table cell'
  | 'caption'
  | 'image'

export interface OdlNode {
  type: OdlNodeType | string
  pdfua_tag?: string
  id?: number
  'page number'?: number
  'bounding box'?: number[]
  level?: string
  content?: string
  font?: string
  'font size'?: number
  /** list */
  'list items'?: OdlNode[]
  /** table */
  'number of rows'?: number
  'number of columns'?: number
  rows?: OdlNode[]
  /** table row */
  'row number'?: number
  cells?: OdlNode[]
  /** table cell */
  'column number'?: number
  'row span'?: number
  'column span'?: number
  kids?: OdlNode[]
  [k: string]: unknown
}

export interface OdlDocument {
  'file name'?: string
  'number of pages'?: number
  author?: string | null
  title?: string | null
  kids: OdlNode[]
  [k: string]: unknown
}
