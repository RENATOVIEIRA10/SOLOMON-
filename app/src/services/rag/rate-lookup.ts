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
  /** Codigo SUSEP/comercial do produto (MAG: "2330", Prudential: "DDR5G"). */
  productCode?: string
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
  'quanto fica',
  'quanto sai',
  'quanto paga',
  'quanto da',
  'quanto dá',
  'quanto é',
  'quanto e',
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
/** Regex: idade apos gender ("homem 40", "mulher 35"). Corretor frequente omite "anos". */
const AGE_GENDER_RE = /\b(?:homem|mulher|masculino|feminino|masc|fem)\s+(\d{2})\b/i

/** Regex: capital segurado. Captura 100k, 500mil, 1M, R$ 250.000, 250000.
 *  Alternation ordem:
 *    - No grupo 1 (valor): primeiro formato BR com separador obrigatorio (1.234/1,234)
 *      para evitar que "\d{1,3}" corte numeros puros em 3 digitos.
 *    - No grupo 2 (sufixo): patterns mais longos ANTES dos mais curtos, senao
 *      "milhao" bateria em "mil" e perderia 3 ordens de magnitude.
 *  WORD BOUNDARY OBRIGATORIO no sufixo: "m" colide com "masculino"/"morte"/etc
 *  se nao exigirmos `\b` apos a magnitude. */
const MAGNITUDE_ALT = 'milhoes|milhões|milhao|milhão|mil|mm|k|m'
const CAPITAL_RE = new RegExp(
  `(?:r\\$\\s*)?(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)\\s*(?:(${MAGNITUDE_ALT})\\b)?`,
  'gi'
)

/** Regex: capital LABELED — "capital 500 mil", "cap 1M", "capital segurado R$ 200.000".
 *  Tem prioridade sobre CAPITAL_RE generico; evita confusao com "renda X" quando
 *  renda >= 10k (ex: "renda 10k cap 1M" nao pode retornar 10k como capital). */
const CAPITAL_LABELED_RE = new RegExp(
  `\\bcap(?:ital)?\\s*(?:segurado\\s*)?(?:de\\s*)?(?:r\\$\\s*)?(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)\\s*(?:(${MAGNITUDE_ALT})\\b)?`,
  'i'
)

/** Regex: codigo SUSEP/comercial do produto.
 *  - MAG: "codigo 2330", "cod 2396", "cód. 2398" (4-5 digitos).
 *  - Prudential: letras+digitos como DDR5G, WL10G, CIB5G, TM10, HC05G (2-4 letras, 1-3 digitos, 0-1 letra final).
 *  Detectados separadamente para nao capturar "F7" (franquia) ou "G2" (grupo).
 */
const PRODUCT_CODE_NUMERIC_RE = /\b(?:c[óo]digo|cod(?:\.|igo)?)\s*(?:susep\s*)?(\d{4,5})\b/i
const PRODUCT_CODE_ALPHA_RE = /\b([A-Z]{2,4}\d{1,3}[A-Z]?)\b/

/** Regex: renda mensal. "renda 3 mil" / "renda mensal de R$ 3.000" / "renda 3000".
 *  Mesma logica do CAPITAL_RE para ordem de alternation. */
