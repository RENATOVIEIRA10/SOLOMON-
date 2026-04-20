/**
 * Rate Table Lookup
 *
 * Killer feature: quando o corretor pergunta sobre PREMIO / TAXA / PRECO,
 * bypass do LLM e consulta `insurer_rate_tables` direto. Zero alucinacao em
 * valores numericos — resposta exata com citacao da pagina do PDF oficial.
 *
 * Fluxo:
 *   1. detectRateIntent(question) — classifica intencao via keywords + regex.
 *   2. Se ha intent + seguradora detectada: queryRateTable(...) no Supabase.
 *   3. Se houver match: formatRateAnswer(...) — bypass LLM.
 *   4. Senao: fall-through para RAG normal.
 */

import { createServiceClient } from '@/lib/supabase'

export interface RateIntent {
  hasIntent: boolean
  age?: number
  gender?: 'M' | 'F'
  /** Nome do produto mencionado (normalizado, maiusculo, sem acento). */
  productHint?: string
  /** Capital segurado em reais, se explicitado. */
  capital?: number
}

export interface RateRow {
  product_name: string
  product_code: string
  portfolio: string | null
  coverage_type: string
  gender: 'M' | 'F'
  age: number
  rate: number
  rate_unit: string
  source_doc_name: string
  source_page: number
  version_label: string | null
}

const RATE_KEYWORDS = [
  'taxa',
  'taxas',
  'premio',
  'prêmio',
  'premios',
  'prêmios',
  'tarifa',
  'tarifas',
  'preco',
  'preço',
  'valor',
  'quanto custa',
  'cotacao',
  'cotação',
  'cotar',
  'mensalidade',
  'anuidade',
]

/** Regex: idade explicita em anos. */
const AGE_RE = /\b(\d{1,2})\s*anos?\b/i
/** Regex: idade sem sufixo quando precedida por "idade"/"com" */
const AGE_CTX_RE = /(?:idade\s*(?:de\s*)?|com\s+|de\s+)(\d{2})\b/i

/** Regex: capital segurado. Captura 100k, 500mil, 1M, R$ 250.000, 250000. */
const CAPITAL_RE = /(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+)\s*(mil|k|m|mm|milhao|milhão|milhoes|milhões)?/gi

/**
 * Classifica se a pergunta e sobre premio/taxa e extrai age/gender/product.
 */
