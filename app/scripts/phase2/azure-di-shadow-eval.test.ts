/**
 * Phase 2 / PR 3B slice 3B.6.3 — pure-helper tests for the shadow eval harness.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no LLM, no OpenAI.
 *
 * Covers:
 *   - normalize (NFD, lowercase, alnum-collapse)
 *   - chunkContainsToken (partial-word rejection, multi-word match,
 *     accent insensitivity, case insensitivity)
 *   - findMatchedTokens (union across chunks, order preservation)
 *   - scoreQuestion (CP / CR proxies on empty / all-hit / partial / no-hit)
 *   - tallyCategoryAggregates (per-category mean, shadowRegressed flag)
 *   - SHADOW_EVAL_QUESTIONS shape (9 entries, expected categories, non-empty tokens)
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow-eval:test
 */

import {
  SHADOW_EVAL_QUESTIONS,
  chunkContainsToken,
  findMatchedTokens,
  normalize,
  scoreQuestion,
  tallyCategoryAggregates,
  tallyControlAggregate,
  type QuestionComparison,
  type RetrievedChunk,
  type ShadowEvalQuestionScope,
} from '../../src/services/azure-di/shadow-eval-metrics'

let passed = 0
let failed = 0

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function chunk(content: string, id = 'c-' + content.slice(0, 8)): RetrievedChunk {
  return { id, content }
}

function runNormalizeTests(): void {
  console.log('\n## normalize')
  ok('lowercases', normalize('VIDA INTEIRA') === 'vida inteira')
  ok('strips accents (Portuguese)', normalize('apólice') === 'apolice')
  ok('strips accents (mid-word)', normalize('renovação automática') === 'renovacao automatica')
  ok('collapses punctuation to single space', normalize('TM-10, TM_15') === 'tm 10 tm 15')
  ok('collapses multiple whitespace', normalize('  vida   inteira  ') === 'vida inteira')
  ok('empty stays empty', normalize('') === '')
}

function runChunkContainsTokenTests(): void {
  console.log('\n## chunkContainsToken')
  ok(
    'finds plain token',
    chunkContainsToken('Premio do Seguro TM10 para 35 anos', 'tm10')
  )
  ok(
    'case-insensitive (haystack uppercase)',
    chunkContainsToken('SEGURO TEMPORARIO TM10', 'tm10')
  )
  ok(
    'accent-insensitive (needle has accent)',
    chunkContainsToken('renovacao automatica', 'renovação')
  )
  ok(
    'accent-insensitive (haystack has accent)',
    chunkContainsToken('apólice de seguro', 'apolice')
  )
  ok(
    'rejects partial-word match (tm10 should NOT match in tm100)',
    !chunkContainsToken('o produto TM100 oferece', 'tm10')
  )
  ok(
    'multi-word token matches contiguous phrase',
    chunkContainsToken('cobertura vida inteira modificado', 'vida inteira')
  )
  ok(
    'multi-word token rejects non-contiguous occurrence',
    !chunkContainsToken('vida e capital inteira', 'vida inteira')
  )
  ok('empty token returns false', !chunkContainsToken('any text', ''))
  ok('not found returns false', !chunkContainsToken('texto qualquer', 'wl10g'))
}

function runFindMatchedTokensTests(): void {
  console.log('\n## findMatchedTokens')
  const chunks = [chunk('Seguro Vida Inteira WL10G'), chunk('Capital remido apos 10 anos')]
  const found = findMatchedTokens(chunks, ['wl10g', 'wl00g', 'vida inteira', 'capital remido'])
  ok('returns only tokens found in the union', found.length === 3, `got ${JSON.stringify(found)}`)
  ok('preserves expectedTokens order', found[0] === 'wl10g' && found[1] === 'vida inteira' && found[2] === 'capital remido')
  ok(
    'returns empty when nothing matches',
    findMatchedTokens([chunk('texto irrelevante')], ['xyz', 'abc']).length === 0
  )
  ok(
    'empty expected returns empty',
    findMatchedTokens(chunks, []).length === 0
  )
}

