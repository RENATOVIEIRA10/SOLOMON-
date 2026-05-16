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
  // Success path: post == accepted, no leak.
  ok('pre=0, post=accepted, leak=0 → FRESH', classifyWriteStatus(0, 5, 5, 0) === 'FRESH')
  ok(
    'pre=accepted, post=accepted, leak=0 → IDEMPOTENT_HIT',
    classifyWriteStatus(5, 5, 5, 0) === 'IDEMPOTENT_HIT'
  )
  ok(
    'pre=3, accepted=5, post=5, leak=0 → OVERWRITE',
    classifyWriteStatus(3, 5, 5, 0) === 'OVERWRITE'
  )
  ok(
    'accepted=0, post=0 (empty pipeline vacuum) → FRESH',
    classifyWriteStatus(0, 0, 0, 0) === 'FRESH'
  )

  // ORPHAN_SUPERSET: post > accepted, leak=0 (benign).
  ok(
    'pre=0, accepted=4, post=6, leak=0 → ORPHAN_SUPERSET (the vida-e-saude case)',
    classifyWriteStatus(0, 4, 6, 0) === 'ORPHAN_SUPERSET'
  )
  ok(
    'pre=4, accepted=4, post=6, leak=0 → ORPHAN_SUPERSET (idempotent intersection with orphan superset)',
    classifyWriteStatus(4, 4, 6, 0) === 'ORPHAN_SUPERSET'
  )

  // WRITE_ERROR: post < accepted.
  ok('post < accepted → WRITE_ERROR', classifyWriteStatus(0, 5, 4, 0) === 'WRITE_ERROR')
  ok(
    'pre=2, accepted=5, post=4 → WRITE_ERROR',
    classifyWriteStatus(2, 5, 4, 0) === 'WRITE_ERROR'
  )

  // WRITE_ERROR: leak > 0 overrides every other classification (catastrophic).
  ok(
    'leak>0, post=accepted → WRITE_ERROR (leak overrides)',
    classifyWriteStatus(0, 5, 5, 1) === 'WRITE_ERROR'
  )
  ok(
    'leak>0, post>accepted → WRITE_ERROR (leak overrides ORPHAN_SUPERSET)',
    classifyWriteStatus(0, 4, 6, 2) === 'WRITE_ERROR'
  )

  // Backward-compat: default leak=0 still works for callers that omit it.
  ok('signature default leak=0 → FRESH', classifyWriteStatus(0, 5, 5) === 'FRESH')
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
    // ORPHAN_SUPERSET: benign — write was clean (post>=accepted), but DB has
    // extra inert v4 rows from a previous run at a different page span.
    // Mirrors the vida-e-saude case discovered in the first --batch --limit 5 run.
    makeDoc({
      sourceUrl: 'https://x/8',
      legacyChunkCount: 248,
      status: 'ORPHAN_SUPERSET',
      pages: 5,
      chunks: 6,
      accepted: 4,
      quarantined: 2,
      resolved: false,
      unresolvedReason: 'fuzzy_below_threshold',
      preShadowCount: 2,
      upsertedCount: 6,
      extraInertShadowRows: 2,
      shadowLeak: 0,
      activeLegacyProd: 248,
    }),
  ]

  const a = tallyAggregate(results)

  ok('docsPlanned = total entries', a.docsPlanned === results.length)
  ok('docsSkippedResume = 1', a.docsSkippedResume === 1)
  ok('docsRan excludes PLANNED and SKIPPED_RESUME', a.docsRan === 6, `got ${a.docsRan}`)
  ok('docsFresh = 1', a.docsFresh === 1)
  ok('docsIdempotent = 1', a.docsIdempotent === 1)
  ok('docsOverwrite = 1', a.docsOverwrite === 1)
  ok('docsOrphanSuperset = 1', a.docsOrphanSuperset === 1)
  ok('docsAzureError = 1', a.docsAzureError === 1)
  ok('docsWriteError = 1', a.docsWriteError === 1)
  ok('docsUnresolved = 2 (overwrite + orphan_superset rows have resolved=false)', a.docsUnresolved === 2)
  ok('totalPages = 5+3+4+5+5 = 22', a.totalPages === 22, `got ${a.totalPages}`)
  ok('totalChunks = 6+5+4+4+6 = 25', a.totalChunks === 25)
  ok('totalAccepted = 4+5+3+4+4 = 20', a.totalAccepted === 20)
  ok('totalQuarantined = 2+0+1+0+2 = 5', a.totalQuarantined === 5)
  ok('totalShadowUpserted = 4+5+3+0+6 = 18', a.totalShadowUpserted === 18)
  ok('totalShadowLeaks = 0', a.totalShadowLeaks === 0)
  ok('totalExtraInertShadow = 0+...+2 = 2', a.totalExtraInertShadow === 2)
  const expectedCost = Math.round(22 * AZURE_DI_LAYOUT_S0_USD_PER_PAGE_ESTIMATE * 100) / 100
  ok(`estimatedCostUsd = ${expectedCost}`, a.estimatedCostUsd === expectedCost)

  // Counter disjointness: every "ran" doc lands in exactly one of the 6
  // result buckets.
  const ranBuckets =
    a.docsFresh +
    a.docsIdempotent +
    a.docsOverwrite +
    a.docsOrphanSuperset +
    a.docsAzureError +
    a.docsWriteError
  ok('disjoint result buckets equal docsRan', ranBuckets === a.docsRan)
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
  ok('renders new per-doc column accepted_current_run', md.includes('accepted_current_run'))
  ok('renders new per-doc column v4_sentinel_rows_for_url', md.includes('v4_sentinel_rows_for_url'))
  ok('renders new per-doc column extra_inert', md.includes('extra_inert'))
  ok('renders new aggregate counter docs ORPHAN_SUPERSET', md.includes('docs ORPHAN_SUPERSET'))
  ok(
    'renders new aggregate counter total extra inert shadow',
    md.includes('total extra inert shadow')
  )
}