export function detectRateIntent(question: string): RateIntent {
  const q = question.toLowerCase()
  const qNoAccent = stripAccents(q)

  // 1. Intent detection: pelo menos 1 keyword de taxa/preco
  const hasRateKeyword = RATE_KEYWORDS.some((kw) => qNoAccent.includes(stripAccents(kw)))
  if (!hasRateKeyword) {
    return { hasIntent: false }
  }

  // 2. Age extraction
  let age: number | undefined
  const ageMatch = q.match(AGE_RE) ?? q.match(AGE_CTX_RE)
  if (ageMatch) {
    const parsed = parseInt(ageMatch[1], 10)
    if (parsed >= 1 && parsed <= 99) age = parsed
  }

  // 3. Gender extraction
  let gender: 'M' | 'F' | undefined
  if (/\b(homem|masculino|masc)\b/i.test(q)) gender = 'M'
  else if (/\b(mulher|feminino|fem)\b/i.test(q)) gender = 'F'

  // 4. Product hint — match against known Prudential product families
  const productHint = detectProductHint(qNoAccent)

  // 5. Capital
  const capital = extractCapital(q)

  return {
    hasIntent: true,
    age,
    gender,
    productHint,
    capital,
  }
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Mapeia menus de produtos → string canonica usada em `product_name` */
const PRODUCT_FAMILIES: Array<{ patterns: string[]; canonical: string }> = [
  { patterns: ['vida inteira unico', 'vida inteira único', 'wlupf'], canonical: 'SEGURO VIDA INTEIRA UNICO' },
  { patterns: ['vida inteira mais'], canonical: 'SEGURO VIDA INTEIRA MAIS' },
  { patterns: ['vida inteira modificado', 'modificado'], canonical: 'SEGURO VIDA INTEIRA MODIFICADO' },
  { patterns: ['idades especiais'], canonical: 'SEGURO VIDA INTEIRA IDADES ESPECIAIS' },
  { patterns: ['vida inteira'], canonical: 'SEGURO VIDA INTEIRA' },
  { patterns: ['vida e saude 10', 'vida e saúde 10', 'vs10'], canonical: 'SEGURO VIDA E SAUDE 10' },
  { patterns: ['vida e saude 20', 'vida e saúde 20', 'vs20'], canonical: 'SEGURO VIDA E SAUDE 20' },
  { patterns: ['vida e saude 30', 'vida e saúde 30', 'vs30'], canonical: 'SEGURO VIDA E SAUDE 30' },
  { patterns: ['temporario decrescente', 'temporário decrescente'], canonical: 'SEGURO TEMPORARIO DECRESCENTE' },
  { patterns: ['temporario preferencial', 'temporário preferencial'], canonical: 'SEGURO TEMPORARIO PREFERENCIAL' },
  { patterns: ['temporario', 'temporário'], canonical: 'SEGURO TEMPORARIO' },
  { patterns: ['renda familiar'], canonical: 'SEGURO RENDA FAMILIAR' },
  { patterns: ['renda hospitalar'], canonical: 'SEGURO RENDA HOSPITALAR' },
  { patterns: ['doencas graves basico', 'doenças graves básico'], canonical: 'SEGURO DOENCAS GRAVES BASICO' },
  { patterns: ['doencas graves plus', 'doenças graves plus'], canonical: 'SEGURO DOENCAS GRAVES PLUS' },
  { patterns: ['doencas graves modular', 'doenças graves modular'], canonical: 'SEGURO DOENCAS GRAVES MODULAR' },
  { patterns: ['doencas ampliadas', 'doenças ampliadas'], canonical: 'SEGURO DOENCAS AMPLIADAS' },
  { patterns: ['morte acidental'], canonical: 'SEGURO POR MORTE ACIDENTAL' },
  { patterns: ['invalidez acidental'], canonical: 'SEGURO INVALIDEZ ACIDENTAL' },
  { patterns: ['assistencia funeral', 'assistência funeral', 'funeral'], canonical: 'SEGURO ASSISTENCIA FUNERAL' },
  { patterns: ['perda autonomia', 'perda da autonomia'], canonical: 'SEGURO PERDA DA AUTONOMIA PESSOAL' },
  { patterns: ['cirurgia ampliada'], canonical: 'SEGURO CIRURGIA AMPLIADA' },
  { patterns: ['cirurgia'], canonical: 'SEGURO CIRURGIA' },
  { patterns: ['quebra de ossos', 'quebra ossos'], canonical: 'SEGURO QUEBRA DE OSSOS' },
]

function detectProductHint(q: string): string | undefined {
  for (const fam of PRODUCT_FAMILIES) {
    if (fam.patterns.some((p) => q.includes(stripAccents(p)))) {
      return fam.canonical
    }
  }
  return undefined
}

function extractCapital(q: string): number | undefined {
  // Try common patterns. Priority: "500 mil" > "500000" > "R$ 500.000,00"
  // Brazilian number: 1.234,56 → 1234.56; English: 1,234.56 → 1234.56
  const matches = [...q.matchAll(CAPITAL_RE)]
  for (const m of matches) {
    const raw = m[1]
    const suffix = (m[2] ?? '').toLowerCase()
    let n = parseBrazilianNumber(raw)
    if (isNaN(n)) continue
    if (suffix.startsWith('mil') || suffix === 'k') n *= 1_000
    else if (suffix.startsWith('m') || suffix.startsWith('milh')) n *= 1_000_000
    // Sanity filter: capital segurado tipicamente R$ 10k - R$ 10M
    if (n >= 10_000 && n <= 50_000_000) return n
  }
  return undefined
}

function parseBrazilianNumber(s: string): number {
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // BR format: 1.234,56
    return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  }
  if (hasComma && !hasDot) {
    return parseFloat(s.replace(',', '.'))
  }
  return parseFloat(s.replace(/\./g, ''))
}

/**
 * Consulta insurer_rate_tables com filtros opcionais.
 */