const RENDA_RE = /renda\s*(?:mensal\s*)?(?:de\s*)?(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(mil|k|m)?/i

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

  // 1. Intent detection: keyword de taxa/preco OU sinais implicitos (produto + age + capital/renda)
  const hasRateKeyword = RATE_KEYWORDS.some((kw) => qNoAccent.includes(stripAccents(kw)))

  // 2. Age extraction — prioriza "NN anos", depois "idade NN"/"com NN", por ultimo "homem/mulher NN"
  let age: number | undefined
  const ageMatch = q.match(AGE_RE) ?? q.match(AGE_CTX_RE) ?? q.match(AGE_GENDER_RE)
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

  // 5. Product code — MAG numerico "codigo NNNN" ou Prudential alfanumerico (DDR5G, WL10G)
  const productCode = detectProductCode(question)

  // 6. Capital
  const capital = extractCapital(q)

  // 7. Renda mensal (DITA/DIT)
  const rendaMensal = extractRendaMensal(q)

  // 8. Franquia (DIT)
  let franquia: '7' | '10' | undefined
  const fMatch = q.match(FRANQUIA_RE)
  if (fMatch) franquia = fMatch[1] as '7' | '10'

  // Intent gating: keyword explicita OU (produto + age + capital|renda) — cotacao implicita
  const hasImplicitIntent = Boolean(
    (productHint || productCode) && age !== undefined && (capital !== undefined || rendaMensal !== undefined)
  )
  if (!hasRateKeyword && !hasImplicitIntent) {
    return { hasIntent: false }
  }

  return {
    hasIntent: true,
    age,
    gender,
    productHint,
    productCode,
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
  let n = parseBrazilianNumber(raw)
  if (isNaN(n)) return undefined
  n *= applyMagnitude(m[2] ?? '')
  // Sanity filter: renda mensal DIT/DITA tipicamente R$ 500 - R$ 100k
  if (n >= 500 && n <= 100_000) return n
  return undefined
}

function extractCapital(q: string): number | undefined {
  // 1. Preferir LABELED: "capital X" / "cap X". Evita pegar renda quando
  //    "renda 10k cap 1M" — o numero da renda (10_000) estaria no range
  //    sanity e vazaria.
  const labeled = q.match(CAPITAL_LABELED_RE)
  if (labeled) {
    const n = parseCapitalAmount(labeled[1], labeled[2] ?? '')
    if (n !== undefined && n >= 10_000 && n <= 50_000_000) return n
  }

  // 2. Fallback: generico, mas ignorando matches adjacentes a "renda" (N chars antes).
  const matches = [...q.matchAll(CAPITAL_RE)]
  for (const m of matches) {
    const start = m.index ?? 0
    const before = q.slice(Math.max(0, start - 30), start).toLowerCase()
    if (/renda\s*(?:mensal\s*)?(?:de\s*)?(?:r\$\s*)?$/.test(before)) continue
    const n = parseCapitalAmount(m[1], m[2] ?? '')
    if (n !== undefined && n >= 10_000 && n <= 50_000_000) return n
  }
  return undefined
}

function parseCapitalAmount(raw: string, suffix: string): number | undefined {
  let n = parseBrazilianNumber(raw)
  if (isNaN(n)) return undefined
  n *= applyMagnitude(suffix)
  return n
}

/** Converte sufixo de magnitude em multiplicador. "milhao" tem prioridade sobre "mil". */
function applyMagnitude(suffix: string): number {
  const s = suffix.toLowerCase()
  if (s.startsWith('milh') || s === 'mm') return 1_000_000
  if (s.startsWith('mil') || s === 'k') return 1_000
  if (s === 'm') return 1_000_000 // "1M" = 1 milhao (nao 1 mil)
  return 1
}

function detectProductCode(raw: string): string | undefined {
  // MAG: "codigo 2330" / "cod 2396" / "cód. 2398" — 4-5 digitos
  const numMatch = raw.match(PRODUCT_CODE_NUMERIC_RE)
  if (numMatch) return numMatch[1]

  // Prudential-style: DDR5G, WL10G, CIB5G, TM10, HC05G.
  // Evitar falsos positivos: F7 (franquia), G2 (grupo). Exigir pelo menos 2 letras iniciais.
  const alphaMatch = raw.match(PRODUCT_CODE_ALPHA_RE)
  if (alphaMatch) {
    const code = alphaMatch[1]
    // Descartar se for padrao franquia (F + 1-2 digitos) ou grupo (G + 1 digito)
    if (/^[FG]\d{1,2}$/i.test(code)) return undefined
    return code.toUpperCase()
  }
  return undefined
}

function parseBrazilianNumber(s: string): number {
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // BR full: 1.234,56 — pontos=milhares, virgula=decimal
    return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  }
  if (hasComma && !hasDot) {
    return parseFloat(s.replace(',', '.'))
  }
  if (hasDot && !hasComma) {
    // So pontos: ambiguo. Se TODOS os grupos apos pontos tem exatamente 3 digitos,
    // tratar como separador de milhar ("1.000", "1.100.000"). Senao, decimal ("1.1", "1.5").
    const parts = s.split('.')
    const allThousandGroups = parts.length > 1 && parts.slice(1).every((p) => p.length === 3)
    if (allThousandGroups) return parseFloat(s.replace(/\./g, ''))
    return parseFloat(s)
  }
  return parseFloat(s)
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
  // IMPORTANTE: so aplica o filtro de period quando o usuario forneceu franquia
  // ou renda (dimensoes exclusivas de DIT/DITA). Capital sozinho NAO dispara
  // o filtro, senao elimina produtos com period=null (Prudential, MAG outros).
  // Para per_1000_annual, capital entra no calculo do premio em formatRateAnswer.
  if (params.franquia || params.rendaMensal) {
    const periodParts: string[] = []
    periodParts.push(params.franquia ? `F${params.franquia}` : 'F%')
    periodParts.push(params.rendaMensal ? `R${params.rendaMensal}` : 'R%')
    periodParts.push(params.capital ? `C${params.capital}` : 'C%')
    q = q.ilike('period', periodParts.join('_'))
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
