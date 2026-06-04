import { callGeminiJson } from './llm'

export interface ExpandedQuery {
  formal_query: string
  expanded_terms: string[]
}

const QUERY_EXPANSION_SYSTEM_PROMPT = `Você é um engenheiro sênior de seguros e RAG especialista no mercado brasileiro.
O seu trabalho é receber uma pergunta de um corretor de seguros (geralmente informal ou com jargão) e expandi-la/reescrevê-la para melhorar a recuperação (retrieval) semântica e léxica em documentos oficiais de Condições Gerais (CG).

Diretrizes:
1. Identifique jargões, coberturas, termos comerciais ou de marketing na pergunta.
2. Traduza esses jargões para a terminologia oficial e técnica comumente usada pelas seguradoras nas Condições Gerais.
   Exemplos de Tradução:
   - "mag" ou "mongeral" -> "MAG Seguros"
   - "premiavel" ou "bradesco premiavel" -> "AP Premiavel"
   - "infarto" -> "Infarto Agudo do Miocardio"
   - "cancer" -> "Neoplasia Maligna" ou "Cancer"
   - "derrame" ou "avc" -> "Acidente Vascular Cerebral"
   - "dit" -> "Diaria por Incapacidade Temporaria"
   - "dit com franquia reduzida" -> "Diaria por Incapacidade Temporaria com Franquia"
   - "majorada" ou "majorar" -> "Invalidez Permanente por Acidente Majorada"
   - "ipta" -> "Invalidez Permanente Total por Acidente"
   - "ifpd" -> "Invalidez Funcional Permanente por Doenca"
   - "dg" -> "Doencas Graves"
   - "dg 10" ou "dg 13" -> "Doencas Graves 10" ou "Doencas Graves 13"
   - "saldamento" -> "Valor Saldado" ou "Saldamento"
   - "carencia" -> "Periodo de Carencia"
   - "resgate" -> "Valor de Resgate"
3. Escreva uma versão formal e detalhada da pergunta ("formal_query"). Ela deve ser focada no conteúdo que se deseja buscar no documento (ex: em vez de "Infarto paga na hora?", use "Critérios de elegibilidade, carência e pagamento do capital segurado para cobertura de Infarto Agudo do Miocárdio").
4. Liste de 3 a 6 termos técnicos formais isolados ("expanded_terms") que são altamente prováveis de constar nos PDFs de seguros.

Retorne APENAS um JSON no seguinte formato:
{
  "formal_query": "Pergunta formatada de forma técnica e detalhada para busca semântica",
  "expanded_terms": ["termo técnico 1", "termo técnico 2", "termo técnico 3"]
}`

/**
 * Expands and rewrites a colloquial broker query using Gemini Flash JSON mode.
 * Falls back gracefully to original query if the model fails.
 */
export async function expandQueryWithLLM(query: string): Promise<ExpandedQuery> {
  const fallback: ExpandedQuery = {
    formal_query: query,
    expanded_terms: [],
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.warn('[rag/query-expansion] GEMINI_API_KEY missing — bypassing LLM expansion')
    return fallback
  }

  try {
    const response = await callGeminiJson(
      QUERY_EXPANSION_SYSTEM_PROMPT,
      `Pergunta original: "${query}"`,
      {
        thinkingBudget: 0,
        temperature: 0.1,
        maxOutputTokens: 256,
        timeoutMs: 4000 // Rápido, timeout baixo de 4s para não introduzir latência visível
      }
    )

    const parsed = JSON.parse(response.text) as Partial<ExpandedQuery>
    
    if (typeof parsed.formal_query === 'string' && Array.isArray(parsed.expanded_terms)) {
      return {
        formal_query: parsed.formal_query.trim(),
        expanded_terms: parsed.expanded_terms.map(t => String(t).trim()).filter(Boolean),
      }
    }
  } catch (err) {
    console.warn(
      '[rag/query-expansion] Failed to expand query via LLM:',
      err instanceof Error ? err.message : String(err)
    )
  }

  return fallback
}
