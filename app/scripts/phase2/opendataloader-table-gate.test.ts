/**
 * Table chunks must survive the quality gates.
 *
 * A table is atomic: the chunker neither merges it with a neighbour nor splits
 * it (both would destroy the grid). Yet G-boundary judged every chunk by the
 * same char window meant for prose — so a table smaller than `minChunkChars`
 * or bigger than `maxChunkChars` was quarantined and never reached the corpus.
 *
 * The real MAG "Condições Gerais" trips both ends:
 *   carência progressiva   → 234 chars  (< 300 floor)
 *   reajuste por idade     → 1733 chars (> 1500 ceiling)
 *
 * These are precisely the two tables the legacy extractor destroyed. Parsing
 * them correctly and then dropping them at the gate would have shipped a
 * corpus with no tables — the same defect, wearing a new parser stamp.
 *
 * `tablesAreAtomic` exempts `has_table` chunks from the prose window and
 * applies `maxTableChars` as a sanity ceiling instead. Text chunks are
 * unaffected, and the Azure DI path keeps the old behaviour by default.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 *
 * Run from app/:
 *   npm run phase2:odl:table-gate:test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { chunkLayoutResult, type SemanticChunk } from '../../src/services/azure-di/chunker'
import {
  runChunkGates,
  type ChunkContext,
  type GateInput,
  type GateOptions,
} from '../../src/services/azure-di/chunk-gate'
import { openDataLoaderToLayout } from '../../src/services/opendataloader/adapter'
import type { OdlDocument } from '../../src/services/opendataloader/types'

const FIXTURES_DIR = path.join('scripts', 'phase2', '__fixtures__')

const CONTEXT: ChunkContext = {
  insurerId: '11111111-1111-1111-1111-111111111111',
  insurerName: 'MAG Seguros',
  productUnresolved: true,
  sourceType: 'conditions_pdf',
}

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

function gate(chunks: readonly SemanticChunk[], options: GateOptions) {
  const inputs: GateInput[] = chunks.map((chunk) => ({ chunk, context: CONTEXT }))
  return runChunkGates(inputs, options)
}

function main(): void {
  console.log('# opendataloader table-gate test')

  const odl = JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, 'odl-mag-vida-inteira.json'), 'utf8'),
  ) as OdlDocument
  const chunks = chunkLayoutResult(openDataLoaderToLayout(odl))
  const tables = chunks.filter((c) => c.metadata.has_table)

  console.log('\n## the fixture trips both ends of the prose window')
  ok('chunker produced the 2 real tables', tables.length === 2, `got ${tables.length}`)
  const small = tables.find((t) => t.content.length < 300)
  const big = tables.find((t) => t.content.length > 1500)
  ok('carencia table sits under the 300-char floor', Boolean(small), `${small?.content.length} chars`)
  ok('reajuste table sits over the 1500-char ceiling', Boolean(big), `${big?.content.length} chars`)

  console.log('\n## the bug: default gates drop both tables')
  const withDefaults = gate(chunks, {})
  const keptByDefault = withDefaults.accepted.filter((c) => c.metadata.has_table)
  ok(
    'with default gates, ZERO tables survive',
    keptByDefault.length === 0,
    `${keptByDefault.length} survived`,
  )
  const boundaryFailures = withDefaults.quarantined.filter(
    (q) => q.chunk.metadata.has_table && q.reasons.some((r) => r.gate === 'G-boundary'),
  )
  ok('both tables were quarantined by G-boundary', boundaryFailures.length === 2)

  console.log('\n## the fix: tables are atomic')
  const withFix = gate(chunks, { tablesAreAtomic: true })
  const keptByFix = withFix.accepted.filter((c) => c.metadata.has_table)
  ok('tablesAreAtomic keeps BOTH tables', keptByFix.length === 2, `${keptByFix.length} survived`)
  ok(
    'the carencia progression is intact in the accepted chunk',
    keptByFix.some((c) => /\|\s*At[ée] 6 meses\s*\|\s*5%\s*\|/.test(c.content)),
  )
  ok(
    'the age/factor pairs are intact in the accepted chunk',
    keptByFix.some((c) => /\|\s*44 anos\s*\|\s*8,61%\s*\|/.test(c.content)),
  )

  console.log('\n## the fix is not a hole')
  const hugeTable: SemanticChunk = {
    ...big!,
    content: '| a | b |\n'.repeat(1200), // ~12k chars
    content_hash: 'hash-huge-table',
  }
  ok(
    'an absurdly large table still gets quarantined (sanity ceiling)',
    gate([hugeTable], { tablesAreAtomic: true, maxTableChars: 8000 }).accepted.length === 0,
  )

  const tinyText: SemanticChunk = {
    ...chunks.find((c) => !c.metadata.has_table)!,
    content: 'curto demais',
    content_hash: 'hash-tiny-text',
  }
  ok(
    'text chunks are NOT loosened by tablesAreAtomic',
    gate([tinyText], { tablesAreAtomic: true }).accepted.length === 0,
  )

  console.log('\n## azure-di default is untouched')
  ok(
    'default (no option) still applies the prose window to tables',
    gate(tables, {}).accepted.length === 0,
  )

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
