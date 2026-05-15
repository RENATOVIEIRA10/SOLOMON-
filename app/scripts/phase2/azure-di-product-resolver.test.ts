/**
 * Phase 2 / PR 3B slice 3B.4 — product-resolver test.
 *
 * Standalone tsx, exit 0/1. No network, no DB, no credentials.
 *
 * Two layers:
 *   1. Unit tests for the helpers (normalizeForFuzzy, extractSusepCandidates,
 *      nameCandidateFromUrl) and each resolution strategy with synthetic
 *      mini-catalogs.
 *   2. Integration tests against the committed Prudential catalog fixture
 *      (12 real rows) — proves terms_url + susep + code + fuzzy + the
 *      catalog-empty (Azos/MAG) path all behave as the plan requires.
 *
 * Run from app/:
 *   npm run phase2:azure-di:product-resolver:test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  extractSusepCandidates,
  nameCandidateFromUrl,
  normalizeForFuzzy,
  resolveProduct,
  type ProductCatalogRow,
} from '../../src/services/azure-di/product-resolver'

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

function loadPrudentialCatalog(): ProductCatalogRow[] {
  const full = path.join(FIXTURES_DIR, 'prudential-products-catalog.json')
  return JSON.parse(readFileSync(full, 'utf8')) as ProductCatalogRow[]
}

function runHelpers(): void {
  console.log('\n## helpers')

  ok('normalizeForFuzzy: strips accents + lowercases', normalizeForFuzzy('Vida Inteira Mais') === 'vida inteira mais')
  ok('normalizeForFuzzy: handles ç/ã', normalizeForFuzzy('Condições Gerais Acidentes') === 'condicoes gerais acidentes')
  ok('normalizeForFuzzy: collapses punctuation + whitespace', normalizeForFuzzy('  TEMPORÁRIO!! DECRESCENTE  ') === 'temporario decrescente')

  const susep = extractSusepCandidates('arquivo 15414-604991-2023-12-broker.pdf e tambem 15414.901681/2017-97')
  ok('extractSusepCandidates: hyphen variant', susep.includes('15414.604991/2023-12'))
  ok('extractSusepCandidates: canonical variant', susep.includes('15414.901681/2017-97'))
  ok('extractSusepCandidates: none in random text', extractSusepCandidates('no susep here').length === 0)

  ok(
    'nameCandidateFromUrl: slugifies last segment',
    nameCandidateFromUrl('https://example.com/path/condicoes-gerais-vida-inteira.pdf') ===
      'condicoes gerais vida inteira'
  )
  ok(
    'nameCandidateFromUrl: decodes percent-encoding',
    (nameCandidateFromUrl(
      'https://www.prudential.com.br/x/Condi%C3%A7%C3%B5es%20Gerais%20Acidentes%20Pessoais%20Passageiro_Dez-25.pdf'
    ) ?? '').toLowerCase().includes('acidentes')
  )
  ok('nameCandidateFromUrl: invalid URL → undefined', nameCandidateFromUrl('not a url') === undefined)
}

function runStrategyUnits(): void {
  console.log('\n## strategy cascade (synthetic catalogs)')

  const catalog: ProductCatalogRow[] = [
    { id: 'p1', name: 'Vida Inteira', code: 'WLPortG', susep_process: '15414.900141/2013-62', terms_url: 'https://x/vi.pdf' },
    { id: 'p2', name: 'Temporário', code: 'TMPortG', susep_process: '15414.900782/2013-17', terms_url: 'https://x/tm.pdf' },
  ]

  // 1. terms_url wins over everything.
  {
    const r = resolveProduct(
      { sourceUrl: 'https://x/vi.pdf', susepCandidates: ['15414.900782/2013-17'], codeCandidates: ['TMPortG'] },
      catalog
    )
    ok('terms_url match returns the right product', r.productId === 'p1' && r.strategy === 'terms_url' && r.confidence === 1.0)
  }

  // 2. SUSEP match when terms_url misses.
  {
    const r = resolveProduct({ sourceUrl: 'https://nowhere/other.pdf', susepCandidates: ['15414.900782/2013-17'] }, catalog)
    ok('susep_process match', r.productId === 'p2' && r.strategy === 'susep_process' && r.confidence === 0.95)
  }

  // 3. Code match.
  {
    const r = resolveProduct({ codeCandidates: ['wlportg'] }, catalog)
    ok('code match (case-insensitive)', r.productId === 'p1' && r.strategy === 'code')
  }

  // 4. Fuzzy name match.
  {
    const r = resolveProduct({ productNameCandidates: ['Seguro Vida Inteira Coberturas'] }, catalog)
    ok(
      'fuzzy_name match above threshold',
      r.productId === 'p1' && r.strategy === 'fuzzy_name' && r.confidence >= 0.65
    )
  }

  // 5. Fuzzy below threshold → unresolved with that reason.
  // Candidate shares ONE token ("vida") with the product → containment 0.5 < 0.65.
  {
    const r = resolveProduct({ productNameCandidates: ['Vida e Familia'] }, catalog)
    ok(
      'fuzzy below threshold → unresolved',
      r.productUnresolved && r.unresolvedReason === 'fuzzy_below_threshold'
    )
  }

  // 6. No signals at all → unresolved no_signals_matched.
  {
    const r = resolveProduct({}, catalog)
    ok('no signals → unresolved no_signals_matched', r.productUnresolved && r.unresolvedReason === 'no_signals_matched')
  }

  // 7. Empty catalog (Azos/MAG case) → unresolved catalog_empty.
  {
    const r = resolveProduct(
      { sourceUrl: 'https://x/anything.pdf', codeCandidates: ['WHATEVER'] },
      []
    )
    ok(
      'empty catalog → unresolved catalog_empty (Azos/MAG)',
      r.productUnresolved && r.unresolvedReason === 'catalog_empty' && r.confidence === 0
    )
  }
}

function runPrudentialIntegration(): void {
  console.log('\n## integration: real Prudential catalog (12 rows)')

  const catalog = loadPrudentialCatalog()
  ok('catalog loaded (12 products)', catalog.length === 12)

  // 1. terms_url exact match — AP Passageiros (the slice 3B.2 fixture URL).
  {
    const url =
      'https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/Condi%C3%A7%C3%B5es%20Gerais%20Acidentes%20Pessoais%20Passageiro_Dez-25.pdf'
    const r = resolveProduct({ sourceUrl: url }, catalog)
    ok(
      'AP Passageiros resolves via terms_url',
      r.productName === 'ACIDENTES PESSOAIS PASSAGEIROS' && r.strategy === 'terms_url' && r.confidence === 1.0
    )
  }

  // 2. terms_url exact match — Vida Inteira.
  {
    const url = 'https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira.pdf'
    const r = resolveProduct({ sourceUrl: url }, catalog)
    ok(
      'Vida Inteira resolves via terms_url',
      r.productName === 'VIDA INTEIRA' && r.strategy === 'terms_url'
    )
  }

  // 3. Vida Inteira variant (modificado-30) without terms_url match → fuzzy_name fallback.
  {
    const url = 'https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-modificado-30.pdf'
    const nameCand = nameCandidateFromUrl(url)
    const r = resolveProduct(
      { sourceUrl: url, productNameCandidates: nameCand ? [nameCand] : [] },
      catalog
    )
    ok(
      'Vida Inteira variant resolves via fuzzy_name',
      r.productName === 'VIDA INTEIRA' && r.strategy === 'fuzzy_name'
    )
  }

  // 4. SUSEP-only resolution.
  {
    const r = resolveProduct({ susepCandidates: ['15414.900141/2013-62'] }, catalog)
    ok('SUSEP resolves Vida Inteira', r.productName === 'VIDA INTEIRA' && r.strategy === 'susep_process')
  }

  // 5. Code-only resolution.
  {
    const r = resolveProduct({ codeCandidates: ['WDportG'] }, catalog)
    ok('Code resolves Vida Inteira Mais', r.productName === 'VIDA INTEIRA MAIS' && r.strategy === 'code')
  }

  // 6. Unrelated doc (sustentabilidade) → unresolved.
  {
    const url = 'https://example.com/relatorio-sustentabilidade-2024.pdf'
    const nameCand = nameCandidateFromUrl(url)
    const r = resolveProduct(
      { sourceUrl: url, productNameCandidates: nameCand ? [nameCand] : [] },
      catalog
    )
    ok('Sustentabilidade doc → unresolved', r.productUnresolved)
  }
}

function runEmptyCatalogPath(): void {
  console.log('\n## empty catalog (Azos/MAG)')

  // Realistic Azos URL with an embedded SUSEP — still unresolved because the catalog is empty.
  const url = 'https://files.azos.com.br/f/15414-604991-2023-12---Condi%C3%A7%C3%B5es-Gerais---Broker-(1).pdf'
  const susep = extractSusepCandidates(url)
  const nameCand = nameCandidateFromUrl(url)
  const r = resolveProduct(
    {
      sourceUrl: url,
      productNameCandidates: nameCand ? [nameCand] : [],
      susepCandidates: susep,
    },
    [] // empty Azos catalog
  )
  ok('Azos URL with SUSEP still unresolved (empty catalog)', r.productUnresolved && r.unresolvedReason === 'catalog_empty')
  ok('Azos resolution has confidence 0', r.confidence === 0)
}

function main(): void {
  console.log('# azure-di product-resolver test')
  runHelpers()
  runStrategyUnits()
  runPrudentialIntegration()
  runEmptyCatalogPath()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
