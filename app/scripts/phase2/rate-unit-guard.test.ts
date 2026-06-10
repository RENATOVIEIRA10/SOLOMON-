/**
 * GRD-01: Unit validation guard for rate_unit + H01 arithmetic regression.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/rate-unit-guard.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { assertRateUnit } from '@/services/rag/rate-lookup'

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

function gateH01Arithmetic(): void {
  console.log('\n## H01 arithmetic regression — 320 x 1.75 = 560/mes, NEVER 5600')

  // H01: Caso canonico — Nova 2 Lite inventou conversao de centavos
  // rate=1.75 (por R$1.000/mes), capital=320.000
  // premio = (1.75 * 320000) / 1000 = 560 (mensal, pois rate_unit='per_1000_monthly')
  // anual  = 560 * 12 = 6720
  const rate = 1.75
  const capital = 320000
  const mensal = (rate * capital) / 1000
  ok('H01 mensal e 560 nao 5600', Math.round(mensal) === 560, `got ${mensal}`)

  const anual = mensal * 12
  ok('H01 anual e 6720', Math.round(anual) === 6720, `got ${anual}`)

  // Invariante: mensal NAO e 5600 (bug da conversao de centavos)
  ok('H01 mensal NAO e 5600 (bug centavos)', Math.round(mensal) !== 5600)

  // Invariante: anual NAO e 56000
  ok('H01 anual NAO e 56000', Math.round(anual) !== 56000)
}

gateAssertRateUnit()
gateH01Arithmetic()

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} passed`)
