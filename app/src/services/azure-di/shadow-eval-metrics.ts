/**
 * Phase 2 / PR 3B.6.3 — pure metrics for the legacy-vs-shadow eval harness.
 *
 * The harness compares two retrievals (`match_documents` and
 * `match_shadow_documents`) on the same query embedding for the 9
 * Prudential-impacted Ragas questions, then computes two deterministic
 * proxy metrics:
 *
 *   - keywordPrecision = fraction of retrieved chunks that contain ≥1
 *                        expected keyword (proxy for "Context Precision")
 *   - keywordRecall    = fraction of expected keywords that appear in
 *                        the UNION of retrieved chunks (proxy for
 *                        "Context Recall")
 *
 * These are NOT the full Ragas CP / CR — those require an LLM judge.
 * They are deterministic, free, and SYMMETRIC: the same function
 * applied to both corpora gives a fair Δ. CEO explicitly accepted this
 * shape in PR #30 (3B.6.3 default mode, no LLM, no cost). A full Ragas
 * run remains a separate, gated slice (3B.6.4) if/when needed.
 *
 * Stop criterion (PR #32 → 3B.6.3 brief): if shadow CP < legacy CP OR
 * shadow CR < legacy CR for ANY category aggregate, the harness exits
 * non-zero so a strategic stop is unambiguous.
 *
 * The module is pure: no I/O, no DB, no OpenAI, no read-path import.
 */

/** A retrieved chunk surface — only the fields the metric needs. */
export interface RetrievedChunk {
  id: string
  content: string
}

/** A question the harness measures. The `expectedTokens` are the proxy "gold". */
export interface ShadowEvalQuestion {
  id: string
  category: 'comparison' | 'concept'
  question: string
  /**
   * Tokens (case- and accent-insensitive) whose presence in retrieved
   * chunks signals on-topic context. Manually curated from the
   * question and `questions.jsonl` ground_truth — small (3-6) and
   * explicit so reviewers can audit each one.
   */
  expectedTokens: readonly string[]
  /** Free-text rationale for the expectedTokens set. */
  notes?: string
}

/** Per-question scores. */
export interface QuestionScore {
  chunkCount: number
  keywordPrecision: number
  keywordRecall: number
  matchedTokens: readonly string[]
}

/** Side-by-side legacy vs shadow result for one question. */
export interface QuestionComparison {
  question: ShadowEvalQuestion
  legacy: QuestionScore
  shadow: QuestionScore
  deltaCp: number
  deltaCr: number
}

/** Per-category aggregate (comparison or concept). */
export interface CategoryAggregate {
  category: 'comparison' | 'concept'
  questionCount: number
  legacyCp: number
  legacyCr: number
  shadowCp: number
  shadowCr: number
  deltaCp: number
  deltaCr: number
  /** True when shadow lost on either CP or CR for this category (stop signal). */
  shadowRegressed: boolean
}

/**
 * Normalize text for token matching: lowercase + strip Unicode
 * combining marks (NFD) + collapse non-alphanumerics to single space.
 * Pure.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Is `token` (already normalized) present in the normalized form of `text`?
 * Plain substring match on space-padded forms so "tm10" doesn't false-match
 * "tm100" but does match "TM10" inside "premio do TM10 para".
 */
export function chunkContainsToken(text: string, normalizedToken: string): boolean {
  if (normalizedToken.length === 0) return false
  const haystack = ` ${normalize(text)} `
  // Pad the normalized token so partial-word collisions ("tm10" vs "tm100")
  // are rejected. The token itself can be multi-word ("vida inteira") — the
  // padding still works because both haystack and needle were normalized
  // identically.
  const needle = ` ${normalize(normalizedToken)} `
  return haystack.includes(needle)
}

/**
 * Returns the SUBSET of `expectedTokens` that appears anywhere in the
 * UNION of `chunks`. Order is preserved relative to `expectedTokens`.
 */
export function findMatchedTokens(
  chunks: readonly RetrievedChunk[],
  expectedTokens: readonly string[]
): string[] {
  const found: string[] = []
  for (const token of expectedTokens) {
    const hit = chunks.some((c) => chunkContainsToken(c.content, token))
    if (hit) found.push(token)
  }
  return found
}

/**
 * Computes the proxy CP / CR for one retrieval against one question.
 * Pure.
 */
export function scoreQuestion(
  chunks: readonly RetrievedChunk[],
  expectedTokens: readonly string[]
): QuestionScore {
  if (expectedTokens.length === 0) {
    // No expected tokens → CR is undefined; we return 0 to keep the metric
    // bounded. Such a question should not be in the harness; the caller is
    // responsible for curating non-empty expectedTokens.
    return { chunkCount: chunks.length, keywordPrecision: 0, keywordRecall: 0, matchedTokens: [] }
  }
  if (chunks.length === 0) {
    return { chunkCount: 0, keywordPrecision: 0, keywordRecall: 0, matchedTokens: [] }
  }
  const matched = findMatchedTokens(chunks, expectedTokens)
  let chunksWithAnyToken = 0
  for (const c of chunks) {
    const hit = expectedTokens.some((t) => chunkContainsToken(c.content, t))
    if (hit) chunksWithAnyToken += 1
  }
  return {
    chunkCount: chunks.length,
    keywordPrecision: chunksWithAnyToken / chunks.length,
    keywordRecall: matched.length / expectedTokens.length,
    matchedTokens: matched,
  }
}

/**
 * Rolls per-question comparisons up into per-category aggregates and a
 * boolean `shadowRegressed` flag per category. Pure.
 */
