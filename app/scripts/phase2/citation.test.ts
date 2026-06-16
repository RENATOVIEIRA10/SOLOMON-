/**
 * TST-03: citation.ts — testes unitários de extração e auditoria de citações.
 *
 * Cobre: mapeamento [N] para fontes, índice inválido, texto sem citação,
 * citação duplicada, coverage, fora de ordem.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/citation.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import fs from 'fs'
import path from 'path'
import { extractCitations, auditCitations } from '@/services/rag/citation'
import type { ContextBlock } from '@/services/rag/context-builder'

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

function makeSources(count: number): ContextBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    insurerName: `Seguradora ${String.fromCharCode(65 + i)}`,
    productName: `Produto ${i + 1}`,
    susepProcess: `15414.${900000 + i}/2024-01`,
    sourceUrl: `https://seguradora-${String.fromCharCode(65 + i).toLowerCase()}.com/produto-${i + 1}`,
    content: `Conteúdo do bloco ${i + 1}. Cláusula de cobertura por morte.`,
  }))
}

// ---------------------------------------------------------------------------
// BLOCO 1: citações válidas mapeiam para fontes corretas
// ---------------------------------------------------------------------------
console.log('\n## extractCitations — citações válidas mapeiam para fontes')

// C01 — [1][2] com 3 fontes
{
  const sources = makeSources(3)
  const response = 'A cobertura de morte é garantida [1] e a carência é de 2 anos [2].'
  const citations = extractCitations(response, sources)

  ok('C01 retorna 2 citações', citations.length === 2, `got ${citations.length}`)
  ok('C01 citacao[0].index=1', citations[0].index === 1, `got ${citations[0].index}`)
  ok('C01 citacao[1].index=2', citations[1].index === 2, `got ${citations[1].index}`)
  ok('C01 citacao[0].insurerName = Seguradora A', citations[0].insurerName === 'Seguradora A', `got "${citations[0].insurerName}"`)
  ok('C01 citacao[1].insurerName = Seguradora B', citations[1].insurerName === 'Seguradora B', `got "${citations[1].insurerName}"`)
  ok('C01 citacao[0].sourceUrl presente', citations[0].sourceUrl !== null, `got ${citations[0].sourceUrl}`)
}

// C02 — apenas [3] de 3 fontes
{
  const sources = makeSources(3)
  const response = 'Produto referenciado em [3] é o único disponível.'
  const citations = extractCitations(response, sources)

  ok('C02 retorna 1 citação', citations.length === 1, `got ${citations.length}`)
  ok('C02 citacao.index=3', citations[0].index === 3, `got ${citations[0].index}`)
  ok('C02 citacao.insurerName = Seguradora C', citations[0].insurerName === 'Seguradora C', `got "${citations[0].insurerName}"`)
}

// ---------------------------------------------------------------------------
// BLOCO 2: índice inválido — detectado como invalidCitationIndexes
// ---------------------------------------------------------------------------
console.log('\n## auditCitations — índice fora de range detectado como inválido')

// C03 — [9] com apenas 3 fontes → invalidCitationIndexes inclui 9
{
  const sources = makeSources(3)
  const response = 'Esta afirmação está em [9] mas só há 3 fontes.'
  const audit = auditCitations(response, sources)

  ok('C03 citations.length=0 (nenhum válido)', audit.citations.length === 0, `got ${audit.citations.length}`)
  ok('C03 referencedIndexes=[9]', audit.referencedIndexes.length === 1 && audit.referencedIndexes[0] === 9, `got ${JSON.stringify(audit.referencedIndexes)}`)
  ok('C03 invalidCitationIndexes=[9]', audit.invalidCitationIndexes.length === 1 && audit.invalidCitationIndexes[0] === 9, `got ${JSON.stringify(audit.invalidCitationIndexes)}`)
  ok('C03 citationCoverage=0', audit.citationCoverage === 0, `got ${audit.citationCoverage}`)
}

// C04 — mix: [1] válido + [9] inválido
{
  const sources = makeSources(3)
  const response = 'Informação válida em [1]. Mas [9] não existe.'
  const audit = auditCitations(response, sources)

  ok('C04 citations.length=1 (só [1] válido)', audit.citations.length === 1, `got ${audit.citations.length}`)
  ok('C04 invalidCitationIndexes=[9]', audit.invalidCitationIndexes.includes(9), `got ${JSON.stringify(audit.invalidCitationIndexes)}`)
  ok('C04 citationCoverage > 0', audit.citationCoverage > 0, `got ${audit.citationCoverage}`)
}

// ---------------------------------------------------------------------------
// BLOCO 3: texto sem citação — coverage 0
// ---------------------------------------------------------------------------
console.log('\n## auditCitations — texto sem citação')

// C05 — nenhum [N] no texto
{
  const sources = makeSources(3)
  const response = 'Esta resposta não tem nenhuma referência numérica.'
  const audit = auditCitations(response, sources)

  ok('C05 citations.length=0', audit.citations.length === 0, `got ${audit.citations.length}`)
  ok('C05 referencedIndexes=[]', audit.referencedIndexes.length === 0, `got ${JSON.stringify(audit.referencedIndexes)}`)
  ok('C05 citationCoverage=0', audit.citationCoverage === 0, `got ${audit.citationCoverage}`)
  ok('C05 invalidCitationIndexes=[]', audit.invalidCitationIndexes.length === 0, `got ${JSON.stringify(audit.invalidCitationIndexes)}`)
}

// C06 — texto vazio
{
  const sources = makeSources(2)
  const audit = auditCitations('', sources)

  ok('C06 texto vazio: citations=[]', audit.citations.length === 0)
  ok('C06 texto vazio: coverage=0', audit.citationCoverage === 0)
}

// ---------------------------------------------------------------------------
// BLOCO 4: citação duplicada — conta apenas uma vez
// ---------------------------------------------------------------------------
console.log('\n## auditCitations — citação duplicada conta uma vez')

// C07 — [1] aparece duas vezes
{
  const sources = makeSources(3)
  const response = 'A cobertura [1] é ampla. Confirmado em [1] novamente.'
  const audit = auditCitations(response, sources)

  ok('C07 referencedIndexes=[1] (dedupado)', audit.referencedIndexes.length === 1, `got ${JSON.stringify(audit.referencedIndexes)}`)
  ok('C07 citations.length=1 (dedupado)', audit.citations.length === 1, `got ${audit.citations.length}`)
  ok('C07 citationCoverage=1/3 ≈ 0.33', Math.abs(audit.citationCoverage - 1 / 3) < 0.01, `got ${audit.citationCoverage}`)
}

// ---------------------------------------------------------------------------
// BLOCO 5: citação fora de ordem — ordenada por index
// ---------------------------------------------------------------------------
console.log('\n## auditCitations — citações fora de ordem → ordenadas')

// C08 — [3][1][2] na resposta → deve retornar ordenado [1,2,3]
{
  const sources = makeSources(3)
  const response = 'Ver [3] para exclusões e [1] para cobertura e [2] para carência.'
  const audit = auditCitations(response, sources)

  ok('C08 citations.length=3', audit.citations.length === 3, `got ${audit.citations.length}`)
  ok('C08 ordenado: [0]=1', audit.citations[0].index === 1, `got ${audit.citations[0].index}`)
  ok('C08 ordenado: [1]=2', audit.citations[1].index === 2, `got ${audit.citations[1].index}`)
  ok('C08 ordenado: [2]=3', audit.citations[2].index === 3, `got ${audit.citations[2].index}`)
}

// ---------------------------------------------------------------------------
// BLOCO 6: excerpt truncado com "..."
// ---------------------------------------------------------------------------
console.log('\n## extractCitations — excerpt truncado em textos longos')

// C09 — conteúdo longo (>200 chars) → excerpt termina com "..."
{
  const longContent = 'A '.repeat(150) // 300 chars
  const sources: ContextBlock[] = [{
    index: 1,
    insurerName: 'Seguradora X',
    productName: 'Produto X',
    susepProcess: null,
    sourceUrl: null,
    content: longContent,
  }]
  const citations = extractCitations('[1] confirma a cobertura.', sources)

  ok('C09 1 citação', citations.length === 1)
  finding('C09', 'C09 excerpt termina com "..." (truncado)', citations[0].excerpt.endsWith('...'), {
    func: 'extractCitations',
    input: 'content com 300 chars',
    expected: 'excerpt.endsWith("...")',
    obtained: `excerpt.endsWith("...")=${citations[0].excerpt.endsWith('...')}, len=${citations[0].excerpt.length}`,
    hypothesis: 'truncateExcerpt(content, 200) deve adicionar "..." quando content.length > 200',
  })
  ok('C09 excerpt.length <= 210 (não excede muito)', citations[0].excerpt.length <= 210, `got ${citations[0].excerpt.length}`)
}

// ---------------------------------------------------------------------------
// BLOCO 7: citationCoverage — proporção correta
// ---------------------------------------------------------------------------
console.log('\n## auditCitations — citationCoverage proporcional')

// C10 — 2 de 4 fontes citadas → coverage = 0.5
{
  const sources = makeSources(4)
  const response = 'Dados em [1] e [3].'
  const audit = auditCitations(response, sources)

  ok('C10 citations.length=2', audit.citations.length === 2, `got ${audit.citations.length}`)
  ok('C10 citationCoverage=0.5', Math.abs(audit.citationCoverage - 0.5) < 0.01, `got ${audit.citationCoverage}`)
}

// C11 — todas as 3 fontes citadas → coverage = 1.0
{
  const sources = makeSources(3)
  const response = 'Ver [1], [2] e [3].'
  const audit = auditCitations(response, sources)

  ok('C11 citationCoverage=1.0', Math.abs(audit.citationCoverage - 1.0) < 0.01, `got ${audit.citationCoverage}`)
}

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
## TST-03 — citation.ts (citation.test.ts)

Rodado em: ${new Date().toISOString()}
Findings encontrados: ${findingLog.length}

| ID | Função | Input | Esperado | Obtido | Hipótese |
|----|--------|-------|----------|--------|----------|
${findingLog.map((f) => `| FINDING-${f.id} | ${f.func} | \`${f.input.slice(0, 60)}\` | ${f.expected} | ${f.obtained} | ${f.hypothesis} |`).join('\n')}

`

  const header = existingContent.startsWith('#') ? existingContent : `# FINDINGS — Ciclo 003\n\n`

  if (!existingContent.includes('## TST-03')) {
    fs.writeFileSync(findingsPath, header + newSection, 'utf8')
    console.log(`\nFINDINGS TST-03 escritos em ${findingsPath}`)
  } else {
    console.log('\nFINDINGS-ciclo003.md já contém TST-03')
  }
}

if (failed > 0) {
  console.error(`\n${failed} teste(s) falhou`)
  process.exit(1)
}

console.log('\npassed')
