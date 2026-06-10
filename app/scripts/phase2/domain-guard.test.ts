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

// CR-01: vida/AP que menciona veiculo/carro/guincho como CAUSA do sinistro
// NUNCA pode ser bloqueada como out-of-domain (falsos positivos confirmados
// empiricamente na review da fase 5).
console.log('\n## CR-01 regression — vida/AP com mencao a veiculo NAO bloqueada')

const CR01_IN_DOMAIN_CASES = [
  'Seguro de vida cobre morte em acidente de veiculo?',
  'O seguro de vida da Prudential cobre morte em acidente de veículo?',
  'Morte acidental em colisao de veiculo e coberta pela apolice AP?',
  'Segurado faleceu ao ser atropelado por um veiculo, o AP cobre?',
  'Seguro de vida paga se o segurado morrer em acidente do carro?',
  'IPA cobre invalidez causada por capotamento do carro?',
  'A assistencia funeral inclui guincho?',
]

function gateCR01FalsePositives(): void {
  for (const question of CR01_IN_DOMAIN_CASES) {
    const r = detectOutOfDomainQuery(question)
    ok(
      `CR-01 NOT blocked: "${question}"`,
      r.isOutOfDomain === false,
      `got isOutOfDomain=${r.isOutOfDomain}, domain=${r.detectedDomain}`
    )
  }
}

// G-06 do heldout: produto auto EXPLICITO continua bloqueado mesmo com a
// supressao por vocabulario de vida ("franquia" aparece na pergunta).
function gateG06StillBlocked(): void {
  const r = detectOutOfDomainQuery('Qual a franquia do meu seguro de carro no caso de colisao com outro veiculo?')
  ok('G-06 franquia seguro de carro -> isOutOfDomain', r.isOutOfDomain === true, `got isOutOfDomain=${r.isOutOfDomain}`)
  ok('G-06 -> detectedDomain=auto', r.detectedDomain === 'auto', `got domain=${r.detectedDomain}`)
}

// WR-05: input acentuado em NFC (forma tipica de mobile) — strip de acentos
// com escapes unicode (u0300-u036f) precisa continuar funcionando.
function gateAccentedAuto(): void {
  const r = detectOutOfDomainQuery('Quanto custa seguro de automóvel?')
  ok('acentuado "automóvel" -> isOutOfDomain', r.isOutOfDomain === true, `got isOutOfDomain=${r.isOutOfDomain}`)
  ok('acentuado "automóvel" -> detectedDomain=auto', r.detectedDomain === 'auto', `got domain=${r.detectedDomain}`)
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
gateCR01FalsePositives()
gateG06StillBlocked()
gateAccentedAuto()
gateRefusalAuto()

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('passed')