function runScoreQuestionTests(): void {
  console.log('\n## scoreQuestion')

  // All hit: all chunks contain at least one token, all tokens covered.
  {
    const chunks = [chunk('Seguro Vida Inteira WL10G info'), chunk('WL00G tabela')]
    const score = scoreQuestion(chunks, ['wl10g', 'wl00g'])
    ok('all-hit: CP=1.0', score.keywordPrecision === 1)
    ok('all-hit: CR=1.0', score.keywordRecall === 1)
    ok('all-hit: matchedTokens has both', score.matchedTokens.length === 2)
  }

  // Partial: 1 of 2 chunks has a token; 1 of 3 expected tokens hit.
  {
    const chunks = [chunk('Seguro Vida Inteira WL10G'), chunk('Irrelevante'), chunk('Mais texto irrelevante')]
    const score = scoreQuestion(chunks, ['wl10g', 'wl00g', 'capital remido'])
    ok('partial CP = 1/3', Math.abs(score.keywordPrecision - 1 / 3) < 1e-9, `got ${score.keywordPrecision}`)
    ok('partial CR = 1/3', Math.abs(score.keywordRecall - 1 / 3) < 1e-9, `got ${score.keywordRecall}`)
  }

  // No hit
  {
    const score = scoreQuestion([chunk('Nada relevante aqui')], ['xyz', 'abc'])
    ok('no-hit CP=0', score.keywordPrecision === 0)
    ok('no-hit CR=0', score.keywordRecall === 0)
  }

  // Empty inputs
  {
    const score = scoreQuestion([], ['xyz'])
    ok('empty chunks: CP=0 CR=0', score.keywordPrecision === 0 && score.keywordRecall === 0)
    ok('empty chunks: chunkCount=0', score.chunkCount === 0)
  }
  {
    const score = scoreQuestion([chunk('texto')], [])
    ok('empty expected tokens: CP=0 CR=0', score.keywordPrecision === 0 && score.keywordRecall === 0)
  }
}

function makeComparison(args: {
  id: string
  category: 'comparison' | 'concept'
  legacyCp: number
  legacyCr: number
  shadowCp: number
  shadowCr: number
  scope?: ShadowEvalQuestionScope
}): QuestionComparison {
  return {
    question: {
      id: args.id,
      category: args.category,
      question: 'q',
      expectedTokens: ['x'],
      scope: args.scope ?? 'conditions',
    },
    legacy: { chunkCount: 0, keywordPrecision: args.legacyCp, keywordRecall: args.legacyCr, matchedTokens: [] },
    shadow: { chunkCount: 0, keywordPrecision: args.shadowCp, keywordRecall: args.shadowCr, matchedTokens: [] },
    deltaCp: args.shadowCp - args.legacyCp,
    deltaCr: args.shadowCr - args.legacyCr,
  }
}

function runTallyAggregatesTests(): void {
  console.log('\n## tallyCategoryAggregates')

  // Symmetric improvement: both categories, both metrics up
  {
    const cs = [
      makeComparison({ id: 'Q1', category: 'comparison', legacyCp: 0.2, legacyCr: 0.3, shadowCp: 0.6, shadowCr: 0.7 }),
      makeComparison({ id: 'Q2', category: 'comparison', legacyCp: 0.4, legacyCr: 0.5, shadowCp: 0.8, shadowCr: 0.9 }),
      makeComparison({ id: 'Q3', category: 'concept', legacyCp: 0.5, legacyCr: 0.5, shadowCp: 0.9, shadowCr: 0.8 }),
    ]
    const aggs = tallyCategoryAggregates(cs)
    const compAgg = aggs.find((a) => a.category === 'comparison')!
    const concAgg = aggs.find((a) => a.category === 'concept')!
    ok('comparison Q count = 2', compAgg.questionCount === 2)
    ok('comparison legacy CP = 0.3 mean', Math.abs(compAgg.legacyCp - 0.3) < 1e-9)
    ok('comparison shadow CP = 0.7 mean', Math.abs(compAgg.shadowCp - 0.7) < 1e-9)
    ok('comparison Δ CP > 0', compAgg.deltaCp > 0)
    ok('comparison Δ CR > 0', compAgg.deltaCr > 0)
    ok('comparison NOT regressed', compAgg.shadowRegressed === false)
    ok('concept Q count = 1', concAgg.questionCount === 1)
    ok('concept NOT regressed', concAgg.shadowRegressed === false)
  }

  // Regression on shadow: comparison CR down → shadowRegressed = true on that category
  {
    const cs = [
      makeComparison({ id: 'Q1', category: 'comparison', legacyCp: 0.5, legacyCr: 0.6, shadowCp: 0.7, shadowCr: 0.4 }),
      makeComparison({ id: 'Q2', category: 'concept', legacyCp: 0.5, legacyCr: 0.5, shadowCp: 0.9, shadowCr: 0.8 }),
    ]
    const aggs = tallyCategoryAggregates(cs)
    const compAgg = aggs.find((a) => a.category === 'comparison')!
    const concAgg = aggs.find((a) => a.category === 'concept')!
    ok('regression on CR flips shadowRegressed', compAgg.shadowRegressed === true)
    ok('healthy category not affected', concAgg.shadowRegressed === false)
  }

  // Regression on shadow CP only
  {
    const cs = [
      makeComparison({ id: 'Q1', category: 'comparison', legacyCp: 0.5, legacyCr: 0.5, shadowCp: 0.4, shadowCr: 0.6 }),
    ]
    const aggs = tallyCategoryAggregates(cs)
    ok('regression on CP flips shadowRegressed', aggs.find((a) => a.category === 'comparison')!.shadowRegressed === true)
  }

  // Empty category
  {
    const aggs = tallyCategoryAggregates([])
    ok('empty input: 2 zero-aggregates', aggs.length === 2 && aggs.every((a) => a.questionCount === 0 && !a.shadowRegressed))
  }
}

