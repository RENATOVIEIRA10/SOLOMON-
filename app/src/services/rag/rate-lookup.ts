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
  /** Nomes de produtos mencionados, quando a pergunta compara familias diferentes. */
  productHints?: string[]
  /** Codigo SUSEP/comercial do produto (MAG: "2330", Prudential: "DDR5G"). */
  productCode?: string
  /** Codigos mencionados na pergunta, quando ha comparacao entre produtos. */
  productCodes?: string[]
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

type QueryRateTableParams = {
  insurerId: string
  productHint?: string
  productHints?: string[]
  productCode?: string
  productCodes?: string[]
  age?: number
  gender?: 'M' | 'F'
  /** Para matrizes DIT/DITA: renda_mensal em R$ (codificada no campo period). */
  rendaMensal?: number
  /** Capital Morte por Acidente em R$ (codificado no campo period). */
  capital?: number
  /** Franquia DIT: '7' ou '10'. */
  franquia?: '7' | '10'
  limit?: number
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
  'mais barato',
  'mais caro',
  'barato',
  'caro',
]

/** Regex: idade explicita em anos. */
const AGE_RE = /\b(\d{1,2})\s*anos?\b/i
/** Regex: idade sem sufixo apenas com contexto forte antes do numero.
 *  Removido o `de NN` generico que pegava "capital de 50 mil" como idade=50. */
