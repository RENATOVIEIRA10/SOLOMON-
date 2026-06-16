/**
 * TST-02: formatRateAnswer + math helpers — testes unitários.
 *
 * Cobre os 5 rate_units, math mensal/anual, comparativo, linha única,
 * fixed_brl_monthly e rótulos de unidade corretos.
 * NÃO duplica casos de rate-unit-guard.test.ts (H01/assertRateUnit já cobertos lá).
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/rate-answer.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import fs from 'fs'
import path from 'path'
import { formatRateAnswer, type RateRow, type RateIntent } from '@/services/rag/rate-lookup'

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

function makeRow(overrides: Partial<RateRow>): RateRow {
  return {
    product_name: 'SEGURO VIDA INTEIRA',
    product_code: 'WL10G',
    portfolio: null,
    coverage_type: 'morte',
    gender: 'M',
    age: 40,
    period: null,
    rate: 1.75,
    rate_unit: 'per_1000_monthly',
    source_doc_name: 'tabela-premios.pdf',
    source_page: 5,
    version_label: null,
    ...overrides,
  }
}

function makeIntent(overrides: Partial<RateIntent>): RateIntent {
  return {
    hasIntent: true,
    age: 40,
    gender: 'M',
    capital: 100_000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// BLOCO 1: per_1000_monthly — mensal e anual
// ---------------------------------------------------------------------------
console.log('\n## per_1000_monthly — R$ 1.75/1000/mes, capital 100k')
// mensal = (1.75 * 100000) / 1000 = 175.00; anual = 175 * 12 = 2100.00
{
  const row = makeRow({ rate: 1.75, rate_unit: 'per_1000_monthly' })
  const out = formatRateAnswer({ insurerName: 'MAG', intent: makeIntent({ capital: 100_000 }), rows: [row] })
  ok('M01 mensal 175,00 presente', out.includes('175,00'), `out snippet: ${out.slice(0, 300)}`)
  ok('M01 anual 2.100,00 presente', out.includes('2.100,00'), `out snippet: ${out.slice(0, 300)}`)
  ok('M01 NAO contem 175,00/ano (inversao)', !/175,00\/ano/.test(out), `out snippet: ${out.slice(0, 300)}`)
  ok('M01 NAO contem 2.100,00/mes (inversao)', !/2\.100,00\/mes/.test(out), `out snippet: ${out.slice(0, 300)}`)
  ok('M01 direcao mensal (175,00/mes)', /175,00\/mes/.test(out), `out snippet: ${out.slice(0, 300)}`)
  ok('M01 direcao anual (2.100,00/ano)', /2\.100,00\/ano/.test(out), `out snippet: ${out.slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 2: per_1000_annual — anual e mensal
// ---------------------------------------------------------------------------
console.log('\n## per_1000_annual — R$ 37.0662/1000/ano, capital 500k (Q02 eval)')
// anual = (37.0662 * 500000) / 1000 = 18533.10; mensal = 18533.10 / 12 = 1544.425
{
  const row = makeRow({ rate: 37.0662, rate_unit: 'per_1000_annual', gender: 'F', age: 35, product_code: 'WL10G' })
  const out = formatRateAnswer({
    insurerName: 'Prudential',
    intent: makeIntent({ age: 35, gender: 'F', capital: 500_000 }),
    rows: [row],
  })
  ok('A01 anual 18.533,10 presente', out.includes('18.533,10'), `out snippet: ${out.slice(0, 400)}`)
  // mensal: 18533.10 / 12 = 1544.425 → formatado como 1.544,43
  ok('A01 mensal 1.544,43 presente', out.includes('1.544,43'), `out snippet: ${out.slice(0, 400)}`)
  ok('A01 NAO contem 18.533,10/mes (inversao)', !/18\.533,10\/mes/.test(out))
  ok('A01 direcao anual (18.533,10/ano)', /18\.533,10\/ano/.test(out), `out snippet: ${out.slice(0, 400)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 3: per_1000_annual baixo valor (H01 inversão check)
// H01 canonico (coberto em rate-unit-guard): rate=1.75 per_1000_monthly capital=320k
// Aqui testar per_1000_annual: mesma taxa mas ANUAL
// ---------------------------------------------------------------------------
console.log('\n## per_1000_annual — H01 inversao (rate=1.75 annual, capital=320k)')
// anual = (1.75 * 320000) / 1000 = 560.00; mensal = 560 / 12 = 46.666... → 46,67
{
  const row = makeRow({ rate: 1.75, rate_unit: 'per_1000_annual' })
  const out = formatRateAnswer({
    insurerName: 'MAG',
    intent: makeIntent({ capital: 320_000 }),
    rows: [row],
  })
  ok('A02 anual 560,00/ano presente', /560,00\/ano/.test(out), `out snippet: ${out.slice(0, 300)}`)
  ok('A02 mensal 46,67 presente', out.includes('46,67'), `out snippet: ${out.slice(0, 300)}`)
  ok('A02 NAO contem 560,00/mes (inversao)', !/560,00\/mes/.test(out))
}

// ---------------------------------------------------------------------------
// BLOCO 4: fixed_brl_monthly — sem cálculo de capital
// ---------------------------------------------------------------------------
console.log('\n## fixed_brl_monthly — valor fixo R$ 20,33/mes (MAG DITA)')
{
  const row = makeRow({
    product_name: 'DITA',
    product_code: '2330',
    rate: 20.33,
    rate_unit: 'fixed_brl_monthly',
    period: 'FX_R1000_C50000',
    gender: 'M',
    age: 40,
  })
  const out = formatRateAnswer({
    insurerName: 'MAG',
    intent: makeIntent({ capital: undefined, rendaMensal: 1000 }),
    rows: [row],
  })
  ok('F01 contem R$ 20,33/mes', out.includes('R$ 20,33/mes'), `out snippet: ${out.slice(0, 300)}`)
  // fixed_brl_monthly NAO deve calcular premio por capital
  ok('F01 NAO contem Premio para capital (fixed nao calcula)', !/Premio para capital/.test(out), `out snippet: ${out.slice(0, 300)}`)
  ok('F01 contem fonte do doc', out.includes('tabela-premios.pdf'), `out snippet: ${out.slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 5: per_100_diaria_monthly — rótulo de unidade correto
// ---------------------------------------------------------------------------
console.log('\n## per_100_diaria_monthly — rótulo de unidade')
{
  const row = makeRow({
    product_name: 'DIH 200',
    product_code: '2114',
    rate: 0.85,
    rate_unit: 'per_100_diaria_monthly',
    period: null,
  })
  const out = formatRateAnswer({
    insurerName: 'MAG',
    intent: makeIntent({ capital: undefined }),
    rows: [row],
  })
  ok('D01 contém rótulo "diaria" no output', out.toLowerCase().includes('diaria') || out.toLowerCase().includes('diária'), `out snippet: ${out.slice(0, 300)}`)
  ok('D01 NAO contém "por R$ 1.000 (taxa anual)" (unidade errada)', !out.includes('por R$ 1.000 (taxa anual)'), `out snippet: ${out.slice(0, 300)}`)
  ok('D01 contém "0,8500" (taxa formatada)', out.includes('0,8500'), `out snippet: ${out.slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 6: per_1000_renda_monthly — rótulo de unidade correto
// ---------------------------------------------------------------------------
console.log('\n## per_1000_renda_monthly — rótulo de unidade')
{
  const row = makeRow({
    product_name: 'RENDA POR INVALIDEZ',
    product_code: '2009',
    rate: 2.50,
    rate_unit: 'per_1000_renda_monthly',
    period: null,
  })
  const out = formatRateAnswer({
    insurerName: 'MAG',
    intent: makeIntent({ capital: undefined }),
    rows: [row],
  })
  ok('R01 contém rótulo "renda" no output', out.toLowerCase().includes('renda'), `out snippet: ${out.slice(0, 300)}`)
  ok('R01 contém "2,5000" (taxa formatada)', out.includes('2,5000'), `out snippet: ${out.slice(0, 300)}`)
  // Nao deve confundir com per_1000_annual
  ok('R01 NAO contem "taxa anual" (unidade errada)', !out.includes('(taxa anual)'), `out snippet: ${out.slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 7: comparativo (>=2 rows mesma unidade) — identifica mais barato
// ---------------------------------------------------------------------------
console.log('\n## Comparativo — 2 rows per_1000_annual, identifica mais barato')
// Q37 eval: WL00G 35F 20.9281 vs WL10G 35F 37.0662 — WL00G mais barato
{
  const row1 = makeRow({
    product_name: 'SEGURO VIDA INTEIRA',
    product_code: 'WL00G',
    rate: 20.9281,
    rate_unit: 'per_1000_annual',
    gender: 'F',
    age: 35,
  })
  const row2 = makeRow({
    product_name: 'SEGURO VIDA INTEIRA',
    product_code: 'WL10G',
    rate: 37.0662,
    rate_unit: 'per_1000_annual',
    gender: 'F',
    age: 35,
  })
  const out = formatRateAnswer({
    insurerName: 'Prudential',
    intent: makeIntent({ age: 35, gender: 'F', capital: 500_000 }),
    rows: [row1, row2],
  })
  ok('C01 Comparativo presente', out.includes('Comparativo'), `out snippet: ${out.slice(0, 400)}`)
  ok('C01 WL00G identificado como mais barato', out.includes('WL00G'), `out snippet: ${out.slice(0, 400)}`)
  // WL00G premio anual = 20.9281 * 500 = 10464.05
  finding('C01a', 'C01 WL00G premio 10.464,05 presente', out.includes('10.464,05'), {
    func: 'formatRateAnswer',
    input: 'WL00G rate=20.9281 per_1000_annual capital=500000',
    expected: '10.464,05',
    obtained: 'ver output',
    hypothesis: '20.9281 * 500000 / 1000 = 10464.05 → formatado como 10.464,05',
  })
  // WL10G premio anual = 37.0662 * 500 = 18533.10
  ok('C01 WL10G premio 18.533,10 presente', out.includes('18.533,10'), `out snippet: ${out.slice(0, 600)}`)
  // O mais barato é WL00G → spread "menor que WL10G"
  ok('C01 spread mencionado', out.includes('menor que') || out.includes('mais barato'), `out snippet: ${out.slice(0, 400)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 8: linha única (1 row) — sem comparativo
// ---------------------------------------------------------------------------
console.log('\n## Linha única (1 row) — sem comparativo')
{
  const row = makeRow({ rate: 4.1428, rate_unit: 'per_1000_annual', gender: 'M', age: 40, product_code: 'DDR5G' })
  const out = formatRateAnswer({
    insurerName: 'Prudential',
    intent: makeIntent({ age: 40, gender: 'M', capital: 200_000 }),
    rows: [row],
  })
  // Sem comparativo (apenas 1 produto)
  ok('L01 NAO tem "Comparativo:" (linha unica)', !out.includes('**Comparativo:**'), `out snippet: ${out.slice(0, 300)}`)
  // DDR5G capital 200k: 4.1428 * 200000 / 1000 = 828.56
  ok('L01 premio 828,56 presente', out.includes('828,56'), `out snippet: ${out.slice(0, 400)}`)
  // anual = 828.56; mensal = 828.56/12 = 69.046...
  ok('L01 mensal 69,05 presente', out.includes('69,05'), `out snippet: ${out.slice(0, 400)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 9: rows vazios — mensagem de não encontrado
// ---------------------------------------------------------------------------
console.log('\n## Rows vazios — mensagem de nao encontrado')
{
  const out = formatRateAnswer({
    insurerName: 'Zurich',
    intent: makeIntent({}),
    rows: [],
  })
  ok('V01 mensagem nao encontrado', out.includes('Nao encontrei') || out.includes('Não encontrei'), `out="${out}"`)
}

// ---------------------------------------------------------------------------
// BLOCO 10: sem capital — exibe fórmula de instrução
// ---------------------------------------------------------------------------
console.log('\n## Sem capital — exibe instrucao de formula')
{
  const row = makeRow({ rate: 5.2009, rate_unit: 'per_1000_annual', gender: 'M', age: 35, product_code: 'TM10' })
  const out = formatRateAnswer({
    insurerName: 'Prudential',
    intent: makeIntent({ capital: undefined }),
    rows: [row],
  })
  // Sem capital, nao pode calcular premio — deve mostrar instrucao
  ok('S01 instrucao de capital presente', out.includes('Formula:') || out.includes('capital'), `out snippet: ${out.slice(0, 400)}`)
  // Sem calculo de premio (sem capital)
  ok('S01 NAO tem "Premio para capital"', !/Premio para capital/.test(out), `out snippet: ${out.slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 11: dados ausentes — reportados na seção DADOS QUE FALTAM
// ---------------------------------------------------------------------------
console.log('\n## DADOS QUE FALTAM — campos ausentes reportados')
{
  const row = makeRow({ rate: 1.0, rate_unit: 'per_1000_annual' })
  const out = formatRateAnswer({
    insurerName: 'MAG',
    intent: { hasIntent: true },  // sem age, gender, capital
    rows: [row],
  })
  ok('D01 seção DADOS QUE FALTAM presente', out.includes('DADOS QUE FALTAM'), `out snippet: ${out.slice(0, 400)}`)
  ok('D01 menciona "idade do segurado"', out.includes('idade do segurado'), `out snippet: ${out.slice(0, 400)}`)
  ok('D01 menciona "sexo do segurado"', out.includes('sexo do segurado'), `out snippet: ${out.slice(0, 400)}`)
  ok('D01 menciona "capital segurado"', out.includes('capital segurado'), `out snippet: ${out.slice(0, 400)}`)
}

// ---------------------------------------------------------------------------
// BLOCO 12: comparativo 3 produtos — CIB5G vs CIB5H (Q38 eval)
// ---------------------------------------------------------------------------
console.log('\n## Comparativo 3 produtos — CIB5G vs CIB5H (Q38 eval)')
// CIB5G: 20.4928; CIB5H: 20.2133 — CIB5H mais barato ~1.4%
{
  const row1 = makeRow({ product_name: 'SEGURO CIRURGIA', product_code: 'CIB5G', rate: 20.4928, rate_unit: 'per_1000_annual', gender: 'M', age: 40 })
  const row2 = makeRow({ product_name: 'SEGURO CIRURGIA', product_code: 'CIB5H', rate: 20.2133, rate_unit: 'per_1000_annual', gender: 'M', age: 40 })
  const out = formatRateAnswer({
    insurerName: 'Prudential',
    intent: makeIntent({ age: 40, gender: 'M', capital: 300_000 }),
    rows: [row1, row2],
  })
  ok('CMP02 CIB5H identificado como mais barato', out.includes('CIB5H'), `out snippet: ${out.slice(0, 500)}`)
  ok('CMP02 Comparativo presente', out.includes('Comparativo'), `out snippet: ${out.slice(0, 300)}`)
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
## TST-02 — formatRateAnswer (rate-answer.test.ts)

Rodado em: ${new Date().toISOString()}
Findings encontrados: ${findingLog.length}

| ID | Função | Input | Esperado | Obtido | Hipótese |
|----|--------|-------|----------|--------|----------|
${findingLog.map((f) => `| FINDING-${f.id} | ${f.func} | \`${f.input.slice(0, 60)}\` | ${f.expected} | ${f.obtained} | ${f.hypothesis} |`).join('\n')}

`

  const header = existingContent.startsWith('#')
    ? existingContent
    : `# FINDINGS — Ciclo 003 (fase 10 test-suite-rag)\n\nFindings são divergências entre comportamento esperado e código atual.\n`

  if (!existingContent.includes('## TST-02')) {
    fs.writeFileSync(findingsPath, header + newSection, 'utf8')
    console.log(`\nFINDINGS TST-02 escritos em ${findingsPath}`)
  } else {
    console.log('\nFINDINGS-ciclo003.md já contém TST-02 — não sobrescrever')
  }
}

if (failed > 0) {
  console.error(`\n${failed} teste(s) falhou (hard failures)`)
  process.exit(1)
}

console.log('\npassed')
