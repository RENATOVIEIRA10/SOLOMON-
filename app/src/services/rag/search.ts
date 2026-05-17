/**
 * Semantic Search on pgvector
 *
 * Embeds the query using OpenAI text-embedding-3-small,
 * then searches the documents table via Supabase RPC (match_documents).
 */

import { createServiceClient } from '@/lib/supabase'
import { embedChunks } from '@/services/embeddings/embedder'
import { RAG } from '@/config/constants'
import { chooseRetrievalCorpus, type Corpus } from '@/config/corpus-routing'
import {
  recordRetrievalTrace,
  type RetrievalSource,
} from '@/services/rag/retrieval-trace'

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
  /**
   * Canonical insurer names from `detectInsurers(question)`. Optional.
   * Used ONLY by `chooseRetrievalCorpus` to decide between
   * `match_documents` and `match_shadow_documents`. Slice 3C-a — no
   * caller passes this yet; without it, every query stays on legacy.
   */
  insurerNames?: readonly string[]
  /**
   * Per-insurer runtime routing table (reserved for future wiring from
   * the `corpus_routing` DB table). Absent in 3C-a/b.
   */
  corpusDbRouting?: ReadonlyMap<string, Corpus>
  /**
   * Slice 3C-b telemetry hooks. All optional; when absent, the helper
   * fills with sensible defaults (uuid for requestId, 'unknown' for
   * source). The trace is fire-and-forget; if the insert fails the
   * user-facing request continues normally.
   */
  requestId?: string
  source?: RetrievalSource
  /**
   * Raw question text. When provided, sha256-hashed in retrieval-trace.ts
   * before insert. NEVER stored raw (PII safety: hash-only v1 per CEO
   * decision at PR #49 merge).
   */
  question?: string
  /**
   * Duck-typed Langfuse trace handle. When provided, search.ts tags it
   * with the chosen corpus. No hard Langfuse import in this module so
   * the coupling stays light (per CEO scope at PR #49 merge:
   * "sem acoplamento pesado").
   */
  langfuseTrace?: {
    update: (params: { tags?: readonly string[] }) => void
  }
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

  // Slice 3C-a: pick the retrieval RPC based on env allowlist + DB
  // routing. With the default empty SHADOW_CORPUS_ALLOWLIST, this is
  // ALWAYS 'match_documents' -- production behavior is unchanged.
  const corpus: Corpus = chooseRetrievalCorpus({
    insurerNames: options?.insurerNames ?? [],
    dbRouting: options?.corpusDbRouting,
  })
  const rpcName: 'match_documents' | 'match_shadow_documents' =
    corpus === 'shadow' ? 'match_shadow_documents' : 'match_documents'

  // Slice 3C-b: light Langfuse tag (duck-typed, no Langfuse import).
  // Best-effort; failures here never propagate.
  try {
    options?.langfuseTrace?.update({ tags: [`corpus:${corpus}`] })
  } catch (tagErr) {
    console.warn(
      '[rag/search] langfuse trace tag failed:',
      tagErr instanceof Error ? tagErr.message : tagErr
    )
  }

  // Slice 3C-b: timed RPC + best-effort trace insert. The user-facing
  // path is unchanged on success and on error; only the recordRetrievalTrace
  // side-effect is new.
  const traceInsurer =
    (options?.insurerNames ?? []).length === 1 ? options!.insurerNames![0] : null
  const traceCommon = {
    requestId: options?.requestId,
    insurerName: traceInsurer,
    corpus,
    source: options?.source ?? ('unknown' as RetrievalSource),
    question: options?.question,
  }

  const t0 = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(rpcName, {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: threshold,
    match_count: topK,
    filter_insurer_id: options?.insurerId ?? null,
    filter_product_id: options?.productId ?? null,
    filter_source_type: options?.sourceType ?? null,
  })
  const latencyMs = Date.now() - t0

  if (error) {
    recordRetrievalTrace({
      ...traceCommon,
      latencyMs,
      chunksReturned: 0,
      // Slice 3C-b does NOT auto-fall-back to legacy -- that lives in
      // 3C-c+. Here we just record that the RPC errored.
      fallbackUsed: false,
      fallbackReason: 'rpc_error',
    })
    throw new Error(`[rag/search] pgvector search failed: ${error.message}`)
  }

  const chunksReturned = Array.isArray(data) ? data.length : 0
  recordRetrievalTrace({
    ...traceCommon,
    latencyMs,
    chunksReturned,
    fallbackUsed: false,
    fallbackReason: null,
  })

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

