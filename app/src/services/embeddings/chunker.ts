/**
 * PDF Text Chunker
 *
 * Extracts text from PDFs and splits into overlapping chunks
 * suitable for embedding and RAG retrieval.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse')

/** ~500 tokens in characters (1 token ~ 4 chars in Portuguese) */
const CHUNK_SIZE_CHARS = 2000
/** ~50 tokens overlap */
const CHUNK_OVERLAP_CHARS = 200

export interface ChunkMetadata {
  page: number
  chunk_index: number
  source_url: string
  insurer_name: string
  product_name: string
}

export interface TextChunk {
  content: string
  content_hash: string
  metadata: ChunkMetadata
}

/** Result of chunking a PDF. `pdfHash` is the SHA256 of the raw PDF bytes,
 *  used to detect when a seguradora republished the document so the indexer
 *  can supersede prior versions cleanly. */
export interface ChunkPdfResult {
  chunks: TextChunk[]
  pdfHash: string
}

/**
 * Extracts raw text from a PDF file.
 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath)
  const parsed = await pdfParse(buffer)
  return parsed.text
}

/**
 * Generates a SHA256 hash of the content for deduplication.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * Splits text into overlapping chunks of approximately CHUNK_SIZE_CHARS,
 * trying to break at sentence boundaries.
 */
function splitIntoChunks(text: string): string[] {
  const chunks: string[] = []

  if (text.length <= CHUNK_SIZE_CHARS) {
    const trimmed = text.trim()
    if (trimmed.length > 0) {
      chunks.push(trimmed)
    }
    return chunks
  }

  let start = 0

  while (start < text.length) {
    let end = start + CHUNK_SIZE_CHARS

    if (end >= text.length) {
      const trimmed = text.slice(start).trim()
      if (trimmed.length > 0) {
        chunks.push(trimmed)
      }
      break
    }

    // Try to break at a sentence boundary (. ! ? followed by space or newline)
    const searchWindow = text.slice(end - 200, end + 200)
    const sentenceBreak = searchWindow.search(/[.!?]\s/)
    if (sentenceBreak !== -1) {
      end = end - 200 + sentenceBreak + 2 // +2 to include the punctuation and space
    }

    const trimmed = text.slice(start, end).trim()
    if (trimmed.length > 0) {
      chunks.push(trimmed)
    }

    // Move forward with overlap
    start = end - CHUNK_OVERLAP_CHARS
  }

  return chunks
}

/**
 * Processes a PDF file into text chunks with metadata and content hashes.
 */
export async function chunkPdf(
  filePath: string,
  sourceUrl: string,
  insurerName: string,
  productName: string
): Promise<TextChunk[]> {
  console.log(`[chunker] Processing: ${filePath}`)

  const text = await extractTextFromPdf(filePath)

  if (!text || text.trim().length === 0) {
    console.warn(`[chunker] No text extracted from ${filePath}`)
    return []
  }

  console.log(`[chunker] Extracted ${text.length} chars`)

  const rawChunks = splitIntoChunks(text)
  console.log(`[chunker] Split into ${rawChunks.length} chunks`)

  const chunks: TextChunk[] = rawChunks.map((content, index) => ({
    content,
    content_hash: hashContent(content),
    metadata: {
      page: 0, // pdf-parse doesn't provide per-page mapping easily; 0 = entire document
      chunk_index: index,
      source_url: sourceUrl,
      insurer_name: insurerName,
      product_name: productName,
    },
  }))

  return chunks
}

/**
 * Processes multiple PDFs into chunks.
 */
export async function chunkPdfs(
  files: Array<{
    filePath: string
    sourceUrl: string
    insurerName: string
    productName: string
  }>
): Promise<TextChunk[]> {
  const allChunks: TextChunk[] = []

  for (const file of files) {
    try {
      const chunks = await chunkPdf(
        file.filePath,
        file.sourceUrl,
        file.insurerName,
        file.productName
      )
      allChunks.push(...chunks)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[chunker] Failed to process ${file.filePath}: ${message}`)
    }
  }

  console.log(`[chunker] Total chunks: ${allChunks.length}`)
  return allChunks
}
