/**
 * corpus-routing loader test.
 *
 * The AND-gate (env allowlist + corpus_routing row) shipped in 3C-a/b but the
 * DB half was never loaded by any caller — so flipping a row could not route
 * anything. These tests pin the loader that closes the gap:
 *   - rows → map (unknown modes dropped, never widened);
 *   - fail-open to EMPTY map (= legacy) on any error;
 *   - end-to-end through chooseRetrievalCorpus: env + row = shadow,
 *     either half missing = legacy.
 *
 * Standalone tsx, exit code 0/1. No network, no DB (fake client only).
 *
 * Run from app/:
 *   npm run phase2:corpus-routing-loader:test
 */

import {
  loadCorpusRoutingMap,
  routingRowsToMap,
  _resetCorpusRoutingCache,
} from '../../src/services/rag/corpus-routing-loader'
import { chooseRetrievalCorpus } from '../../src/config/corpus-routing'

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

function fakeClient(rows: Array<{ insurer_name: string; mode: string }> | null, errorMsg?: string) {
  return {
    from: (_table: 'corpus_routing') => ({
      select: (_cols: string) =>
        Promise.resolve({ data: rows, error: errorMsg ? { message: errorMsg } : null }),
    }),
  }
}

async function main(): Promise<void> {
  console.log('# corpus-routing loader test')

  console.log('\n## routingRowsToMap (pure)')
  const map = routingRowsToMap([
    { insurer_name: 'MAG', mode: 'shadow' },
    { insurer_name: 'Prudential', mode: 'legacy' },
    { insurer_name: 'Azos', mode: 'banana' },
    { insurer_name: '', mode: 'shadow' },
  ])
  ok('maps shadow row', map.get('MAG') === 'shadow')
  ok('maps legacy row', map.get('Prudential') === 'legacy')
  ok('drops unknown mode (never widened)', !map.has('Azos'))
  ok('drops empty insurer name', map.size === 2)

  console.log('\n## loadCorpusRoutingMap (fail-open)')
  _resetCorpusRoutingCache()
  const loaded = await loadCorpusRoutingMap({ client: fakeClient([{ insurer_name: 'MetLife', mode: 'shadow' }]) })
  ok('loads rows through the client', loaded.get('MetLife') === 'shadow')

  const failedLoad = await loadCorpusRoutingMap({ client: fakeClient(null, 'boom') })
  ok('DB error degrades to EMPTY map (legacy), never throws', failedLoad.size === 0)

  const thrown = await loadCorpusRoutingMap({
    client: { from: () => ({ select: () => Promise.reject(new Error('down')) }) } as never,
  })
  ok('client exception also degrades to empty map', thrown.size === 0)

  console.log('\n## AND-gate end-to-end (chooseRetrievalCorpus)')
  const envAllow = new Set(['MAG'])
  const dbShadow = routingRowsToMap([{ insurer_name: 'MAG', mode: 'shadow' }])

  ok(
    'env + db row => shadow',
    chooseRetrievalCorpus({ insurerNames: ['MAG'], envAllowlist: envAllow, dbRouting: dbShadow }) === 'shadow',
  )
  ok(
    'env sem db row => legacy (metade do gate)',
    chooseRetrievalCorpus({ insurerNames: ['MAG'], envAllowlist: envAllow, dbRouting: new Map() }) === 'legacy',
  )
  ok(
    'db row sem env => legacy (outra metade)',
    chooseRetrievalCorpus({ insurerNames: ['MAG'], envAllowlist: new Set(), dbRouting: dbShadow }) === 'legacy',
  )
  ok(
    'multi-insurer => legacy mesmo com tudo ligado',
    chooseRetrievalCorpus({ insurerNames: ['MAG', 'Azos'], envAllowlist: envAllow, dbRouting: dbShadow }) === 'legacy',
  )

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