function runQuestionsShapeTests(): void {
  console.log('\n## SHADOW_EVAL_QUESTIONS shape')
  ok('exactly 9 questions', SHADOW_EVAL_QUESTIONS.length === 9)
  const ids = SHADOW_EVAL_QUESTIONS.map((q) => q.id)
  const expected = ['Q16', 'Q17', 'Q26', 'Q31', 'Q32', 'Q36', 'Q37', 'Q38', 'Q39']
  ok(
    'covers Q16/17/26 (concept) + Q31/32/36/37/38/39 (comparison)',
    expected.every((id) => ids.includes(id)),
    `got ${ids.join(',')}`
  )
  const conceptIds = SHADOW_EVAL_QUESTIONS.filter((q) => q.category === 'concept').map((q) => q.id).sort()
  const compIds = SHADOW_EVAL_QUESTIONS.filter((q) => q.category === 'comparison').map((q) => q.id).sort()
  ok(
    'concept = [Q16, Q17, Q26]',
    JSON.stringify(conceptIds) === JSON.stringify(['Q16', 'Q17', 'Q26'])
  )
  ok(
    'comparison = [Q31, Q32, Q36, Q37, Q38, Q39]',
    JSON.stringify(compIds) === JSON.stringify(['Q31', 'Q32', 'Q36', 'Q37', 'Q38', 'Q39'])
  )
  ok(
    'every question has ≥3 expected tokens',
    SHADOW_EVAL_QUESTIONS.every((q) => q.expectedTokens.length >= 3)
  )
  ok(
    'every question has notes (token rationale)',
    SHADOW_EVAL_QUESTIONS.every((q) => typeof q.notes === 'string' && q.notes.length > 0)
  )
  ok(
    'no duplicate ids',
    new Set(SHADOW_EVAL_QUESTIONS.map((q) => q.id)).size === SHADOW_EVAL_QUESTIONS.length
  )
  // --- slice 3B.7.1: scope invariants ---
  ok(
    'every question has scope set',
    SHADOW_EVAL_QUESTIONS.every(
      (q) => q.scope === 'conditions' || q.scope === 'control_rate_table'
    )
  )
  const controlIds = SHADOW_EVAL_QUESTIONS.filter((q) => q.scope === 'control_rate_table')
    .map((q) => q.id)
    .sort()
  ok(
    'control_rate_table scope = [Q38, Q39] exactly',
    JSON.stringify(controlIds) === JSON.stringify(['Q38', 'Q39']),
    `got ${controlIds.join(',')}`
  )
  const conditionsIds = SHADOW_EVAL_QUESTIONS.filter((q) => q.scope === 'conditions')
    .map((q) => q.id)
    .sort()
  ok(
    'conditions scope = [Q16, Q17, Q26, Q31, Q32, Q36, Q37]',
    JSON.stringify(conditionsIds) ===
      JSON.stringify(['Q16', 'Q17', 'Q26', 'Q31', 'Q32', 'Q36', 'Q37']),
    `got ${conditionsIds.join(',')}`
  )
}

