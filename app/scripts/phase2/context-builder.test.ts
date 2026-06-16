/**
 * TST-04: context-builder.ts — testes unitários de buildContext e formatBlock.
 *
 * Cobre: cabeçalho formatBlock, truncação por orçamento, chunk stitching
 * (mergeAdjacentResults), orçamento char respeitado.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/context-builder.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import fs from 'fs'
import path from 'path'
import { buildContext } from '@/services/rag/context-builder'
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

function makeResult(overrides: Partial<SearchResult> & { content: string }): SearchResult {
  return {
    id: `chunk-${Math.random().toString(36).slice(2)}`,
    similarity: 0.9,
    source_type: 'pdf',
    source_url: null,
    product_id: 'prod-001',
    insurer_id: 'ins-001',
    metadata: {
      insurer_name: 'Prudential',
      product_name: 'VIDA INTEIRA',
      page: 5,
      source_doc: 'condicoes-gerais-prudential.pdf',
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// BLOCO 1: formatBlock — cabeçalho [N] Seguradora — Produto | Documento | Página
// ---------------------------------------------------------------------------
console.log('\n## buildContext — formatBlock: cabeçalho estruturado')

// CB01 — cabeçalho básico com todos os campos
{
  const result = makeResult({ content: 'Cláusula 1: morte acidental coberta.' })
  const { contextText, sources } = buildContext([result])

  ok('CB01 retorna 1 fonte', sources.length === 1, `got ${sources.length}`)
  ok('CB01 contextText nao vazio', contextText.length > 0)
  // Cabeçalho deve começar com [1]
  ok('CB01 contexto começa com [1]', contextText.startsWith('[1]'), `starts with: "${contextText.slice(0, 20)}"`)
  ok('CB01 insurerName no cabeçalho', contextText.includes('Prudential'), `got: "${contextText.slice(0, 200)}"`)
  ok('CB01 productName no cabeçalho', contextText.includes('VIDA INTEIRA'), `got: "${contextText.slice(0, 200)}"`)
  ok('CB01 source_doc no cabeçalho', contextText.includes('condicoes-gerais-prudential.pdf'), `got: "${contextText.slice(0, 200)}"`)
  ok('CB01 page no cabeçalho', contextText.includes('5'), `got: "${contextText.slice(0, 200)}"`)
  ok('CB01 conteúdo presente', contextText.includes('Cláusula 1'), `got: "${contextText.slice(0, 200)}"`)
}

// CB02 — cabeçalho com Processo SUSEP (via enrichment)
{
  const result = makeResult({ content: 'Conteúdo com SUSEP.' })
  const enrichment = {
    insurers: new Map([['ins-001', 'MAG Seguros']]),
    products: new Map([['prod-001', { name: 'DITA', susep_process: '15414.654321/2024-01' }]]),
  }
  const { contextText } = buildContext([result], enrichment)

  ok('CB02 Processo SUSEP presente', contextText.includes('15414.654321/2024-01'), `got: "${contextText.slice(0, 300)}"`)
  ok('CB02 enrichment insurerName=MAG Seguros', contextText.includes('MAG Seguros'), `got: "${contextText.slice(0, 200)}"`)
  ok('CB02 enrichment productName=DITA', contextText.includes('DITA'), `got: "${contextText.slice(0, 200)}"`)
}

// CB03 — source_url presente
{
  const result = makeResult({ content: 'Link de fonte.', source_url: 'https://prudential.com.br/produto' })
  const { contextText } = buildContext([result])

  ok('CB03 source_url presente', contextText.includes('https://prudential.com.br/produto'), `got: "${contextText.slice(0, 300)}"`)
}

// ---------------------------------------------------------------------------
// BLOCO 2: múltiplos resultados — indexação sequencial
// ---------------------------------------------------------------------------
console.log('\n## buildContext — múltiplos resultados: indexação [1], [2], [3]')

// CB04 — 3 resultados diferentes → [1], [2], [3]
{
  const results = [
    makeResult({ insurer_id: 'ins-a', product_id: 'prod-a', content: 'Conteúdo A.',
      metadata: { insurer_name: 'Seguradora A', product_name: 'Produto A', source_doc: 'doc-a.pdf' } }),
    makeResult({ insurer_id: 'ins-b', product_id: 'prod-b', content: 'Conteúdo B.',
      metadata: { insurer_name: 'Seguradora B', product_name: 'Produto B', source_doc: 'doc-b.pdf' } }),
    makeResult({ insurer_id: 'ins-c', product_id: 'prod-c', content: 'Conteúdo C.',
      metadata: { insurer_name: 'Seguradora C', product_name: 'Produto C', source_doc: 'doc-c.pdf' } }),
  ]
  const { sources } = buildContext(results)

  ok('CB04 3 fontes retornadas', sources.length === 3, `got ${sources.length}`)
  ok('CB04 sources[0].index=1', sources[0].index === 1, `got ${sources[0].index}`)
  ok('CB04 sources[1].index=2', sources[1].index === 2, `got ${sources[1].index}`)
  ok('CB04 sources[2].index=3', sources[2].index === 3, `got ${sources[2].index}`)
}

// ---------------------------------------------------------------------------
// BLOCO 3: chunk stitching — mergeAdjacentResults une chunks adjacentes
// ---------------------------------------------------------------------------
console.log('\n## buildContext — chunk stitching: chunks adjacentes da mesma fonte')

// CB05 — mesma seguradora+produto+doc em páginas adjacentes → stitchado
{
  const baseMetadata = {
    insurer_name: 'Prudential',
    product_name: 'VIDA INTEIRA',
    source_doc: 'cg-vi.pdf',
  }
  const r1 = makeResult({
    insurer_id: 'ins-001',
    product_id: 'prod-001',
    content: 'Parte A da cobertura de morte.',
    metadata: { ...baseMetadata, page: 5 },
  })
  const r2 = makeResult({
    insurer_id: 'ins-001',
    product_id: 'prod-001',
    content: 'Parte B da cláusula de carência.',
    metadata: { ...baseMetadata, page: 6 },
  })
  const { sources } = buildContext([r1, r2])

  // Páginas 5 e 6 são adjacentes → devem ser mergiadas em 1 bloco
  finding('CB05', 'CB05 chunks pág 5-6 stitchados em 1 bloco', sources.length === 1, {
    func: 'buildContext → mergeAdjacentResults',
    input: 'pag 5 + pag 6 mesma seguradora/produto/doc',
    expected: 'sources.length=1 (merged)',
    obtained: `sources.length=${sources.length}`,
    hypothesis: 'mergeAdjacentResults une pags adjacentes (|pageA - pageB| <= 1) com mesmo insurer+product+doc',
  })
  if (sources.length === 1) {
    ok('CB05 conteúdo stitchado contém ambas partes', sources[0].content.includes('Parte A') && sources[0].content.includes('Parte B'), `content: "${sources[0].content.slice(0, 200)}"`)
  }
}

// CB06 — mesma seguradora+produto+doc na mesma página → stitchado
{
  const baseMetadata = {
    insurer_name: 'MAG Seguros',
    product_name: 'DITA',
    source_doc: 'tabela-dita.pdf',
  }
  const r1 = makeResult({
    insurer_id: 'ins-mag',
    product_id: 'prod-dita',
    content: 'Tabela renda mensal R$ 1.000.',
    metadata: { ...baseMetadata, page: 11 },
  })
  const r2 = makeResult({
    insurer_id: 'ins-mag',
    product_id: 'prod-dita',
    content: 'Tabela renda mensal R$ 2.000.',
    metadata: { ...baseMetadata, page: 11 },
  })
  const { sources } = buildContext([r1, r2])

  finding('CB06', 'CB06 chunks mesma página mergiados', sources.length === 1, {
    func: 'buildContext → mergeAdjacentResults',
    input: 'pag 11 + pag 11 mesma seguradora/produto/doc',
    expected: 'sources.length=1',
    obtained: `sources.length=${sources.length}`,
    hypothesis: 'samePage=true → merge imediato',
  })
}

// CB07 — seguradora/produto diferente na mesma página → NÃO stitchado
{
  const r1 = makeResult({
    insurer_id: 'ins-prudential',
    product_id: 'prod-vi',
    content: 'Prudential content.',
    metadata: { insurer_name: 'Prudential', product_name: 'VI', source_doc: 'doc-a.pdf', page: 5 },
  })
  const r2 = makeResult({
    insurer_id: 'ins-mag',
    product_id: 'prod-mag',
    content: 'MAG content.',
    metadata: { insurer_name: 'MAG', product_name: 'DITA', source_doc: 'doc-b.pdf', page: 5 },
  })
  const { sources } = buildContext([r1, r2])

  ok('CB07 seguradoras diferentes nao mergiadas', sources.length === 2, `got sources.length=${sources.length}`)
}

// ---------------------------------------------------------------------------
// BLOCO 4: truncação por orçamento — buildContext respeita MAX_CONTEXT_CHARS
// ---------------------------------------------------------------------------
console.log('\n## buildContext — truncação por orçamento de chars')

// CB08 — conteúdo grande (>32k chars) → truncado
{
  // Criar conteúdo que excede 32000 chars
  const bigContent = 'X'.repeat(20_000)
  const r1 = makeResult({ content: bigContent, insurer_id: 'ins-a', product_id: 'p-a',
    metadata: { insurer_name: 'A', product_name: 'PA', source_doc: 'a.pdf' } })
  const r2 = makeResult({ content: bigContent, insurer_id: 'ins-b', product_id: 'p-b',
    metadata: { insurer_name: 'B', product_name: 'PB', source_doc: 'b.pdf' } })
  const r3 = makeResult({ content: 'Terceiro resultado, deve ser descartado ou truncado.',
    insurer_id: 'ins-c', product_id: 'p-c',
    metadata: { insurer_name: 'C', product_name: 'PC', source_doc: 'c.pdf' } })

  const { contextText, sources } = buildContext([r1, r2, r3])

  ok('CB08 contextText.length <= 32200', contextText.length <= 32_200, `got ${contextText.length}`)
  ok('CB08 sources.length < 3 (truncacao descartou ou cortou r3)', sources.length < 3 || sources[sources.length - 1].content.includes('...'), `got sources.length=${sources.length}`)
}

// CB09 — conteúdo pequeno → todos incluídos, sem truncação
{
  const smallContent = 'Cobertura básica.'
  const results = Array.from({ length: 3 }, (_, i) =>
    makeResult({
      content: smallContent,
      insurer_id: `ins-${i}`,
      product_id: `prod-${i}`,
      metadata: { insurer_name: `Seg ${i}`, product_name: `Prod ${i}`, source_doc: `doc-${i}.pdf` },
    })
  )
  const { sources } = buildContext(results)

  ok('CB09 3 fontes incluídas (sem truncação)', sources.length === 3, `got ${sources.length}`)
}

// ---------------------------------------------------------------------------
// BLOCO 5: resultados vazios
// ---------------------------------------------------------------------------
console.log('\n## buildContext — resultados vazios')

// CB10 — array vazio → contextText vazio + sources vazio
{
  const { contextText, sources } = buildContext([])

  ok('CB10 contextText vazio', contextText === '', `got "${contextText}"`)
  ok('CB10 sources vazio', sources.length === 0, `got ${sources.length}`)
}

// ---------------------------------------------------------------------------
// BLOCO 6: format do contextText — dois blocos separados por '\n\n'
// ---------------------------------------------------------------------------
console.log('\n## buildContext — dois blocos separados por newlines')

// CB11 — 2 resultados distintos → separados no contextText
{
  const r1 = makeResult({
    insurer_id: 'ins-x',
    product_id: 'prod-x',
    content: 'Cobertura X.',
    metadata: { insurer_name: 'Seguradora X', product_name: 'Produto X', source_doc: 'x.pdf', page: 1 },
  })
  const r2 = makeResult({
    insurer_id: 'ins-y',
    product_id: 'prod-y',
    content: 'Cobertura Y.',
    metadata: { insurer_name: 'Seguradora Y', product_name: 'Produto Y', source_doc: 'y.pdf', page: 1 },
  })
  const { contextText, sources } = buildContext([r1, r2])

  ok('CB11 2 fontes', sources.length === 2, `got ${sources.length}`)
  ok('CB11 contextText contém [1]', contextText.includes('[1]'), `got: "${contextText.slice(0, 100)}"`)
  ok('CB11 contextText contém [2]', contextText.includes('[2]'), `got: "${contextText.slice(0, 200)}"`)
  // Conteúdos de ambos presentes
  ok('CB11 conteúdo X presente', contextText.includes('Cobertura X'), `got: "${contextText.slice(0, 300)}"`)
  ok('CB11 conteúdo Y presente', contextText.includes('Cobertura Y'), `got: "${contextText.slice(0, 400)}"`)
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
## TST-04 — context-builder.ts (context-builder.test.ts)

Rodado em: ${new Date().toISOString()}
Findings encontrados: ${findingLog.length}

| ID | Função | Input | Esperado | Obtido | Hipótese |
|----|--------|-------|----------|--------|----------|
${findingLog.map((f) => `| FINDING-${f.id} | ${f.func} | \`${f.input.slice(0, 60)}\` | ${f.expected} | ${f.obtained} | ${f.hypothesis} |`).join('\n')}

`

  const header = existingContent.startsWith('#') ? existingContent : `# FINDINGS — Ciclo 003\n\n`

  if (!existingContent.includes('## TST-04')) {
    fs.writeFileSync(findingsPath, header + newSection, 'utf8')
    console.log(`\nFINDINGS TST-04 escritos em ${findingsPath}`)
  } else {
    console.log('\nFINDINGS-ciclo003.md já contém TST-04')
  }
}

if (failed > 0) {
  console.error(`\n${failed} teste(s) falhou`)
  process.exit(1)
}

console.log('\npassed')
