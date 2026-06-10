/**
 * GRD-03: domain-guard tests.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/domain-guard.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { detectOutOfDomainQuery, refusalMessageForDomain } from '@/services/rag/domain-guard'

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

console.log('\n## detectOutOfDomainQuery — out-of-domain cases')

function gateAutoQuote(): void {
  const r = detectOutOfDomainQuery('Quanto custa seguro de auto da Porto?')
  ok('seguro de auto -> isOutOfDomain', r.isOutOfDomain === true, `got isOutOfDomain=${r.isOutOfDomain}`)
  ok('seguro de auto -> detectedDomain=auto', r.detectedDomain === 'auto', `got domain=${r.detectedDomain}`)
}

function gateCarroSimple(): void {
  const r = detectOutOfDomainQuery('seguro do meu carro')
  ok('meu carro -> isOutOfDomain', r.isOutOfDomain === true, `got isOutOfDomain=${r.isOutOfDomain}`)
  ok('meu carro -> detectedDomain=auto', r.detectedDomain === 'auto', `got domain=${r.detectedDomain}`)
}

function gateResidencial(): void {
  const r = detectOutOfDomainQuery('seguro residencial cobre incendio?')
  ok('seguro residencial -> isOutOfDomain', r.isOutOfDomain === true, `got isOutOfDomain=${r.isOutOfDomain}`)
  ok('seguro residencial -> detectedDomain=residencial', r.detectedDomain === 'residencial', `got domain=${r.detectedDomain}`)
}

function gateViagem(): void {
  const r = detectOutOfDomainQuery('seguro viagem internacional')
  ok('seguro viagem -> isOutOfDomain', r.isOutOfDomain === true, `got isOutOfDomain=${r.isOutOfDomain}`)
  ok('seguro viagem -> detectedDomain=viagem', r.detectedDomain === 'viagem', `got domain=${r.detectedDomain}`)
}

console.log('\n## detectOutOfDomainQuery — in-domain cases (vida NAO bloqueada)')

function gateVidaVivaMorte(): void {
  const r = detectOutOfDomainQuery('qual a cobertura de morte do Vida Viva?')
  ok('cobertura de morte vida -> NOT blocked', r.isOutOfDomain === false, `got isOutOfDomain=${r.isOutOfDomain}`)
}

function gateInvalidezAcidente(): void {
  const r = detectOutOfDomainQuery('invalidez por acidente cobre o que?')
  ok('invalidez por acidente -> NOT blocked', r.isOutOfDomain === false, `got isOutOfDomain=${r.isOutOfDomain}`)
}

function gateSeguroDeVidaCarencia(): void {
  const r = detectOutOfDomainQuery('seguro de vida tem carencia?')
  ok('seguro de vida carencia -> NOT blocked', r.isOutOfDomain === false, `got isOutOfDomain=${r.isOutOfDomain}`)
}

console.log('\n## refusalMessageForDomain — mensagem honesta')

function gateRefusalAuto(): void {
  const msg = refusalMessageForDomain('auto')
  ok('refusal auto contains "vida"', msg.toLowerCase().includes('vida'), `msg="${msg}"`)
  ok('refusal auto contains "auto"', msg.toLowerCase().includes('auto'), `msg="${msg}"`)
}

gateAutoQuote()
gateCarroSimple()
gateResidencial()
gateViagem()
gateVidaVivaMorte()
gateInvalidezAcidente()
gateSeguroDeVidaCarencia()
gateRefusalAuto()

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('passed')
