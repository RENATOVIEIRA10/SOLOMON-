/**
 * Semantic Search on pgvector
 *
 * Embeds the query using OpenAI text-embedding-3-small,
 * then searches the documents table via Supabase RPC (match_documents).
 */

import { createServiceClient } from '@/lib/supabase'
import { embedChunks } from '@/services/embeddings/embedder'
import { RAG } from '@/config/constants'
import {
  chooseRetrievalCorpus,
  shouldRunShadowPreview,
  type Corpus,
} from '@/config/corpus-routing'
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
   * Default true: keeps previdencia/capitalizacao/auto/etc. out of life RAG.
   * AP comparisons can disable this because Bradesco AP Premiavel is indexed
   * with capitalizacao metadata, but is relevant as an AP product differential.
   */
  excludeNonLifeProductTypes?: boolean
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

type DocumentSearchRow = {
  id: string
  content: string
  metadata: Record<string, unknown> | null
  source_url: string | null
  source_type: string
  product_id: string | null
  insurer_id: string | null
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
    filter_exclude_non_life: options?.excludeNonLifeProductTypes ?? true,
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

  // Slice 3C-c: fire-and-forget shadow preview alongside legacy serve.
  // Runs the shadow RPC with the SAME args, traces it with mode='preview-only',
  // and DISCARDS the result. The user-facing response continues unaffected;
  // any failure here is logged and swallowed.
  if (
    shouldRunShadowPreview({
      insurerNames: options?.insurerNames ?? [],
      servedCorpus: corpus,
    })
  ) {
    void runShadowPreview(supabase, {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: threshold,
      match_count: topK,
      filter_insurer_id: options?.insurerId ?? null,
      filter_product_id: options?.productId ?? null,
      filter_source_type: options?.sourceType ?? null,
      filter_exclude_non_life: options?.excludeNonLifeProductTypes ?? true,
    }, traceCommon).catch((err) => {
      console.warn(
        '[rag/search] shadow preview launcher failed:',
        err instanceof Error ? err.message : err
      )
    })
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

/**
 * Lexical companion retrieval for exact product/coverage wording.
 *
 * This intentionally stays additive: vector search remains the primary
 * retriever, while lexical hits provide candidates that embeddings often miss
 * for codes, acronyms, product names, and literal clause terms.
 */
export async function lexicalSearch(
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const terms = extractLexicalTerms(query, RAG.lexicalMaxTerms)
  if (terms.length === 0) return []

  const topK = options?.topK ?? RAG.lexicalTopK
  const supabase = createServiceClient()
  const orFilter = terms.map((term) => `content.ilike.%${term}%`).join(',')
  const priorityTerms = terms.filter((term) => term === 'premiavel' || term === 'premiaveis')
  const priorityFilter = priorityTerms.map((term) => `content.ilike.%${term}%`).join(',')

  let request = supabase
    .from('documents')
    .select('id, content, metadata, source_url, source_type, product_id, insurer_id')
    .or(orFilter)
    .not('embedding', 'is', null)
    .is('valid_until', null)
    .limit(Math.max(topK * 3, topK))

  if (options?.insurerId) request = request.eq('insurer_id', options.insurerId)
  if (options?.productId) request = request.eq('product_id', options.productId)
  if (options?.sourceType) request = request.eq('source_type', options.sourceType)

  let priorityRows: DocumentSearchRow[] = []
  if (priorityFilter) {
    let priorityRequest = supabase
      .from('documents')
      .select('id, content, metadata, source_url, source_type, product_id, insurer_id')
      .or(priorityFilter)
      .not('embedding', 'is', null)
      .is('valid_until', null)
      .limit(Math.max(topK * 3, topK))

    if (options?.insurerId) priorityRequest = priorityRequest.eq('insurer_id', options.insurerId)
    if (options?.productId) priorityRequest = priorityRequest.eq('product_id', options.productId)
    if (options?.sourceType) priorityRequest = priorityRequest.eq('source_type', options.sourceType)

    const { data: priorityData, error: priorityError } = await priorityRequest
    if (priorityError) {
      console.warn(`[rag/lexical] Supabase priority lexical search failed: ${priorityError.message}`)
    } else if (Array.isArray(priorityData)) {
      priorityRows = priorityData as DocumentSearchRow[]
    }
  }

  const { data, error } = await request
  if (error) {
    console.warn(`[rag/lexical] Supabase lexical search failed: ${error.message}`)
  }

  const rowsById = new Map<string, DocumentSearchRow>()
  for (const row of priorityRows) rowsById.set(row.id, row)
  if (!error && Array.isArray(data)) {
    for (const row of data as DocumentSearchRow[]) rowsById.set(row.id, row)
  }
  const rows = [...rowsById.values()]
  if (rows.length === 0) return []

  return rows
    .filter((row) => row.metadata?.rag_exclude !== true && row.metadata?.rag_exclude !== 'true')
    .filter((row) => {
      if (options?.excludeNonLifeProductTypes === false) return true
      const tipoProduto = String(row.metadata?.tipo_produto ?? '')
      return !['PGBL', 'VGBL', 'previdencia', 'capitalizacao', 'residencial', 'viagem', 'auto'].includes(tipoProduto)
    })
    .map((row) => ({
      id: row.id,
      content: row.content,
      similarity: scoreLexicalHit(query, row, terms),
      metadata: row.metadata ?? {},
      source_url: row.source_url,
      source_type: row.source_type,
      product_id: row.product_id,
      insurer_id: row.insurer_id,
    }))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, topK)
}

export function mergeSearchResults(
  primary: SearchResult[],
  secondary: SearchResult[],
  limit: number
): SearchResult[] {
  const byId = new Map<string, SearchResult>()

  for (const result of [...primary, ...secondary]) {
    const existing = byId.get(result.id)
    if (!existing || (result.similarity ?? 0) > (existing.similarity ?? 0)) {
      byId.set(result.id, result)
    }
  }

  return [...byId.values()]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit)
}

