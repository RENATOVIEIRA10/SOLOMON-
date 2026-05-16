/**
 * Phase 2 / PR 3B slice 3B.6.1 — shadow-embedder pure-helper tests.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no OpenAI call.
 *
 * Covers:
 *   - estimateTokens / estimateCostUsd
 *   - formatEmbeddingVector
 *   - summarizeCost
 *   - assertEmbeddingTargetIsShadow positive + 7 negative paths
 *
 * I/O helpers (snapshotCounts, fetchEligibleRows, updateEmbeddingForRow)
 * live in the CLI and are validated end-to-end on the VPS smoke run.
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow-embedder:test
 */

import { SEMANTIC_CHUNKER_PARSER } from '../../src/services/azure-di/chunker'
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_USD_PER_MILLION_TOKENS,
  assertEmbeddingTargetIsShadow,
  estimateCostUsd,
  estimateTokens,
  formatEmbeddingVector,
  summarizeCost,
  type EmbeddingTargetRow,
} from '../../src/services/azure-di/shadow-embedder'
import {
  SHADOW_HASH_PREFIX,
  SHADOW_HASH_SCHEME,
  SHADOW_VALID_UNTIL_SENTINEL,
} from '../../src/services/azure-di/shadow-indexer'

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

function throwsAny(fn: () => void): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

function runConstantsTest(): void {
  console.log('\n## constants')
  ok('model is text-embedding-3-small', EMBEDDING_MODEL === 'text-embedding-3-small')
  ok('dimensions is 1536', EMBEDDING_DIMENSIONS === 1536)
  ok('USD per million tokens is 0.02', EMBEDDING_USD_PER_MILLION_TOKENS === 0.02)
}

function runEstimateTokensTest(): void {
  console.log('\n## estimateTokens')
  ok('empty string → 0', estimateTokens('') === 0)
  ok('1 char → 1 token (ceil)', estimateTokens('A') === 1)
  ok('4 chars → 1 token', estimateTokens('ABCD') === 1)
  ok('5 chars → 2 tokens (ceil)', estimateTokens('ABCDE') === 2)
  ok('400 chars → 100 tokens', estimateTokens('A'.repeat(400)) === 100)
}

function runEstimateCostTest(): void {
  console.log('\n## estimateCostUsd')
  ok('0 tokens → $0', estimateCostUsd(0) === 0)
  ok(
    '1M tokens → $0.02',
    Math.abs(estimateCostUsd(1_000_000) - 0.02) < 1e-9,
    `got ${estimateCostUsd(1_000_000)}`
  )
  ok(
    '500k tokens → $0.01',
    Math.abs(estimateCostUsd(500_000) - 0.01) < 1e-9
  )
  ok('cost is monotonic', estimateCostUsd(100) < estimateCostUsd(1000))
}

function runFormatVectorTest(): void {
  console.log('\n## formatEmbeddingVector')
  ok('empty array → "[]"', formatEmbeddingVector([]) === '[]')
  ok('single value → "[0.1]"', formatEmbeddingVector([0.1]) === '[0.1]')
  ok(
    'three values → "[0.1,0.2,0.3]"',
    formatEmbeddingVector([0.1, 0.2, 0.3]) === '[0.1,0.2,0.3]'
  )
  ok(
    'negative values preserved',
    formatEmbeddingVector([-0.5, 0.5]) === '[-0.5,0.5]'
  )
}

function runSummarizeCostTest(): void {
  console.log('\n## summarizeCost')
  const empty = summarizeCost([])
  ok(
    'empty: rowCount=0 tokens=0 cost=0',
    empty.rowCount === 0 && empty.totalTokens === 0 && empty.estimatedCostUsd === 0
  )

  const single = summarizeCost(['A'.repeat(400)])
  ok(
    'single 400-char text: 100 tokens',
    single.rowCount === 1 && single.totalTokens === 100
  )

  const multi = summarizeCost(['A'.repeat(400), 'B'.repeat(800)])
  ok(
    'multi: tokens summed across texts',
    multi.rowCount === 2 && multi.totalTokens === 300,
    `got tokens=${multi.totalTokens}`
  )
}

function makeShadowRow(overrides: Partial<EmbeddingTargetRow> = {}): EmbeddingTargetRow {
  return {
    id: 'row-uuid',
    content: 'some clause content with enough length',
    content_hash: `${SHADOW_HASH_PREFIX}deadbeef`,
    valid_until: SHADOW_VALID_UNTIL_SENTINEL,
    embedding: null,
    metadata: {
      shadow: true,
      parser: SEMANTIC_CHUNKER_PARSER,
      hash_scheme: SHADOW_HASH_SCHEME,
    },
    ...overrides,
  }
}

function runAssertTargetTests(): void {
  console.log('\n## assertEmbeddingTargetIsShadow')

  // Positive path
  ok(
    'passes a well-formed shadow row',
    !throwsAny(() => assertEmbeddingTargetIsShadow(makeShadowRow()))
  )

  // Negative paths — every contract bit independently rejects.
  ok(
    'rejects embedding IS NOT NULL (idempotency)',
    throwsAny(() => assertEmbeddingTargetIsShadow(makeShadowRow({ embedding: '[0.1]' })))
  )
  ok(
    'rejects valid_until = NULL (would-be-promoted)',
    throwsAny(() => assertEmbeddingTargetIsShadow(makeShadowRow({ valid_until: null })))
  )
  ok(
    'rejects valid_until != sentinel',
    throwsAny(() =>
      assertEmbeddingTargetIsShadow(makeShadowRow({ valid_until: '2030-01-01T00:00:00Z' }))
    )
  )
  ok(
    'rejects content_hash missing shadow-v4 prefix',
    throwsAny(() =>
      assertEmbeddingTargetIsShadow(makeShadowRow({ content_hash: 'plain-hash-no-prefix' }))
    )
  )
  ok(
    'rejects metadata.shadow=false',
    throwsAny(() =>
      assertEmbeddingTargetIsShadow(
        makeShadowRow({ metadata: { shadow: false, parser: SEMANTIC_CHUNKER_PARSER, hash_scheme: SHADOW_HASH_SCHEME } })
      )
    )
  )
  ok(
    'rejects metadata.hash_scheme != url-aware-v1 (v3 orphan)',
    throwsAny(() =>
      assertEmbeddingTargetIsShadow(
        makeShadowRow({ metadata: { shadow: true, parser: SEMANTIC_CHUNKER_PARSER } })
      )
    )
  )
  ok(
    'rejects metadata.parser != azure-di-layout-v3',
    throwsAny(() =>
      assertEmbeddingTargetIsShadow(
        makeShadowRow({
          metadata: { shadow: true, parser: 'something-else', hash_scheme: SHADOW_HASH_SCHEME },
        })
      )
    )
  )
  ok(
    'rejects empty content',
    throwsAny(() => assertEmbeddingTargetIsShadow(makeShadowRow({ content: '' })))
  )
  ok(
    'rejects null metadata',
    throwsAny(() => assertEmbeddingTargetIsShadow(makeShadowRow({ metadata: null })))
  )
}

function main(): void {
  console.log('# azure-di shadow-embedder pure-helper test')
  runConstantsTest()
  runEstimateTokensTest()
  runEstimateCostTest()
  runFormatVectorTest()
  runSummarizeCostTest()
  runAssertTargetTests()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