const AGE_CTX_RE = /\b(?:idade|cliente|segurado|pessoa|homem|mulher|feminino|masculino)\s*(?:de|com|:)?\s*(\d{2})\b/i
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
const PRODUCT_CODE_ALPHA_GLOBAL_RE = /\b([A-Z]{2,4}\d{1,3}[A-Z]?)\b/g

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
  const productHints = detectProductHints(qNoAccent, insurer)
  const productHint = productHints[0]

  // 5. Product code — MAG numerico "codigo NNNN" ou Prudential alfanumerico (DDR5G, WL10G)
  const productCodes = detectProductCodes(question)
  const productCode = detectProductCode(question) ?? productCodes[0]

  // 6. Capital
  const capital = extractCapital(q)

  // 7. Renda mensal (DITA/DIT)
  const rendaMensal = extractRendaMensal(q)

  // 8. Franquia (DIT)
  let franquia: '7' | '10' | undefined
  const fMatch = q.match(FRANQUIA_RE)
  if (fMatch) franquia = fMatch[1] as '7' | '10'

  // Intent gating: keyword explicita OU produto com dimensoes suficientes
  // para uma taxa estruturada. Capital e necessario para premio final, mas
  // productCode + idade + sexo ja resolve taxa por R$ 1.000 em tabelas Prudential.
  const hasProductCodeRate = Boolean(productCode && age !== undefined && gender !== undefined)
  const hasImplicitIntent = Boolean(
    hasProductCodeRate ||
    ((productHint || productCode) && age !== undefined && (capital !== undefined || rendaMensal !== undefined))
  )
  // Alem disso, keyword sozinha nao basta: se nenhum qualifier foi extraido
  // (age, capital, renda, produto), nao e cotacao — e pergunta generica tipo
  // "qual a taxa do seguro pet?". Deixar cair no RAG pra responder via PDF.
  const hasAnyQualifier =
    age !== undefined ||
    capital !== undefined ||
    rendaMensal !== undefined ||
    productCode !== undefined ||
    productHint !== undefined
  if (!hasRateKeyword && !hasImplicitIntent) {
    return { hasIntent: false }
  }
  if (hasRateKeyword && !hasImplicitIntent && !hasAnyQualifier) {
    return { hasIntent: false }
  }

  return {
    hasIntent: true,
    age,
    gender,
    productHint,
    productHints: productHints.length > 0 ? productHints : undefined,
    productCode,
    productCodes: productCodes.length > 0 ? productCodes : undefined,
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

function detectProductHints(q: string, insurer?: string): string[] {
  const matches: string[] = []
  for (const fam of PRODUCT_FAMILIES) {
    if (fam.insurer && insurer && fam.insurer !== insurer) continue
    if (fam.patterns.some((p) => q.includes(stripAccents(p)))) {
      matches.push(fam.canonical)
    }
  }
  return [...new Set(matches)]
    .sort((a, b) => b.length - a.length)
    .filter((candidate, index, all) => !all.slice(0, index).some((kept) => kept.includes(candidate)))
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

function detectProductCodes(raw: string): string[] {
  const codes: string[] = []

  const numMatch = raw.match(PRODUCT_CODE_NUMERIC_RE)
  if (numMatch) codes.push(numMatch[1])

  for (const alphaMatch of raw.matchAll(PRODUCT_CODE_ALPHA_GLOBAL_RE)) {
    const code = alphaMatch[1]
    if (/^[FG]\d{1,2}$/i.test(code)) continue
    codes.push(code.toUpperCase())
  }

  return [...new Set(codes)]
}

function parseBrazilianNumber(s: string): number {
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // BR full: 1.234,56 — pontos=milhares, virgula=decimal
    return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  }
  if (hasComma && !hasDot) {
    // "500,000" e "1,234,567" sao formato US thousands; com 3 digitos apos
    // virgula tratar como separador de milhar pra evitar virar decimal 500.
    if (/^\d{1,3}(?:,\d{3})+$/.test(s)) {
      return parseFloat(s.replace(/,/g, ''))
    }
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

function sanitizePostgrestOrValue(value: string): string {
  return value.replace(/[(),]/g, ' ').trim()
}

/**
 * Consulta insurer_rate_tables com filtros opcionais.
 */
export async function queryRateTable(params: QueryRateTableParams): Promise<RateRow[]> {
  const productHints = params.productHints?.length ? params.productHints : params.productHint ? [params.productHint] : []
  const productCodes = params.productCodes?.length ? params.productCodes : params.productCode ? [params.productCode] : []

  if (productCodes.length > 1 || (productCodes.length > 0 && productHints.length > 1)) {
    const rows: RateRow[] = []
    const codeProductHints = productHints.filter((hint) => hint !== 'DITA')
    const codeProductHint = codeProductHints.length === 1 ? codeProductHints[0] : undefined
    for (const code of productCodes) {
      rows.push(...(await queryRateTableSingle({
        ...params,
        productCode: code,
        productCodes: undefined,
        productHints: undefined,
        productHint: codeProductHint,
      })))
    }

    const coveredProductNames = new Set(rows.map((row) => normalizeProductName(row.product_name)))
    const uncoveredHints = productHints.filter((hint) => {
      const normalizedHint = normalizeProductName(hint)
      return ![...coveredProductNames].some((name) => name.includes(normalizedHint))
    })
    for (const hint of uncoveredHints) {
      rows.push(...(await queryRateTableSingle({
        ...params,
        productHint: hint,
        productHints: undefined,
        productCode: undefined,
        productCodes: undefined,
        franquia: hint === 'DITA' ? undefined : params.franquia,
      })))
    }
    return dedupeRateRows(rows)
  }

  if (productCodes.length === 0 && productHints.length > 1) {
    const rows: RateRow[] = []
    for (const hint of productHints) {
      rows.push(...(await queryRateTableSingle({
        ...params,
        productHint: hint,
        productHints: undefined,
        franquia: hint === 'DITA' ? undefined : params.franquia,
      })))
    }
    return dedupeRateRows(rows)
  }

  return queryRateTableSingle(params)
}

async function queryRateTableSingle(params: QueryRateTableParams): Promise<RateRow[]> {
  const supabase = createServiceClient()
  let q = supabase
    .from('insurer_rate_tables')
    .select('product_name, product_code, portfolio, coverage_type, gender, age, period, rate, rate_unit, source_doc_name, source_page, version_label')
    .eq('insurer_id', params.insurerId)

  const productHints = params.productHints?.length ? params.productHints : params.productHint ? [params.productHint] : []
  const productCodes = params.productCodes?.length ? params.productCodes : params.productCode ? [params.productCode] : []

  if (productCodes.length >= 2) {
    q = q.in('product_code', productCodes.map((code) => code.toUpperCase()))
  } else if (productCodes.length === 1 && productHints.length >= 2) {
    const productFilters = [
      ...productHints.map((hint) => `product_name.ilike.%${sanitizePostgrestOrValue(hint)}%`),
      `product_code.eq.${sanitizePostgrestOrValue(productCodes[0].toUpperCase())}`,
    ]
    q = q.or(productFilters.join(','))
  } else if (productCodes.length === 1 && productHints.length === 1) {
    q = q.eq('product_code', productCodes[0].toUpperCase()).ilike('product_name', `%${productHints[0]}%`)
  } else if (productCodes.length === 1) {
    q = q.eq('product_code', productCodes[0].toUpperCase())
  } else if (productHints.length >= 2) {
    q = q.or(productHints.map((hint) => `product_name.ilike.%${sanitizePostgrestOrValue(hint)}%`).join(','))
  } else if (params.productHint) {
    q = q.ilike('product_name', `%${params.productHint}%`)
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
  // WR-03/GRD-01: rate_unit desconhecido vindo do banco NUNCA chega ao
  // formatter. Decisao: validar AQUI (call boundary) e DEGRADAR — a linha
  // invalida e descartada com log; se nada sobrar, o fast-path da MISS e o
  // fluxo cai no RAG com o guard anti-aritmetica (GRD-01) injetado, em vez
  // de derrubar a request (500 em ask(), evento error no SSE). O throw em
  // assertRateUnit/formatCapitalPremiumLine permanece como defesa em
  // profundidade para chamadas diretas do formatter.
  return ((data ?? []) as RateRow[]).filter((row) => {
    try {
      assertRateUnit(row.rate_unit, 'queryRateTable')
      return true
    } catch (err) {
      console.error((err as Error).message)
      return false
    }
  })
}

function normalizeProductName(value: string): string {
  return stripAccents(value).toUpperCase()
}

function dedupeRateRows(rows: RateRow[]): RateRow[] {
  const seen = new Set<string>()
  const out: RateRow[] = []
  for (const row of rows) {
    const key = [
      row.product_name,
      row.product_code,
      row.coverage_type,
      row.gender,
      row.age,
      row.period ?? '',
      row.rate,
      row.rate_unit,
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out.sort((a, b) =>
    a.product_name.localeCompare(b.product_name) ||
    a.product_code.localeCompare(b.product_code) ||
    a.age - b.age ||
    a.gender.localeCompare(b.gender)
  )
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

  const comparisonSummary = buildRateComparisonSummary(groups, intent)
  if (comparisonSummary) {
    lines.push(comparisonSummary)
    lines.push('')
  }

  for (const [key, groupRows] of groups) {
    const [productName, productCode, coverageType] = key.split('|')
    const portfolio = groupRows[0].portfolio
    const page = groupRows[0].source_page
    const doc = groupRows[0].source_doc_name
    const version = groupRows[0].version_label ?? ''
    lines.push(`**${productName} — ${productCode}**${portfolio ? ` (Portfolio ${portfolio})` : ''} — Cobertura ${coverageType}`)
    const repeatedSummary = summarizeRepeatedRateRows(groupRows, intent)
    if (repeatedSummary) {
      lines.push(repeatedSummary)
    } else {
      for (const r of groupRows) {
        lines.push(formatRateRowLine(r))
        if (intent.capital && (r.rate_unit === 'per_1000_annual' || r.rate_unit === 'per_1000_monthly')) {
          lines.push(formatCapitalPremiumLine(r, intent.capital))
        }
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

function buildRateComparisonSummary(groups: Map<string, RateRow[]>, intent: RateIntent): string | undefined {
  if (groups.size < 2) return undefined

  const candidates = [...groups.entries()]
    .map(([key, rows]) => {
      const [productName, productCode] = key.split('|')
      const bestRow = rows.reduce((best, row) => comparableRateValue(row, intent) < comparableRateValue(best, intent) ? row : best)
      return {
        label: `${productName} - ${productCode}`,
        row: bestRow,
        value: comparableRateValue(bestRow, intent),
      }
    })
    .sort((a, b) => a.value - b.value)

  const cheapest = candidates[0]
  const mostExpensive = candidates[candidates.length - 1]
  if (!cheapest || !mostExpensive) return undefined

  const unit = rateUnitLabel(cheapest.row)
  const spread =
    mostExpensive.value > 0
      ? `; diferenca aproximada: ${formatBrNumber((1 - cheapest.value / mostExpensive.value) * 100, 1)}% menor que ${mostExpensive.label}`
      : ''
  const capitalNote =
    intent.capital && (cheapest.row.rate_unit === 'per_1000_annual' || cheapest.row.rate_unit === 'per_1000_monthly')
      ? ` para capital R$ ${formatBrNumber(intent.capital, 0)}`
      : ''
  return `**Comparativo:** ${cheapest.label} e o mais barato (${formatBrNumber(cheapest.value, cheapest.row.rate_unit === 'fixed_brl_monthly' ? 2 : 4)} ${unit}${capitalNote})${spread}.`
}

function comparableRateValue(row: RateRow, intent: RateIntent): number {
  if (intent.capital && (row.rate_unit === 'per_1000_annual' || row.rate_unit === 'per_1000_monthly')) {
    return (row.rate * intent.capital) / 1000
  }
  return row.rate
}

const KNOWN_RATE_UNITS = new Set([
  'fixed_brl_monthly',
  'per_1000_monthly',
  'per_1000_annual',
  'per_100_diaria_monthly',
  'per_1000_renda_monthly',
])

export function assertRateUnit(rateUnit: string, context: string): void {
  if (!KNOWN_RATE_UNITS.has(rateUnit)) {
    throw new Error(
      `[grd-01] rate_unit desconhecido "${rateUnit}" em ${context} — calculo de premio bloqueado para evitar conversao inventada`
    )
  }
}

function rateUnitLabel(row: RateRow): string {
  if (row.rate_unit === 'fixed_brl_monthly') return 'R$/mes'
  if (row.rate_unit === 'per_1000_monthly') return 'por R$ 1.000/mes'
  if (row.rate_unit === 'per_1000_annual') return 'por R$ 1.000/ano'
  if (row.rate_unit === 'per_100_diaria_monthly') return 'por R$ 100 de diaria/mes'
  if (row.rate_unit === 'per_1000_renda_monthly') return 'por R$ 1.000 de renda/mes'
  return row.rate_unit
}

function summarizeRepeatedRateRows(rows: RateRow[], intent: RateIntent): string | undefined {
  if (rows.length < 8) return undefined

  const first = rows[0]
  const sameRate = rows.every((row) =>
    row.rate === first.rate &&
    row.rate_unit === first.rate_unit &&
    (row.period ?? '') === (first.period ?? '')
  )
  if (!sameRate) return undefined

  const ages = [...new Set(rows.map((row) => row.age))].sort((a, b) => a - b)
  const genders = [...new Set(rows.map((row) => row.gender))].sort()
  const ageLabel = ages.length === 1 ? `Idade ${ages[0]}` : `Idades ${ages[0]} a ${ages[ages.length - 1]}`
  const genderLabel =
    genders.length === 2 ? 'Fem e Masc' : genders[0] === 'M' ? 'Masc' : 'Fem'
  const periodLabel = first.rate_unit === 'fixed_brl_monthly' ? formatPeriodDIT(first.period) : null
  const suffix = periodLabel ? ` — ${periodLabel}` : ''
  const lines = [`  - ${ageLabel} / ${genderLabel}${suffix}: **${formatRateValue(first)}** ${rateUnitText(first)}`]

  if (intent.capital && (first.rate_unit === 'per_1000_annual' || first.rate_unit === 'per_1000_monthly')) {
    lines.push(formatCapitalPremiumLine(first, intent.capital))
  }

  return lines.join('\n')
}

function formatRateRowLine(row: RateRow): string {
  const genderLabel = row.gender === 'M' ? 'Masc' : 'Fem'
  const periodLabel = row.rate_unit === 'fixed_brl_monthly' ? formatPeriodDIT(row.period) : null
  return `  - Idade ${row.age} / ${genderLabel}${periodLabel ? ` — ${periodLabel}` : ''}: **${formatRateValue(row)}** ${rateUnitText(row)}`
}

function formatRateValue(row: RateRow): string {
  if (row.rate_unit === 'fixed_brl_monthly') return `R$ ${formatBrNumber(row.rate, 2)}/mes`
  return formatBrNumber(row.rate)
}

function rateUnitText(row: RateRow): string {
  if (row.rate_unit === 'fixed_brl_monthly') return ''
  if (row.rate_unit === 'per_100_diaria_monthly') return 'por R$ 100 de diaria (taxa mensal)'
  if (row.rate_unit === 'per_1000_renda_monthly') return 'por R$ 1.000 de renda (taxa mensal)'
  if (row.rate_unit === 'per_1000_monthly') return 'por R$ 1.000 (taxa mensal)'
  return 'por R$ 1.000 (taxa anual)'
}

function formatCapitalPremiumLine(row: RateRow, capital: number): string {
  assertRateUnit(row.rate_unit, 'formatCapitalPremiumLine')
  const premio = (row.rate * capital) / 1000
  const mensal = row.rate_unit === 'per_1000_monthly' ? premio : premio / 12
  const anual = row.rate_unit === 'per_1000_monthly' ? premio * 12 : premio
  return `    Premio para capital R$ ${formatBrNumber(capital, 0)}: **R$ ${formatBrNumber(anual, 2)}/ano** (≈ R$ ${formatBrNumber(mensal, 2)}/mes)`
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
