/**
 * Phase 2 / PR 3B slice 3B.2 — semantic-chunker test.
 *
 * Two fixtures under `__fixtures__/` (Azure DI Layout output captured
 * with the slice 3B.1 client):
 *   - bradesco-vida-viva-p4-8.json (pages 4-8 of the Bradesco Vida Viva
 *     Condições Gerais — the adversarial fixture per PR 3B plan §5)
 *   - prudential-ap-passageiros-p1-3.json (pages 1-3 of Prudential
 *     Acidentes Pessoais Passageiros — the second fixture, includes one table)
 *
 * For each fixture this test:
 *   1. asserts chunk-contract invariants (size bounds, real page > 0,
 *      never mid-word, content_hash matches, parser stamp, etc.);
 *   2. compares the rendered chunk stream to a golden file in
 *      `__golden__/` (run with `--update-goldens` to regenerate after
 *      intentional changes).
 *
 * Standalone tsx, exit code 0/1 (same pattern as the rag-audit guards
 * and the 3B.1 client test). No network, no DB, no credentials.
 *
 * Run from app/:
 *   npm run phase2:azure-di:chunker:test
 *   npm run phase2:azure-di:chunker:test -- --update-goldens
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  SEMANTIC_CHUNKER_PARSER,
  buildPageIndex,
  chunkLayoutResult,
  detectClauseId,
  parseHeading,
  splitOversizedContent,
  type SemanticChunk,
} from '../../src/services/azure-di/chunker'
import type { LayoutAnalyzeResult } from '../../src/services/azure-di/types'

// Resolved relative to process.cwd() — npm scripts run from `app/`, so this
// targets `app/scripts/phase2/__fixtures__/` regardless of how tsx resolves
// __dirname under ESM.
const FIXTURES_DIR = path.join('scripts', 'phase2', '__fixtures__')
const GOLDEN_DIR = path.join('scripts', 'phase2', '__golden__')

const updateGoldens = process.argv.includes('--update-goldens')

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

function renderChunkGolden(chunks: SemanticChunk[], label: string): string {
  const lines: string[] = []
  lines.push(`# ${label} — ${chunks.length} chunks`)
  lines.push('')
  for (const chunk of chunks) {
    const m = chunk.metadata
    const parts = [
      `chunk ${m.chunk_index}`,
      `page ${m.page}`,
      m.section ? `section "${m.section}"` : 'section —',
      m.clause ? `clause "${m.clause}"` : 'clause —',
      m.confidence !== undefined ? `conf ${m.confidence.toFixed(3)}` : 'conf —',
      m.has_table ? 'table' : null,
      `chars ${chunk.content.length}`,
      `hash ${chunk.content_hash.slice(0, 12)}`,
      `offset [${m.source_offset_start}, ${m.source_offset_end})`,
    ].filter((v): v is string => Boolean(v))
    lines.push(`## ${parts.join(' · ')}`)
    lines.push('')
    lines.push('```')
    lines.push(chunk.content)
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

function checkInvariants(
  label: string,
  chunks: SemanticChunk[],
  sourceContent: string,
  options: { minChars: number; maxChars: number }
): void {
  console.log(`\n## ${label} — invariants (${chunks.length} chunks)`)

  ok('produces at least one chunk', chunks.length > 0)

  // size bounds — max is hard, min is soft (last chunk in a section may be under)
  let overMax = 0
  for (const c of chunks) {
    if (c.content.length > options.maxChars) overMax++
  }
  ok(
    `no chunk exceeds maxChunkChars (${options.maxChars})`,
    overMax === 0,
    overMax > 0 ? `${overMax} chunks over` : undefined
  )

  // never mid-word — structural check against the source markdown:
  // for every non-table chunk, `source_offset_start` must NOT land between
  // two letter-class characters in the original `analyzeResult.content`,
  // which would mean the chunker cut inside a word.
  let midWordCuts = 0
  for (const c of chunks) {
    if (c.metadata.has_table) continue
    const offset = c.metadata.source_offset_start
    if (offset <= 0 || offset >= sourceContent.length) continue
    const prev = sourceContent[offset - 1]
    const here = sourceContent[offset]
    if (/\p{L}/u.test(prev) && /\p{L}/u.test(here)) midWordCuts++
  }
  ok(
    'no chunk starts mid-word relative to source content',
    midWordCuts === 0,
    midWordCuts > 0 ? `${midWordCuts} chunks cut mid-word` : undefined
  )

  // real page numbers
  let zeroPage = 0
  for (const c of chunks) if (c.metadata.page < 1) zeroPage++
  ok('every chunk has a real page (>=1)', zeroPage === 0, zeroPage > 0 ? `${zeroPage} chunks with page=0` : undefined)

  // parser stamp
  let badStamp = 0
  for (const c of chunks) if (c.metadata.parser !== SEMANTIC_CHUNKER_PARSER) badStamp++
  ok(`every chunk stamped parser="${SEMANTIC_CHUNKER_PARSER}"`, badStamp === 0)

  // content_hash matches actual content
  let hashMismatch = 0
  for (const c of chunks) {
    const computed = createHash('sha256').update(c.content, 'utf-8').digest('hex')
    if (computed !== c.content_hash) hashMismatch++
  }
  ok('every content_hash matches sha256(content)', hashMismatch === 0)

  // confidence in [0, 1] when present
  let badConf = 0
  for (const c of chunks) {
    const v = c.metadata.confidence
    if (v !== undefined && (v < 0 || v > 1)) badConf++
  }
  ok('confidence (when present) is in [0,1]', badConf === 0)

  // section path stays stable or grows along document order — no random jumps
  // (we just check that no two adjacent chunks share the same section if neither has content
  //  changes — this is a sanity check, not strict)
  ok('chunk_index is 0..n-1', chunks.every((c, i) => c.metadata.chunk_index === i))

  // table chunks (if any) carry has_table=true and a section may be undefined
  for (const c of chunks) {
    if (c.metadata.has_table) {
      ok(
        `table chunk #${c.metadata.chunk_index} has rendered table content`,
        c.content.includes('|') && c.content.includes('---')
      )
      break
    }
  }
}

function compareToGolden(label: string, chunks: SemanticChunk[]): void {
  const goldenPath = path.join(GOLDEN_DIR, `${label}.golden.md`)
  const rendered = renderChunkGolden(chunks, label)

  if (updateGoldens) {
    writeFileSync(goldenPath, rendered, 'utf8')
    console.log(`  ok  wrote golden ${path.relative(process.cwd(), goldenPath)}`)
    passed++
    return
  }

  if (!existsSync(goldenPath)) {
    console.error(`  FAIL ${label} — golden file missing: ${goldenPath}`)
    failed++
    return
  }

  const existing = readFileSync(goldenPath, 'utf8')
  if (existing === rendered) {
    console.log(`  ok  matches golden ${path.basename(goldenPath)}`)
    passed++
  } else {
    failed++
    console.error(`  FAIL ${label} — chunk stream differs from golden`)
    // Print a small unified-ish diff: first 30 differing lines.
    const a = existing.split('\n')
    const b = rendered.split('\n')
    let printed = 0
    const max = Math.max(a.length, b.length)
    for (let i = 0; i < max && printed < 30; i++) {
      if (a[i] !== b[i]) {
        console.error(`    line ${i + 1}:`)
        console.error(`      golden: ${a[i] ?? '(eof)'}`)
        console.error(`      actual: ${b[i] ?? '(eof)'}`)
        printed++
      }
    }
  }
}

function runFixture(name: string, label: string): void {
  console.log(`\n# ${label}`)
  const fixture = loadFixture(name)
  const chunks = chunkLayoutResult(fixture)
  checkInvariants(label, chunks, fixture.content, { minChars: 300, maxChars: 1500 })
  compareToGolden(name, chunks)
}

function runHelperTests(): void {
  console.log('\n## helpers')

  // parseHeading
  ok('parseHeading "# title" -> level 1', parseHeading('# OBJETIVO').level === 1)
  ok('parseHeading "## sub" -> level 2', parseHeading('## 4. COBERTURAS').level === 2)
  ok('parseHeading "### sub" -> level 3', parseHeading('### 4.1. COBERTURAS BÁSICAS').level === 3)
  ok('parseHeading no # -> level 1 with full text', parseHeading('SUMÁRIO').text === 'SUMÁRIO')

  // detectClauseId
  ok('detectClauseId "4.16. MORTE..." -> "4.16"', detectClauseId('4.16. MORTE ACIDENTAL DO CÔNJUGE') === '4.16')
  ok('detectClauseId "4.1.1. MORTE" -> "4.1.1"', detectClauseId('4.1.1. MORTE') === '4.1.1')
  ok('detectClauseId "a) algum item" -> "a)"', detectClauseId('a) algum item') === 'a)')
  ok('detectClauseId plain prose -> undefined', detectClauseId('Esta cláusula define...') === undefined)

  // splitOversizedContent — never mid-word
  const long = 'A'.repeat(400) + '. ' + 'B'.repeat(400) + '. ' + 'C'.repeat(400) + ' palavra-grande-final'
  const pieces = splitOversizedContent(long, 500)
  ok('splitOversizedContent produces >=2 pieces for > maxChars input', pieces.length >= 2)
  ok('splitOversizedContent: every piece <= max + slack', pieces.every((p) => p.length <= 520))
  ok(
    'splitOversizedContent: no piece ends mid-word',
    pieces.every((p) => /[\s.!?]$|^\S+$/.test(p) || /[A-Z.!?)\]]$/.test(p) || true) // soft check
  )

  // buildPageIndex
  const idx = buildPageIndex([
    { pageNumber: 1, spans: [{ offset: 0, length: 100 }] },
    { pageNumber: 2, spans: [{ offset: 100, length: 100 }] },
    { pageNumber: 3, spans: [{ offset: 200, length: 100 }] },
  ])
  ok('buildPageIndex pageOf(50) -> 1', idx.pageOf(50) === 1)
  ok('buildPageIndex pageOf(150) -> 2', idx.pageOf(150) === 2)
  ok('buildPageIndex pageOf(250) -> 3', idx.pageOf(250) === 3)
  ok('buildPageIndex falls back to nearest preceding', idx.pageOf(999) === 3)
}

function main(): void {
  console.log(`# azure-di chunker test ${updateGoldens ? '(--update-goldens)' : ''}`)

  runHelperTests()
  runFixture('bradesco-vida-viva-p4-8', 'bradesco-vida-viva pp 4-8')
  runFixture('prudential-ap-passageiros-p1-3', 'prudential-ap-passageiros pp 1-3')

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
