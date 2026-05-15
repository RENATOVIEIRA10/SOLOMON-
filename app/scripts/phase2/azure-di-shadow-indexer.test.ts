/**
 * Phase 2 / PR 3B slice 3B.5 — shadow-indexer integrated test.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 *
 * Three layers:
 *   1. Insurer-guard unit tests (Azos/MAG must be refused, Prudential
 *      variants must pass).
 *   2. Pipeline integration over the Bradesco + Prudential fixtures —
 *      verifying that for a Prudential-named run with the real catalog,
 *      every accepted chunk produces an inert row carrying the sentinel
 *      `valid_until`, the `shadow-v3:` hash prefix, `metadata.shadow=true`,
 *      and a null embedding.
 *   3. Idempotency check: re-running buildShadowRows on the same input
 *      produces row-equal output (same hashes, same metadata, same counts).
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow-indexer:test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { SEMANTIC_CHUNKER_PARSER } from '../../src/services/azure-di/chunker'
import {
  SHADOW_HASH_PREFIX,
  SHADOW_SOURCE_TYPE,
  SHADOW_VALID_UNTIL_SENTINEL,
  ShadowIndexerGuardError,
  assertPrudentialOnly,
  assertRowsAreInert,
  buildShadowRows,
} from '../../src/services/azure-di/shadow-indexer'
import type { ProductCatalogRow } from '../../src/services/azure-di/product-resolver'
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

function loadLayoutFixture(name: string): LayoutAnalyzeResult {
  const full = path.join(FIXTURES_DIR, `${name}.json`)
  return JSON.parse(readFileSync(full, 'utf8')) as LayoutAnalyzeResult
}

function loadPrudentialCatalog(): ProductCatalogRow[] {
  const full = path.join(FIXTURES_DIR, 'prudential-products-catalog.json')
  return JSON.parse(readFileSync(full, 'utf8')) as ProductCatalogRow[]
}

const PRUDENTIAL_AP_PASSAGEIROS_URL =
  'https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/Condi%C3%A7%C3%B5es%20Gerais%20Acidentes%20Pessoais%20Passageiro_Dez-25.pdf'

function runGuardTests(): void {
  console.log('\n## insurer guard')
  ok('refuses "Azos Seguros"', throwsGuard(() => assertPrudentialOnly('Azos Seguros')))
  ok('refuses "AZOS"', throwsGuard(() => assertPrudentialOnly('AZOS')))
  ok('refuses "MAG Seguros"', throwsGuard(() => assertPrudentialOnly('MAG Seguros')))
  ok('refuses "Bradesco Seguros"', throwsGuard(() => assertPrudentialOnly('Bradesco Seguros')))
  ok('refuses empty', throwsGuard(() => assertPrudentialOnly('')))
  ok('accepts "Prudential do Brasil"', !throwsGuard(() => assertPrudentialOnly('Prudential do Brasil')))
  ok('accepts "PRUDENTIAL"', !throwsGuard(() => assertPrudentialOnly('PRUDENTIAL')))
}

function throwsGuard(fn: () => void): boolean {
  try {
    fn()
    return false
  } catch (err) {
    return err instanceof ShadowIndexerGuardError
  }
}

function runPipelineIntegration(): void {
  console.log('\n## pipeline integration (Prudential AP Passageiros)')
  const layout = loadLayoutFixture('prudential-ap-passageiros-p1-3')
  const catalog = loadPrudentialCatalog()
  const result = buildShadowRows({
    layout,
    insurerId: 'insurer-prudential-uuid',
    insurerName: 'Prudential do Brasil',
    sourceUrl: PRUDENTIAL_AP_PASSAGEIROS_URL,
    productCatalog: catalog,
    pdfHash: 'fixture-pdf-hash',
  })

  ok('chunks count from chunker', result.summary.chunkCount === 7, `got ${result.summary.chunkCount}`)
  ok(
    'accept/quarantine split mirrors gate test',
    result.summary.acceptedCount === 5 && result.summary.quarantinedCount === 2,
    `got ${result.summary.acceptedCount}/${result.summary.quarantinedCount}`
  )
  ok('row count equals accepted count', result.rows.length === result.summary.acceptedCount)

  // Product resolver hits terms_url exact match for the catalog row with that URL.
  ok(
    'product resolution: terms_url with confidence 1.00',
    !result.resolution.productUnresolved &&
      result.resolution.strategy === 'terms_url' &&
      result.resolution.confidence === 1.0,
    `strategy=${result.resolution.strategy} conf=${result.resolution.confidence}`
  )
  ok(
    'product name carries through to summary',
    result.summary.productName === 'ACIDENTES PESSOAIS PASSAGEIROS'
  )

  // Inertness invariants — every row must satisfy the contract.
  let allSentinel = true
  let allShadowFlag = true
  let allHashPrefix = true
  let allNullEmbedding = true
  let allConditionsPdf = true
  let allProductId = true
  for (const row of result.rows) {
    if (row.valid_until !== SHADOW_VALID_UNTIL_SENTINEL) allSentinel = false
    const meta = row.metadata as Record<string, unknown> | null
    if (!meta || meta.shadow !== true) allShadowFlag = false
    if (!meta || meta.parser !== SEMANTIC_CHUNKER_PARSER) allShadowFlag = false
    if (!row.content_hash.startsWith(SHADOW_HASH_PREFIX)) allHashPrefix = false
    if (row.embedding !== null) allNullEmbedding = false
    if (row.source_type !== SHADOW_SOURCE_TYPE) allConditionsPdf = false
    if (!row.product_id) allProductId = false
  }
  ok('every row valid_until = sentinel', allSentinel)
  ok('every row metadata.shadow=true & parser=v3', allShadowFlag)
  ok('every row content_hash prefixed shadow-v3:', allHashPrefix)
  ok('every row embedding=null', allNullEmbedding)
  ok('every row source_type=conditions_pdf', allConditionsPdf)
  ok('every row product_id set (resolver hit)', allProductId)

  // assertRowsAreInert is the gate the CLI runs before upsert — exercise it.
  let thrown = false
  try {
    assertRowsAreInert(result.rows)
  } catch (err) {
    thrown = true
    console.error(`  unexpected throw: ${(err as Error).message}`)
  }
  ok('assertRowsAreInert passes on real rows', !thrown)
}

function runIdempotency(): void {
  console.log('\n## idempotency')
  const layout = loadLayoutFixture('prudential-ap-passageiros-p1-3')
  const catalog = loadPrudentialCatalog()
  const input = {
    layout,
    insurerId: 'insurer-prudential-uuid',
    insurerName: 'Prudential do Brasil',
    sourceUrl: PRUDENTIAL_AP_PASSAGEIROS_URL,
    productCatalog: catalog,
  }
  const first = buildShadowRows(input)
  const second = buildShadowRows(input)
  ok('same row count', first.rows.length === second.rows.length)
  ok(
    'same content_hashes',
    first.rows.every((r, i) => r.content_hash === second.rows[i].content_hash)
  )
  ok(
    'same chunk_index order',
    first.rows.every((r, i) => r.chunk_index === second.rows[i].chunk_index)
  )
  ok(
    'same content text',
    first.rows.every((r, i) => r.content === second.rows[i].content)
  )
}

function runAzosMagBlocked(): void {
  console.log('\n## non-Prudential insurer blocked')
  const layout = loadLayoutFixture('bradesco-vida-viva-p4-8')
  const baseInput = {
    layout,
    insurerId: 'whatever',
    sourceUrl: 'https://example.com/fake.pdf',
    productCatalog: [] as ProductCatalogRow[],
  }
  for (const insurerName of ['Azos Seguros', 'MAG Seguros', 'Bradesco Seguros']) {
    let blocked = false
    try {
      buildShadowRows({ ...baseInput, insurerName })
    } catch (err) {
      blocked = err instanceof ShadowIndexerGuardError
    }
    ok(`buildShadowRows refuses "${insurerName}"`, blocked)
  }
}

function runAssertRowsAreInertNegativePaths(): void {
  console.log('\n## assertRowsAreInert negative paths')
  const baseRow = {
    insurer_id: 'i',
    product_id: 'p',
    source_type: SHADOW_SOURCE_TYPE,
    source_url: 'https://x',
    chunk_index: 0,
    content: 'hello',
    content_hash: `${SHADOW_HASH_PREFIX}abc`,
    pdf_hash: null,
    embedding: null,
    valid_until: SHADOW_VALID_UNTIL_SENTINEL,
    metadata: { shadow: true, parser: SEMANTIC_CHUNKER_PARSER },
  }
  ok('passes a well-formed row', !throwsAny(() => assertRowsAreInert([baseRow])))
  ok(
    'fails when valid_until null',
    throwsAny(() => assertRowsAreInert([{ ...baseRow, valid_until: null }]))
  )
  ok(
    'fails when embedding present',
    throwsAny(() => assertRowsAreInert([{ ...baseRow, embedding: '[0.1,0.2]' }]))
  )
  ok(
    'fails when hash missing prefix',
    throwsAny(() => assertRowsAreInert([{ ...baseRow, content_hash: 'plain-abc' }]))
  )
  ok(
    'fails when metadata.shadow != true',
    throwsAny(() =>
      assertRowsAreInert([{ ...baseRow, metadata: { shadow: false, parser: SEMANTIC_CHUNKER_PARSER } }])
    )
  )
  ok(
    'fails when source_type != conditions_pdf',
    throwsAny(() => assertRowsAreInert([{ ...baseRow, source_type: 'manual' }]))
  )
}

function throwsAny(fn: () => void): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

function main(): void {
  console.log('# azure-di shadow-indexer test')
  runGuardTests()
  runPipelineIntegration()
  runIdempotency()
  runAzosMagBlocked()
  runAssertRowsAreInertNegativePaths()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
