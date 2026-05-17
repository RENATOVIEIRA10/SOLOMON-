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

/**
 * Which corpus a question is supposed to retrieve from.
 *
 *   `conditions`              — answer lives in conditions_pdf clauses;
 *                               both legacy and shadow CAN retrieve it.
 *                               These questions drive the strategic stop
 *                               signal.
 *   `control_rate_table`      — answer lives in rate_table_pdf rows.
 *                               Legacy can retrieve it via the structured
 *                               rate path; shadow is conditions_pdf-only
 *                               by contract and is NOT expected to score.
 *                               Reported as sanity check; NEVER feeds the
 *                               stop signal. (Introduced in slice 3B.7.1.)
 *   `out_of_scope_commercial` — answer lives only in commercial / sales
 *                               material (folheto, product manual, sales
 *                               kit). NOT in any indexed PDF — neither
 *                               conditions_pdf nor rate_table_pdf. Legacy
 *                               may score artificially via synthetic
 *                               metadata-header chunks that inject
 *                               product-catalog data; shadow chunker does
 *                               not. Reported for transparency; NEVER
 *                               feeds the stop signal. (Introduced in
 *                               slice 3B.7.5 after the Q26 audit.)
 *
 * The split exists so the strategic stop signal reflects only what the
 * chunker can actually be measured on.
 */
export type ShadowEvalQuestionScope =
  | 'conditions'
  | 'control_rate_table'
  | 'out_of_scope_commercial'

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
  /**
   * Whether this question is `conditions` (drives stop signal) or
   * `control_rate_table` (informational sanity check). Slice 3B.7.1
   * makes this required.
   */
  scope: ShadowEvalQuestionScope
  /** Free-text rationale for the expectedTokens set + scope choice. */
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

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * Rolls per-question comparisons up into per-category aggregates and a
 * boolean `shadowRegressed` flag per category. Pure.
 *
 * **Slice 3B.7.1 + 3B.7.5 semantics**: only questions whose
 * {@link ShadowEvalQuestion.scope} is `'conditions'` feed these
 * aggregates and the stop signal. `'control_rate_table'` and
 * `'out_of_scope_commercial'` questions are reported separately via
 * {@link tallyControlAggregate} and {@link tallyOutOfScopeCommercialAggregate}
 * as informational sanity checks — they NEVER set `shadowRegressed`.
 */