export async function hybridSearch(
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const topK = options?.topK ?? RAG.topK
  const [semantic, lexical] = await Promise.all([
    semanticSearch(query, options),
    lexicalSearch(query, { ...options, topK: Math.min(RAG.lexicalTopK, topK) }),
  ])

  return mergeSearchResults(semantic, lexical, topK)
}

export async function hybridSearchWithEmbedding(
  query: string,
  queryEmbedding: number[],
  options?: SearchOptions
): Promise<SearchResult[]> {
  const topK = options?.topK ?? RAG.topK
  const [semantic, lexical] = await Promise.all([
    semanticSearchWithEmbedding(queryEmbedding, options),
    lexicalSearch(query, { ...options, topK: Math.min(RAG.lexicalTopK, topK) }),
  ])

  return mergeSearchResults(semantic, lexical, topK)
}

const LEXICAL_STOPWORDS = new Set([
  'como', 'qual', 'quais', 'quando', 'onde', 'para', 'pela', 'pelo', 'pelas',
  'pelos', 'dos', 'das', 'nos', 'nas', 'que', 'uma', 'umas', 'uns', 'com',
  'sem', 'por', 'sobre', 'seguro', 'seguros', 'seguradora', 'seguradoras',
  'condicoes', 'gerais', 'documento', 'documentos', 'cliente', 'produto',
  'produtos', 'cobertura', 'coberturas',
])

function extractLexicalTerms(query: string, maxTerms: number): string[] {
  const normalized = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const tokens = normalized
    .match(/[a-z0-9]{3,}/g)
    ?.filter((term) => !LEXICAL_STOPWORDS.has(term))
    ?? []

  return [...new Set(tokens)]
    .sort((a, b) => lexicalTermWeight(b) - lexicalTermWeight(a))
    .slice(0, maxTerms)
}

function lexicalTermWeight(term: string): number {
  let weight = term.length
  if (term === 'premiavel' || term === 'premiaveis') weight += 20
  if (/[0-9]/.test(term)) weight += 8
  if (term.length <= 5 && /[a-z]/.test(term) && /[0-9]/.test(term)) weight += 6
  return weight
}

