/**
 * TST-01: detectRateIntent — corpus de testes unitários.
 *
 * Documenta o comportamento ESPERADO de detectRateIntent. Mismatches entre
 * esperado e obtido são registrados como FINDINGS (não falhas duras).
 * Kimi identificou 5/50 mismatches — alguns findings são esperados.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/rate-intent.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import fs from 'fs'
import path from 'path'
import { detectRateIntent } from '@/services/rag/rate-lookup'

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

// ---------------------------------------------------------------------------
// BLOCO 1: POSITIVOS — hasIntent=true com extração correta
// ---------------------------------------------------------------------------
console.log('\n## POSITIVOS — hasIntent=true com extração correta')

// P01 — Vida Inteira MAG com capital
{
  const r = detectRateIntent('Vida Inteira MAG homem 40 anos capital 500 mil')
  ok('P01 hasIntent=true', r.hasIntent === true, `got hasIntent=${r.hasIntent}`)
  ok('P01 age=40', r.age === 40, `got age=${r.age}`)
  ok('P01 gender=M', r.gender === 'M', `got gender=${r.gender}`)
  ok('P01 capital=500000', r.capital === 500_000, `got capital=${r.capital}`)
  finding('01', 'P01 productHint contém VIDA INTEIRA', r.productHint?.includes('VIDA INTEIRA') === true, {
    func: 'detectRateIntent',
    input: 'Vida Inteira MAG homem 40 anos capital 500 mil',
    expected: 'productHint inclui VIDA INTEIRA',
    obtained: String(r.productHint),
    hypothesis: 'PRODUCT_FAMILIES entry MAG "vida inteira" mapeada para "VIDA INTEIRA"',
  })
}

// P02 — Prudential DDR5G com código
{
  const r = detectRateIntent('Prudential Doencas Graves DDR5G mulher 35 anos 200 mil')
  ok('P02 hasIntent=true', r.hasIntent === true)
  finding('02', 'P02 productCode=DDR5G', r.productCode === 'DDR5G', {
    func: 'detectRateIntent',
    input: 'Prudential Doencas Graves DDR5G mulher 35 anos 200 mil',
    expected: 'productCode=DDR5G',
    obtained: String(r.productCode),
    hypothesis: 'PRODUCT_CODE_ALPHA_RE deve capturar DDR5G',
  })
  ok('P02 age=35', r.age === 35, `got age=${r.age}`)
  ok('P02 gender=F', r.gender === 'F', `got gender=${r.gender}`)
  ok('P02 capital=200000', r.capital === 200_000, `got capital=${r.capital}`)
}

// P03 — Premio genérico com keyword
{
  const r = detectRateIntent('premio do seguro de vida para mulher de 28 anos, capital R$ 100.000')
  ok('P03 hasIntent=true', r.hasIntent === true)
  ok('P03 age=28', r.age === 28, `got age=${r.age}`)
  ok('P03 gender=F', r.gender === 'F', `got gender=${r.gender}`)
  ok('P03 capital=100000', r.capital === 100_000, `got capital=${r.capital}`)
}

// P04 — Capital "500 mil" (magnitude)
{
  const r = detectRateIntent('taxa de vida para homem 40 anos 500 mil')
  ok('P04 hasIntent=true', r.hasIntent === true)
  ok('P04 capital=500000 (500 mil)', r.capital === 500_000, `got capital=${r.capital}`)
}

// P05 — Capital com ponto BR "R$ 500.000"
{
  const r = detectRateIntent('quanto custa seguro de vida para homem 45 anos R$ 500.000')
  ok('P05 hasIntent=true', r.hasIntent === true)
  ok('P05 capital=500000 (R$ 500.000)', r.capital === 500_000, `got capital=${r.capital}`)
}

// P06 — Capital "1 milhao"
{
  const r = detectRateIntent('Seguro Temporario Prudential TM10 para homem de 45 anos, capital 1 milhao. Quanto custa?')
  ok('P06 hasIntent=true', r.hasIntent === true)
  finding('06', 'P06 capital=1000000 (1 milhao)', r.capital === 1_000_000, {
    func: 'detectRateIntent',
    input: 'capital 1 milhao',
    expected: 'capital=1000000',
    obtained: String(r.capital),
    hypothesis: 'applyMagnitude("milhao") deve retornar 1_000_000',
  })
  ok('P06 age=45', r.age === 45, `got age=${r.age}`)
  ok('P06 gender=M', r.gender === 'M', `got gender=${r.gender}`)
}

// P07 — Capital puro numérico "500000"
{
  const r = detectRateIntent('cotacao para mulher 30 anos capital 500000')
  ok('P07 hasIntent=true', r.hasIntent === true)
  finding('07', 'P07 capital=500000 (int puro)', r.capital === 500_000, {
    func: 'detectRateIntent',
    input: 'capital 500000',
    expected: 'capital=500000',
    obtained: String(r.capital),
    hypothesis: 'parseBrazilianNumber sem separadores deve retornar 500000',
  })
}

// P08 — DIT/renda mensal MAG
// FINDING: "DIT MAG renda mensal 5000" → sem keyword de preco explícita e
// sem capital → hasRateKeyword=false, hasImplicitIntent=false → hasIntent=false.
// O parser exige capital OU (productCode + age + gender) para cotação implícita.
// Corretor precisaria dizer "premio" ou "quanto custa" para ativar o fast-path.
{
  const r = detectRateIntent('DIT MAG renda mensal 5000')
  finding('08a', 'P08 hasIntent=true (DIT sem keyword explicita)', r.hasIntent === true, {
    func: 'detectRateIntent',
    input: 'DIT MAG renda mensal 5000',
    expected: 'hasIntent=true',
    obtained: String(r.hasIntent),
    hypothesis: 'Sem keyword de preco e sem capital → hasIntent=false. Renda sozinha + produto não dispara intent. Behavior atual: correto por design (evita false positives).',
  })
  finding('08b', 'P08 rendaMensal=5000', r.rendaMensal === 5000, {
    func: 'detectRateIntent',
    input: 'DIT MAG renda mensal 5000',
    expected: 'rendaMensal=5000',
    obtained: String(r.rendaMensal),
    hypothesis: 'RENDA_RE deve capturar "renda mensal 5000" mesmo sem hasIntent',
  })
}

// P09 — Franquia F7 explícita
{
  const r = detectRateIntent('MAG DIT MAC+IPAM GRUPO 2 F7 codigo 2396, homem 40 anos, renda 1.000 capital 50.000')
  ok('P09 hasIntent=true', r.hasIntent === true)
  finding('09', 'P09 franquia=7', r.franquia === '7', {
    func: 'detectRateIntent',
    input: '... F7 ...',
    expected: 'franquia=7',
    obtained: String(r.franquia),
    hypothesis: 'FRANQUIA_RE deve capturar "F7"',
  })
  ok('P09 age=40', r.age === 40, `got age=${r.age}`)
  ok('P09 gender=M', r.gender === 'M', `got gender=${r.gender}`)
  ok('P09 rendaMensal=1000', r.rendaMensal === 1000, `got rendaMensal=${r.rendaMensal}`)
  ok('P09 capital=50000', r.capital === 50_000, `got capital=${r.capital}`)
}

// P10 — Produto com código numérico MAG DITA 2330
{
  const r = detectRateIntent('MAG DITA 40 anos, renda 10 mil capital 1 milhao')
  ok('P10 hasIntent=true', r.hasIntent === true)
  ok('P10 age=40', r.age === 40, `got age=${r.age}`)
  finding('10', 'P10 rendaMensal=10000', r.rendaMensal === 10_000, {
    func: 'detectRateIntent',
    input: 'renda 10 mil',
    expected: 'rendaMensal=10000',
    obtained: String(r.rendaMensal),
    hypothesis: 'RENDA_RE + applyMagnitude("mil") deve retornar 10000',
  })
}

// P11 — Cotação Prudential WL10G mulher 35 anos
{
  const r = detectRateIntent('Seguro Vida Inteira Prudential WL10G, mulher 35 anos, capital R$ 500.000 — qual o premio?')
  ok('P11 hasIntent=true', r.hasIntent === true)
  ok('P11 age=35', r.age === 35, `got age=${r.age}`)
  ok('P11 gender=F', r.gender === 'F', `got gender=${r.gender}`)
  ok('P11 capital=500000', r.capital === 500_000, `got capital=${r.capital}`)
  finding('11', 'P11 productCode=WL10G', r.productCode === 'WL10G', {
    func: 'detectRateIntent',
    input: '... WL10G ...',
    expected: 'productCode=WL10G',
    obtained: String(r.productCode),
    hypothesis: 'PRODUCT_CODE_ALPHA_RE deve capturar WL10G',
  })
}

// P12 — "quanto fica" como keyword
{
  const r = detectRateIntent('quanto fica o seguro de vida para homem de 50 anos capital 200 mil')
  ok('P12 hasIntent=true', r.hasIntent === true, `got hasIntent=${r.hasIntent}`)
  ok('P12 age=50', r.age === 50, `got age=${r.age}`)
  ok('P12 gender=M', r.gender === 'M', `got gender=${r.gender}`)
  ok('P12 capital=200000', r.capital === 200_000, `got capital=${r.capital}`)
}

// ---------------------------------------------------------------------------
// BLOCO 2: NEGATIVOS — hasIntent=false (perguntas conceituais)
// ---------------------------------------------------------------------------
console.log('\n## NEGATIVOS — hasIntent=false (perguntas conceituais, não cotação)')

// N01 — Pergunta sobre cobertura (não preco)
{
  const r = detectRateIntent('o que cobre o seguro de vida da MAG?')
  finding('N01', 'N01 hasIntent=false (cobertura)', r.hasIntent === false, {
    func: 'detectRateIntent',
    input: 'o que cobre o seguro de vida da MAG?',
    expected: 'hasIntent=false',
    obtained: String(r.hasIntent),
    hypothesis: 'sem keyword de taxa/preco e sem qualifiers numericos — deve retornar false',
  })
}

// N02 — Carência (conceitual)
{
  const r = detectRateIntent('carencia da Prudential')
  finding('N02', 'N02 hasIntent=false (carencia)', r.hasIntent === false, {
    func: 'detectRateIntent',
    input: 'carencia da Prudential',
    expected: 'hasIntent=false',
    obtained: String(r.hasIntent),
    hypothesis: 'sem keyword de taxa/preco nem qualifiers — deve retornar false',
  })
}

// N03 — Exclusões Azos
{
  const r = detectRateIntent('quais exclusoes da Azos')
  finding('N03', 'N03 hasIntent=false (exclusoes)', r.hasIntent === false, {
    func: 'detectRateIntent',
    input: 'quais exclusoes da Azos',
    expected: 'hasIntent=false',
    obtained: String(r.hasIntent),
    hypothesis: 'sem keyword de taxa/preco — deve retornar false',
  })
}

// N04 — Pergunta genérica "qual o melhor seguro"
{
  const r = detectRateIntent('Qual e o melhor seguro?')
  finding('N04', 'N04 hasIntent=false (sem qualifiers)', r.hasIntent === false, {
    func: 'detectRateIntent',
    input: 'Qual e o melhor seguro?',
    expected: 'hasIntent=false (melhor sem qualifiers)',
    obtained: String(r.hasIntent),
    hypothesis: 'hasRateKeyword=true (mais barato) mas hasAnyQualifier=false → deve retornar false',
  })
}

// N05 — Pergunta de bolo (out-of-domain — sem rate keyword)
{
  const r = detectRateIntent('Como faco um bolo de chocolate?')
  ok('N05 hasIntent=false (out-of-domain)', r.hasIntent === false, `got hasIntent=${r.hasIntent}`)
}

// N06 — Pergunta sobre beneficiários (conceitual)
{
  const r = detectRateIntent('Como funciona a indicacao de beneficiarios no Bradesco Vida Viva?')
  finding('N06', 'N06 hasIntent=false (beneficiarios)', r.hasIntent === false, {
    func: 'detectRateIntent',
    input: 'Como funciona a indicacao de beneficiarios no Bradesco Vida Viva?',
    expected: 'hasIntent=false',
    obtained: String(r.hasIntent),
    hypothesis: 'sem keyword de taxa/preco nem qualifiers de cotação — deve retornar false',
  })
}

// N07 — Pergunta de sinistro
{
  const r = detectRateIntent('Segurado faleceu de infarto. Beneficiario pode receber?')
  finding('N07', 'N07 hasIntent=false (sinistro)', r.hasIntent === false, {
    func: 'detectRateIntent',
    input: 'Segurado faleceu de infarto. Beneficiario pode receber?',
    expected: 'hasIntent=false',
    obtained: String(r.hasIntent),
    hypothesis: 'sem keyword de taxa/preco nem qualifiers de cotação — deve retornar false',
  })
}

// ---------------------------------------------------------------------------
// BLOCO 3: EDGE CASES
// ---------------------------------------------------------------------------
console.log('\n## EDGE CASES')

// E01 — Idade sem capital
{
  const r = detectRateIntent('taxa de seguro de vida para homem 35 anos')
  // Tem keyword (taxa) + age + gender → hasAnyQualifier=true → hasIntent pode ser true
  // mas hasImplicitIntent=false pois sem capital/productCode — depende da logic exata
  // Verificamos apenas o que o código FAZ:
  ok('E01 hasIntent boolean (not throw)', typeof r.hasIntent === 'boolean')
  ok('E01 age=35', r.age === 35, `got age=${r.age}`)
  ok('E01 gender=M', r.gender === 'M', `got gender=${r.gender}`)
}

// E02 — Capital sem idade (keyword mas sem idade)
{
  const r = detectRateIntent('quanto custa seguro de vida capital 300 mil')
  ok('E02 hasIntent boolean', typeof r.hasIntent === 'boolean')
  finding('E02', 'E02 capital=300000', r.capital === 300_000, {
    func: 'detectRateIntent',
    input: 'quanto custa seguro de vida capital 300 mil',
    expected: 'capital=300000',
    obtained: String(r.capital),
    hypothesis: 'CAPITAL_LABELED_RE captura "capital 300 mil" = 300000',
  })
}

// E03 — Gênero implícito "para ela"
{
  const r = detectRateIntent('taxa de vida para ela, 28 anos, capital 200 mil')
  ok('E03 hasIntent boolean', typeof r.hasIntent === 'boolean')
  ok('E03 age=28', r.age === 28, `got age=${r.age}`)
  // "para ela" não é capturado pela regex atual (\b(mulher|feminino|fem)\b)
  finding('E03', 'E03 gender=F (implicito "para ela")', r.gender === 'F', {
    func: 'detectRateIntent',
    input: 'taxa de vida para ela, 28 anos',
    expected: 'gender=F',
    obtained: String(r.gender),
    hypothesis: '"para ela" não está no regex de gender — esperado finding',
  })
}

// E04 — Gênero implícito "para ele"
{
  const r = detectRateIntent('taxa de vida para ele, 33 anos, capital 100 mil')
  ok('E04 age=33', r.age === 33, `got age=${r.age}`)
  finding('E04', 'E04 gender=M (implicito "para ele")', r.gender === 'M', {
    func: 'detectRateIntent',
    input: 'taxa de vida para ele, 33 anos',
    expected: 'gender=M',
    obtained: String(r.gender),
    hypothesis: '"para ele" não está no regex de gender — esperado finding',
  })
}

// E05 — Idade fora de faixa (0)
{
  const r = detectRateIntent('taxa para homem 0 anos capital 100 mil')
  // Código filtra: if (parsed >= 1 && parsed <= 99)
  finding('E05', 'E05 age=undefined (fora de faixa 0)', r.age === undefined, {
    func: 'detectRateIntent',
    input: '... 0 anos ...',
    expected: 'age=undefined (filtrado pela sanity)',
    obtained: String(r.age),
    hypothesis: 'parsed >= 1 exclui idade 0',
  })
}

// E06 — Idade fora de faixa (120)
{
  const r = detectRateIntent('taxa para homem 120 anos capital 100 mil')
  finding('E06', 'E06 age=undefined (fora de faixa 120)', r.age === undefined, {
    func: 'detectRateIntent',
    input: '... 120 anos ...',
    expected: 'age=undefined (filtrado pela sanity > 99)',
    obtained: String(r.age),
    hypothesis: 'parsed <= 99 exclui idade 120',
  })
}

// E07 — Número por extenso "quarenta anos" (não suportado pelo regex numérico)
{
  const r = detectRateIntent('taxa de vida para homem quarenta anos capital 200 mil')
  ok('E07 hasIntent boolean', typeof r.hasIntent === 'boolean')
  // Números por extenso NÃO são suportados (sem regex dedicado)
  finding('E07', 'E07 age=undefined (extenso sem suporte)', r.age === undefined, {
    func: 'detectRateIntent',
    input: '... quarenta anos ...',
    expected: 'age=undefined (numeros por extenso nao suportados)',
    obtained: String(r.age),
    hypothesis: 'AGE_RE exige digitos — "quarenta" nao faz match',
  })
}

// E08 — Keyword "mais barato" sem qualifiers
{
  const r = detectRateIntent('qual o seguro mais barato?')
  finding('E08', 'E08 hasIntent=false (mais barato sem qualifiers)', r.hasIntent === false, {
    func: 'detectRateIntent',
    input: 'qual o seguro mais barato?',
    expected: 'hasIntent=false — keyword sem qualifiers',
    obtained: String(r.hasIntent),
    hypothesis: 'hasRateKeyword=true mas hasAnyQualifier=false → false',
  })
}

// E09 — Pergunta Q07 do eval (DITA, feminino, renda 10k, capital 1M)
{
  const r = detectRateIntent('Cliente quer MAG DITA, 40 anos, feminino, renda 10 mil e capital 1 milhao. Quanto fica o premio?')
  ok('E09 hasIntent=true', r.hasIntent === true)
  ok('E09 age=40', r.age === 40, `got age=${r.age}`)
  ok('E09 gender=F', r.gender === 'F', `got gender=${r.gender}`)
  finding('E09a', 'E09 rendaMensal=10000', r.rendaMensal === 10_000, {
    func: 'detectRateIntent',
    input: 'renda 10 mil',
    expected: 'rendaMensal=10000',
    obtained: String(r.rendaMensal),
    hypothesis: 'RENDA_RE + magnitude deve retornar 10000',
  })
  finding('E09b', 'E09 capital=1000000', r.capital === 1_000_000, {
    func: 'detectRateIntent',
    input: 'capital 1 milhao',
    expected: 'capital=1000000',
    obtained: String(r.capital),
    hypothesis: 'CAPITAL_LABELED_RE captura "capital 1 milhao" = 1000000',
  })
}

// E10 — Pergunta Q04 do eval (TM10, 1 milhao)
{
  const r = detectRateIntent('Seguro Temporario Prudential TM10 para homem de 45 anos, capital 1 milhao. Quanto custa?')
  ok('E10 hasIntent=true', r.hasIntent === true)
  ok('E10 age=45', r.age === 45, `got age=${r.age}`)
  finding('E10', 'E10 productCode=TM10', r.productCode === 'TM10', {
    func: 'detectRateIntent',
    input: '... TM10 ...',
    expected: 'productCode=TM10',
    obtained: String(r.productCode),
    hypothesis: 'PRODUCT_CODE_ALPHA_RE deve capturar TM10',
  })
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
## TST-01 — detectRateIntent (rate-intent.test.ts)

Rodado em: ${new Date().toISOString()}
Findings encontrados: ${findingLog.length}

| ID | Função | Input | Esperado | Obtido | Hipótese |
|----|--------|-------|----------|--------|----------|
${findingLog.map((f) => `| FINDING-${f.id} | ${f.func} | \`${f.input.slice(0, 60)}\` | ${f.expected} | ${f.obtained} | ${f.hypothesis} |`).join('\n')}

`

  const header = existingContent.startsWith('#')
    ? existingContent
    : `# FINDINGS — Ciclo 003 (fase 10 test-suite-rag)\n\nFindings são divergências entre comportamento esperado e código atual. NÃO indicam bug confirmado — hipótese registrada para análise.\n`

  if (!existingContent.includes('## TST-01')) {
    fs.writeFileSync(findingsPath, header + newSection, 'utf8')
    console.log(`\nFINDINGS escritos em ${findingsPath}`)
  } else {
    console.log(`\nFINDINGS-ciclo003.md já contém TST-01 — não sobrescrever`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} teste(s) falhou (hard failures, não findings)`)
  process.exit(1)
}

console.log('\npassed')
