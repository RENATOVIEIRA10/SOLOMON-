/**
 * Vector Indexer
 *
 * Stores text chunks and their embeddings in Supabase.
 * Uses content_hash + chunk_index for deduplication via upsert.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert, Json } from '@/types/database'
import type { TextChunk } from './chunker'

const BATCH_SIZE = 100

export interface IndexResult {
  inserted: number
  errors: number
}

/**
 * Converts an embedding vector to Supabase pgvector string format.
 * e.g. [1.0, 2.0, 3.0] → "[1.0,2.0,3.0]"
 */
function vectorToString(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Indexes a set of chunks with their embeddings into the documents table.
 *
 * @param db - Supabase admin client (service role, bypasses RLS)
 * @param chunks - Text chunks with metadata and content hashes
 * @param embeddings - Embedding vectors (same order as chunks)
 * @param productId - Optional product ID to link documents to
 * @param insurerId - Optional insurer ID to link documents to
 */
export async function indexChunks(
  db: SupabaseClient<Database>,
  chunks: TextChunk[],
  embeddings: number[][],
  productId?: string,
  insurerId?: string
): Promise<IndexResult> {
  if (chunks.length === 0) {
    return { inserted: 0, errors: 0 }
  }

  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Mismatch: ${chunks.length} chunks but ${embeddings.length} embeddings`
    )
  }

  console.log(`[indexer] Indexing ${chunks.length} chunks (batch size: ${BATCH_SIZE})`)

  let inserted = 0
  let errors = 0

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + BATCH_SIZE)
    const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE)

    const rows: TablesInsert<'documents'>[] = batchChunks.map((chunk, idx) => ({
      content: chunk.content,
      content_hash: chunk.content_hash,
      chunk_index: chunk.metadata.chunk_index,
      source_type: 'conditions_pdf',
      source_url: chunk.metadata.source_url,
      embedding: vectorToString(batchEmbeddings[idx]),
      product_id: productId ?? null,
      insurer_id: insurerId ?? null,
      metadata: chunk.metadata as unknown as Json,
    }))

    const { error } = await db
      .from('documents')
      .upsert(rows, {
        onConflict: 'content_hash,chunk_index',
        ignoreDuplicates: false,
      })

    if (error) {
      console.error(`[indexer] Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`)
      errors += batchChunks.length
    } else {
      inserted += batchChunks.length
      console.log(
        `[indexer] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchChunks.length} rows upserted`
      )
    }
  }

  console.log(`[indexer] Done: ${inserted} indexed, ${errors} errors`)
  return { inserted, errors }
}

/**
 * Indexes chunks without embeddings (for --skip-embeddings mode).
 * Stores the text content and metadata only, embedding will be null.
 */
export async function indexChunksWithoutEmbeddings(
  db: SupabaseClient<Database>,
  chunks: TextChunk[],
  productId?: string,
  insurerId?: string
): Promise<IndexResult> {
  if (chunks.length === 0) {
    return { inserted: 0, errors: 0 }
  }

  console.log(`[indexer] Indexing ${chunks.length} chunks WITHOUT embeddings`)

  let inserted = 0
  let errors = 0

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + BATCH_SIZE)

    const rows: TablesInsert<'documents'>[] = batchChunks.map((chunk) => ({
      content: chunk.content,
      content_hash: chunk.content_hash,
      chunk_index: chunk.metadata.chunk_index,
      source_type: 'conditions_pdf',
      source_url: chunk.metadata.source_url,
      embedding: null,
      product_id: productId ?? null,
      insurer_id: insurerId ?? null,
      metadata: chunk.metadata as unknown as Json,
    }))

    const { error } = await db
      .from('documents')
      .upsert(rows, {
        onConflict: 'content_hash,chunk_index',
        ignoreDuplicates: false,
      })

    if (error) {
      console.error(`[indexer] Batch error: ${error.message}`)
      errors += batchChunks.length
    } else {
      inserted += batchChunks.length
    }
  }

  console.log(`[indexer] Done: ${inserted} indexed, ${errors} errors`)
  return { inserted, errors }
}
