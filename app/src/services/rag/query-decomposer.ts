/**
 * Query Decomposer — Fase 3 SOLOMON
 *
 * Decompõe queries comparativas em sub-queries focadas por entidade (seguradora,
 * produto ou cobertura), permitindo retrieval independente + Cohere Rerank
 * per-entity + fusão balanceada.
 *
 * Fluxo:
 *   detectComparativeQuery(q) → boolean  (fast-path heurístico, sem LLM)
 *   decomposeComparativeQuery(q)          (Gemini JSON apenas se heurística passar)
 *   balancedMerge(buckets)               (intercalação com cap por entidade)
 *   dedupeChunks(chunks)                 (deduplicação multi-critério)
 */

import { callGeminiJson } from './llm'
import type { SearchResult } from './search'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecomposedSubQuery = {
  entity: string
  entity_type: 'insurer' | 'product' | 'coverage' | 'unknown'
  query: string
}

export type QueryDecomposition = {
  is_comparative: boolean
  confidence: number
  original_query: string
  sub_queries: DecomposedSubQuery[]
  comparison_axis?: string[]
}

// ---------------------------------------------------------------------------
// Heuristic triggers (fast-path — zero LLM cost)
// ---------------------------------------------------------------------------

const COMPARATIVE_TRIGGERS: RegExp[] = [
  /\bcompare\b/i,
  /\bcomparar\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
  /\bdiferenca\s+entre\b/i,
  /\bdiferença\s+entre\b/i,
  /\bqual\s+(?:é\s+)?(?:o\s+)?melhor\b/i,
  /\bmais\s+barato\b/i,
  /\bcontra\b/i,
  /\bou\s+a\b/i,
]

/** Canonical insurer names — kept in sync with detectInsurers in answer.ts */
const KNOWN_INSURERS_LOWER = [
  'prudential', 'bradesco', 'porto seguro', 'porto', 'icatu', 'mapfre',
  'tokio', 'tokio marine', 'sulamerica', 'sulamérica', 'sul america',
  'sul américa', 'zurich', 'caixa vida', 'caixa seguradora', 'santander',
  'metlife', 'met life', 'mag seguros', 'mag', 'mongeral', 'azos',
]

function stripAccentsLower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function countInsurerMentions(question: string): number {
  const q = stripAccentsLower(question)
  let count = 0
  for (const name of KNOWN_INSURERS_LOWER) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(q)) {
      count++
    }
  }
  return count
}

/**
 * Fast-path heuristic: returns true when the question contains comparative
 * trigger words OR explicitly mentions 2+ distinct insurers.
 * No LLM call — runs in <1ms.
 */
export function detectComparativeQuery(question: string): boolean {
  const q = stripAccentsLower(question)
  if (COMPARATIVE_TRIGGERS.some((re) => re.test(q))) return true
  if (countInsurerMentions(question) >= 2) return true
  return false
}

// ---------------------------------------------------------------------------
// LLM Decomposition (called only when heuristic returns true)
// ---------------------------------------------------------------------------

const DECOMPOSE_SYSTEM_PROMPT = `Você é um analisador de perguntas sobre seguros de vida.
Analise a pergunta e retorne JSON com a decomposição em sub-queries por entidade.

REGRAS:
- Identifique CADA seguradora, produto ou cobertura mencionada como entidade separada.
- Para cada entidade, reescreva a query focada APENAS naquela entidade.
- Se não conseguir identificar ao menos 2 entidades distintas, retorne is_comparative=false.
- confidence: 0-1 (1 = certeza de que é comparativa com 2+ entidades claras).
- comparison_axis: o que está sendo comparado (ex: ["carência", "cobertura IPA"]).
- entity_type: "insurer" | "product" | "coverage" | "unknown".

SCHEMA OBRIGATÓRIO:
{
  "is_comparative": boolean,
  "confidence": number,
  "original_query": string,
  "sub_queries": [
    { "entity": string, "entity_type": string, "query": string }
  ],
  "comparison_axis": [string]
}`

/**
 * Decomposes a comparative query into focused per-entity sub-queries using
 * Gemini JSON mode (thinkingBudget=0 for speed and token efficiency).
 */
