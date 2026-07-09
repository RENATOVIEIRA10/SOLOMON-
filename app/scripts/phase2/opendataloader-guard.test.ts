/**
 * OpenDataLoader insurer-scope guard test.
 *
 * Two things must hold at once:
 *   1. the OpenDataLoader path admits exactly the four commercial life
 *      insurers (Prudential, MAG, MetLife, Azos) and refuses everything else;
 *   2. the Azure DI path is UNCHANGED — `buildShadowRows` with no injected
 *      guard still refuses MAG/MetLife, exactly as before this feature.
 *
 * (2) is the regression that matters: widening scope for one pipeline must not
 * silently widen it for the other.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 *
 * Run from app/:
 *   npm run phase2:odl:guard:test
 */

import { buildShadowRows, ShadowIndexerGuardError } from '../../src/services/azure-di/shadow-indexer'
import { openDataLoaderToLayout } from '../../src/services/opendataloader/adapter'
import {
  assertInsurerAllowed,
  InsurerNotAllowedError,
  OPENDATALOADER_ALLOWED_INSURERS,
} from '../../src/services/opendataloader/guard'

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

function throwsOf(fn: () => unknown, Ctor: new (...args: never[]) => Error): boolean {
  try {
    fn()
    return false
  } catch (err) {
    return err instanceof Ctor
  }
}

function doesNotThrow(fn: () => unknown): boolean {
  try {
    fn()
    return true
  } catch {
    return false
  }
}

function runAllowlistTests(): void {
  console.log('\n## assertInsurerAllowed')

  for (const name of ['Prudential do Brasil', 'MAG Seguros', 'MetLife', 'Azos']) {
    ok(`allows "${name}"`, doesNotThrow(() => assertInsurerAllowed(name)))
  }

  for (const name of [
    'Bradesco Seguros',
    'Zurich',
    'Icatu Seguros',
    'Porto Seguro',
    'SulAmerica',
    'Caixa Vida e Previdencia',
    'Tokio Marine',
  ]) {
    ok(`refuses "${name}"`, throwsOf(() => assertInsurerAllowed(name), InsurerNotAllowedError))
  }

  ok('refuses an empty name', throwsOf(() => assertInsurerAllowed('   '), InsurerNotAllowedError))
  ok('matching is case-insensitive', doesNotThrow(() => assertInsurerAllowed('METLIFE')))
  ok('allowlist holds the 4 commercial life insurers', OPENDATALOADER_ALLOWED_INSURERS.length === 4)
}

function runInjectionTests(): void {
  console.log('\n## buildShadowRows — guard injection')

  const layout = openDataLoaderToLayout({
    kids: [
      { type: 'heading', 'page number': 1, content: '1) OBJETIVO DO SEGURO' },
      { type: 'paragraph', 'page number': 1, content: 'A'.repeat(600) },
    ],
  })
  const base = {
    layout,
    insurerId: '11111111-1111-1111-1111-111111111111',
    sourceUrl: 'https://example.com/mag/condicoes-gerais.pdf',
    productCatalog: [],
  }

  // REGRESSION: the Azure DI path must stay Prudential-only.
  ok(
    'default guard still refuses MAG (Azure DI path unchanged)',
    throwsOf(
      () => buildShadowRows({ ...base, insurerName: 'MAG Seguros' }),
      ShadowIndexerGuardError,
    ),
  )
  ok(
    'default guard still refuses MetLife (Azure DI path unchanged)',
    throwsOf(() => buildShadowRows({ ...base, insurerName: 'MetLife' }), ShadowIndexerGuardError),
  )

  // NEW: the OpenDataLoader path admits MAG through an injected allowlist.
  let rows = 0
  let error = ''
  try {
    const result = buildShadowRows({
      ...base,
      insurerName: 'MAG Seguros',
      assertInsurer: (name) => assertInsurerAllowed(name),
    })
    rows = result.rows.length
  } catch (err) {
    error = (err as Error).message
  }
  ok('injected allowlist admits MAG and builds rows', rows > 0, error || `rows=${rows}`)

  // The injected guard is still a guard.
  ok(
    'injected allowlist still refuses Bradesco',
    throwsOf(
      () =>
        buildShadowRows({
          ...base,
          insurerName: 'Bradesco Seguros',
          assertInsurer: (name) => assertInsurerAllowed(name),
        }),
      InsurerNotAllowedError,
    ),
  )
}

function main(): void {
  console.log('# opendataloader guard test')
  runAllowlistTests()
  runInjectionTests()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