// ---------------------------------------------------------------------------
// Cohere Rerank 3.5 (Sessao 3, 2026-04-28)
// ---------------------------------------------------------------------------

const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank'
const COHERE_RERANK_TIMEOUT_MS = 5000
/** Cohere limita documents a 1000 por request; chunks longos sao truncados em ~512 tokens internos. */
const COHERE_MAX_DOC_CHARS = 4000

interface CohereRerankResultItem {
  index: number
  relevance_score: number
}

interface CohereRerankResponse {
  results: CohereRerankResultItem[]
  meta?: { billed_units?: { search_units?: number } }
}

/**
 * Rerank candidates via Cohere Rerank 3.5 (cross-encoder). Substitui o ranking
 * por similarity (bi-encoder pgvector) por ranking de relevancia query-vs-chunk.
 *
 * Tolerante: se COHERE_API_KEY ausente, log warning e retorna candidates.slice(0, topN)
 * — deploy continua funcionando sem reranker, so sem ganho de precision.
 *
 * Tolerante: se Cohere falhar (timeout, erro API), fallback pra similarity
 * order pra nao quebrar producao.
 */
export async function rerankWithCohere(
  query: string,
  candidates: SearchResult[],
  topN: number
): Promise<SearchResult[]> {
  if (candidates.length === 0) return []
  if (candidates.length <= topN) return candidates

  const apiKey = process.env.COHERE_API_KEY
  if (!apiKey) {
    console.warn('[rag/rerank] COHERE_API_KEY ausente — fallback pra similarity order')
    return candidates.slice(0, topN)
  }

  const documents = candidates.map((c) =>
    c.content.length > COHERE_MAX_DOC_CHARS ? c.content.slice(0, COHERE_MAX_DOC_CHARS) : c.content
  )

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), COHERE_RERANK_TIMEOUT_MS)

  try {
    const response = await fetch(COHERE_RERANK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: RAG.rerankModel,
        query,
        documents,
        top_n: topN,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      console.warn(`[rag/rerank] Cohere ${response.status}: ${errBody.slice(0, 200)} — fallback similarity`)
      return candidates.slice(0, topN)
    }

    const data = (await response.json()) as CohereRerankResponse
    if (!Array.isArray(data.results) || data.results.length === 0) {
      console.warn('[rag/rerank] Cohere retornou results vazio — fallback similarity')
      return candidates.slice(0, topN)
    }

    // Map indexes do response pra candidates originais. Substituir similarity
    // pelo relevance_score do Cohere pra downstream (diversifyResults, etc)
    // poder usar como sinal de qualidade.
    const reranked: SearchResult[] = []
    for (const r of data.results) {
      const original = candidates[r.index]
      if (original) {
        reranked.push({ ...original, similarity: r.relevance_score })
      }
    }

    const billed = data.meta?.billed_units?.search_units ?? 1
    console.log(`[rag/rerank] Cohere ${RAG.rerankModel}: ${candidates.length} -> ${reranked.length} (billed ${billed} search units)`)
    return reranked
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[rag/rerank] Cohere falhou: ${msg} — fallback similarity`)
    return candidates.slice(0, topN)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Conveniencia: pgvector(fetchK=50) -> Cohere rerank -> top-N.
 * Usado em answer.ts onde queremos qualidade alta no contexto LLM.
 */
export async function semanticSearchAndRerank(
  query: string,
  options?: SearchOptions & { fetchK?: number; rerankTopN?: number }
): Promise<SearchResult[]> {
  const fetchK = options?.fetchK ?? RAG.fetchK
  const topN = options?.rerankTopN ?? RAG.rerankK
  const candidates = await semanticSearch(query, { ...options, topK: fetchK })
  return rerankWithCohere(query, candidates, topN)
}
