/**
 * OpenDataLoader → LayoutAnalyzeResult adapter test.
 *
 * Fixture under `__fixtures__/odl-mag-vida-inteira.json` is raw OpenDataLoader
 * JSON for the MAG "Condições Gerais — Vida Inteira" (14 pages), produced by
 * `opendataloader-pdf --format json` (local, CPU, no network).
 *
 * This test asserts two layers:
 *   1. adapter invariants — flat content, offsets that slice back to their own
 *      text, roles, table cells, page index resolution;
 *   2. downstream behaviour — `chunkLayoutResult()` turns the two real tables
 *      into `has_table` chunks that KEEP their structure. These are the exact
 *      tables the legacy extractor destroyed:
 *        carência   → "Até 6 meses5%"                    (columns glued)
 *        reajuste   → "16 anos-44 anos1,098872 anos1,0831" (ages+factors fused)
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 *
 * Run from app/:
 *   npm run phase2:odl:adapter:test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { buildPageIndex, chunkLayoutResult } from '../../src/services/azure-di/chunker'
import { openDataLoaderToLayout } from '../../src/services/opendataloader/adapter'
import type { OdlDocument } from '../../src/services/opendataloader/types'

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

function runAdapterUnitTests(): void {
  console.log('\n## adapter invariants')

  // flat content + accumulating offsets
  const two = openDataLoaderToLayout({
    kids: [
      { type: 'paragraph', 'page number': 1, content: 'First' },
      { type: 'paragraph', 'page number': 1, content: 'Second' },
    ],
  })
  ok('flat content joins blocks with a newline', two.content === 'First\nSecond')
  ok(
    'second paragraph offset accounts for the separator',
    two.paragraphs?.[1].spans[0].offset === 6,
    `got ${two.paragraphs?.[1].spans[0].offset}`,
  )

  // the invariant that makes the chunker trustworthy
  ok(
    'every paragraph span slices back to exactly its own content',
    (two.paragraphs ?? []).every(
      (p) => two.content.slice(p.spans[0].offset, p.spans[0].offset + p.spans[0].length) === p.content,
    ),
  )

  // heading → role the chunker recognises
  const heading = openDataLoaderToLayout({
    kids: [{ type: 'heading', level: '2', 'page number': 1, content: '6) CARENCIAS' }],
  })
  ok('heading maps to role sectionHeading', heading.paragraphs?.[0].role === 'sectionHeading')

  // list items must not be dropped (they carry exclusions / incisos)
  const list = openDataLoaderToLayout({
    kids: [
      {
        type: 'list',
        'page number': 2,
        'list items': [
          { type: 'list item', content: 'a) risco excluido um', 'page number': 2 },
          { type: 'list item', content: 'b) risco excluido dois', 'page number': 2 },
        ],
      },
    ],
  })
  ok('list items become paragraphs', list.paragraphs?.length === 2, `got ${list.paragraphs?.length}`)

  // table → cells
  const table = openDataLoaderToLayout({
    kids: [
      {
        type: 'table',
        'number of rows': 2,
        'number of columns': 2,
        'page number': 7,
        rows: [
          {
            type: 'table row',
            'row number': 1,
            cells: [
              { type: 'table cell', 'row number': 1, 'column number': 1, kids: [{ type: 'paragraph', content: 'Periodo' }] },
              { type: 'table cell', 'row number': 1, 'column number': 2, kids: [{ type: 'paragraph', content: 'Percentual' }] },
            ],
          },
          {
            type: 'table row',
            'row number': 2,
            cells: [
              { type: 'table cell', 'row number': 2, 'column number': 1, kids: [{ type: 'paragraph', content: 'Ate 6 meses' }] },
              { type: 'table cell', 'row number': 2, 'column number': 2, kids: [{ type: 'paragraph', content: '5%' }] },
            ],
          },
        ],
      },
    ],
  })
  const t = table.tables?.[0]
  ok('table keeps rowCount/columnCount', t?.rowCount === 2 && t?.columnCount === 2)
  ok(
    'cells are 0-based and carry their text',
    t?.cells.find((c) => c.rowIndex === 1 && c.columnIndex === 0)?.content === 'Ate 6 meses',
  )
  ok('table page comes from boundingRegions', t?.boundingRegions?.[0].pageNumber === 7)

  // page index must resolve a paragraph offset to its real page
  const multipage = openDataLoaderToLayout({
    kids: [
      { type: 'paragraph', 'page number': 1, content: 'pagina um' },
      { type: 'paragraph', 'page number': 2, content: 'pagina dois' },
    ],
  })
  const index = buildPageIndex(multipage.pages)
  ok(
    'buildPageIndex maps the 2nd paragraph offset to page 2',
    index.pageOf(multipage.paragraphs![1].spans[0].offset) === 2,
  )
}

function runFixture(): void {
  console.log('\n## fixture: odl-mag-vida-inteira (real MAG Condições Gerais)')

  const odl = JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, 'odl-mag-vida-inteira.json'), 'utf8'),
  ) as OdlDocument

  const layout = openDataLoaderToLayout(odl)

  ok('content is substantial', layout.content.length > 1000, `${layout.content.length} chars`)
  ok('both tables detected', layout.tables?.length === 2, `got ${layout.tables?.length}`)
  ok(
    'every paragraph offset is consistent on the real document',
    (layout.paragraphs ?? []).every(
      (p) =>
        layout.content.slice(p.spans[0].offset, p.spans[0].offset + p.spans[0].length) === p.content,
    ),
  )
  ok('pages are 1-based and non-zero', layout.pages.every((p) => p.pageNumber > 0))

  const chunks = chunkLayoutResult(layout)
  const tableChunks = chunks.filter((c) => c.metadata.has_table)
  ok('chunker produced has_table chunks', tableChunks.length === 2, `got ${tableChunks.length}`)
  ok('every table chunk has a real page (> 0)', tableChunks.every((c) => c.metadata.page > 0))

  // the carência progression: 5% → 100%, as a markdown table
  const carencia = tableChunks.find(
    (c) => /\|/.test(c.content) && /meses/i.test(c.content) && /100\s*%/.test(c.content),
  )
  ok('carencia table survives as a markdown table', Boolean(carencia))
  ok(
    'carencia keeps "Até 6 meses" and "5%" in SEPARATE cells (legacy glued them)',
    Boolean(carencia && /\|\s*At[ée] 6 meses\s*\|\s*5%\s*\|/.test(carencia.content)),
    carencia?.content.slice(0, 120),
  )

  // the 6-column age table: ages and factors must not fuse
  const reajuste = tableChunks.find((c) => /Idade/i.test(c.content) && /8,61%/.test(c.content))
  ok('age-reajuste table survives', Boolean(reajuste))
  ok(
    'age-reajuste keeps "44 anos" and "8,61%" in SEPARATE cells (legacy fused them)',
    Boolean(reajuste && /\|\s*44 anos\s*\|\s*8,61%\s*\|/.test(reajuste.content)),
    reajuste?.content.slice(0, 160),
  )
}

function main(): void {
  console.log('# opendataloader adapter test')
  runAdapterUnitTests()
  runFixture()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