function runStopSignalScopingTests(): void {
  console.log('\n## stop signal scoping (slice 3B.7.1)')

  // Case 1: only control regressed → no stop signal
  {
    const cs = [
      makeComparison({
        id: 'Q-cond',
        category: 'comparison',
        scope: 'conditions',
        legacyCp: 0.5,
        legacyCr: 0.5,
        shadowCp: 0.7,
        shadowCr: 0.7,
      }),
      makeComparison({
        id: 'Q38',
        category: 'comparison',
        scope: 'control_rate_table',
        legacyCp: 1.0,
        legacyCr: 1.0,
        shadowCp: 0.0,
        shadowCr: 0.0,
      }),
    ]
    const aggs = tallyCategoryAggregates(cs)
    const compAgg = aggs.find((a) => a.category === 'comparison')!
    ok(
      'control regression alone does NOT flip shadowRegressed',
      compAgg.shadowRegressed === false
    )
    ok(
      'control question excluded from in-scope question count',
      compAgg.questionCount === 1
    )
    ok(
      'aggregates compute means only over conditions',
      Math.abs(compAgg.shadowCp - 0.7) < 1e-9 && Math.abs(compAgg.legacyCp - 0.5) < 1e-9
    )
  }

  // Case 2: conditions regressed → stop signal fires regardless of control
  {
    const cs = [
      makeComparison({
        id: 'Q-cond',
        category: 'comparison',
        scope: 'conditions',
        legacyCp: 0.5,
        legacyCr: 0.5,
        shadowCp: 0.3,
        shadowCr: 0.5,
      }),
      makeComparison({
        id: 'Q38',
        category: 'comparison',
        scope: 'control_rate_table',
        legacyCp: 0.0,
        legacyCr: 0.0,
        shadowCp: 1.0,
        shadowCr: 1.0,
      }),
    ]
    const aggs = tallyCategoryAggregates(cs)
    const compAgg = aggs.find((a) => a.category === 'comparison')!
    ok(
      'conditions regression flips shadowRegressed',
      compAgg.shadowRegressed === true
    )
  }

  // Case 3: only control questions → aggregate is empty, no stop
  {
    const cs = [
      makeComparison({
        id: 'Q38',
        category: 'comparison',
        scope: 'control_rate_table',
        legacyCp: 1.0,
        legacyCr: 1.0,
        shadowCp: 0.0,
        shadowCr: 0.0,
      }),
    ]
    const aggs = tallyCategoryAggregates(cs)
    ok(
      'all-control batch leaves both category aggregates empty + non-regressed',
      aggs.every((a) => a.questionCount === 0 && !a.shadowRegressed)
    )
  }
}

function runControlAggregateTests(): void {
  console.log('\n## tallyControlAggregate')

  // No control questions → null
  {
    const cs = [
      makeComparison({
        id: 'Q1',
        category: 'comparison',
        scope: 'conditions',
        legacyCp: 0.5,
        legacyCr: 0.5,
        shadowCp: 0.7,
        shadowCr: 0.7,
      }),
    ]
    ok('no control questions → null', tallyControlAggregate(cs) === null)
  }

  // 2 control questions → averaged correctly
  {
    const cs = [
      makeComparison({
        id: 'Q38',
        category: 'comparison',
        scope: 'control_rate_table',
        legacyCp: 1.0,
        legacyCr: 1.0,
        shadowCp: 0.0,
        shadowCr: 0.0,
      }),
      makeComparison({
        id: 'Q39',
        category: 'comparison',
        scope: 'control_rate_table',
        legacyCp: 0.8,
        legacyCr: 0.6,
        shadowCp: 0.0,
        shadowCr: 0.0,
      }),
    ]
    const ctrl = tallyControlAggregate(cs)
    ok('control aggregate not null when 2 control questions', ctrl !== null)
    if (ctrl) {
      ok('control questionCount = 2', ctrl.questionCount === 2)
      ok('control legacy CP = 0.9 mean', Math.abs(ctrl.legacyCp - 0.9) < 1e-9)
      ok('control shadow CP = 0.0', ctrl.shadowCp === 0)
      ok('control deltaCp is negative (shadow loses on rate)', ctrl.deltaCp < 0)
      ok('control aggregate carries scope tag', ctrl.scope === 'control_rate_table')
    }
  }

  // Mixed batch: control aggregate ignores conditions questions
  {
    const cs = [
      makeComparison({
        id: 'Q-cond',
        category: 'comparison',
        scope: 'conditions',
        legacyCp: 0.5,
        legacyCr: 0.5,
        shadowCp: 0.7,
        shadowCr: 0.7,
      }),
      makeComparison({
        id: 'Q38',
        category: 'comparison',
        scope: 'control_rate_table',
        legacyCp: 1.0,
        legacyCr: 1.0,
        shadowCp: 0.0,
        shadowCr: 0.0,
      }),
    ]
    const ctrl = tallyControlAggregate(cs)
    ok(
      'control aggregate has Q count = 1 (excludes conditions)',
      ctrl?.questionCount === 1
    )
  }
}

function main(): void {
  console.log('# azure-di shadow-eval pure-helper test')
  runNormalizeTests()
  runChunkContainsTokenTests()
  runFindMatchedTokensTests()
  runScoreQuestionTests()
  runTallyAggregatesTests()
  runStopSignalScopingTests()
  runControlAggregateTests()
  runQuestionsShapeTests()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
