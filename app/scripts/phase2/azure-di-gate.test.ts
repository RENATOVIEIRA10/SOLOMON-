/**
 * Phase 2 / PR 3B slice 3B.3 — quality-gate test.
 *
 * Two layers:
 *   1. Unit tests for each gate predicate (synthetic chunks + contexts).
 *   2. Integration tests: run the slice 3B.2 chunker on the same
 *      Bradesco + Prudential fixtures, then run the gates, and assert
 *      the expected accept/quarantine split — proves the under-300
 *      chunks get quarantined (and only them, for those fixtures).
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 *
 * Run from app/:
 *   npm run phase2:azure-di:gate:test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  GATE_IDS,
  checkBoundary,
  checkConfidence,
  checkContent,
  checkDedup,
  checkInsurer,
  checkPage,
  checkProduct,
  checkType,
  formatGateReport,
  runChunkGates,
  type ChunkContext,
  type GateId,
  type GateInput,
} from '../../src/services/azure-di/chunk-gate'
import {
  SEMANTIC_CHUNKER_PARSER,
  chunkLayoutResult,
  type SemanticChunk,
} from '../../src/services/azure-di/chunker'
import type { LayoutAnalyzeResult } from '../../src/services/azure-di/types'

const FIXTURES_DIR = path.join('scripts', 'phase2', '__fixtures__')

let passed = 0
let failed = 0

function ok(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function loadFixture(name: string): LayoutAnalyzeResult {
  const full = path.join(FIXTURES_DIR, `${name}.json`)
  return JSON.parse(readFileSync(full, 'utf8')) as LayoutAnalyzeResult
}

/** Synthetic-chunk factory for the unit tests. */
function makeChunk(overrides: Partial<SemanticChunk> & { content?: string } = {}): SemanticChunk {
  const content = overrides.content ?? 'A'.repeat(500)
  return {
    content,
    content_hash: overrides.content_hash ?? `hash-${content.length}-${content.slice(0, 6)}`,
    metadata: {
      chunk_index: 0,
      page: 1,
      parser: SEMANTIC_CHUNKER_PARSER,
      source_offset_start: 0,
      source_offset_end: content.length,
      ...(overrides.metadata ?? {}),
    },
  }
}

const FULL_CONTEXT: ChunkContext = {
  insurerName: 'Bradesco Seguros',
  productName: 'Vida Viva',
  productUnresolved: true,
  sourceType: 'conditions_pdf',
}

const DEFAULT_OPTS = {
  minChunkChars: 300,
  maxChunkChars: 1500,
  contentTrivialChars: 5,
  minConfidence: 0.85,
  allowedSourceTypes: ['conditions_pdf'] as const,
}

