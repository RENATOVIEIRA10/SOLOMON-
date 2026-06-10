/**
 * GRD-01: Unit validation guard for rate_unit + H01 arithmetic regression.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/rate-unit-guard.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { assertRateUnit, formatRateAnswer, type RateRow } from '@/services/rag/rate-lookup'

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

function gateAssertRateUnit(): void {
  console.log('\n## assertRateUnit — known units must not throw')

  // Unidades conhecidas: nao lancam
  const knownUnits = [
    'fixed_brl_monthly',
    'per_1000_monthly',
    'per_1000_annual',
    'per_100_diaria_monthly',
    'per_1000_renda_monthly',
  ]
  for (const unit of knownUnits) {
    let threw = false
    try {
      assertRateUnit(unit, 'test')
    } catch {
      threw = true
    }
    ok(`known unit "${unit}" does not throw`, !threw)
  }

  // Unidade desconhecida: lanca com prefixo [grd-01]
  console.log('\n## assertRateUnit — unknown unit must throw [grd-01]')
  let caughtMessage = ''
  try {
    assertRateUnit('centavos', 'test')
  } catch (err) {
    caughtMessage = err instanceof Error ? err.message : String(err)
  }
  ok(
    'unknown unit "centavos" throws with [grd-01] prefix',
    caughtMessage.includes('[grd-01]'),
    `message: "${caughtMessage}"`
  )

  let caughtMessage2 = ''
  try {
    assertRateUnit('unknown_unit_xyz', 'test')
  } catch (err) {
    caughtMessage2 = err instanceof Error ? err.message : String(err)
  }
  ok(
    'unknown unit "unknown_unit_xyz" throws with [grd-01] prefix',
    caughtMessage2.includes('[grd-01]'),
    `message: "${caughtMessage2}"`
  )
}

// WR-04: o gate H01 exercita o CODIGO DE PRODUCAO (formatRateAnswer →
// formatCapitalPremiumLine), nao uma formula recalculada localmente no teste.
// Se alguem reintroduzir a inversao mensal/anual ou a "conversao de centavos"
// (bug H01 do Nova 2 Lite) no formatter, este gate quebra.
function makeRow(overrides: Partial<RateRow>): RateRow {
  return {
    product_name: 'VIDA INTEIRA',
    product_code: '3082',
    portfolio: null,
    coverage_type: 'morte',
    gender: 'M',
    age: 40,
    period: null,
    rate: 1.75,
    rate_unit: 'per_1000_monthly',
    source_doc_name: 'tabela-premios.pdf',
    source_page: 1,
    version_label: null,
    ...overrides,
  }
}

function gateH01Arithmetic(): void {
  console.log('\n## H01 arithmetic regression (production path) — 320k x 1.75/1000 = 560/mes, NEVER 5600')

  // H01 canonico: rate=1.75 por R$ 1.000/MES, capital=320.000.
  // mensal = (1.75 * 320000) / 1000 = 560; anual = 560 * 12 = 6720.
  const out = formatRateAnswer({
    insurerName: 'MAG',
    intent: { hasIntent: true, age: 40, gender: 'M', capital: 320000 },
    rows: [makeRow({})],
  })
  ok('H01 mensal 560,00 presente na resposta', out.includes('560,00'), `out=\n${out}`)
  ok('H01 anual 6.720,00 presente na resposta', out.includes('6.720,00'), `out=\n${out}`)
  ok('H01 NAO contem 5.600,00/mes (bug centavos)', !/5\.600,00\/mes/.test(out))
  ok('H01 NAO contem 56.000,00', !out.includes('56.000,00'))
  ok('H01 direcao mensal correta (560,00/mes)', /560,00\/mes/.test(out), `out=\n${out}`)
  ok('H01 direcao anual correta (6.720,00\/ano)', /6\.720,00\/ano/.test(out), `out=\n${out}`)

  console.log('\n## H01 inversao mensal/anual — per_1000_annual NAO pode virar mensal')

  // Mesma taxa, unidade ANUAL: premio anual = 560; mensal = 560/12 = 46,67.
  const outAnnual = formatRateAnswer({
    insurerName: 'MAG',
    intent: { hasIntent: true, age: 40, gender: 'M', capital: 320000 },
    rows: [makeRow({ rate_unit: 'per_1000_annual' })],
  })
  ok('per_1000_annual: 560,00/ano presente', /560,00\/ano/.test(outAnnual), `out=\n${outAnnual}`)
  ok('per_1000_annual: mensal aproximado 46,67 presente', outAnnual.includes('46,67'), `out=\n${outAnnual}`)
  ok('per_1000_annual: NAO contem 560,00/mes (inversao)', !/560,00\/mes/.test(outAnnual))
}

gateAssertRateUnit()
gateH01Arithmetic()

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} passed`)
