/**
 * RAG Answer Orchestrator
 *
 * Main entry point for the SOLOMON RAG engine.
 * Flow: embed query -> search pgvector -> enrich -> build context -> LLM -> citations -> save
 */

import { createServiceClient } from '@/lib/supabase'
import { semanticSearch, type SearchResult } from './search'
import { buildContext, type ContextBlock, type EnrichmentData } from './context-builder'
import { callLLM, type LLMResponse } from './llm'
import { extractCitations, type Citation } from './citation'

const SYSTEM_PROMPT_TEMPLATE = `Voce e SOLOMON, um especialista em seguros de vida no Brasil.
Sua funcao e responder perguntas de corretores de seguros com precisao e citacao de fontes.

REGRAS:
1. Use APENAS as informacoes dos documentos fornecidos abaixo.
2. Sempre cite a fonte usando o formato [N] onde N e o numero da referencia.
3. Inclua: nome da seguradora, produto, clausula ou processo SUSEP quando disponivel.
4. Se nao encontrar a informacao nos documentos, diga claramente: "Nao encontrei essa informacao nas condicoes gerais indexadas."
5. Nunca invente informacao. Se nao tem certeza, diga.
6. Responda em portugues, de forma clara e direta.
7. Quando relevante, alerte sobre exclusoes, carencias ou pegadinhas nas condicoes gerais.

DOCUMENTOS DE REFERENCIA:
{context}`

export interface AskOptions {
  brokerId?: string
  channel?: 'whatsapp' | 'dashboard' | 'api'
  insurerFilter?: string
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface AskResult {
  answer: string
  citations: Citation[]
  sources: ContextBlock[]
  model: string
  tokensUsed: number
  latencyMs: number
  conversationId?: string
}

/**
 * Main RAG pipeline: question in, structured answer out.
 */
export async function ask(
  question: string,
  options?: AskOptions
): Promise<AskResult> {
  const startTime = Date.now()

  // 1. Semantic search
  const searchResults = await semanticSearch(question, {
    insurerId: options?.insurerFilter,
  })

  // 2. Enrich with insurer/product names
  const enrichment = await loadEnrichment(searchResults)

  // 3. Build context with citations
  const { contextText, sources } = buildContext(searchResults, enrichment)

  // 4. Build system prompt
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{context}', contextText || 'Nenhum documento encontrado.')

  // 5. Build user message (with optional conversation history)
  const userMessage = buildUserMessage(question, options?.conversationHistory)

  // 6. Call LLM
  let llmResponse: LLMResponse
  try {
    llmResponse = await callLLM(systemPrompt, userMessage)
  } catch (error) {
    // If LLM fails but we have search results, return a degraded response
    if (searchResults.length > 0) {
      const fallbackAnswer = buildFallbackAnswer(sources)
      return {
        answer: fallbackAnswer,
        citations: [],
        sources,
        model: 'fallback',
        tokensUsed: 0,
        latencyMs: Date.now() - startTime,
      }
    }
    throw error
  }

  // 7. Extract citations
  const citations = extractCitations(llmResponse.text, sources)

  // 8. Save conversation (if brokerId provided)
  let conversationId: string | undefined
  if (options?.brokerId) {
    conversationId = await saveConversation({
      brokerId: options.brokerId,
      channel: options.channel ?? 'api',
      message: question,
      response: llmResponse.text,
      model: llmResponse.model,
      tokensUsed: llmResponse.tokensUsed,
      latencyMs: Date.now() - startTime,
      sources: citations,
    })
  }

  return {
    answer: llmResponse.text,
    citations,
    sources,
    model: llmResponse.model,
    tokensUsed: llmResponse.tokensUsed,
    latencyMs: Date.now() - startTime,
    conversationId,
  }
}

/**
 * Loads insurer and product names for search result enrichment.
 */
async function loadEnrichment(results: SearchResult[]): Promise<EnrichmentData> {
  const insurerIds = [...new Set(results.map((r) => r.insurer_id).filter(Boolean))] as string[]
  const productIds = [...new Set(results.map((r) => r.product_id).filter(Boolean))] as string[]

  const insurers = new Map<string, string>()
  const products = new Map<string, { name: string; susep_process: string | null }>()

  if (insurerIds.length === 0 && productIds.length === 0) {
    return { insurers, products }
  }

  const supabase = createServiceClient()

  // Fetch insurers and products in parallel
  const [insurerResult, productResult] = await Promise.all([
    insurerIds.length > 0
      ? supabase.from('insurers').select('id, name').in('id', insurerIds)
      : { data: [], error: null },
    productIds.length > 0
      ? supabase.from('products').select('id, name, susep_process').in('id', productIds)
      : { data: [], error: null },
  ])

  if (insurerResult.data) {
    for (const row of insurerResult.data) {
      insurers.set(row.id, row.name)
    }
  }

  if (productResult.data) {
    for (const row of productResult.data) {
      products.set(row.id, { name: row.name, susep_process: row.susep_process })
    }
  }

  return { insurers, products }
}

/**
 * Builds the user message, optionally prepending conversation history.
 */
function buildUserMessage(
  question: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  if (!history || history.length === 0) {
    return question
  }

  const historyText = history
    .map((msg) => `${msg.role === 'user' ? 'Corretor' : 'SOLOMON'}: ${msg.content}`)
    .join('\n\n')

  return `Historico da conversa:\n${historyText}\n\nPergunta atual:\n${question}`
}

/**
 * Builds a degraded response from raw search results when LLM fails.
 */
function buildFallbackAnswer(sources: ContextBlock[]): string {
  const lines = [
    'Nao consegui processar a resposta via IA, mas encontrei os seguintes trechos relevantes:',
    '',
  ]

  for (const source of sources.slice(0, 3)) {
    lines.push(`[${source.index}] ${source.insurerName} — ${source.productName}`)
    lines.push(source.content.slice(0, 300) + (source.content.length > 300 ? '...' : ''))
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Saves the conversation to the database.
 */
async function saveConversation(params: {
  brokerId: string
  channel: string
  message: string
  response: string
  model: string
  tokensUsed: number
  latencyMs: number
  sources: Citation[]
}): Promise<string | undefined> {
  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('conversations')
      .insert({
        broker_id: params.brokerId,
        channel: params.channel,
        message: params.message,
        response: params.response,
        model: params.model,
        tokens_used: params.tokensUsed,
        latency_ms: params.latencyMs,
        sources: JSON.parse(JSON.stringify(params.sources)),
      })
      .select('id')
      .single()

    if (error) {
      console.error('[rag/answer] Failed to save conversation:', error.message)
      return undefined
    }

    return data?.id
  } catch (error) {
    console.error('[rag/answer] Failed to save conversation:', error)
    return undefined
  }
}
