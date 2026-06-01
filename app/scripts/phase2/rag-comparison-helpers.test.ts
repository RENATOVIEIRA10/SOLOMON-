/**
 * Phase 2 / P0 comparison retrieval helpers.
 *
 * Run from app/:
 *   npm run phase2:rag-comparison:test
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { detectRateIntent } from '@/services/rag/rate-lookup'
import { buildRerankDocument, type SearchResult } from '@/services/rag/search'
import { expandQueryWithJargon } from '@/config/jargon'

let passed = 0
let failed = 0

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`)
  }
}

function includesAll(label: string, actual: string[] | undefined, expected: string[]): void {
  const missing = expected.filter((item) => !actual?.includes(item))
  ok(label, missing.length === 0, `missing: ${missing.join(', ')}`)
}

function gateMultiProductRateIntent(): void {
  console.log('\n## multi-product rate intent')
  const intent = detectRateIntent(
    'Na Prudential, WL10G vs WL00G para mulher 35 anos: qual fica mais barato?',
    'Prudential'
  )

  ok('comparative price wording triggers rate intent', intent.hasIntent)
  includesAll('captures both Prudential product codes', intent.productCodes, ['WL10G', 'WL00G'])
  ok('keeps primary productCode for legacy callers', intent.productCode === 'WL10G')
  ok('extracts age', intent.age === 35)
  ok('extracts gender', intent.gender === 'F')

  const singleProductRateIntent = detectRateIntent(
    'Compare Seguro Doencas Graves Plus da Prudential (DDR5G) com outras seguradoras que oferecem DG — 35 anos mulher.',
    'Prudential'
  )
  ok('single product code with age and gender triggers rate intent', singleProductRateIntent.hasIntent)
  includesAll('captures Prudential DG product code', singleProductRateIntent.productCodes, ['DDR5G'])
  ok('extracts DG age', singleProductRateIntent.age === 35)
  ok('extracts DG gender', singleProductRateIntent.gender === 'F')

  const magIntent = detectRateIntent(
    'Entre MAG DITA e MAG DIT MAC+IPAM GRUPO 2 F7 codigo 2396, para 40 anos renda 1k capital 50k: qual mais barato?',
    'MAG'
  )
  ok('MAG DIT comparison triggers rate intent', magIntent.hasIntent)
  includesAll('captures both MAG product families', magIntent.productHints, ['DIT MAC+IPAM GRUPO 2', 'DITA'])
  includesAll('captures MAG coded product', magIntent.productCodes, ['2396'])
}

function gateRerankDocumentMetadata(): void {
  console.log('\n## rerank document metadata')
  const candidate: SearchResult = {
    id: 'chunk-1',
    content: 'Tabela de taxas por idade.',
    similarity: 0.72,
    metadata: {
      insurer_name: 'Prudential',
      product_name: 'Seguro Vida Inteira',
      product_code: 'WL10G',
      coverage_name: 'Morte',
    },
    source_url: null,
    source_type: 'rate_pdf',
    product_id: 'product-1',
    insurer_id: 'insurer-1',
  }

  const doc = buildRerankDocument(candidate)
  ok('includes insurer metadata', doc.includes('Seguradora: Prudential'))
  ok('includes product metadata', doc.includes('Produto: Seguro Vida Inteira'))
  ok('includes product code metadata', doc.includes('Codigo: WL10G'))
  ok('preserves chunk body', doc.includes('Tabela de taxas por idade.'))
}

function gateAcidentesPessoaisExpansion(): void {
  console.log('\n## acidentes pessoais expansion')
  const expanded = expandQueryWithJargon(
    'Comparar coberturas de Acidentes Pessoais Zurich versus Bradesco - diferencas principais.'
  )
  ok('expands AP comparison with DMH', expanded.includes('DMH'))
  ok('expands AP comparison with AP Premiavel', expanded.includes('AP Premiavel'))
  ok('expands AP comparison with Vida Empresa AP', expanded.includes('Vida Empresa AP'))
}

gateMultiProductRateIntent()
gateRerankDocumentMetadata()
gateAcidentesPessoaisExpansion()

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} passed`)