function runGateUnitTests(): void {
  console.log('\n## gate predicates')

  // G-content
  ok('G-content: empty content fails', checkContent(makeChunk({ content: '   ' }), DEFAULT_OPTS) !== null)
  ok('G-content: 2-char trivial fails', checkContent(makeChunk({ content: 'ok' }), DEFAULT_OPTS) !== null)
  ok('G-content: normal body passes', checkContent(makeChunk({ content: 'A'.repeat(50) }), DEFAULT_OPTS) === null)

  // G-boundary
  ok('G-boundary: 299 chars fails', checkBoundary(makeChunk({ content: 'A'.repeat(299) }), DEFAULT_OPTS) !== null)
  ok('G-boundary: 300 chars passes', checkBoundary(makeChunk({ content: 'A'.repeat(300) }), DEFAULT_OPTS) === null)
  ok('G-boundary: 1500 chars passes', checkBoundary(makeChunk({ content: 'A'.repeat(1500) }), DEFAULT_OPTS) === null)
  ok('G-boundary: 1501 chars fails', checkBoundary(makeChunk({ content: 'A'.repeat(1501) }), DEFAULT_OPTS) !== null)

  // G-page
  ok('G-page: page 0 fails', checkPage(makeChunk({ metadata: { chunk_index: 0, page: 0, parser: SEMANTIC_CHUNKER_PARSER, source_offset_start: 0, source_offset_end: 1 } })) !== null)
  ok('G-page: page 1 passes', checkPage(makeChunk({ metadata: { chunk_index: 0, page: 1, parser: SEMANTIC_CHUNKER_PARSER, source_offset_start: 0, source_offset_end: 1 } })) === null)

  // G-insurer
  ok('G-insurer: empty context fails', checkInsurer({}) !== null)
  ok('G-insurer: insurerId only passes', checkInsurer({ insurerId: 'abc' }) === null)
  ok('G-insurer: insurerName only passes', checkInsurer({ insurerName: 'Bradesco' }) === null)

  // G-product
  ok('G-product: silent NULL fails', checkProduct({}) !== null)
  ok('G-product: productId set passes', checkProduct({ productId: 'p1' }) === null)
  ok('G-product: productUnresolved=true passes', checkProduct({ productUnresolved: true }) === null)

  // G-confidence
  ok('G-confidence: 0.5 fails', checkConfidence(makeChunk({ metadata: { chunk_index: 0, page: 1, parser: SEMANTIC_CHUNKER_PARSER, source_offset_start: 0, source_offset_end: 1, confidence: 0.5 } }), DEFAULT_OPTS) !== null)
  ok('G-confidence: 0.9 passes', checkConfidence(makeChunk({ metadata: { chunk_index: 0, page: 1, parser: SEMANTIC_CHUNKER_PARSER, source_offset_start: 0, source_offset_end: 1, confidence: 0.9 } }), DEFAULT_OPTS) === null)
  ok('G-confidence: undefined passes (no word data ≠ bad)', checkConfidence(makeChunk(), DEFAULT_OPTS) === null)

  // G-type
  ok('G-type: missing sourceType fails', checkType({}, DEFAULT_OPTS) !== null)
  ok('G-type: conditions_pdf passes', checkType({ sourceType: 'conditions_pdf' }, DEFAULT_OPTS) === null)
  ok('G-type: rate_table_pdf fails for this slice', checkType({ sourceType: 'rate_table_pdf' }, DEFAULT_OPTS) !== null)

  // G-dedup
  const seen = new Set<string>(['hash-A'])
  ok('G-dedup: new hash passes', checkDedup(makeChunk({ content_hash: 'hash-B' }), seen) === null)
  ok('G-dedup: seen hash fails', checkDedup(makeChunk({ content_hash: 'hash-A' }), seen) !== null)
}

function runBatchUnitTests(): void {
  console.log('\n## batch runner')

  // Happy path: 2 chunks fully contextualized, both accept.
  {
    const inputs: GateInput[] = [
      { chunk: makeChunk({ content: 'A'.repeat(800), content_hash: 'h1' }), context: FULL_CONTEXT },
      { chunk: makeChunk({ content: 'B'.repeat(800), content_hash: 'h2' }), context: FULL_CONTEXT },
    ]
    const report = runChunkGates(inputs)
    ok('happy path: both accepted', report.totals.accepted === 2 && report.totals.quarantined === 0)
    ok('happy path: G-boundary tallied 2 passes', report.byGate['G-boundary'].passed === 2)
  }

  // Multi-gate failure: under-300 + missing insurer.
  {
    const report = runChunkGates([
      { chunk: makeChunk({ content: 'tiny' }), context: { sourceType: 'conditions_pdf' } },
    ])
    ok('multi-fail: quarantined', report.totals.quarantined === 1)
    const reasons = report.quarantined[0].reasons.map((r) => r.gate)
    ok('multi-fail: reasons include G-content', reasons.includes('G-content'))
    ok('multi-fail: reasons include G-boundary', reasons.includes('G-boundary'))
    ok('multi-fail: reasons include G-insurer', reasons.includes('G-insurer'))
    ok('multi-fail: reasons include G-product', reasons.includes('G-product'))
  }

  // Dedup: 3 chunks with same hash → 1 accepts, 2 quarantine.
  {
    const c1: SemanticChunk = makeChunk({ content: 'A'.repeat(800), content_hash: 'dup' })
    const c2: SemanticChunk = makeChunk({ content: 'A'.repeat(800), content_hash: 'dup' })
    const c3: SemanticChunk = makeChunk({ content: 'A'.repeat(800), content_hash: 'dup' })
    const report = runChunkGates([
      { chunk: c1, context: FULL_CONTEXT },
      { chunk: c2, context: FULL_CONTEXT },
      { chunk: c3, context: FULL_CONTEXT },
    ])
    ok('dedup: 1 accepted, 2 quarantined', report.totals.accepted === 1 && report.totals.quarantined === 2)
    const allFromDedup = report.quarantined.every((q) => q.reasons.some((r) => r.gate === 'G-dedup'))
    ok('dedup: both quarantines cite G-dedup', allFromDedup)
  }

  // Dedup is not poisoned by a chunk that fails OTHER gates first.
  {
    const tiny: SemanticChunk = makeChunk({ content: 'tiny', content_hash: 'shared' })
    const big: SemanticChunk = makeChunk({ content: 'A'.repeat(800), content_hash: 'shared' })
    const report = runChunkGates([
      { chunk: tiny, context: FULL_CONTEXT }, // fails G-content + G-boundary; hash NOT added to seen
      { chunk: big, context: FULL_CONTEXT }, // should accept — first one didn't enter seen
    ])
    ok(
      'dedup not poisoned by upstream failure',
      report.totals.accepted === 1 && report.totals.quarantined === 1
    )
  }
}

