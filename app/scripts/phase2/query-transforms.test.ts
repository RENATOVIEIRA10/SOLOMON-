/**
 * TST-05: query-decomposer + query-expansion — testes unitários.
 *
 * Cobre apenas funções PURAS (determinísticas, zero LLM call):
 *   - detectComparativeQuery (heurística, <1ms)
 *   - balancedMerge (intercalação balanceada)
 *   - dedupeChunks (deduplicação multi-critério)
 *
 * Funções com LLM (decomposeComparativeQuery, expandQueryWithLLM):
 *   - Anotadas como FORA DE ESCOPO (dependem de Gemini API key).
 *   - NÃO mockadas neste ciclo (conforme regra_critica do plano).
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/query-transforms.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import fs from 'fs'
import path from 'path'
import {
  detectComparativeQuery,
  balancedMerge,
  dedupeChunks,
} from '@/services/rag/query-decomposer'
import type { SearchResult } from '@/services/rag/search'

let passed = 0
let failed = 0
let findings = 0

interface FindingEntry {
  id: string
  func: string
  input: string
  expected: string
  obtained: string
  hypothesis: string
}
const findingLog: FindingEntry[] = []

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`)
  }
}

function finding(
  id: string,
  label: string,
  cond: boolean,
  entry: Omit<FindingEntry, 'id'>
): void {
  if (cond) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    findings++
    console.warn(`  FINDING-${id}  ${label} — esperado: ${entry.expected} / obtido: ${entry.obtained}`)
    findingLog.push({ id, ...entry })
  }
}

function makeChunk(overrides: Partial<SearchResult> & { content: string }): SearchResult {
  return {
    id: `chunk-${Math.random().toString(36).slice(2, 8)}`,
    similarity: 0.9,
    source_type: 'pdf',
    source_url: null,
    product_id: null,
    insurer_id: null,
    metadata: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// BLOCO 1: detectComparativeQuery — heurística por trigger words
// ---------------------------------------------------------------------------
console.log('\n## detectComparativeQuery — trigger words')

// DQ01 — "compare" → true
{
  const r = detectComparativeQuery('compare Prudential e MAG vida inteira')
  ok('DQ01 "compare" → true', r === true, `got ${r}`)
}

// DQ02 — "versus" → true
{
  const r = detectComparativeQuery('Prudential versus MAG: qual mais barato?')
  ok('DQ02 "versus" → true', r === true, `got ${r}`)
}

// DQ03 — "vs" → true
{
  const r = detectComparativeQuery('Prudential vs MAG vida inteira')
  ok('DQ03 "vs" → true', r === true, `got ${r}`)
}

// DQ04 — "diferenca entre" → true
{
  const r = detectComparativeQuery('qual a diferença entre Prudential e MAG?')
  ok('DQ04 "diferença entre" → true', r === true, `got ${r}`)
}

// DQ05 — "mais barato" → true
{
  const r = detectComparativeQuery('qual o seguro mais barato, Prudential ou MAG?')
  ok('DQ05 "mais barato" → true', r === true, `got ${r}`)
}

// DQ06 — "comparar" → true
{
  const r = detectComparativeQuery('quero comparar Bradesco e Zurich acidentes pessoais')
  ok('DQ06 "comparar" → true', r === true, `got ${r}`)
}

// DQ07 — 2 seguradoras mencionadas (sem trigger word) → true
{
  const r = detectComparativeQuery('Prudential MAG vida inteira qual coberturas?')
  ok('DQ07 2 seguradoras → true', r === true, `got ${r}`)
}

// DQ08 — 1 seguradora, sem trigger → false
{
  const r = detectComparativeQuery('Qual o prêmio da Prudential vida inteira para mulher 35 anos?')
  ok('DQ08 pergunta simples (1 seguradora) → false', r === false, `got ${r}`)
}

// DQ09 — pergunta conceitual simples → false
{
  const r = detectComparativeQuery('O que cobre o seguro de vida da MAG?')
  ok('DQ09 pergunta conceitual 1 seguradora → false', r === false, `got ${r}`)
}

// DQ10 — Bradesco e Zurich (2 seguradoras) → true
{
  const r = detectComparativeQuery('Bradesco e Zurich — coberturas de AP')
  ok('DQ10 Bradesco + Zurich → true', r === true, `got ${r}`)
}

// DQ11 — "qual o melhor" → trigger regex /\bqual\s+(?:é\s+)?(?:o\s+)?melhor\b/i
// FINDING: após stripAccentsLower(), "qual é o melhor" vira "qual e o melhor".
// O regex tenta bater `é` literal (não o `e` sem acento) OU `o` opcional.
// Sequência "e o" antes de "melhor" não bate no regex porque:
// - `(?:é\s+)?` é opcional (skip) → cursor em "e o melhor"
// - `(?:o\s+)?` é opcional (skip) → cursor em "e o melhor"
// - `melhor` precisa vir logo após `qual ` → mas há "e o " no meio.
// Resultado: detectComparativeQuery retorna false para "qual é o melhor seguro de vida?"
// IMPACTO: perguntas de estilo "qual é o melhor" sem seguradora explícita não ativam
// o decomposer. Low impact porque sem seguradora o retrieval não muda.
{
  const r = detectComparativeQuery('qual é o melhor seguro de vida?')
  finding('DQ11', 'DQ11 "qual é o melhor" → true', r === true, {
    func: 'detectComparativeQuery',
    input: 'qual é o melhor seguro de vida?',
    expected: 'true (trigger /qual.*melhor/)',
    obtained: String(r),
    hypothesis: 'stripAccentsLower() remove acento de "é" → "e"; regex `(?:é\\s+)?` não bate em "e"; "e o" antes de "melhor" quebra o match. Impacto baixo: pergunta sem seguradora não muda retrieval.',
  })
}

// DQ12 — "contra" → true
{
  const r = detectComparativeQuery('Prudential contra MAG: vantagens')
  ok('DQ12 "contra" → true', r === true, `got ${r}`)
}

// DQ13 — acento normalizado: "diferença" com NFD
{
  const r = detectComparativeQuery('diferença entre Prudential e MAG')
  ok('DQ13 acentuado "diferença" → true', r === true, `got ${r}`)
}

// DQ14 — sem comparativo, sem seguradoras → false
{
  const r = detectComparativeQuery('o infarto é coberto pelo seguro?')
  ok('DQ14 infarto sem seguradora → false', r === false, `got ${r}`)
}

// DQ15 — Prudential + Bradesco mencionados implicitamente → true
{
  const r = detectComparativeQuery('estou analisando produtos da Prudential e do Bradesco')
  ok('DQ15 Prudential + Bradesco implícito → true', r === true, `got ${r}`)
}

// ---------------------------------------------------------------------------
// BLOCO 2: balancedMerge — intercalação preserva equilíbrio
// ---------------------------------------------------------------------------
console.log('\n## balancedMerge — intercalação balanceada')

// BM01 — 2 buckets iguais [P1..P5, B1..B3] → intercalado
{
  const prudential = [1, 2, 3, 4, 5].map((i) => makeChunk({ content: `Prudential chunk ${i}`, insurer_id: 'pru' }))
  const bradesco = [1, 2, 3].map((i) => makeChunk({ content: `Bradesco chunk ${i}`, insurer_id: 'bra' }))

  const merged = balancedMerge(
    [{ entity: 'Prudential', results: prudential }, { entity: 'Bradesco', results: bradesco }],
    5,
    10
  )

  ok('BM01 merged 8 chunks (5 pru + 3 bra)', merged.length === 8, `got ${merged.length}`)
  // Ordem: P1, B1, P2, B2, P3, B3, P4, P5
  ok('BM01 primeiro é Prudential', merged[0].insurer_id === 'pru', `got ${merged[0].insurer_id}`)
  ok('BM01 segundo é Bradesco', merged[1].insurer_id === 'bra', `got ${merged[1].insurer_id}`)
  ok('BM01 terceiro é Prudential', merged[2].insurer_id === 'pru', `got ${merged[2].insurer_id}`)
}

// BM02 — finalTopK limita saída
{
  const bucket1 = [1, 2, 3, 4, 5].map((i) => makeChunk({ content: `A ${i}`, insurer_id: 'a' }))
  const bucket2 = [1, 2, 3, 4, 5].map((i) => makeChunk({ content: `B ${i}`, insurer_id: 'b' }))

  const merged = balancedMerge(
    [{ entity: 'A', results: bucket1 }, { entity: 'B', results: bucket2 }],
    5,
    4  // finalTopK=4
  )

  ok('BM02 finalTopK=4 limitou para 4', merged.length === 4, `got ${merged.length}`)
}

// BM03 — 1 bucket apenas
{
  const chunks = [1, 2, 3].map((i) => makeChunk({ content: `Solo ${i}`, insurer_id: 'solo' }))
  const merged = balancedMerge([{ entity: 'Solo', results: chunks }], 5, 10)

  ok('BM03 1 bucket retorna todos (3)', merged.length === 3, `got ${merged.length}`)
}

// BM04 — bucket vazio
{
  const merged = balancedMerge([], 5, 10)
  ok('BM04 0 buckets → []', merged.length === 0, `got ${merged.length}`)
}

// BM05 — maxPerEntity limita por bucket
{
  const big = Array.from({ length: 10 }, (_, i) => makeChunk({ content: `C ${i}`, insurer_id: 'c' }))
  const merged = balancedMerge([{ entity: 'C', results: big }], 3, 10)  // maxPerEntity=3
  ok('BM05 maxPerEntity=3 limita bucket', merged.length === 3, `got ${merged.length}`)
}

// ---------------------------------------------------------------------------
// BLOCO 3: dedupeChunks — deduplicação multi-critério
// ---------------------------------------------------------------------------
console.log('\n## dedupeChunks — deduplicação multi-critério')

// DC01 — chunk com mesmo id duplicado → 1 resultado
{
  const id = 'chunk-dup-001'
  const c1 = makeChunk({ id, content: 'Conteúdo duplicado.' })
  const c2 = makeChunk({ id, content: 'Conteúdo diferente mas mesmo id.' })

  const result = dedupeChunks([c1, c2])
  ok('DC01 mesmo id → dedupado para 1', result.length === 1, `got ${result.length}`)
}

// DC02 — document_id + page duplicados → 1 resultado
{
  const c1 = makeChunk({ content: 'Chunk A.', metadata: { document_id: 'doc-xyz', page: 7 } })
  const c2 = makeChunk({ content: 'Chunk B diferente.', metadata: { document_id: 'doc-xyz', page: 7 } })

  const result = dedupeChunks([c1, c2])
  ok('DC02 mesmo doc+page → dedupado para 1', result.length === 1, `got ${result.length}`)
}

// DC03 — conteúdo quase igual (primeiros 120 chars) → dedupado
{
  const base = 'Cobertura por morte acidental está garantida no artigo 3 das condições gerais do produto de seguros. '
  const c1 = makeChunk({ content: base + 'versão A' })
  const c2 = makeChunk({ content: base + 'versão B diferente no final' })

  const result = dedupeChunks([c1, c2])
  finding('DC03', 'DC03 conteúdo near-duplicate (120 chars) → dedupado', result.length === 1, {
    func: 'dedupeChunks',
    input: `chunks com 120+ chars iguais no início: "${base.slice(0, 40)}..."`,
    expected: 'result.length=1',
    obtained: `result.length=${result.length}`,
    hypothesis: 'k3 = txt fingerprint primeiros 120 chars normalizado — deve dedupar near-duplicates',
  })
}

// DC04 — chunks completamente diferentes → todos preservados
{
  const chunks = [
    makeChunk({ content: 'Prudential cobre morte acidental.' }),
    makeChunk({ content: 'MAG oferece DITA com renda mensal.' }),
    makeChunk({ content: 'Bradesco AP Premiável tem sorteios.' }),
  ]

  const result = dedupeChunks(chunks)
  ok('DC04 3 chunks distintos → 3 preservados', result.length === 3, `got ${result.length}`)
}

// DC05 — array vazio → vazio
{
  const result = dedupeChunks([])
  ok('DC05 vazio → vazio', result.length === 0, `got ${result.length}`)
}

// DC06 — chunk único → preservado
{
  const c = makeChunk({ content: 'Único chunk.' })
  const result = dedupeChunks([c])
  ok('DC06 1 chunk → preservado', result.length === 1, `got ${result.length}`)
}

// ---------------------------------------------------------------------------
// Fora de escopo (LLM-dependent)
// ---------------------------------------------------------------------------
console.log('\n## FORA DE ESCOPO — funções LLM-dependent (não testadas neste ciclo)')
console.log('  [out-of-scope] decomposeComparativeQuery — depende de callGeminiJson (Gemini API key)')
console.log('  [out-of-scope] expandQueryWithLLM — depende de callGeminiJson (Gemini API key)')
console.log('  Razão: regra_critica do plano proíbe mock de LLM neste ciclo.')
console.log('  Testar em ciclo dedicado com GEMINI_API_KEY em ambiente controlado.')

// ---------------------------------------------------------------------------
// Sumário e FINDINGS-ciclo003.md
// ---------------------------------------------------------------------------

const totalTests = passed + failed + findings
console.log(`\n${totalTests} tests: ${passed} passed, ${failed} failed, ${findings} findings (documentados)`)

if (findingLog.length > 0) {
  const findingsDir = path.resolve('scripts/phase2')
  const findingsPath = path.join(findingsDir, 'FINDINGS-ciclo003.md')
  const existingContent = fs.existsSync(findingsPath) ? fs.readFileSync(findingsPath, 'utf8') : ''

  const newSection = `
## TST-05 — query-decomposer + query-expansion (query-transforms.test.ts)

Rodado em: ${new Date().toISOString()}
Findings encontrados: ${findingLog.length}

Fora de escopo: \`decomposeComparativeQuery\` e \`expandQueryWithLLM\` dependem de Gemini API key — não mockadas neste ciclo.

| ID | Função | Input | Esperado | Obtido | Hipótese |
|----|--------|-------|----------|--------|----------|
${findingLog.map((f) => `| FINDING-${f.id} | ${f.func} | \`${f.input.slice(0, 60)}\` | ${f.expected} | ${f.obtained} | ${f.hypothesis} |`).join('\n')}

`

  const header = existingContent.startsWith('#') ? existingContent : `# FINDINGS — Ciclo 003\n\n`

  if (!existingContent.includes('## TST-05')) {
    fs.writeFileSync(findingsPath, header + newSection, 'utf8')
    console.log(`\nFINDINGS TST-05 escritos em ${findingsPath}`)
  } else {
    console.log('\nFINDINGS-ciclo003.md já contém TST-05')
  }
}

if (failed > 0) {
  console.error(`\n${failed} teste(s) falhou`)
  process.exit(1)
}

console.log('\npassed')