export function tallyCategoryAggregates(
  comparisons: readonly QuestionComparison[]
): CategoryAggregate[] {
  const cats: Array<'comparison' | 'concept'> = ['comparison', 'concept']
  return cats.map((category) => {
    const subset = comparisons.filter((c) => c.question.category === category)
    if (subset.length === 0) {
      return {
        category,
        questionCount: 0,
        legacyCp: 0,
        legacyCr: 0,
        shadowCp: 0,
        shadowCr: 0,
        deltaCp: 0,
        deltaCr: 0,
        shadowRegressed: false,
      }
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    const legacyCp = mean(subset.map((c) => c.legacy.keywordPrecision))
    const legacyCr = mean(subset.map((c) => c.legacy.keywordRecall))
    const shadowCp = mean(subset.map((c) => c.shadow.keywordPrecision))
    const shadowCr = mean(subset.map((c) => c.shadow.keywordRecall))
    const deltaCp = shadowCp - legacyCp
    const deltaCr = shadowCr - legacyCr
    return {
      category,
      questionCount: subset.length,
      legacyCp,
      legacyCr,
      shadowCp,
      shadowCr,
      deltaCp,
      deltaCr,
      shadowRegressed: deltaCp < 0 || deltaCr < 0,
    }
  })
}

/**
 * The 9 Prudential-impacted Ragas questions selected for the harness.
 * Six `comparison` + three `concept` per `docs/phase-2-pr3b-plan.md` §3.
 * Each question carries an explicit `expectedTokens` set so the proxy
 * metric is fully auditable.
 *
 * Token curation rationale lives in each entry's `notes`; the rule of
 * thumb is "tokens that a correct retrieval MUST surface to even have
 * a chance at answering the question well".
 */
export const SHADOW_EVAL_QUESTIONS: readonly ShadowEvalQuestion[] = [
  // --- concept (3) ---
  {
    id: 'Q16',
    category: 'concept',
    question:
      'Qual o periodo de carencia para suicidio no Seguro Vida Inteira da Prudential?',
    expectedTokens: ['carencia', 'suicidio', '2 anos', 'vida inteira'],
    notes:
      'Julio-validated ground_truth: "2 anos a contar da contratacao". Tokens cover the right clause (carencia + suicidio) and the right product (vida inteira) plus the literal period.',
  },
  {
    id: 'Q17',
    category: 'concept',
    question: 'O Seguro Temporario da Prudential tem renovacao automatica?',
    expectedTokens: ['temporario', 'renovacao', 'vigencia', 'apolice'],
    notes:
      'Julio-validated: renovacao depends on whether temporario is cobertura base or opcional. Tokens span product (temporario) and the clause topic (renovacao/vigencia).',
  },
  {
    id: 'Q26',
    category: 'concept',
    question:
      'Qual o numero minimo de vidas para contratar o VG Corporate da Prudential?',
    expectedTokens: ['vg corporate', 'vg express', '500 vidas'],
    notes:
      'Julio-validated: VG Corporate >500 vidas, VG Express 2-500. Tokens are the two product names plus the threshold.',
  },
  // --- comparison (6) ---
  {
    id: 'Q31',
    category: 'comparison',
    question:
      'Comparar premio Seguro Temporario Prudential TM10 (capital 500k) versus Bradesco Tranquilidade Familiar.',
    expectedTokens: ['tm10', 'temporario', 'capital', 'premio'],
    notes:
      'Q31 hits conditions-text for Temporario TM10 product naming + capital/premio (the answer cites a Prudential per-1000 rate). Bradesco-side has no tables imported, expected.',
  },
  {
    id: 'Q32',
    category: 'comparison',
    question:
      'Compare Seguro Doencas Graves Plus da Prudential (DDR5G) com outras seguradoras.',
    expectedTokens: ['ddr5g', 'doencas graves', 'prudential'],
    notes:
      'Q32: the chunker must surface DDR5G clauses or doencas graves clauses. Other-insurer tables are not imported, so we score Prudential-side only.',
  },
  {
    id: 'Q36',
    category: 'comparison',
    question:
      'Como Prudential Renda Familiar compara ao Bradesco Tranquilidade Familiar?',
    expectedTokens: ['renda familiar', 'renda mensal', 'morte', 'beneficiario'],
    notes:
      'Q36: comparison between two renda-mensal products. Tokens are the Prudential product name + the clause concepts (renda mensal, morte do provedor, beneficiario).',
  },
  {
    id: 'Q37',
    category: 'comparison',
    question: 'Prudential Vida Inteira WL10G vs WL00G, mulher 35 anos.',
    expectedTokens: ['wl10g', 'wl00g', 'vida inteira', 'capital remido'],
    notes:
      'Q37: distinguishes two Vida Inteira variants by code. Tokens cover both codes and the explanatory concept (capital remido).',
  },
  {
    id: 'Q38',
    category: 'comparison',
    question: 'Prudential Seguro Cirurgia CIB5G vs CIB5H, qual mais barato?',
    expectedTokens: ['cib5g', 'cib5h', 'cirurgia'],
    notes:
      'Q38: control question — already scores CP=1.0 in the legacy baseline because it hits the structured rate path. Shadow should match, not regress.',
  },
  {
    id: 'Q39',
    category: 'comparison',
    question: 'Prudential Temporario TM10, TM15 e TM20 para homem 35 anos.',
    expectedTokens: ['tm10', 'tm15', 'tm20', 'temporario'],
    notes:
      'Q39: distinguishes 3 temporario term variants. Tokens are the codes plus the product name.',
  },
]