function runFixtureIntegration(
  name: string,
  context: ChunkContext,
  expected: {
    inputs: number
    accepted: number
    quarantined: number
    quarantinedReasons: { chunkIndex: number; mustInclude: GateId[] }[]
  }
): void {
  console.log(`\n## fixture ${name}`)
  const fixture = loadFixture(name)
  const chunks = chunkLayoutResult(fixture)
  const inputs: GateInput[] = chunks.map((chunk) => ({ chunk, context }))
  const report = runChunkGates(inputs)

  ok(
    `inputs=${expected.inputs} accepted=${expected.accepted} quarantined=${expected.quarantined}`,
    report.totals.input === expected.inputs &&
      report.totals.accepted === expected.accepted &&
      report.totals.quarantined === expected.quarantined,
    `actual ${report.totals.input}/${report.totals.accepted}/${report.totals.quarantined}`
  )

  for (const expect of expected.quarantinedReasons) {
    const q = report.quarantined.find((x) => x.chunk.metadata.chunk_index === expect.chunkIndex)
    ok(`chunk ${expect.chunkIndex} is quarantined`, q !== undefined)
    if (q) {
      const gates = new Set(q.reasons.map((r) => r.gate))
      for (const required of expect.mustInclude) {
        ok(
          `chunk ${expect.chunkIndex} reasons include ${required}`,
          gates.has(required),
          gates.size > 0 ? `got ${[...gates].join(',')}` : 'no reasons'
        )
      }
    }
  }

  // Sanity: GATE_IDS order matches the byGate keys in the report.
  ok(
    'byGate covers all 8 gate IDs',
    GATE_IDS.every((id) => report.byGate[id] !== undefined)
  )

  // formatGateReport produces a non-empty summary.
  const summary = formatGateReport(report)
  ok('formatGateReport returns text', summary.includes('chunks:') && summary.length > 50)
}

function main(): void {
  console.log('# azure-di chunk-gate test')

  runGateUnitTests()
  runBatchUnitTests()

  // Bradesco fixture: 7 chunks → 5 accepted, 2 quarantined (chunks 1 at 266 chars and 6 at 251 chars).
  runFixtureIntegration(
    'bradesco-vida-viva-p4-8',
    {
      insurerName: 'Bradesco Seguros',
      productName: 'Vida Viva',
      productUnresolved: true,
      sourceType: 'conditions_pdf',
    },
    {
      inputs: 7,
      accepted: 5,
      quarantined: 2,
      quarantinedReasons: [
        { chunkIndex: 1, mustInclude: ['G-boundary'] },
        { chunkIndex: 6, mustInclude: ['G-boundary'] },
      ],
    }
  )

  // Prudential fixture: 7 chunks → 5 accepted, 2 quarantined (chunk 0 at 10 chars and chunk 3 at 211 chars).
  runFixtureIntegration(
    'prudential-ap-passageiros-p1-3',
    {
      insurerName: 'Prudential do Brasil',
      productName: 'Acidentes Pessoais Passageiros',
      productUnresolved: true,
      sourceType: 'conditions_pdf',
    },
    {
      inputs: 7,
      accepted: 5,
      quarantined: 2,
      quarantinedReasons: [
        // Chunk 0 is 10 chars: under the boundary floor but above the
        // contentTrivialChars=5 threshold, so only G-boundary fails.
        { chunkIndex: 0, mustInclude: ['G-boundary'] },
        { chunkIndex: 3, mustInclude: ['G-boundary'] },
      ],
    }
  )

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
