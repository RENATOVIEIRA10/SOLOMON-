/**
 * Phase 2 / PR 3B slice 3B.5 — batch-mode pure-helper tests.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 *
 * Covers the pure helpers in `src/services/azure-di/shadow-indexer-batch.ts`:
 *   - classifyWriteStatus (4 status paths)
 *   - tallyAggregate (status disjointness, sum invariants, cost arithmetic)
 *   - renderBatchReport (smoke: contains the inputs verbatim where it matters)
 *
 * I/O helpers (discoverPrudentialManifest, processOneDocument,
 * runFinalReadPathProbe) live in the CLI and are validated end-to-end on
 * the VPS via --batch --dry-run + --batch --live --write, not here.
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow-indexer:batch:test
 */

import {
  AZURE_DI_LAYOUT_S0_USD_PER_PAGE_ESTIMATE,
  classifyWriteStatus,
  emptyAggregate,
  renderBatchReport,
  tallyAggregate,
  type DocResult,
} from '../../src/services/azure-di/shadow-indexer-batch'

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

function runClassifyTests(): void {
  console.log('\n## classifyWriteStatus')
  ok('pre=0, post=accepted → FRESH', classifyWriteStatus(0, 5, 5) === 'FRESH')
  ok(
    'pre=accepted, post=accepted → IDEMPOTENT_HIT',
    classifyWriteStatus(5, 5, 5) === 'IDEMPOTENT_HIT'
  )
  ok('pre=3, accepted=5, post=5 → OVERWRITE', classifyWriteStatus(3, 5, 5) === 'OVERWRITE')
  ok('post ≠ accepted → WRITE_ERROR', classifyWriteStatus(0, 5, 4) === 'WRITE_ERROR')
  ok('pre=2, accepted=5, post=4 → WRITE_ERROR', classifyWriteStatus(2, 5, 4) === 'WRITE_ERROR')
  ok('accepted=0, post=0 (empty pipeline, idempotent vacuum)', classifyWriteStatus(0, 0, 0) === 'FRESH')
}

function makeDoc(overrides: Partial<DocResult>): DocResult {
  return {
    sourceUrl: 'https://example.com/x.pdf',
    legacyChunkCount: 0,
    status: 'PLANNED',
    ...overrides,
  }
}

function runEmptyAggregateTest(): void {
  console.log('\n## emptyAggregate')
  const a = emptyAggregate()
  ok(
    'all counters start at 0',
    Object.values(a).every((v) => v === 0)
  )
}

function runTallyTests(): void {
  console.log('\n## tallyAggregate')

  // Empty input
  {
    const a = tallyAggregate([])
    ok('empty input → all zeros', a.docsPlanned === 0 && a.totalShadowLeaks === 0)
  }

  // Mixed batch covering every status disjointly
  const results: DocResult[] = [
    makeDoc({
      sourceUrl: 'https://x/1',
      legacyChunkCount: 100,
      status: 'FRESH',
      pages: 5,
      chunks: 6,
      accepted: 4,
      quarantined: 2,
      resolved: true,
      productId: 'p1',
      productName: 'VIDA INTEIRA',
      preShadowCount: 0,
      upsertedCount: 4,
      shadowLeak: 0,
      activeLegacyProd: 100,
    }),
    makeDoc({
      sourceUrl: 'https://x/2',
      legacyChunkCount: 80,
      status: 'IDEMPOTENT_HIT',
      pages: 3,
      chunks: 5,
      accepted: 5,
      quarantined: 0,
      resolved: true,
      productId: 'p2',
      productName: 'TEMPORARIO',
      preShadowCount: 5,
      upsertedCount: 5,
      shadowLeak: 0,
      activeLegacyProd: 80,
    }),
    makeDoc({
      sourceUrl: 'https://x/3',
      legacyChunkCount: 60,
      status: 'OVERWRITE',
      pages: 4,
      chunks: 4,
      accepted: 3,
      quarantined: 1,
      resolved: false,
      unresolvedReason: 'fuzzy_below_threshold',
      preShadowCount: 2,
      upsertedCount: 3,
      shadowLeak: 0,
      activeLegacyProd: 60,
    }),
    makeDoc({
      sourceUrl: 'https://x/4',
      legacyChunkCount: 40,
      status: 'SKIPPED_RESUME',
      preShadowCount: 5,
    }),
    makeDoc({
      sourceUrl: 'https://x/5',
      legacyChunkCount: 20,
      status: 'AZURE_ERROR',
      errorMessage: 'fake timeout',
    }),
    makeDoc({
      sourceUrl: 'https://x/6',
      legacyChunkCount: 15,
      status: 'WRITE_ERROR',
      pages: 5,
      chunks: 4,
      accepted: 4,
      quarantined: 0,
      resolved: true,
      productId: 'p3',
      productName: 'AP',
      preShadowCount: 0,
      upsertedCount: 0,
      errorMessage: 'fake upsert failure',
    }),
    makeDoc({
      sourceUrl: 'https://x/7',
      legacyChunkCount: 10,
      status: 'PLANNED', // dry-run placeholder
    }),
  ]

  const a = tallyAggregate(results)

  ok('docsPlanned = total entries', a.docsPlanned === results.length)
  ok('docsSkippedResume = 1', a.docsSkippedResume === 1)
  ok('docsRan excludes PLANNED and SKIPPED_RESUME', a.docsRan === 5, `got ${a.docsRan}`)
  ok('docsFresh = 1', a.docsFresh === 1)
  ok('docsIdempotent = 1', a.docsIdempotent === 1)
  ok('docsOverwrite = 1', a.docsOverwrite === 1)
  ok('docsAzureError = 1', a.docsAzureError === 1)
  ok('docsWriteError = 1', a.docsWriteError === 1)
  ok('docsUnresolved = 1 (only doc with resolved=false)', a.docsUnresolved === 1)
  ok('totalPages = 5+3+4+5 = 17', a.totalPages === 17, `got ${a.totalPages}`)
  ok('totalChunks = 6+5+4+4 = 19', a.totalChunks === 19)
  ok('totalAccepted = 4+5+3+4 = 16', a.totalAccepted === 16)
  ok('totalQuarantined = 2+0+1+0 = 3', a.totalQuarantined === 3)
  ok('totalShadowUpserted = 4+5+3+0 = 12', a.totalShadowUpserted === 12)
  ok('totalShadowLeaks = 0+0+0 = 0', a.totalShadowLeaks === 0)
  const expectedCost = Math.round(17 * AZURE_DI_LAYOUT_S0_USD_PER_PAGE_ESTIMATE * 100) / 100
  ok(`estimatedCostUsd = ${expectedCost}`, a.estimatedCostUsd === expectedCost)

  // Counter disjointness: FRESH + IDEMPOTENT + OVERWRITE + AZURE_ERROR + WRITE_ERROR + SKIPPED + PLANNED == docsPlanned
  const buckets =
    a.docsFresh +
    a.docsIdempotent +
    a.docsOverwrite +
    a.docsAzureError +
    a.docsWriteError +
    a.docsSkippedResume
  // PLANNED is the only category not summed above; in this fixture there's 1 PLANNED row.
  ok('disjoint buckets cover docsRan + skipped', buckets === a.docsRan + a.docsSkippedResume)
}

