/**
 * GRD-04 (canal oraculo): claim-guard tests.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/claim-guard.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { detectClaimVerdictIntent, claimGuidanceMessage } from '@/services/rag/claim-guard'

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

// ---------------------------------------------------------------------------
// DISPARAM — devem retornar true
// ---------------------------------------------------------------------------
console.log('\n## detectClaimVerdictIntent — casos que DEVEM disparar (true)')

function testG09(): void {
  // G-09 verbatim do heldout
  const q = 'O segurado sofreu um acidente de bicicleta e fraturou o tornozelo. Nao encontrei clausula de cobertura nem de exclusao para fratura isolada nos documentos da Icatu. Qual o veredito?'
  const result = detectClaimVerdictIntent(q)
  ok('G-09 verbatim dispara', result === true, `got ${result}`)
}

function testG10(): void {
  // G-10 verbatim do heldout
  const q = 'O segurado faleceu por parada cardiaca durante exercicio fisico. Nao ha clausula de cobertura especifica para esse tipo de morte nos documentos recuperados. O beneficiario pode presumir que e coberto?'
  const result = detectClaimVerdictIntent(q)
  ok('G-10 verbatim dispara', result === true, `got ${result}`)
}

function testInfartoFamilia(): void {
  const q = 'O cliente teve um infarto e faleceu ontem, a familia recebe o capital?'
  const result = detectClaimVerdictIntent(q)
  ok('infarto + familia recebe -> dispara', result === true, `got ${result}`)
}

function testMotoMAG(): void {
  const q = 'Segurado se acidentou de moto, posso acionar o seguro da MAG?'
  const result = detectClaimVerdictIntent(q)
  ok('acidentou + acionar seguro -> dispara', result === true, `got ${result}`)
}

// --- probe adversarial (review 05-05, CR-01): fraseados naturais de corretor ---

function testApolicePaga(): void {
  const q = 'Meu cliente morreu semana passada, a apólice paga?'
  const result = detectClaimVerdictIntent(q)
  ok('cliente morreu + "a apolice paga?" -> dispara', result === true, `got ${result}`)
}

function testSeguroCobre(): void {
  const q = 'O segurado faleceu ontem. O seguro cobre?'
  const result = detectClaimVerdictIntent(q)
  ok('faleceu ontem + "o seguro cobre?" -> dispara', result === true, `got ${result}`)
}

function testApolicePagaIndenizacao(): void {
  const q = 'O cliente sofreu um acidente de moto, a apólice paga a indenização?'
  const result = detectClaimVerdictIntent(q)
  ok('acidente de moto + "apolice paga a indenizacao" -> dispara', result === true, `got ${result}`)
}

function testTitularDireitoCapital(): void {
  const q = 'O titular faleceu em acidente de carro, a familia tem direito ao capital?'
  const result = detectClaimVerdictIntent(q)
  ok('titular faleceu + "tem direito ao capital" -> dispara', result === true, `got ${result}`)
}

function testPossoPresumirCobertura(): void {
  // WR-04: "presumir cobertura" com espaco simples + sujeito "posso"
  const q = 'O segurado faleceu, posso presumir cobertura?'
  const result = detectClaimVerdictIntent(q)
  ok('faleceu + "posso presumir cobertura" -> dispara', result === true, `got ${result}`)
}

// --- probe adversarial (review 05-05, WR-01): evento nominal/participio ---

function testFalecimentoNominal(): void {
  const q = 'houve o falecimento do titular, tem direito à indenização?'
  const result = detectClaimVerdictIntent(q)
  ok('"houve o falecimento" + tem direito -> dispara', result === true, `got ${result}`)
}

function testClienteInternado(): void {
  const q = 'cliente internado com câncer, o seguro cobre o tratamento?'
  const result = detectClaimVerdictIntent(q)
  ok('"cliente internado" + seguro cobre -> dispara', result === true, `got ${result}`)
}

// ---------------------------------------------------------------------------
// NAO DISPARAM — devem retornar false
// ---------------------------------------------------------------------------
console.log('\n## detectClaimVerdictIntent — casos que NAO DEVEM disparar (false)')

function testG11(): void {
  // G-11 verbatim — pergunta CONCEITUAL de contrato
  const q = 'A carencia e o mesmo que o prazo de contestabilidade em um seguro de vida?'
  const result = detectClaimVerdictIntent(q)
  ok('G-11 conceitual NAO dispara', result === false, `got ${result}`)
}

function testG12(): void {
  // G-12 verbatim — pergunta CONCEITUAL de contrato
  const q = 'Todo seguro de vida cobre suicidio desde o primeiro dia de vigencia?'
  const result = detectClaimVerdictIntent(q)
  ok('G-12 conceitual NAO dispara', result === false, `got ${result}`)
}

function testCarencia(): void {
  const q = 'O que e carencia?'
  const result = detectClaimVerdictIntent(q)
  ok('"O que e carencia?" NAO dispara', result === false, `got ${result}`)
}

function testCotacao(): void {
  const q = 'Quanto custa Vida Inteira MAG para homem de 40 anos?'
  const result = detectClaimVerdictIntent(q)
  ok('cotacao NAO dispara', result === false, `got ${result}`)
}

function testDocumentosAposFalecimento(): void {
  // Evento presente mas SEM pedido de veredicto — operacional
  const q = 'Quais documentos preciso quando o segurado falece?'
  const result = detectClaimVerdictIntent(q)
  ok('documentos apos falecimento (sem veredicto) NAO dispara', result === false, `got ${result}`)
}

function testConceitual_CR01(): void {
  // CR-01: pergunta conceitual de cobertura — deve ir ao LLM
  const q = 'Seguro de vida cobre morte em acidente de carro?'
  const result = detectClaimVerdictIntent(q)
  ok('CR-01 conceitual de cobertura NAO dispara', result === false, `got ${result}`)
}

function testParadaCardiacaConceitual(): void {
  // WR-02: conceitual pura — sem evento ocorrido, deve fluir ao LLM
  const q = 'Morte por parada cardíaca é coberta no seguro de vida?'
  const result = detectClaimVerdictIntent(q)
  ok('"morte por parada cardiaca e coberta?" conceitual NAO dispara', result === false, `got ${result}`)
}

function testParadaCardiacaExercicio(): void {
  // WR-02: conceitual pura — sem evento ocorrido, deve fluir ao LLM
  const q = 'Parada cardíaca durante exercício físico é coberta como morte acidental?'
  const result = detectClaimVerdictIntent(q)
  ok('"parada cardiaca ... e coberta como morte acidental?" NAO dispara', result === false, `got ${result}`)
}

// --- WR-03: hipoteticas introduzidas por "se"/"caso" sao conceituais ---

function testHipoteticaInfarto(): void {
  const q = 'Se o segurado teve um infarto antes da carência, está coberto?'
  const result = detectClaimVerdictIntent(q)
  ok('hipotetica "se ... teve um infarto" NAO dispara', result === false, `got ${result}`)
}

function testHipoteticaAcidenteExterior(): void {
  const q = 'Se o cliente sofreu um acidente fora do país, tem cobertura?'
  const result = detectClaimVerdictIntent(q)
  ok('hipotetica "se ... sofreu um acidente" NAO dispara', result === false, `got ${result}`)
}

function testHipoteticaSubjuntivo(): void {
  const q = 'Se o segurado falecer em acidente, é coberto?'
  const result = detectClaimVerdictIntent(q)
  ok('hipotetica "se ... falecer" (subjuntivo) NAO dispara', result === false, `got ${result}`)
}

// ---------------------------------------------------------------------------
// Mensagem de orientacao
// ---------------------------------------------------------------------------
console.log('\n## claimGuidanceMessage — mensagem honesta e inconclusiva')

function testGuidanceMessageContainsPresuma(): void {
  const msg = claimGuidanceMessage()
  ok('mensagem contem "presuma cobertura"', msg.includes('presuma cobertura'), `msg="${msg.slice(0, 100)}"`)
}

function testGuidanceMessageInconclusiva(): void {
  const msg = claimGuidanceMessage().toLowerCase()
  const presumesCoberto = msg.includes('e coberto') || msg.includes('esta coberto') || msg.includes('sera coberto')
  ok('mensagem NAO presume coberto', !presumesCoberto, `found presumption in msg`)
}

function testGuidanceMessageMentionsTrilho(): void {
  const msg = claimGuidanceMessage()
  ok('mensagem menciona trilho pre-sinistro', msg.toLowerCase().includes('pre-sinistro') || msg.toLowerCase().includes('pre sinistro'), `msg="${msg.slice(0, 100)}"`)
}

// Execute all tests
testG09()
testG10()
testInfartoFamilia()
testMotoMAG()
testApolicePaga()
testSeguroCobre()
testApolicePagaIndenizacao()
testTitularDireitoCapital()
testPossoPresumirCobertura()
testFalecimentoNominal()
testClienteInternado()
testG11()
testG12()
testCarencia()
testCotacao()
testDocumentosAposFalecimento()
testConceitual_CR01()
testParadaCardiacaConceitual()
testParadaCardiacaExercicio()
testHipoteticaInfarto()
testHipoteticaAcidenteExterior()
testHipoteticaSubjuntivo()
testGuidanceMessageContainsPresuma()
testGuidanceMessageInconclusiva()
testGuidanceMessageMentionsTrilho()

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('passed')