function runRenderOrphanSupersetSectionTest(): void {
  console.log('\n## renderBatchReport (ORPHAN_SUPERSET section)')
  const results: DocResult[] = [
    makeDoc({
      sourceUrl: 'https://prudential.com.br/vida-e-saude.pdf',
      legacyChunkCount: 248,
      status: 'ORPHAN_SUPERSET',
      pages: 5,
      chunks: 6,
      accepted: 4,
      quarantined: 2,
      resolved: false,
      unresolvedReason: 'fuzzy_below_threshold',
      preShadowCount: 2,
      upsertedCount: 6,
      extraInertShadowRows: 2,
      shadowLeak: 0,
      activeLegacyProd: 248,
    }),
  ]
  const md = renderBatchReport({
    generatedAt: '2026-05-16T00:00:00.000Z',
    mode: 'live-write',
    insurer: { id: 'iid', name: 'Prudential do Brasil' },
    catalogSize: 12,
    preflights: [],
    endpointMasked: 'https://***.cognitiveservices.azure.com',
    pageSpan: '1-5',
    minChunks: 5,
    resume: false,
    manifest: [{ source_url: results[0].sourceUrl, legacy_chunk_count: 248 }],
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
  ok('renders ORPHAN_SUPERSET in per-doc table', md.includes('| ORPHAN_SUPERSET |'))
  ok('renders ORPHAN_SUPERSET notes header', md.includes('### ORPHAN_SUPERSET notes'))
  ok('notes explain benign nature', md.includes('Benign'))
  ok('notes explain page-span cause', md.includes('--max-pages'))
  ok('notes point at metadata.page_span', md.includes('metadata.page_span'))
  ok('notes list the affected URL', md.includes('vida-e-saude.pdf'))
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
  runRenderOrphanSupersetSectionTest()
  runRenderSkippedProbeTest()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
