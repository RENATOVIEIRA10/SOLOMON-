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
import { RAG } from '@/config/constants'
import { expandQueryWithJargon } from '@/config/jargon'

export const SYSTEM_PROMPT_TEMPLATE = `Voce e SOLOMON, o consultor privado de seguros de vida mais inteligente do Brasil.
Voce NAO e um buscador de texto. Voce e um ESPECIALISTA que LE, INTERPRETA e RACIOCINA sobre condicoes gerais como um corretor senior com 20 anos de experiencia faria.

PROTOCOLO DE VALIDACAO (EXECUTE MENTALMENTE ANTES DE RESPONDER):
Passo 1: Identifique qual(is) seguradora(s) o corretor mencionou na pergunta.
Passo 2: Para cada chunk [N] em DOCUMENTOS DE REFERENCIA, leia o cabecalho e identifique a qual seguradora ele pertence.
Passo 3: Se o corretor perguntou sobre a seguradora X e existem chunks de Y ou Z no contexto: IGNORE Y e Z. Use APENAS chunks de X para fundamentar a resposta.
Passo 4: Se NENHUM chunk da seguradora X aparece no contexto: responda literalmente "Nao encontrei condicoes gerais da [X] na base para responder isso com seguranca. Posso procurar em outras seguradoras que temos indexadas." — NAO invente, NAO use chunks de outra seguradora como proxy.
Passo 5: NUNCA combine clausulas de seguradoras diferentes em uma mesma afirmacao.
Passo 6: Se o corretor NAO mencionou seguradora e o contexto tem chunks de varias, responda comparativamente ("Na Zurich... | Na Bradesco... | Na Porto..."), separando por seguradora e citando cada uma individualmente — nunca fundindo numa unica clausula generica.

POSTURA:
- Voce INTERPRETA os documentos, nao apenas copia trechos. Quando um corretor pergunta algo, voce le a condicao geral e EXPLICA o que ela significa na pratica.
- Quando o corretor usa jargao do mercado, voce entende e traduz para o que a condicao geral diz. Exemplo: "majorada" = paga 100% do capital mesmo em invalidez parcial.
- Voce cruza informacoes entre clausulas diferentes do MESMO documento para chegar a conclusoes (jamais entre documentos de seguradoras distintas).
- Voce alerta sobre nuances que um corretor menos experiente poderia perder.

GLOSSARIO DO MERCADO (use para interpretar perguntas dos corretores):
- MAJORADA / MAJORAR = pagar 100% do capital segurado mesmo na invalidez PARCIAL (ao inves de percentuais proporcionais). Ex: "IPA Majorada" = Invalidez Permanente por Acidente onde qualquer invalidez parcial paga o capital cheio.
- IPTA = Invalidez Permanente Total por Acidente
- IPA = Invalidez Permanente por Acidente (pode ser total ou parcial)
- IFPD = Invalidez Funcional Permanente por Doenca
- DIT = Diaria por Incapacidade Temporaria
- DG = Doencas Graves
- AP = Acidentes Pessoais
- CG = Condicoes Gerais
- IS = Importancia Segurada (capital segurado)
- LMI = Limite Maximo de Indenizacao
- Carencia = periodo apos contratacao em que nao ha cobertura
- Contestabilidade = periodo (geralmente 2 anos) em que a seguradora pode contestar o contrato
- Valor Saldado = valor reduzido de cobertura quando o segurado para de pagar
- Beneficio Prolongado = extensao da cobertura por periodo limitado apos parar de pagar

REGRAS CRITICAS:
1. NUNCA misture informacoes de uma seguradora com outra. Cada afirmacao DEVE ser atribuida a seguradora correta com citacao. Se um dado e da SulAmerica, NAO diga que e da Azos.
2. Se a cobertura ou clausula NAO aparece nos documentos daquela seguradora especifica, diga "nao encontrei essa cobertura nas condicoes gerais da [seguradora]". NAO assuma que existe so porque outra seguradora tem.
3. Cada documento de referencia tem o nome da seguradora no cabecalho [N]. Use APENAS dados do documento correto para cada seguradora.

REGRAS GERAIS:
4. Use os documentos fornecidos como base, mas INTERPRETE-OS como um corretor expert faria.
5. Sempre cite a fonte usando o formato [N] onde N e o numero da referencia.
6. Inclua: nome da seguradora, produto, clausula ou processo SUSEP quando disponivel.
7. Se nao encontrar a informacao nos documentos, diga claramente e explique o que seria necessario.
8. Nunca invente dados especificos (valores, percentuais, clausulas). Mas PODE fazer inferencias logicas a partir do que esta escrito no documento correto.
9. Responda em portugues, de forma clara e direta. Use linguagem de corretor, nao de advogado.
10. Quando relevante, alerte sobre exclusoes, carencias, pegadinhas e OPORTUNIDADES nas condicoes gerais.
11. OBRIGATORIO: No final de TODA resposta, inclua a secao "FONTES E LIMITACOES" conforme modelo abaixo.

FORMATO DA SECAO "FONTES E LIMITACOES":
---
**FONTES UTILIZADAS:**
- [N] Seguradora — Produto | [Ver documento](URL_DA_FONTE)
- [N] Seguradora — Produto | [Ver documento](URL_DA_FONTE)
(liste TODAS as fontes que voce citou na resposta, com o link do PDF quando disponivel no campo "Fonte:" do documento)

**DADOS QUE FALTAM:**
- O que falta para uma resposta mais completa (ex: tabela de precos, condicoes gerais de X, manual de subscricao)
- Quais seguradoras nao foram consultadas e por que
---

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
  /**
   * Heurística 0-1 de quão confiável é a resposta.
   * Combina avgSimilarity (qualidade do match) e sourceCount (quantidade de
   * fontes corroborando). 0 quando não há match; 1 quando há >=5 fontes
   * todas com similaridade >= threshold.
   */
  confidenceScore: number
  /** Média de cosine similarity dos chunks usados na resposta */
  avgSimilarity: number
  /** Número de chunks usados como contexto */
  sourceCount: number
  /** True se confidenceScore < LOW_CONFIDENCE_THRESHOLD — consumer pode exibir aviso */
  lowConfidence: boolean
}

/** Abaixo desse valor, resposta deve exibir aviso ao corretor */
export const LOW_CONFIDENCE_THRESHOLD = 0.55

/**
 * Main RAG pipeline: question in, structured answer out.
 */
export async function ask(
  question: string,
  options?: AskOptions
): Promise<AskResult> {
  const startTime = Date.now()

  // 0. Detect insurer names in the question for targeted search
  const mentionedInsurers = detectInsurers(question)
  console.log(`[rag/ask] Mentioned insurers: ${mentionedInsurers.length > 0 ? mentionedInsurers.join(', ') : 'none (global search)'}`)

  // 0b. Expand query with jargon → technical terms so embedding captures both
  // the corretor's shorthand and the exact phrasing used in insurer PDFs.
  const expandedQuery = expandQueryWithJargon(question)
  if (expandedQuery !== question) {
    console.log(`[rag/ask] Jargon expansion: "${question}" → "${expandedQuery}"`)
  }

  // 1. Semantic search — strategy depends on whether insurers were mentioned
  let searchResults: SearchResult[] = []

  if (mentionedInsurers.length > 0) {
    // Targeted search: query each mentioned insurer separately to guarantee results
    const insurerIds = await resolveInsurerIds(mentionedInsurers)
    const perInsurer = Math.ceil(RAG.topK / mentionedInsurers.length)

    for (const [name, ids] of insurerIds) {
      let nameResults: SearchResult[] = []
      for (const id of ids) {
        const r = await semanticSearch(expandedQuery, { insurerId: id, topK: perInsurer })
        nameResults.push(...r)
      }
      console.log(`[rag/ask] ${name}: ${nameResults.length} results (across ${ids.length} insurer row(s))`)
      searchResults.push(...nameResults)
    }

    // If targeted search found nothing, fall back to global
    if (searchResults.length === 0) {
      searchResults = await semanticSearch(expandedQuery, {
        insurerId: options?.insurerFilter,
        topK: RAG.fetchK,
      })
    }
  } else {
    // Global search: pulling 50 chunks cross-insurer contaminates the LLM context
    // (causa raiz das alucinacoes 2/6 reportadas) — a regra "nao misturar" no
    // system prompt nao salva se ja entraram chunks de outras seguradoras na
    // entrada. Quando nao ha seguradora detectada, busca estreita (topK=15)
    // para forcar chunks do mesmo cluster semantico.
    searchResults = await semanticSearch(expandedQuery, {
      insurerId: options?.insurerFilter,
      topK: RAG.globalTopK,
    })
  }

  // 1b. Fallback: structured search on products/coverages — so roda quando
  // temos contexto de seguradora explicito. Sem filtro de insurer, o RPC
  // search_products pode retornar produto de outra seguradora (landmine de
  // atribuicao errada) ja que a RPC atual nao aceita insurer filter.
  if (searchResults.length === 0) {
    const fallbackInsurerId = options?.insurerFilter
      ?? (mentionedInsurers.length > 0
        ? (await resolveInsurerIds(mentionedInsurers)).values().next().value?.[0]
        : undefined)
    if (fallbackInsurerId) {
      searchResults = await structuredSearch(question, fallbackInsurerId)
    }
  }

  // 2. Enrich with insurer/product names (need names before diversifying)
  const enrichment = await loadEnrichment(searchResults)

  // 2b. Diversify results — ensure coverage across insurers (only for global search)
  if (mentionedInsurers.length === 0) {
    searchResults = diversifyResults(searchResults, enrichment, mentionedInsurers)
  } else if (searchResults.length > RAG.topK) {
    searchResults = searchResults.slice(0, RAG.topK)
  }

  // 3. Build context with citations
  const { contextText, sources } = buildContext(searchResults, enrichment)

  // 3b. Compute confidence heuristic from search results
  const avgSimilarity = searchResults.length > 0
    ? searchResults.reduce((sum, r) => sum + (r.similarity ?? 0), 0) / searchResults.length
    : 0
  const sourceCount = searchResults.length
  // Confidence mixes match quality (avgSimilarity) and corroboration (sourceCount).
  // >=5 fontes com similaridade alta → 1.0; nenhum match → 0.
  const sourceFactor = Math.min(1, sourceCount / 5)
  const confidenceScore = Math.round((avgSimilarity * 0.6 + sourceFactor * 0.4) * 100) / 100
  const lowConfidence = confidenceScore < LOW_CONFIDENCE_THRESHOLD

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
        confidenceScore,
        avgSimilarity,
        sourceCount,
        lowConfidence,
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
    confidenceScore,
    avgSimilarity,
    sourceCount,
    lowConfidence,
  }
}

/**
 * Structured search fallback: uses search_products RPC to query
 * products and coverages directly when no embeddings are available.
 */
export async function structuredSearch(question: string, insurerFilter?: string): Promise<SearchResult[]> {
  const supabase = createServiceClient()

  // Extract the most meaningful search terms
  const stopWords = ['qual', 'quais', 'como', 'onde', 'quando', 'para', 'pela', 'pelo', 'dos', 'das', 'nos', 'nas', 'que', 'uma', 'com', 'sem', 'por']
  const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w))

  // Try each keyword as search term (insurer names are most useful)
  for (const keyword of keywords) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('search_products', {
      search_query: keyword,
      max_results: 10,
    })

    if (error) {
      console.error(`[rag/structured] RPC error for "${keyword}":`, error.message)
      continue
    }

    if (data && data.length > 0) {
      // Se temos contexto de seguradora, filtra client-side (RPC search_products
      // nao aceita filtro de insurer).
      const filtered = insurerFilter
        ? (data as Array<Record<string, unknown>>).filter((row) => String(row.insurer_id) === insurerFilter)
        : (data as Array<Record<string, unknown>>)

      if (filtered.length === 0) continue

      console.log(`[rag/structured] Found ${filtered.length}/${data.length} results for keyword "${keyword}" (insurer filter ${insurerFilter ? 'ON' : 'OFF'})`)
      return filtered.map((row, idx) => ({
        id: String(row.product_id),
        content: [
          `Produto: ${row.product_name}`,
          `Seguradora: ${row.insurer_name}`,
          `Modalidade: ${row.modality}`,
          row.susep_process ? `Processo SUSEP: ${row.susep_process}` : '',
          row.product_code ? `Codigo: ${row.product_code}` : '',
          `Coberturas: ${row.coverage_summary}`,
        ].filter(Boolean).join('\n'),
        similarity: 0.85 - (idx * 0.03),
        metadata: {},
        source_url: row.terms_url as string | null,
        source_type: 'structured',
        product_id: String(row.product_id),
        insurer_id: String(row.insurer_id),
      }))
    }
  }

  return []
}

/**
 * Loads insurer and product names for search result enrichment.
 */
export async function loadEnrichment(results: SearchResult[]): Promise<EnrichmentData> {
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
 * Resolves canonical insurer names to their database IDs.
 * Returns Map<canonicalName, id>.
 */
export async function resolveInsurerIds(canonicalNames: string[]): Promise<Map<string, string[]>> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('insurers').select('id, name')
  const result = new Map<string, string[]>()

  if (!data) return result

  for (const canonical of canonicalNames) {
    const lower = canonical.toLowerCase()
    // Duplicates in the insurers table (e.g. two "MAG Seguros" rows where one holds
    // the docs and another is empty) mean we must keep ALL matching ids, otherwise
    // the targeted search can hit the empty row and return zero results.
    const matches = data.filter((i) => i.name.toLowerCase().includes(lower))
    if (matches.length > 0) {
      result.set(canonical, matches.map((m) => m.id))
    }
  }

  return result
}

/**
 * Builds the user message, optionally prepending conversation history.
 */
export function buildUserMessage(
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

// ---------------------------------------------------------------------------
// Insurer detection + result diversification
// ---------------------------------------------------------------------------

/** Known insurer name patterns (lowercase) mapped to canonical names */
const INSURER_PATTERNS: Array<{ patterns: string[]; canonical: string }> = [
  { patterns: ['prudential'], canonical: 'Prudential' },
  { patterns: ['bradesco'], canonical: 'Bradesco' },
  { patterns: ['porto seguro', 'porto'], canonical: 'Porto Seguro' },
  { patterns: ['icatu'], canonical: 'Icatu' },
  { patterns: ['mapfre'], canonical: 'MAPFRE' },
  { patterns: ['tokio', 'tokio marine'], canonical: 'Tokio Marine' },
  { patterns: ['sulamerica', 'sulamérica', 'sul america', 'sul américa'], canonical: 'SulAmerica' },
  { patterns: ['zurich'], canonical: 'Zurich' },
  { patterns: ['caixa vida', 'caixa seguradora'], canonical: 'Caixa' },
  { patterns: ['santander'], canonical: 'Santander' },
  { patterns: ['metlife', 'met life'], canonical: 'MetLife' },
  { patterns: ['mag seguros', 'mag ', 'mongeral'], canonical: 'MAG' },
  { patterns: ['azos'], canonical: 'Azos' },
]

/**
 * Detects insurer names mentioned in the user's question.
 * Returns canonical names.
 */
export function detectInsurers(question: string): string[] {
  const q = question.toLowerCase()
  const found: string[] = []
  for (const { patterns, canonical } of INSURER_PATTERNS) {
    if (patterns.some((p) => q.includes(p))) {
      found.push(canonical)
    }
  }
  return found
}

/**
 * Diversifies search results to ensure coverage across multiple insurers.
 *
 * Strategy:
 * - If user mentioned specific insurers → prioritize those, fill rest with others
 * - If no insurer mentioned → round-robin across insurers (max N per insurer)
 * - Always respect similarity ordering within each insurer group
 */
export function diversifyResults(
  results: SearchResult[],
  enrichment: EnrichmentData,
  mentionedInsurers: string[]
): SearchResult[] {
  if (results.length <= RAG.topK) return results

  // Group by insurer
  const byInsurer = new Map<string, SearchResult[]>()
  for (const r of results) {
    const insurerName = enrichment.insurers.get(r.insurer_id ?? '') ?? 'unknown'
    const group = byInsurer.get(insurerName) ?? []
    group.push(r)
    byInsurer.set(insurerName, group)
  }

  console.log(`[rag/diversify] ${results.length} results from ${byInsurer.size} insurers: ${[...byInsurer.entries()].map(([n, r]) => `${n}(${r.length})`).join(', ')}`)

  const final: SearchResult[] = []

  if (mentionedInsurers.length > 0) {
    // User asked about specific insurers — give them priority
    const mentionedLower = mentionedInsurers.map((n) => n.toLowerCase())

    // First: results from mentioned insurers (up to topK - 3, leave room for context)
    const mentionedLimit = RAG.topK - 3
    for (const [name, group] of byInsurer) {
      if (mentionedLower.some((m) => name.toLowerCase().includes(m))) {
        for (const r of group.slice(0, mentionedLimit)) {
          if (final.length < mentionedLimit) final.push(r)
        }
      }
    }

    // Then: fill remaining slots with other insurers for context
    for (const [name, group] of byInsurer) {
      if (!mentionedLower.some((m) => name.toLowerCase().includes(m))) {
        for (const r of group.slice(0, 2)) {
          if (final.length < RAG.topK) final.push(r)
        }
      }
    }
  } else {
    // No specific insurer — round-robin for diversity
    const insurerNames = [...byInsurer.keys()]
    let round = 0

    while (final.length < RAG.topK && round < RAG.maxPerInsurer) {
      for (const name of insurerNames) {
        const group = byInsurer.get(name)!
        if (round < group.length && final.length < RAG.topK) {
          final.push(group[round])
        }
      }
      round++
    }
  }

  console.log(`[rag/diversify] Final: ${final.length} results`)
  return final
}

/**
 * Saves the conversation to the database.
 */
export async function saveConversation(params: {
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