function runTallyLeakTest(): void {
  console.log('\n## tallyAggregate (leak detection)')
  const results: DocResult[] = [
    makeDoc({ status: 'FRESH', pages: 3, accepted: 5, upsertedCount: 5, shadowLeak: 0 }),
    makeDoc({ status: 'FRESH', pages: 3, accepted: 5, upsertedCount: 5, shadowLeak: 7 }), // simulated leak
  ]
  const a = tallyAggregate(results)
  ok('totalShadowLeaks sums leaks across docs', a.totalShadowLeaks === 7)
}

function runRenderSmokeTest(): void {
  console.log('\n## renderBatchReport (smoke)')
  const results: DocResult[] = [
    makeDoc({
      sourceUrl: 'https://prudential.com.br/condicoes-gerais-x.pdf',
      legacyChunkCount: 50,
      status: 'FRESH',
      pages: 5,
      chunks: 6,
      accepted: 4,
      quarantined: 2,
      resolved: true,
      productName: 'VIDA INTEIRA',
      upsertedCount: 4,
      shadowLeak: 0,
      activeLegacyProd: 50,
    }),
  ]
  const md = renderBatchReport({
    generatedAt: '2026-05-15T00:00:00.000Z',
    mode: 'live-write',
    insurer: { id: 'iid', name: 'Prudential do Brasil' },
    catalogSize: 12,
    preflights: [{ ok: true, label: 'check-a', detail: 'detail-a' }],
    endpointMasked: 'https://***.cognitiveservices.azure.com',
    pageSpan: '1-5',
    minChunks: 5,
    limit: 22,
    resume: true,
    manifest: [{ source_url: 'https://prudential.com.br/condicoes-gerais-x.pdf', legacy_chunk_count: 50 }],
    results,
    aggregate: tallyAggregate(results),
    finalProbe: {
      threshold: 0.0,
      topK: 50,
      totalReturned: 40,
      shadowReturned: 0,
      nonNullValidUntilReturned: 0,
    },
  })
  ok('header references slice 3B.5', md.includes('PR 3B slice 3B.5'))
  ok('renders insurer name', md.includes('Prudential do Brasil'))
  ok('renders mode in header', md.includes('(live-write)'))
  ok('renders product name in per-doc row', md.includes('VIDA INTEIRA'))
  ok('renders manifest size summary', md.includes('Discovered 1 Prudential URL'))
  ok('renders min-chunks input', md.includes('min-chunks filter: 5'))
  ok('renders limit input', md.includes('limit: 22'))
  ok('renders resume flag', md.includes('resume: yes'))
  ok('renders shadow leak count', md.includes('total shadow leaks'))
  ok('renders MUST be 0 callout for probe', md.includes('MUST be 0'))
  ok('renders estimated cost line', md.includes('estimated Azure cost'))
  ok('renders FRESH status', md.includes('| FRESH |'))
}

function runRenderSkippedProbeTest(): void {
  console.log('\n## renderBatchReport (probe skipped)')
  const md = renderBatchReport({
    generatedAt: '2026-05-15T00:00:00.000Z',
    mode: 'live-write',
    insurer: { id: 'iid', name: 'Prudential do Brasil' },
    catalogSize: 12,
    preflights: [],
    endpointMasked: '(missing)',
    pageSpan: '1-3',
    minChunks: 5,
    resume: false,
    manifest: [],
    results: [],
    aggregate: tallyAggregate([]),
    finalProbe: {
      threshold: 0.0,
      topK: 50,
      totalReturned: 0,
      shadowReturned: 0,
      nonNullValidUntilReturned: 0,
      skipped: 'no active embedding available to probe with',
    },
  })
  ok(
    'shows skipped reason verbatim',
    md.includes('Probe skipped: no active embedding available to probe with')
  )
}

function main(): void {
  console.log('# azure-di shadow-indexer batch helpers test')
  runClassifyTests()
  runEmptyAggregateTest()
  runTallyTests()
  runTallyLeakTest()
  runRenderSmokeTest()
  runRenderSkippedProbeTest()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
