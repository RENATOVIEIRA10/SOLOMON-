/**
 * RAG Answer Orchestrator
 *
 * Main entry point for the SOLOMON RAG engine.
 * Flow: embed query -> search pgvector -> enrich -> build context -> LLM -> citations -> save
 */

import { createServiceClient } from '@/lib/supabase'
import { embedQuery, rerankWithCohere, semanticSearch, semanticSearchWithEmbedding, type SearchResult } from './search'
import { buildContext, type ContextBlock, type EnrichmentData } from './context-builder'
import { callLLM, type LLMResponse } from './llm'
import { extractCitations, type Citation } from './citation'
import { RAG } from '@/config/constants'
import { expandQueryWithJargon } from '@/config/jargon'
import { detectRateIntent, queryRateTable, formatRateAnswer } from './rate-lookup'

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

/**
 * System prompt variant para queries comparativas (Padrao B).
 * Substitui Passo 3+5 do template original que mandava IGNORAR chunks de
 * outras seguradoras — em comparativo isso conflita com o objetivo. Aqui
 * permite comparacao explicita lado-a-lado sem fundir clausulas.
 */
export const SYSTEM_PROMPT_COMPARE_TEMPLATE = SYSTEM_PROMPT_TEMPLATE
  .replace(
    'Passo 3: Se o corretor perguntou sobre a seguradora X e existem chunks de Y ou Z no contexto: IGNORE Y e Z. Use APENAS chunks de X para fundamentar a resposta.',
    'Passo 3: Se o intent for comparativo, COMPARE explicitamente cada seguradora separadamente: "Na X...", "Na Y...", "Na Z...". Use apenas chunks da propria seguradora para cada bloco.'
  )
  .replace(
    'Passo 5: NUNCA combine clausulas de seguradoras diferentes em uma mesma afirmacao.',
    'Passo 5: Compare lado a lado, sem fundir clausulas de seguradoras diferentes em uma mesma afirmacao.'
  )

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
  // Padrao B intent: 1 insurer mencionada + query pede comparacao com "outras"
  const compareIntent = mentionedInsurers.length === 1 && questionImpliesOtherInsurers(question)
  console.log(`[rag/ask] Mentioned insurers: ${mentionedInsurers.length > 0 ? mentionedInsurers.join(', ') : 'none (global search)'} | compareIntent=${compareIntent}`)

  // 0a. Rate lookup fast-path: se a pergunta e sobre TAXA/PREMIO e temos
  // seguradora detectada, consulta insurer_rate_tables direto — bypass LLM.
  // Zero alucinacao em numeros: resposta vem de tabela estruturada com
  // citacao da pagina do PDF oficial. Fall-through para RAG normal se nao
  // encontrar linhas ou se faltam parametros criticos.
  if (mentionedInsurers.length === 1) {
    const intent = detectRateIntent(question, mentionedInsurers[0])
    if (intent.hasIntent) {
      console.log(`[rag/ask] Rate intent detected — attempting fast-path. Intent:`, {
        age: intent.age,
        gender: intent.gender,
        product: intent.productHint,
        productCode: intent.productCode,
        capital: intent.capital,
        rendaMensal: intent.rendaMensal,
        franquia: intent.franquia,
      })
      const insurerIds = await resolveInsurerIds(mentionedInsurers)
      const ids = insurerIds.values().next().value
      if (ids && ids.length > 0) {
        const rateRows = await queryRateTable({
          insurerId: ids[0],
          productHint: intent.productHint,
          productCode: intent.productCode,
          age: intent.age,
          gender: intent.gender,
          rendaMensal: intent.rendaMensal,
          capital: intent.capital,
          franquia: intent.franquia,
          limit: 40,
        })
        if (rateRows.length > 0) {
          // Confidence gate: rate fast-path so retorna 1.0 se temos
          // dimensoes minimas (age+capital OU productCode+age+gender+capital).
          // Senao, abaixa pra 0.4 e marca lowConfidence — o corretor
          // pode receber 40 linhas com filtros frouxos sem o selo de
          // "certeza absoluta".
          const hasAgeAndCapital = intent.age !== undefined && intent.capital !== undefined
          const hasProductCodeFull =
            intent.productCode !== undefined &&
            intent.age !== undefined &&
            intent.gender !== undefined &&
            intent.capital !== undefined
          const hasEnoughDimensions = hasAgeAndCapital || hasProductCodeFull
          const confidence = hasEnoughDimensions ? 1.0 : 0.4

          let answer = formatRateAnswer({
            insurerName: mentionedInsurers[0],
            intent,
            rows: rateRows,
          })
          if (!hasEnoughDimensions) {
            answer = `> [Aviso] Consulta com parametros incompletos. Informe idade, sexo e capital segurado para garantir taxa correta.\n\n${answer}`
          }
          console.log(`[rag/ask] Rate fast-path HIT — ${rateRows.length} rows, confidence=${confidence}. Bypassing LLM.`)
          return {
            answer,
            citations: [],
            sources: [],
            model: 'rate-table-lookup',
            tokensUsed: 0,
            latencyMs: Date.now() - startTime,
            confidenceScore: confidence,
            avgSimilarity: confidence,
            sourceCount: rateRows.length,
            lowConfidence: !hasEnoughDimensions,
          }
        }
        console.log(`[rag/ask] Rate fast-path MISS — no rows, falling through to RAG.`)
      }
    }
  }

  // 0b. Expand query with jargon → technical terms so embedding captures both
  // the corretor's shorthand and the exact phrasing used in insurer PDFs.
  const expandedQuery = expandQueryWithJargon(question)
  if (expandedQuery !== question) {
    console.log(`[rag/ask] Jargon expansion: "${question}" → "${expandedQuery}"`)
  }

  // 1. Semantic search — strategy depends on whether insurers were mentioned
  let searchResults: SearchResult[] = []

  if (mentionedInsurers.length > 0) {
    // Targeted search: query each mentioned insurer separately to guarantee results.
    // Padrao A: fetch wider then re-rank by product_name overlap so chunks of
    // the specific product mentioned in the query (Q36 "Renda Familiar") win
    // over generic-product chunks (Vida Viva).
    const insurerIds = await resolveInsurerIds(mentionedInsurers)
    // compareIntent: reserva 5 slots pra "others" no Padrao B; senao, divide topK pelas mencionadas.
    const perInsurer = compareIntent ? Math.max(1, RAG.topK - 5) : Math.ceil(RAG.topK / mentionedInsurers.length)
    const perInsurerFetch = Math.min(RAG.fetchK, perInsurer * 3)
    const queryTokens = tokenizeForProductMatch(question)
    const queryEmbedding = await embedQuery(expandedQuery)

    for (const [name, ids] of insurerIds) {
      let nameResults: SearchResult[] = []
      for (const id of ids) {
        const r = await semanticSearchWithEmbedding(queryEmbedding, { insurerId: id, topK: perInsurerFetch })
        nameResults.push(...r)
      }
      const boosted = boostByProductMatch(nameResults, queryTokens)
      const trimmed = boosted.slice(0, perInsurer)
      console.log(`[rag/ask] ${name}: ${nameResults.length} fetched, ${trimmed.length} after product-boost (across ${ids.length} insurer row(s))`)
      searchResults.push(...trimmed)
    }

    // If targeted search found nothing, fall back to global
    if (searchResults.length === 0) {
      searchResults = await semanticSearch(expandedQuery, {
        insurerId: options?.insurerFilter,
        topK: RAG.fetchK,
      })
    }

    // Padrao B (Q32): "Compare DG da Prudential com outras seguradoras".
    // detectInsurers retorna so a mencionada, multi-insurer search nao
    // fornece "outras". Disparar round-robin cross-insurer EXCLUINDO a
    // mencionada e mergear pra dar contexto comparativo.
    if (compareIntent) {
      const mentionedIdSet = new Set<string>()
      for (const ids of (await resolveInsurerIds(mentionedInsurers)).values()) {
        ids.forEach((id) => mentionedIdSet.add(id))
      }
      const others = await roundRobinGlobalSearch(expandedQuery, {
        excludeInsurerIds: mentionedIdSet,
        perInsurerTopK: 1,
      })
      // Reserva 5-7 slots pros "others" — sem isso o slice de topK
      // adiante corta tudo (bug HIGH 13). Cap total = topK + 5.
      const otherSlots = Math.min(7, Math.max(5, RAG.topK + 5 - searchResults.length))
      const selectedOthers = others.slice(0, otherSlots)
      const totalLimit = RAG.topK + 5
      console.log(`[rag/ask] Padrao B: +${selectedOthers.length}/${others.length} cross-insurer chunks (others), total cap ${totalLimit}`)
      searchResults = [...searchResults, ...selectedOthers].slice(0, totalLimit)
    }
  } else if (options?.insurerFilter) {
    // Caller forced a single-insurer filter — honor it without round-robin.
    searchResults = await semanticSearch(expandedQuery, {
      insurerId: options.insurerFilter,
      topK: RAG.globalTopK,
    })
  } else if (questionImpliesComparison(question)) {
    // Padrao C: round-robin per-entity SO em queries comparativas explicitas.
    // 1 mini-search por insurer ativa em paralelo (top-2 cada) merged + sorted.
    // Sem isso, concept/edge queries despejavam 24 chunks irrelevantes no LLM.
    searchResults = await roundRobinGlobalSearch(expandedQuery)
  } else {
    // Concept / edge / general queries sem insurer: busca focada (topK=15)
    // mantem chunks no mesmo cluster semantico — comportamento pre-Fase 2.
    searchResults = await semanticSearch(expandedQuery, {
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

  // 1c. Cohere Rerank 3.5 (Sessao 3, 2026-04-28): cross-encoder corta ruido
  // pos-retrieval. Tolerante: se COHERE_API_KEY ausente ou Cohere falha,
  // retorna similarity order.
  //
  // SKIP em queries comparativas pra preservar diversidade cross-insurer:
  // (a) Padrao B (compareIntent: 1 insurer + "outras")
  // (b) Padrao C (global: 0 insurers + questionImpliesComparison)
  // (c) Multi-insurer explicito: 2+ insurers detectadas (ex: "compare X
  //     com Y"). Sem skip aqui, eval pos-Cohere mostrou CR comparison
  //     despencar -0.21pp porque Cohere concentra top-N em 1-2 insurers.
  const isMultiInsurerExplicit = mentionedInsurers.length >= 2
  const isComparativeGlobal = mentionedInsurers.length === 0 && questionImpliesComparison(question)
  const skipRerank = compareIntent || isComparativeGlobal || isMultiInsurerExplicit
  if (!skipRerank && searchResults.length > RAG.rerankK) {
    searchResults = await rerankWithCohere(question, searchResults, RAG.rerankK)
  }

  // 2. Enrich with insurer/product names (need names before diversifying)
  const enrichment = await loadEnrichment(searchResults)

  // 2b. Diversify results — ensure coverage across insurers (only for global search)
  if (mentionedInsurers.length === 0) {
    searchResults = diversifyResults(searchResults, enrichment, mentionedInsurers)
  } else if (!compareIntent && searchResults.length > RAG.topK) {
    // Single-insurer ou multi-insurer normal: trim pra topK.
    // CompareIntent ja respeita totalLimit=topK+5 acima — NAO cortar aqui.
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

  // 4. Build system prompt — variant comparativa quando Padrao B disparou,
  // pra nao mandar LLM "ignorar Y/Z" justamente quando precisa comparar.
  const promptTemplate = compareIntent ? SYSTEM_PROMPT_COMPARE_TEMPLATE : SYSTEM_PROMPT_TEMPLATE
  const systemPrompt = promptTemplate.replace('{context}', contextText || 'Nenhum documento encontrado.')

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

// ---------------------------------------------------------------------------
// Product-name overlap boost (Padrao A)
// ---------------------------------------------------------------------------

const PRODUCT_MATCH_STOPWORDS = new Set([
  'como','qual','quais','compare','comparar','versus','entre','para','com','sem',
  'por','pelo','pela','pelos','pelas','dos','das','nos','nas','que','uma','umas',
  'uns','foi','sao','tem','mais','menos','seguradora','seguradoras','seguro',
  'seguros','catalogo','plano','planos','outras','outros','sobre','tipo',
  'tipos','vida','renda','capital','idade','anos','homem','mulher','feminino',
  'masculino','cliente','codigo','cobertura','coberturas','exclusao','exclusoes',
  'carencia','carencias','contestabilidade','principais','diferencas','diferenca',
  'beneficio','beneficios','assistencia','funeral','antecipacao','prazo',
  'declaracoes','condicoes','gerais','documentos','referencias','minha','meu',
  'meus','minhas','sua','seu','seus','suas','este','esta','estes','estas',
])

function stripAccentsLower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function tokenizeForProductMatch(s: string): Set<string> {
  return new Set(
    stripAccentsLower(s)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !PRODUCT_MATCH_STOPWORDS.has(t))
  )
}

/**
 * Re-rank chunks by overlap between query tokens and metadata.product_name
 * tokens. Multiplicative boost (1.0 → 1.5) — keeps embedding similarity as the
 * primary signal but breaks ties between chunks of comparable similarity in
 * favour of the product the query actually mentions.
 */
export function boostByProductMatch(chunks: SearchResult[], queryTokens: Set<string>): SearchResult[] {
  if (queryTokens.size === 0 || chunks.length === 0) return [...chunks]
  return [...chunks]
    .map((c) => {
      const pname = (c.metadata?.product_name as string | undefined) ?? ''
      if (!pname) return { ...c, similarity: c.similarity ?? 0 }
      const ptoks = tokenizeForProductMatch(pname)
      if (ptoks.size === 0) return { ...c, similarity: c.similarity ?? 0 }
      let overlap = 0
      for (const t of ptoks) if (queryTokens.has(t)) overlap++
      const productOverlap = overlap / ptoks.size
      const factor = 1 + 0.5 * productOverlap
      return { ...c, similarity: (c.similarity ?? 0) * factor }
    })
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
}

// ---------------------------------------------------------------------------
// Active insurers cache + round-robin global search (Padrao C / Padrao B)
// ---------------------------------------------------------------------------

interface ActiveInsurer { id: string; name: string }
let activeInsurersCache: { value: ActiveInsurer[]; ts: number } | null = null
const ACTIVE_INSURERS_TTL_MS = 5 * 60 * 1000

/**
 * Returns insurers that have at least minChunks indexed chunks. Cached for
 * 5min to avoid hitting Supabase on every global query.
 */
async function loadActiveInsurers(minChunks = 50): Promise<ActiveInsurer[]> {
  if (activeInsurersCache && Date.now() - activeInsurersCache.ts < ACTIVE_INSURERS_TTL_MS) {
    return activeInsurersCache.value
  }
  const supabase = createServiceClient()
  const { data: ins } = await supabase.from('insurers').select('id, name')
  if (!ins) {
    return []
  }
  const counts = await Promise.all(
    ins.map(async (i) => {
      const { count } = await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('insurer_id', i.id)
        .not('embedding', 'is', null)
        .is('valid_until', null)
      return { id: i.id, name: i.name, count: count ?? 0 }
    })
  )
  const rows = counts.filter((c) => c.count >= minChunks).map(({ id, name }) => ({ id, name }))
  activeInsurersCache = { value: rows, ts: Date.now() }
  return rows
}

interface RoundRobinOptions {
  excludeInsurerIds?: Set<string>
  perInsurerTopK?: number
}

/**
 * Round-robin per-entity global search. Embeds the query ONCE, fans out to
 * each active insurer in parallel with topK=perInsurerTopK, merges and sorts
 * by similarity. Caps at fetchK*2 raw chunks; downstream diversifyResults
 * trims to RAG.topK. Optionally excludes specific insurer ids (used by Padrao
 * B to fetch "other insurers" without re-fetching the mentioned one).
 */
export async function roundRobinGlobalSearch(
  query: string,
  opts?: RoundRobinOptions
): Promise<SearchResult[]> {
  const all = await loadActiveInsurers()
  const insurers = opts?.excludeInsurerIds
    ? all.filter((i) => !opts.excludeInsurerIds!.has(i.id))
    : all
  if (insurers.length === 0) {
    return semanticSearch(query, { topK: RAG.globalTopK })
  }

  const queryEmbedding = await embedQuery(query)
  const perInsurerTopK = opts?.perInsurerTopK ?? 2

  const settled = await Promise.allSettled(
    insurers.map((i) =>
      semanticSearchWithEmbedding(queryEmbedding, { insurerId: i.id, topK: perInsurerTopK })
    )
  )

  const merged: SearchResult[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') merged.push(...r.value)
  }
  merged.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))

  const cap = RAG.fetchK * 2
  const trimmed = merged.length > cap ? merged.slice(0, cap) : merged
  console.log(`[rag/round-robin-global] ${insurers.length} insurers × ${perInsurerTopK} = ${merged.length} chunks (capped to ${trimmed.length})`)
  return trimmed
}

/**
 * Padrao B detector: question mentions one insurer but explicitly asks for
 * comparison against "outras seguradoras" / "demais" / "no catalogo" /
 * "concorrentes" etc. detectInsurers alone returns just the named one and
 * the multi-insurer path stays narrow — this pattern triggers the cross-
 * insurer round-robin to enrich the context.
 *
 * Restringido em 2026-04-28: gatilhos amplos ("que oferecem", "no mercado",
 * "varias seguradoras", "quais seguradoras") removidos pra evitar disparo
 * em queries nao comparativas que apenas mencionam mercado.
 */
export function questionImpliesOtherInsurers(question: string): boolean {
  const q = stripAccentsLower(question)
  const triggers = [
    /\boutras?\s+(?:seguradoras?|operadoras?)\b/,
    /\bdemais\s+(?:seguradoras?|operadoras?)\b/,
    /\bvs?\s+outras?\b/,
    /\bno\s+(?:seu\s+)?catalogo\b/,
    /\b(?:concorrentes?|concorrencia)\b/,
  ]
  return triggers.some((re) => re.test(q))
}

/**
 * Padrao C scope detector: stricter than questionImpliesOtherInsurers.
 * Usado quando NENHUMA seguradora foi mencionada — define se a query merece
 * fan-out global (round-robin per-entity) ou busca focada (semanticSearch
 * single-call). Concept/edge queries sem comparacao explicita devem
 * permanecer focadas.
 */
export function questionImpliesComparison(question: string): boolean {
  if (detectInsurers(question).length >= 2) return true

  const q = stripAccentsLower(question)
  const triggers = [
    /\bcompare\b/,
    /\bcomparar\b/,
    /\bversus\b/,
    /\bvs\.?\b/,
    /\bdiferenca\s+entre\b/,
    /\bqual\s+(?:e\s+)?melhor\b/,
    /\bmais\s+barato\b/,
    /\bno\s+(?:seu\s+)?catalogo\b/,
    /\bquais\s+(?:seguradoras?|operadoras?)\b/,
  ]
  return triggers.some((re) => re.test(q))
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