export async function decomposeComparativeQuery(question: string): Promise<QueryDecomposition> {
  const fallback: QueryDecomposition = {
    is_comparative: false,
    confidence: 0,
    original_query: question,
    sub_queries: [],
  }

  try {
    const resp = await callGeminiJson(
      DECOMPOSE_SYSTEM_PROMPT,
      `Pergunta do corretor: "${question}"`,
      { thinkingBudget: 0, temperature: 0.1, maxOutputTokens: 512 }
    )

    let parsed: QueryDecomposition
    try {
      parsed = JSON.parse(resp.text) as QueryDecomposition
    } catch {
      console.warn('[query-decomposer] Gemini JSON parse failed, returning fallback')
      return fallback
    }

    // Validate minimum structure
    if (
      typeof parsed.is_comparative !== 'boolean' ||
      !Array.isArray(parsed.sub_queries)
    ) {
      return fallback
    }

    parsed.original_query = question

    console.log(
      `[query-decomposer] decomposed: is_comparative=${parsed.is_comparative} ` +
      `confidence=${parsed.confidence} sub_queries=${parsed.sub_queries.length} ` +
      `entities=${parsed.sub_queries.map((sq) => sq.entity).join(', ')}`
    )

    return parsed
  } catch (error) {
    console.warn('[query-decomposer] decomposeComparativeQuery error:', (error as Error).message)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Balanced Merge
// ---------------------------------------------------------------------------

/**
 * Intercalates per-entity result buckets preserving entity balance.
 * Each bucket is a [entityLabel, SearchResult[]] pair.
 *
 * Example with maxPerEntity=5, finalTopK=10:
 *   Prudential: [P1,P2,P3,P4,P5]  + Bradesco: [B1,B2,B3]
 *   → [P1,B1,P2,B2,P3,B3,P4,P5]
 *
 * Chunks within each bucket are assumed to be already sorted by relevance
 * (e.g. post-Cohere rerank).
 */
export function balancedMerge(
  buckets: Array<{ entity: string; results: SearchResult[] }>,
  maxPerEntity = 5,
  finalTopK = 10
): SearchResult[] {
  if (buckets.length === 0) return []

  // Cap each bucket to maxPerEntity
  const capped = buckets.map((b) => ({
    entity: b.entity,
    results: b.results.slice(0, maxPerEntity),
  }))

  const merged: SearchResult[] = []
  let round = 0
  const maxRounds = maxPerEntity

  while (merged.length < finalTopK && round < maxRounds) {
    for (const { results } of capped) {
      if (round < results.length && merged.length < finalTopK) {
        merged.push(results[round])
      }
    }
    round++
  }

  console.log(
    `[query-decomposer] balancedMerge: ${buckets.map((b) => `${b.entity}(${b.results.length})`).join(', ')} ` +
    `→ ${merged.length} merged (finalTopK=${finalTopK})`
  )

  return merged
}

// ---------------------------------------------------------------------------
// Chunk Deduplication
// ---------------------------------------------------------------------------

/**
 * Removes duplicate chunks using a multi-criterion strategy:
 * 1. chunk.id
 * 2. document_id + page (if available in metadata)
 * 3. normalized text hash (first 120 chars — catches near-duplicates)
 */
export function dedupeChunks(chunks: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  const result: SearchResult[] = []

  for (const chunk of chunks) {
    // Key 1: chunk id
    const k1 = chunk.id ? `id:${chunk.id}` : null

    // Key 2: document_id + page
    const docId = (chunk.metadata?.document_id as string | undefined) ?? ''
    const page = (chunk.metadata?.page as number | undefined) ?? -1
    const k2 = docId ? `doc:${docId}:pg:${page}` : null

    // Key 3: normalized text fingerprint (first 120 chars, lowercased, no accents/spaces)
    const textFingerprint = stripAccentsLower(chunk.content)
      .replace(/\s+/g, '')
      .slice(0, 120)
    const k3 = `txt:${textFingerprint}`

    const keys = [k1, k2, k3].filter(Boolean) as string[]
    const isDuplicate = keys.some((k) => seen.has(k))

    if (!isDuplicate) {
      keys.forEach((k) => seen.add(k))
      result.push(chunk)
    }
  }

  if (result.length < chunks.length) {
    console.log(`[query-decomposer] dedupeChunks: ${chunks.length} → ${result.length} (removed ${chunks.length - result.length} dupes)`)
  }

  return result
}