export async function queryRateTable(params: {
  insurerId: string
  productHint?: string
  productCode?: string
  age?: number
  gender?: 'M' | 'F'
  limit?: number
}): Promise<RateRow[]> {
  const supabase = createServiceClient()
  let q = supabase
    .from('insurer_rate_tables')
    .select('product_name, product_code, portfolio, coverage_type, gender, age, rate, rate_unit, source_doc_name, source_page, version_label')
    .eq('insurer_id', params.insurerId)

  if (params.productHint) {
    q = q.ilike('product_name', `%${params.productHint}%`)
  }
  if (params.productCode) {
    q = q.eq('product_code', params.productCode.toUpperCase())
  }
  if (params.age !== undefined) {
    q = q.eq('age', params.age)
  }
  if (params.gender) {
    q = q.eq('gender', params.gender)
  }

  const { data, error } = await q.limit(params.limit ?? 30).order('product_name').order('product_code').order('age')
  if (error) {
    console.error('[rate-lookup] query error:', error.message)
    return []
  }
  return (data ?? []) as RateRow[]
}

/**
 * Formata resposta de taxa como texto estruturado (bypass LLM).
 * Se multiplos produtos correspondem ao hint, lista todos com calculos.
 */
export function formatRateAnswer(params: {
  insurerName: string
  intent: RateIntent
  rows: RateRow[]
}): string {
  const { insurerName, intent, rows } = params
  if (rows.length === 0) {
    return `Nao encontrei a taxa para os parametros informados na ${insurerName}.`
  }

  // Group by (product_name, product_code) to consolidate variants
  type Key = string
  const groups = new Map<Key, RateRow[]>()
  for (const r of rows) {
    const key = `${r.product_name}|${r.product_code}|${r.coverage_type}`
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }

  const lines: string[] = [
    `**Taxas ${insurerName}** (fonte oficial)`,
    intent.age !== undefined ? `Idade: ${intent.age} anos` : null,
    intent.gender ? `Sexo: ${intent.gender === 'M' ? 'Masculino' : 'Feminino'}` : null,
    '',
  ].filter((l): l is string => l !== null)

  for (const [key, groupRows] of groups) {
    const [productName, productCode, coverageType] = key.split('|')
    const portfolio = groupRows[0].portfolio
    const page = groupRows[0].source_page
    const doc = groupRows[0].source_doc_name
    const version = groupRows[0].version_label ?? ''

    lines.push(`**${productName} — ${productCode}**${portfolio ? ` (Portfolio ${portfolio})` : ''} — Cobertura ${coverageType}`)
    for (const r of groupRows) {
      const rateBr = formatBrNumber(r.rate)
      const genderLabel = r.gender === 'M' ? 'Masc' : 'Fem'
      lines.push(`  - Idade ${r.age} / ${genderLabel}: **${rateBr}** por R$ 1.000 (taxa anual)`)
      if (intent.capital) {
        const premio = (r.rate * intent.capital) / 1000
        lines.push(`    Premio anual para capital R$ ${formatBrNumber(intent.capital, 0)}: **R$ ${formatBrNumber(premio, 2)}** (≈ R$ ${formatBrNumber(premio / 12, 2)}/mes)`)
      }
    }
    lines.push(`  *Fonte: ${doc}, pagina ${page}${version ? `, versao ${version}` : ''}*`)
    lines.push('')
  }

  if (!intent.capital) {
    lines.push('> Formula: Premio Anual = Taxa × Capital Segurado / 1000. Informa o capital desejado para eu calcular o premio.')
  }

  lines.push('')
  lines.push('---')
  lines.push('**FONTES UTILIZADAS:**')
  const firstDoc = rows[0].source_doc_name
  const firstVersion = rows[0].version_label
  lines.push(`- ${insurerName} — Tabela de Premios oficial${firstVersion ? ` (${firstVersion})` : ''} — ${firstDoc}`)
  lines.push('')
  lines.push('**DADOS QUE FALTAM:**')
  const missing: string[] = []
  if (intent.age === undefined) missing.push('idade do segurado')
  if (!intent.gender) missing.push('sexo do segurado')
  if (!intent.capital) missing.push('capital segurado')
  if (missing.length > 0) lines.push(`- ${missing.join(', ')}`)
  else lines.push('- Nenhum dado adicional necessario.')

  return lines.join('\n')
}

function formatBrNumber(n: number, decimals = 4): string {
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
