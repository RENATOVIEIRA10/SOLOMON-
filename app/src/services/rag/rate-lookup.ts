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
  /** Renda mensal (DIT/DITA) em reais — ex "renda 3 mil" → 3000. */
  rendaMensal?: number
  /** Franquia (DIT/DIT Médicos) — '7' ou '10' dias. */
  franquia?: '7' | '10'
}

export interface RateRow {
  product_name: string
  product_code: string
  portfolio: string | null
  coverage_type: string
  gender: 'M' | 'F'
  age: number
  period: string | null
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

/** Regex: renda mensal. "renda 3 mil" / "renda mensal de R$ 3.000" / "renda 3000" */
const RENDA_RE = /renda\s*(?:mensal\s*)?(?:de\s*)?(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+)\s*(mil|k|m)?/i

/** Regex: franquia DIT. "franquia 7 dias" / "franquia de 10" / "f7" / "f10". */
const FRANQUIA_RE = /\b(?:franquia(?:\s*de)?\s*|f)(7|10)(?:\s*dias?)?\b/i

/**
 * Classifica se a pergunta e sobre premio/taxa e extrai age/gender/product.
 * @param insurer canonical insurer name ('Prudential' | 'MAG' | ...). Quando
 *   informado, restringe a busca de productHint as familias daquela seguradora.
 */
export function detectRateIntent(question: string, insurer?: string): RateIntent {
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

  // 4. Product hint — filtrado por seguradora quando disponivel
  const productHint = detectProductHint(qNoAccent, insurer)

  // 5. Capital
  const capital = extractCapital(q)

  // 6. Renda mensal (DITA/DIT)
  const rendaMensal = extractRendaMensal(q)

  // 7. Franquia (DIT)
  let franquia: '7' | '10' | undefined
  const fMatch = q.match(FRANQUIA_RE)
  if (fMatch) franquia = fMatch[1] as '7' | '10'

  return {
    hasIntent: true,
    age,
    gender,
    productHint,
    capital,
    rendaMensal,
    franquia,
  }
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Mapeia menus de produtos → substring usada em `product_name` para ilike.
 * `insurer` e o nome canonico da seguradora (ver INSURER_PATTERNS em answer.ts).
 * Quando `insurer` esta undefined, a familia aplica a qualquer seguradora.
 */
const PRODUCT_FAMILIES: Array<{ patterns: string[]; canonical: string; insurer?: string }> = [
  // Prudential
  { insurer: 'Prudential', patterns: ['vida inteira unico', 'vida inteira único', 'wlupf'], canonical: 'SEGURO VIDA INTEIRA UNICO' },
  { insurer: 'Prudential', patterns: ['vida inteira mais'], canonical: 'SEGURO VIDA INTEIRA MAIS' },
  { insurer: 'Prudential', patterns: ['vida inteira modificado', 'modificado'], canonical: 'SEGURO VIDA INTEIRA MODIFICADO' },
  { insurer: 'Prudential', patterns: ['idades especiais'], canonical: 'SEGURO VIDA INTEIRA IDADES ESPECIAIS' },
  { insurer: 'Prudential', patterns: ['vida inteira'], canonical: 'SEGURO VIDA INTEIRA' },
  { insurer: 'Prudential', patterns: ['vida e saude 10', 'vida e saúde 10', 'vs10'], canonical: 'SEGURO VIDA E SAUDE 10' },
  { insurer: 'Prudential', patterns: ['vida e saude 20', 'vida e saúde 20', 'vs20'], canonical: 'SEGURO VIDA E SAUDE 20' },
  { insurer: 'Prudential', patterns: ['vida e saude 30', 'vida e saúde 30', 'vs30'], canonical: 'SEGURO VIDA E SAUDE 30' },
  { insurer: 'Prudential', patterns: ['temporario decrescente', 'temporário decrescente'], canonical: 'SEGURO TEMPORARIO DECRESCENTE' },
  { insurer: 'Prudential', patterns: ['temporario preferencial', 'temporário preferencial'], canonical: 'SEGURO TEMPORARIO PREFERENCIAL' },
  { insurer: 'Prudential', patterns: ['temporario', 'temporário'], canonical: 'SEGURO TEMPORARIO' },
  { insurer: 'Prudential', patterns: ['renda familiar'], canonical: 'SEGURO RENDA FAMILIAR' },
  { insurer: 'Prudential', patterns: ['renda hospitalar'], canonical: 'SEGURO RENDA HOSPITALAR' },
  { insurer: 'Prudential', patterns: ['doencas graves basico', 'doenças graves básico'], canonical: 'SEGURO DOENCAS GRAVES BASICO' },
  { insurer: 'Prudential', patterns: ['doencas graves plus', 'doenças graves plus'], canonical: 'SEGURO DOENCAS GRAVES PLUS' },
  { insurer: 'Prudential', patterns: ['doencas graves modular', 'doenças graves modular'], canonical: 'SEGURO DOENCAS GRAVES MODULAR' },
  { insurer: 'Prudential', patterns: ['doencas ampliadas', 'doenças ampliadas'], canonical: 'SEGURO DOENCAS AMPLIADAS' },
  { insurer: 'Prudential', patterns: ['morte acidental'], canonical: 'SEGURO POR MORTE ACIDENTAL' },
  { insurer: 'Prudential', patterns: ['invalidez acidental'], canonical: 'SEGURO INVALIDEZ ACIDENTAL' },
  { insurer: 'Prudential', patterns: ['assistencia funeral', 'assistência funeral', 'funeral'], canonical: 'SEGURO ASSISTENCIA FUNERAL' },
  { insurer: 'Prudential', patterns: ['perda autonomia', 'perda da autonomia'], canonical: 'SEGURO PERDA DA AUTONOMIA PESSOAL' },
  { insurer: 'Prudential', patterns: ['cirurgia ampliada'], canonical: 'SEGURO CIRURGIA AMPLIADA' },
  { insurer: 'Prudential', patterns: ['cirurgia'], canonical: 'SEGURO CIRURGIA' },
  { insurer: 'Prudential', patterns: ['quebra de ossos', 'quebra ossos'], canonical: 'SEGURO QUEBRA DE OSSOS' },

  // MAG — product_name na base esta sem prefixo "SEGURO". Codigos SUSEP informativos:
  //  3082 Vida Inteira, 3083 V.I. Conjuge, 3085 Prazo Certo, 1501 Morte Acidente,
  //  3084 Pensao por Morte, 2278/2279 Invalidez Majorada, 1548 Invalidez Total,
  //  2009 Renda por Invalidez, 2229/2598/2230/2599/2231/2345 Doencas Graves,
  //  2114/2115/2116/2117 DIH/UTI, 2301 Cirurgias, 3057-3069 SAF.
  { insurer: 'MAG', patterns: ['vida inteira conjuge', 'vida inteira cônjuge', 'conjuge'], canonical: 'VIDA INTEIRA CONJUGE' },
  { insurer: 'MAG', patterns: ['vida inteira'], canonical: 'VIDA INTEIRA' },
  { insurer: 'MAG', patterns: ['prazo certo'], canonical: 'PRAZO CERTO' },
  { insurer: 'MAG', patterns: ['morte por acidente', 'morte acidente', 'morte acidental'], canonical: 'MORTE POR ACIDENTE' },
  { insurer: 'MAG', patterns: ['pensao por morte', 'pensão por morte', 'pensao morte'], canonical: 'PENSAO POR MORTE' },
  { insurer: 'MAG', patterns: ['invalidez majorada ou doenca', 'invalidez majorada ou doença', 'invalidez por acidente majorada ou doenca'], canonical: 'INVALIDEZ POR ACIDENTE MAJORADA OU DOENCA' },
  { insurer: 'MAG', patterns: ['invalidez majorada', 'invalidez por acidente majorada'], canonical: 'INVALIDEZ POR ACIDENTE MAJORADA' },
  { insurer: 'MAG', patterns: ['invalidez total por acidente', 'invalidez total'], canonical: 'INVALIDEZ TOTAL POR ACIDENTE' },
  { insurer: 'MAG', patterns: ['renda por invalidez', 'renda invalidez'], canonical: 'RENDA POR INVALIDEZ' },
  { insurer: 'MAG', patterns: ['doencas graves essencial', 'doenças graves essencial', 'dg essencial'], canonical: 'DOENCAS GRAVES ESSENCIAL' },
  { insurer: 'MAG', patterns: ['doencas graves plus', 'doenças graves plus', 'dg plus'], canonical: 'DOENCAS GRAVES PLUS' },
  { insurer: 'MAG', patterns: ['doencas graves premium', 'doenças graves premium', 'dg premium'], canonical: 'DOENCAS GRAVES PREMIUM' },
  { insurer: 'MAG', patterns: ['doencas graves master', 'doenças graves master', 'dg master'], canonical: 'DOENCAS GRAVES MASTER' },
  { insurer: 'MAG', patterns: ['uti', 'diaria uti', 'diaria hospitalar uti'], canonical: 'DIARIA INTERNACAO HOSPITALAR UTI' },
  { insurer: 'MAG', patterns: ['250 diarias', 'dih 250'], canonical: 'DIARIA INTERNACAO HOSPITALAR 250' },
  { insurer: 'MAG', patterns: ['200 diarias', 'dih 200'], canonical: 'DIARIA INTERNACAO HOSPITALAR 200' },
  { insurer: 'MAG', patterns: ['150 diarias', 'dih 150'], canonical: 'DIARIA INTERNACAO HOSPITALAR 150' },
  { insurer: 'MAG', patterns: ['diaria internacao', 'diária internação', 'diaria hospitalar', 'diária hospitalar', 'dih'], canonical: 'DIARIA INTERNACAO HOSPITALAR' },
  { insurer: 'MAG', patterns: ['cirurgia', 'cirurgias'], canonical: 'CIRURGIAS' },
  { insurer: 'MAG', patterns: ['saf essencial familiar+pais+sogros', 'saf essencial familiar pais sogros'], canonical: 'SAF ESSENCIAL FAMILIAR+PAIS+SOGROS' },
  { insurer: 'MAG', patterns: ['saf essencial familiar+pais', 'saf essencial familiar pais'], canonical: 'SAF ESSENCIAL FAMILIAR+PAIS' },
  { insurer: 'MAG', patterns: ['saf essencial individual'], canonical: 'SAF ESSENCIAL INDIVIDUAL' },
  { insurer: 'MAG', patterns: ['saf essencial familiar'], canonical: 'SAF ESSENCIAL FAMILIAR' },
  { insurer: 'MAG', patterns: ['saf essencial'], canonical: 'SAF ESSENCIAL' },
  { insurer: 'MAG', patterns: ['saf plus familiar+pais+sogros', 'saf plus familiar pais sogros'], canonical: 'SAF PLUS FAMILIAR+PAIS+SOGROS' },
  { insurer: 'MAG', patterns: ['saf plus familiar+pais', 'saf plus familiar pais'], canonical: 'SAF PLUS FAMILIAR+PAIS' },
  { insurer: 'MAG', patterns: ['saf plus individual'], canonical: 'SAF PLUS INDIVIDUAL' },
  { insurer: 'MAG', patterns: ['saf plus familiar'], canonical: 'SAF PLUS FAMILIAR' },
  { insurer: 'MAG', patterns: ['saf plus'], canonical: 'SAF PLUS' },
  { insurer: 'MAG', patterns: ['saf premium familiar+pais+sogros', 'saf premium familiar pais sogros'], canonical: 'SAF PREMIUM FAMILIAR+PAIS+SOGROS' },
  { insurer: 'MAG', patterns: ['saf premium familiar+pais', 'saf premium familiar pais'], canonical: 'SAF PREMIUM FAMILIAR+PAIS' },
  { insurer: 'MAG', patterns: ['saf premium individual'], canonical: 'SAF PREMIUM INDIVIDUAL' },
  { insurer: 'MAG', patterns: ['saf premium familiar'], canonical: 'SAF PREMIUM FAMILIAR' },
  { insurer: 'MAG', patterns: ['saf premium'], canonical: 'SAF PREMIUM' },
  { insurer: 'MAG', patterns: ['saf'], canonical: 'SAF' },

  // MAG — DITA (pags 11-12) e DIT (pags 17-133) sao matrizes renda x capital x
  // idade x sexo x franquia. rate_unit = fixed_brl_monthly (premio mensal BRL).
  // period codifica (franquia, renda, capital) como "F{7|10}_R{renda}_C{capital}".
  // Canonical e parcial (ilike) — franquia/sexo sao filtros adicionais via period/gender.
  //
  // DIT Grupos 1/2/3: classificacao profissional. Grupo Medicos separado.
  // Produto MQC (Invalidez por Morbidez Qualquer Causa) tem tabelas F / M separadas.
  // Produto MAC+IPAM (Morte por Acidente + Invalidez Permanente Acidente Majorada) unissex.
  { insurer: 'MAG', patterns: ['dita'], canonical: 'DITA' },
  { insurer: 'MAG', patterns: ['dit mqc medicos', 'dit mqc médicos'], canonical: 'DIT MQC MEDICOS' },
  { insurer: 'MAG', patterns: ['dit mac ipam medicos', 'dit mac+ipam medicos', 'dit medicos mac'], canonical: 'DIT MAC+IPAM MEDICOS' },
  { insurer: 'MAG', patterns: ['dit medicos', 'dit médicos', 'grupo medicos', 'grupo médicos'], canonical: 'MEDICOS' },
  { insurer: 'MAG', patterns: ['dit mqc grupo 1', 'dit grupo 1 mqc'], canonical: 'DIT MQC GRUPO 1' },
  { insurer: 'MAG', patterns: ['dit mqc grupo 2', 'dit grupo 2 mqc'], canonical: 'DIT MQC GRUPO 2' },
  { insurer: 'MAG', patterns: ['dit mqc grupo 3', 'dit grupo 3 mqc'], canonical: 'DIT MQC GRUPO 3' },
  { insurer: 'MAG', patterns: ['dit mac ipam grupo 1', 'dit mac+ipam grupo 1'], canonical: 'DIT MAC+IPAM GRUPO 1' },
  { insurer: 'MAG', patterns: ['dit mac ipam grupo 2', 'dit mac+ipam grupo 2'], canonical: 'DIT MAC+IPAM GRUPO 2' },
  { insurer: 'MAG', patterns: ['dit mac ipam grupo 3', 'dit mac+ipam grupo 3'], canonical: 'DIT MAC+IPAM GRUPO 3' },
  { insurer: 'MAG', patterns: ['dit grupo 1', 'grupo 1'], canonical: 'GRUPO 1' },
  { insurer: 'MAG', patterns: ['dit grupo 2', 'grupo 2'], canonical: 'GRUPO 2' },
  { insurer: 'MAG', patterns: ['dit grupo 3', 'grupo 3'], canonical: 'GRUPO 3' },
  { insurer: 'MAG', patterns: ['dit mqc'], canonical: 'DIT MQC' },
  { insurer: 'MAG', patterns: ['dit mac ipam', 'dit mac+ipam'], canonical: 'DIT MAC+IPAM' },
  { insurer: 'MAG', patterns: ['dit'], canonical: 'DIT' },
]

function detectProductHint(q: string, insurer?: string): string | undefined {
  for (const fam of PRODUCT_FAMILIES) {
    if (fam.insurer && insurer && fam.insurer !== insurer) continue
    if (fam.patterns.some((p) => q.includes(stripAccents(p)))) {
      return fam.canonical
    }
  }
  return undefined
}

function extractRendaMensal(q: string): number | undefined {
  const m = q.match(RENDA_RE)
  if (!m) return undefined
  const raw = m[1]
  const suffix = (m[2] ?? '').toLowerCase()
  let n = parseBrazilianNumber(raw)
  if (isNaN(n)) return undefined
  if (suffix.startsWith('mil') || suffix === 'k') n *= 1_000
  else if (suffix.startsWith('m')) n *= 1_000_000
  // Sanity filter: renda mensal DIT/DITA tipicamente R$ 500 - R$ 100k
  if (n >= 500 && n <= 100_000) return n
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
  /** Para matrizes DIT/DITA: renda_mensal em R$ (codificada no campo period). */
  rendaMensal?: number
  /** Capital Morte por Acidente em R$ (codificado no campo period). */
  capital?: number
  /** Franquia DIT: '7' ou '10'. */
  franquia?: '7' | '10'
  limit?: number
}): Promise<RateRow[]> {
  const supabase = createServiceClient()
  let q = supabase
    .from('insurer_rate_tables')
    .select('product_name, product_code, portfolio, coverage_type, gender, age, period, rate, rate_unit, source_doc_name, source_page, version_label')
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

  // Filtro de period para matrizes DIT/DITA (fixed_brl_monthly).
  // Period format: "F{7|10}_R{renda}_C{capital}". Usar ilike para matching parcial.
  const periodParts: string[] = []
  if (params.franquia) periodParts.push(`F${params.franquia}`)
  else periodParts.push('F%')
  if (params.rendaMensal) periodParts.push(`R${params.rendaMensal}`)
  else periodParts.push('R%')
  if (params.capital) periodParts.push(`C${params.capital}`)
  else periodParts.push('C%')
  const periodPattern = periodParts.join('_')
  // So aplica filtro se usuario forneceu ao menos uma dimensao especifica
  if (params.franquia || params.rendaMensal || params.capital) {
    q = q.ilike('period', periodPattern)
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
    const unit = groupRows[0].rate_unit

    lines.push(`**${productName} — ${productCode}**${portfolio ? ` (Portfolio ${portfolio})` : ''} — Cobertura ${coverageType}`)
    for (const r of groupRows) {
      const rateBr = formatBrNumber(r.rate)
      const genderLabel = r.gender === 'M' ? 'Masc' : 'Fem'
      if (r.rate_unit === 'fixed_brl_monthly') {
        // DITA/DIT: premio mensal fixo em BRL, period codifica (franquia, renda, capital)
        const periodLabel = formatPeriodDIT(r.period)
        lines.push(`  - Idade ${r.age} / ${genderLabel}${periodLabel ? ` — ${periodLabel}` : ''}: **R$ ${formatBrNumber(r.rate, 2)}/mes**`)
      } else if (r.rate_unit === 'per_100_diaria_monthly') {
        lines.push(`  - Idade ${r.age} / ${genderLabel}: **${rateBr}** por R$ 100 de diaria (taxa mensal)`)
      } else if (r.rate_unit === 'per_1000_renda_monthly') {
        lines.push(`  - Idade ${r.age} / ${genderLabel}: **${rateBr}** por R$ 1.000 de renda (taxa mensal)`)
      } else if (r.rate_unit === 'per_1000_monthly') {
        lines.push(`  - Idade ${r.age} / ${genderLabel}: **${rateBr}** por R$ 1.000 (taxa mensal)`)
      } else {
        lines.push(`  - Idade ${r.age} / ${genderLabel}: **${rateBr}** por R$ 1.000 (taxa anual)`)
      }
      if (intent.capital && (r.rate_unit === 'per_1000_annual' || r.rate_unit === 'per_1000_monthly')) {
        const premio = (r.rate * intent.capital) / 1000
        const mensal = r.rate_unit === 'per_1000_monthly' ? premio : premio / 12
        const anual = r.rate_unit === 'per_1000_monthly' ? premio * 12 : premio
        lines.push(`    Premio para capital R$ ${formatBrNumber(intent.capital, 0)}: **R$ ${formatBrNumber(anual, 2)}/ano** (≈ R$ ${formatBrNumber(mensal, 2)}/mes)`)
      }
    }
    lines.push(`  *Fonte: ${doc}, pagina ${page}${version ? `, versao ${version}` : ''}*`)
    lines.push('')
  }

  if (!intent.capital && rows.every((r) => r.rate_unit !== 'fixed_brl_monthly')) {
    lines.push('> Formula: Premio = Taxa × Capital Segurado / 1000. Informa o capital desejado para eu calcular o premio.')
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

/** Decompoe period "F7_R3000_C30000" em texto legivel. */
function formatPeriodDIT(period: string | null): string | null {
  if (!period) return null
  const m = period.match(/^F(7|10|X)_R(\d+)_C(\d+)$/)
  if (!m) return null
  const franquia = m[1]
  const renda = parseInt(m[2], 10)
  const capital = parseInt(m[3], 10)
  const parts: string[] = []
  if (franquia !== 'X') parts.push(`Franquia ${franquia} dias`)
  parts.push(`Renda R$ ${formatBrNumber(renda, 0)}`)
  parts.push(`Capital R$ ${formatBrNumber(capital, 0)}`)
  return parts.join(' / ')
}