function scoreLexicalHit(
  query: string,
  row: DocumentSearchRow,
  terms: string[]
): number {
  const text = `${row.content} ${String(row.metadata?.product_name ?? '')} ${String(row.metadata?.coverage_name ?? '')}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const queryNorm = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const hits = terms.filter((term) => text.includes(term))
  const hitRatio = terms.length > 0 ? hits.length / terms.length : 0
  const rareTermBonus = hits.some((term) => /[0-9]/.test(term) || term.length >= 8) ? 0.12 : 0
  const priorityTermBonus = hits.some((term) => term === 'premiavel' || term === 'premiaveis') ? 0.28 : 0
  const phraseBonus = queryNorm.length >= 12 && text.includes(queryNorm.slice(0, 80)) ? 0.1 : 0

  return Math.min(0.95, 0.5 + hitRatio * 0.25 + rareTermBonus + priorityTermBonus + phraseBonus)
}

// ---------------------------------------------------------------------------
// Slice 3C-c — shadow preview launcher
// ---------------------------------------------------------------------------
//
// Runs match_shadow_documents alongside legacy on the same query embedding,
// traces the result with mode='preview-only', and DISCARDS the chunks.
// The shadow corpus is observed; nothing is served to the user.
//
// Contract:
//  - Only called when shouldRunShadowPreview() returned true.
//  - Returned Promise never rejects (try/catch wraps the entire body).
//  - Timed independently of the legacy call (parallel observability).
//  - Failure surfaces only via the trace row (fallbackReason='rpc_error')
//    plus a console.warn. The caller's response is already in flight.

type ShadowRpcArgs = {
  query_embedding: string
  match_threshold: number
  match_count: number
  filter_insurer_id: string | null
  filter_product_id: string | null
  filter_source_type: string | null
  filter_exclude_non_life: boolean
}

type ShadowTraceCommon = {
  requestId?: string
  insurerName: string | null
  corpus: Corpus
  source: RetrievalSource
  question?: string
}

async function runShadowPreview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rpcArgs: ShadowRpcArgs,
  legacyTraceCommon: ShadowTraceCommon
): Promise<void> {
  const t0 = Date.now()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(
      'match_shadow_documents',
      rpcArgs
    )
    const latencyMs = Date.now() - t0
    if (error) {
      recordRetrievalTrace({
        requestId: legacyTraceCommon.requestId,
        insurerName: legacyTraceCommon.insurerName,
        corpus: 'shadow',
        mode: 'preview-only',
        source: legacyTraceCommon.source,
        question: legacyTraceCommon.question,
        latencyMs,
        chunksReturned: 0,
        fallbackUsed: false,
        fallbackReason: 'rpc_error',
      })
      console.warn(
        '[rag/search] shadow preview RPC error (swallowed):',
        error.message ?? error
      )
      return
    }
    const chunksReturned = Array.isArray(data) ? data.length : 0
    recordRetrievalTrace({
      requestId: legacyTraceCommon.requestId,
      insurerName: legacyTraceCommon.insurerName,
      corpus: 'shadow',
      mode: 'preview-only',
      source: legacyTraceCommon.source,
      question: legacyTraceCommon.question,
      latencyMs,
      chunksReturned,
      fallbackUsed: false,
      fallbackReason: null,
    })
  } catch (err) {
    const latencyMs = Date.now() - t0
    recordRetrievalTrace({
      requestId: legacyTraceCommon.requestId,
      insurerName: legacyTraceCommon.insurerName,
      corpus: 'shadow',
      mode: 'preview-only',
      source: legacyTraceCommon.source,
      question: legacyTraceCommon.question,
      latencyMs,
      chunksReturned: 0,
      fallbackUsed: false,
      fallbackReason: 'rpc_error',
    })
    console.warn(
      '[rag/search] shadow preview threw (swallowed):',
      err instanceof Error ? err.message : err
    )
  }
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

  const documents = candidates.map(buildRerankDocument)

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
 * Builds the text sent to Cohere. The indexed chunk body often starts mid-page,
 * so product/source metadata is a real ranking signal for comparative queries.
 */
export function buildRerankDocument(candidate: SearchResult): string {
  const metadata = candidate.metadata ?? {}
  const header = [
    metadata.insurer_name ? `Seguradora: ${String(metadata.insurer_name)}` : null,
    metadata.product_name ? `Produto: ${String(metadata.product_name)}` : null,
    metadata.product_code ? `Codigo: ${String(metadata.product_code)}` : null,
    metadata.coverage_name ? `Cobertura: ${String(metadata.coverage_name)}` : null,
    candidate.source_type ? `Tipo de fonte: ${candidate.source_type}` : null,
  ].filter(Boolean)

  const body =
    candidate.content.length > COHERE_MAX_DOC_CHARS
      ? candidate.content.slice(0, COHERE_MAX_DOC_CHARS)
      : candidate.content

  return header.length > 0 ? `${header.join('\n')}\n\n${body}` : body
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
