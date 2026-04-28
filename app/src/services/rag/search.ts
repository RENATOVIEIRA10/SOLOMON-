/**
 * Semantic Search on pgvector
 *
 * Embeds the query using OpenAI text-embedding-3-small,
 * then searches the documents table via Supabase RPC (match_documents).
 */

import { createServiceClient } from '@/lib/supabase'
import { embedChunks } from '@/services/embeddings/embedder'
import { RAG } from '@/config/constants'

export interface SearchResult {
  id: string
  content: string
  similarity: number
  metadata: Record<string, unknown>
  source_url: string | null
  source_type: string
  product_id: string | null
  insurer_id: string | null
}

export interface SearchOptions {
  topK?: number
  threshold?: number
  insurerId?: string
  productId?: string
  sourceType?: string
}

/**
 * Embeds a single query string using the same model as document embeddings.
 * Exported so callers fanning the same query across N insurers (Padrao C
 * round-robin) embed once and reuse, avoiding N redundant OpenAI calls.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await embedChunks([query])
  if (!embedding) {
    throw new Error('[rag/search] Failed to generate query embedding')
  }
  return embedding
}

/**
 * Performs semantic search against pgvector via Supabase RPC.
 *
 * Uses the match_documents function created in migration 002.
 */
export async function semanticSearch(
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const queryEmbedding = await embedQuery(query)
  return semanticSearchWithEmbedding(queryEmbedding, options)
}

/**
 * Variant that accepts a pre-computed embedding. Used by round-robin
 * per-entity search where the same query is fanned out across N insurers.
 */
export async function semanticSearchWithEmbedding(
  queryEmbedding: number[],
  options?: SearchOptions
): Promise<SearchResult[]> {
  const topK = options?.topK ?? RAG.topK
  const threshold = options?.threshold ?? RAG.similarityThreshold

  const supabase = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('match_documents', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: threshold,
    match_count: topK,
    filter_insurer_id: options?.insurerId ?? null,
    filter_product_id: options?.productId ?? null,
    filter_source_type: options?.sourceType ?? null,
  })

  if (error) {
    throw new Error(`[rag/search] pgvector search failed: ${error.message}`)
  }

  if (!data || data.length === 0) {
    return []
  }

  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    content: row.content as string,
    similarity: row.similarity as number,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    source_url: (row.source_url as string) ?? null,
    source_type: row.source_type as string,
    product_id: (row.product_id as string) ?? null,
    insurer_id: (row.insurer_id as string) ?? null,
  }))
}
