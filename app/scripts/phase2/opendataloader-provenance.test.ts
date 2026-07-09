/**
 * Shadow-row provenance test.
 *
 * A shadow row must say WHICH parser produced it. Without that, the corpus
 * cannot be compared (azure-di vs opendataloader), audited, or rolled back.
 *
 * Guarantees:
 *   1. default stamp is unchanged (`azure-di-layout-v3`) — no silent rewrite
 *      of the existing Azure DI corpus;
 *   2. the OpenDataLoader path can stamp `opendataloader-v1`;
 *   3. inertness asserts accept BOTH known parsers and still reject unknown
 *      ones — widening provenance must not become a hole.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 *
 * Run from app/:
 *   npm run phase2:odl:provenance:test
 */

import {
  assertRowsAreInert,
  buildShadowRows,
  SHADOW_ALLOWED_PARSERS,
} from '../../src/services/azure-di/shadow-indexer'
import { SEMANTIC_CHUNKER_PARSER } from '../../src/services/azure-di/chunker'
import { openDataLoaderToLayout, OPENDATALOADER_PARSER } from '../../src/services/opendataloader/adapter'
import { assertInsurerAllowed } from '../../src/services/opendataloader/guard'

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

function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

const layout = openDataLoaderToLayout({
  kids: [
    { type: 'heading', 'page number': 1, content: '1) OBJETIVO DO SEGURO' },
    { type: 'paragraph', 'page number': 1, content: 'B'.repeat(600) },
  ],
})

const base = {
  layout,
  insurerId: '11111111-1111-1111-1111-111111111111',
  sourceUrl: 'https://example.com/mag/condicoes-gerais.pdf',
  productCatalog: [],
}

function metaParser(row: { metadata: unknown }): string {
  return String((row.metadata as Record<string, unknown>).parser)
}

function main(): void {
  console.log('# opendataloader provenance test')

  console.log('\n## stamp')

  // 1. default is untouched — the Azure DI corpus keeps its stamp
  const prudential = buildShadowRows({ ...base, insurerName: 'Prudential do Brasil' })
  ok('default stamp stays azure-di-layout-v3', prudential.rows.every((r) => metaParser(r) === SEMANTIC_CHUNKER_PARSER))

  // 2. the OpenDataLoader path stamps its own provenance
  const mag = buildShadowRows({
    ...base,
    insurerName: 'MAG Seguros',
    assertInsurer: (n) => assertInsurerAllowed(n),
    parserStamp: OPENDATALOADER_PARSER,
  })
  ok('rows were built for MAG', mag.rows.length > 0, `rows=${mag.rows.length}`)
  ok(
    'opendataloader path stamps opendataloader-v1',
    mag.rows.every((r) => metaParser(r) === OPENDATALOADER_PARSER),
    metaParser(mag.rows[0] ?? { metadata: {} }),
  )

  console.log('\n## inertness asserts')

  // 3. both known parsers pass inertness
  ok('assertRowsAreInert accepts azure-di rows', !throws(() => assertRowsAreInert(prudential.rows)))
  ok('assertRowsAreInert accepts opendataloader rows', !throws(() => assertRowsAreInert(mag.rows)))

  // 4. an unknown parser is still refused (widening is not a hole)
  const forged = mag.rows.map((r) => ({
    ...r,
    metadata: { ...(r.metadata as Record<string, unknown>), parser: 'totally-unknown-parser' },
  }))
  ok('assertRowsAreInert refuses an unknown parser', throws(() => assertRowsAreInert(forged)))

  ok('allowed parsers are exactly the two known ones', SHADOW_ALLOWED_PARSERS.length === 2)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