export function tallyCategoryAggregates(
  comparisons: readonly QuestionComparison[]
): CategoryAggregate[] {
  const cats: Array<'comparison' | 'concept'> = ['comparison', 'concept']
  return cats.map((category) => {
    const subset = comparisons.filter(
      (c) => c.question.category === category && c.question.scope === 'conditions'
    )
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
 * Informational rollup of questions with `scope='control_rate_table'`.
 * Never feeds the strategic stop signal — shadow is expected to lose
 * here because rate questions live in `rate_table_pdf` which the
 * shadow set does not cover.
 *
 * Returns `null` when the harness has zero control questions.
 */
export interface ControlAggregate {
  scope: 'control_rate_table'
  questionCount: number
  legacyCp: number
  legacyCr: number
  shadowCp: number
  shadowCr: number
  deltaCp: number
  deltaCr: number
}

export function tallyControlAggregate(
  comparisons: readonly QuestionComparison[]
): ControlAggregate | null {
  const subset = comparisons.filter((c) => c.question.scope === 'control_rate_table')
  if (subset.length === 0) return null
  const legacyCp = mean(subset.map((c) => c.legacy.keywordPrecision))
  const legacyCr = mean(subset.map((c) => c.legacy.keywordRecall))
  const shadowCp = mean(subset.map((c) => c.shadow.keywordPrecision))
  const shadowCr = mean(subset.map((c) => c.shadow.keywordRecall))
  return {
    scope: 'control_rate_table',
    questionCount: subset.length,
    legacyCp,
    legacyCr,
    shadowCp,
    shadowCr,
    deltaCp: shadowCp - legacyCp,
    deltaCr: shadowCr - legacyCr,
  }
}

/**
 * Informational rollup of questions with `scope='out_of_scope_commercial'`.
 *
 * These questions ask for facts that do not live in any indexed PDF —
 * the ground truth is commercial / sales-kit material, not legal
 * conditions. Legacy may score artificially because the legacy
 * ingestion pipeline injects synthetic metadata-header chunks
 * containing product-catalog data (product name, SUSEP, etc.). The
 * new chunker does not inject synthetic chunks, so shadow has no
 * such artifact and typically scores 0.
 *
 * NEVER feeds the strategic stop signal. Returns `null` when the
 * harness has zero out-of-scope-commercial questions.
 *
 * Introduced in slice 3B.7.5 after the Q26 audit.
 */
export interface OutOfScopeCommercialAggregate {
  scope: 'out_of_scope_commercial'
  questionCount: number
  legacyCp: number
  legacyCr: number
  shadowCp: number
  shadowCr: number
  deltaCp: number
  deltaCr: number
}

export function tallyOutOfScopeCommercialAggregate(
  comparisons: readonly QuestionComparison[]
): OutOfScopeCommercialAggregate | null {
  const subset = comparisons.filter((c) => c.question.scope === 'out_of_scope_commercial')
  if (subset.length === 0) return null
  const legacyCp = mean(subset.map((c) => c.legacy.keywordPrecision))
  const legacyCr = mean(subset.map((c) => c.legacy.keywordRecall))
  const shadowCp = mean(subset.map((c) => c.shadow.keywordPrecision))
  const shadowCr = mean(subset.map((c) => c.shadow.keywordRecall))
  return {
    scope: 'out_of_scope_commercial',
    questionCount: subset.length,
    legacyCp,
    legacyCr,
    shadowCp,
    shadowCr,
    deltaCp: shadowCp - legacyCp,
    deltaCr: shadowCr - legacyCr,
  }
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
  // --- concept (3) — all conditions scope ---
  {
    id: 'Q16',
    category: 'concept',
    scope: 'conditions',
    question:
      'Qual o periodo de carencia para suicidio no Seguro Vida Inteira da Prudential?',
    expectedTokens: ['carencia', 'suicidio', '2 anos', 'vida inteira'],
    notes:
      'Julio-validated ground_truth: "2 anos a contar da contratacao". Tokens cover the right clause (carencia + suicidio) and the right product (vida inteira) plus the literal period. Scope=conditions: clause lives in conditions_pdf.',
  },
  {
    id: 'Q17',
    category: 'concept',
    scope: 'conditions',
    question: 'O Seguro Temporario da Prudential tem renovacao automatica?',
    expectedTokens: ['temporario', 'renovacao', 'vigencia', 'apolice'],
    notes:
      'Julio-validated: renovacao depends on whether temporario is cobertura base or opcional. Tokens span product (temporario) and the clause topic (renovacao/vigencia). Scope=conditions.',
  },
  {
    id: 'Q26',
    category: 'concept',
    scope: 'out_of_scope_commercial',
    question:
      'Qual o numero minimo de vidas para contratar o VG Corporate da Prudential?',
    expectedTokens: ['vg corporate', 'vg express', '500 vidas'],
    notes:
      'Audited in slice 3B.7.5 (docs/phase-2-pr3b7.5-q26-q37-token-audit.md). The Julio-validated ground truth (VG Corporate >500 vidas, VG Express 2-500) is PRODUCT-POSITIONING knowledge from commercial material — it does NOT live in any conditions_pdf or rate_table_pdf in the indexed Prudential corpus. Verified: "500 vidas" returns zero hits across all corpora; the only "vg corporate"/"vg express" hits are a synthetic metadata-header chunk legacy ingestion injects. Reclassified scope to out_of_scope_commercial so this question never feeds the stop signal. Kept in the harness for transparency about the legacy-ingestion artifact.',
  },
  // --- comparison (6) — Q31/32/36/37 conditions, Q38/Q39 control_rate_table ---
  {
    id: 'Q31',
    category: 'comparison',
    scope: 'conditions',
    question:
      'Comparar premio Seguro Temporario Prudential TM10 (capital 500k) versus Bradesco Tranquilidade Familiar.',
    expectedTokens: ['tm10', 'temporario', 'capital', 'premio'],
    notes:
      'Q31 hits conditions-text for Temporario TM10 product naming + capital/premio (the answer cites a Prudential per-1000 rate). Bradesco-side has no tables imported, expected. Scope=conditions: the conditions retrieval is what we want to measure.',
  },
  {
    id: 'Q32',
    category: 'comparison',
    scope: 'conditions',
    question:
      'Compare Seguro Doencas Graves Plus da Prudential (DDR5G) com outras seguradoras.',
    expectedTokens: ['ddr5g', 'doencas graves', 'prudential'],
    notes:
      'Q32: the chunker must surface DDR5G clauses or doencas graves clauses. Other-insurer tables are not imported, so we score Prudential-side only. Scope=conditions.',
  },
  {
    id: 'Q36',
    category: 'comparison',
    scope: 'conditions',
    question:
      'Como Prudential Renda Familiar compara ao Bradesco Tranquilidade Familiar?',
    expectedTokens: ['renda familiar', 'renda mensal', 'morte', 'beneficiario'],
    notes:
      'Q36: comparison between two renda-mensal products. Tokens are the Prudential product name + the clause concepts (renda mensal, morte do provedor, beneficiario). Scope=conditions.',
  },
  {
    id: 'Q37',
    category: 'comparison',
    scope: 'conditions',
    question: 'Prudential Vida Inteira WL10G vs WL00G, mulher 35 anos.',
    expectedTokens: ['vida inteira', 'modificado', 'vitalicia', 'pagamento'],
    notes:
      'Audited in slice 3B.7.5. Original tokens ["wl10g","wl00g","vida inteira","capital remido"] were rate-table-flavoured: wl10g/wl00g exist exclusively in rate_table_pdf (58/57 hits each, ZERO in conditions_pdf); "capital remido" returns zero hits across the entire Prudential corpus. Replaced with body-text-anchored conditions tokens: vida inteira (product family), modificado (the WL10G "modificado 30" variant differentiator), vitalicia (the WL00G permanent-life concept), pagamento (the economic differentiator — limited-payment vs ongoing). Scope=conditions: this question IS measurable on the new chunker.',
  },
  {
    id: 'Q38',
    category: 'comparison',
    scope: 'control_rate_table',
    question: 'Prudential Seguro Cirurgia CIB5G vs CIB5H, qual mais barato?',
    expectedTokens: ['cib5g', 'cib5h', 'cirurgia'],
    notes:
      'Q38: pure rate question (ground_truth: 20,4928 vs 20,2133 per_1000_annual). Legacy hits this via the structured rate_table_pdf path; shadow is conditions_pdf-only by contract and CANNOT score by design. Reclassified to control_rate_table in slice 3B.7.1; informational only — never feeds the stop signal.',
  },
  {
    id: 'Q39',
    category: 'comparison',
    scope: 'control_rate_table',
    question: 'Prudential Temporario TM10, TM15 e TM20 para homem 35 anos.',
    expectedTokens: ['tm10', 'tm15', 'tm20', 'temporario'],
    notes:
      'Q39: pure rate question (3 rate values for 3 temporario term variants). Same shape as Q38 — rate_table_pdf scope. Reclassified to control_rate_table in slice 3B.7.1; informational only.',
  },
]
