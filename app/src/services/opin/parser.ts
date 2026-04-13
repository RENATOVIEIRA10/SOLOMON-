/**
 * OPIN Response Parser
 *
 * Normalizes OPIN API responses into our Supabase schema format.
 * Maps products and coverages to the database insert types.
 *
 * Real OPIN structure (from Bradesco test):
 *   product.insuranceModality (not modality)
 *   product.termsAndConditions = [{susepProcessNumber, definition}] (array)
 *   product.coverages[].coverage (not type)
 *   product.coverages[].coverageAttributes (not attributes)
 *   coverageAttributes.minValue = [{amount, currency}] (array)
 *   coverageAttributes.gracePeriod = {amount, unit} or string
 */

import type { TablesInsert } from '@/types/database'
import type { OPINProduct, FetchResult } from './fetcher'

/** Valid coverage types in our database CHECK constraint */
const VALID_COVERAGE_TYPES = [
  'MORTE',
  'INVALIDEZ',
  'DOENCA_GRAVE',
  'DIT',
  'DIH',
  'FUNERAL',
  'AP',
] as const

type CoverageType = (typeof VALID_COVERAGE_TYPES)[number]

/**
 * Maps OPIN coverage type strings to our normalized enum.
 */
const COVERAGE_TYPE_MAP: Record<string, CoverageType> = {
  MORTE: 'MORTE',
  DEATH: 'MORTE',
  INVALIDEZ: 'INVALIDEZ',
  INVALIDEZ_PERMANENTE_TOTAL: 'INVALIDEZ',
  INVALIDEZ_FUNCIONAL_PERMANENTE_TOTAL: 'INVALIDEZ',
  INVALIDEZ_LABORATIVA_PERMANENTE_TOTAL: 'INVALIDEZ',
  INVALIDEZ_PERMANENTE_PARCIAL: 'INVALIDEZ',
  DISABILITY: 'INVALIDEZ',
  DOENCA_GRAVE: 'DOENCA_GRAVE',
  DOENCAS_GRAVES: 'DOENCA_GRAVE',
  CRITICAL_ILLNESS: 'DOENCA_GRAVE',
  DIT: 'DIT',
  DIARIAS_INCAPACIDADE_TEMPORARIA: 'DIT',
  INCAPACIDADE_TEMPORARIA: 'DIT',
  DIH: 'DIH',
  DIARIAS_INTERNACAO_HOSPITALAR: 'DIH',
  HOSPITALIZACAO: 'DIH',
  FUNERAL: 'FUNERAL',
  AUXILIO_FUNERAL: 'FUNERAL',
  ASSISTENCIA_FUNERAL: 'FUNERAL',
  AP: 'AP',
  ACIDENTE_PESSOAL: 'AP',
  MORTE_ACIDENTAL: 'MORTE',
  // Common OPIN types that map to existing categories
  DESPESAS_MEDICAS_HOSPITALARES_ODONTOLOGICAS: 'DIH',
  RENDA_POR_INVALIDEZ: 'INVALIDEZ',
  RENDA_POR_INCAPACIDADE: 'DIT',
  PECULIO_POR_MORTE: 'MORTE',
  PECÚLIO_POR_MORTE: 'MORTE',
  PENSAO_POR_MORTE: 'MORTE',
}

function normalizeCoverageType(raw: string): CoverageType | null {
  const upper = raw.toUpperCase().trim().replace(/\s+/g, '_')
  return COVERAGE_TYPE_MAP[upper] ?? null
}

/** Maps OPIN modality to our CHECK constraint values */
function normalizeModality(raw: string | undefined): string {
  if (!raw) return 'VIDA'
  const upper = raw.toUpperCase().trim()
  if (upper.includes('VIDA')) return 'VIDA'
  if (upper.includes('FUNERAL')) return 'FUNERAL'
  if (upper.includes('PREVIDENCIA') || upper.includes('PREVIDÊNCIA')) return 'PREVIDENCIA'
  if (upper.includes('AP') || upper.includes('ACIDENTE')) return 'AP'
  return 'VIDA'
}

export interface ParsedProduct {
  product: TablesInsert<'products'>
  coverages: Omit<TablesInsert<'coverages'>, 'product_id'>[]
}

export interface ParseResult {
  products: ParsedProduct[]
  skippedCoverages: number
  totalCoverages: number
}

/**
 * Parses a single OPIN product into our database schema.
 */
function parseProduct(
  product: OPINProduct,
  insurerId: string
): ParsedProduct {
  // termsAndConditions is an array in real OPIN responses
  const terms = product.termsAndConditions
  let termsUrl: string | null = null
  let susepProcess: string | null = null

  if (Array.isArray(terms) && terms.length > 0) {
    const first = terms[0] as Record<string, unknown>
    susepProcess = (first.susepProcessNumber as string) ?? null
    // 'definition' field often contains the URL, or there may be a 'url' field
    const url = (first.url as string) ?? null
    const definition = (first.definition as string) ?? null
    termsUrl = url || (definition && definition.toLowerCase().startsWith('http') ? definition : null)
  } else if (terms && typeof terms === 'object' && !Array.isArray(terms)) {
    const t = terms as Record<string, unknown>
    susepProcess = (t.susepProcessNumber as string) ?? null
    termsUrl = (t.url as string) ?? null
  }

  const parsedProduct: TablesInsert<'products'> = {
    insurer_id: insurerId,
    name: product.name || 'Sem nome',
    code: product.code ?? null,
    category: product.category ?? null,
    modality: normalizeModality(
      (product.insuranceModality as string) ?? (product.modality as string)
    ),
    susep_process: susepProcess,
    terms_url: termsUrl,
    raw_data: JSON.parse(JSON.stringify(product)),
    active: true,
  }

  const coverages: Omit<TablesInsert<'coverages'>, 'product_id'>[] = []
  const rawCoverages = (product.coverages ?? []) as Array<Record<string, unknown>>

  for (const cov of rawCoverages) {
    const mapped = parseCoverage(cov)
    if (mapped) {
      coverages.push(mapped)
    }
  }

  return { product: parsedProduct, coverages }
}

/**
 * Parses a single OPIN coverage into our database schema.
 * Real OPIN uses 'coverage' (not 'type') and 'coverageAttributes' (not 'attributes').
 */
function parseCoverage(
  cov: Record<string, unknown>
): Omit<TablesInsert<'coverages'>, 'product_id'> | null {
  // Real field name is 'coverage', fallback to 'type'
  const rawType = (cov.coverage as string) ?? (cov.type as string) ?? ''
  const normalizedType = normalizeCoverageType(rawType)

  if (!normalizedType) {
    return null
  }

  // Real field name is 'coverageAttributes', fallback to 'attributes'
  const attrs = (cov.coverageAttributes ?? cov.attributes ?? {}) as Record<string, unknown>

  return {
    type: normalizedType,
    min_value: extractAmount(attrs.minValue),
    max_value: extractAmount(attrs.maxValue),
    grace_period_days: parseGracePeriod(attrs.gracePeriod),
    excluded_risks: extractStringArray(attrs.excludedRisks),
    details: JSON.parse(JSON.stringify(attrs)),
  }
}

/**
 * Extracts a numeric amount from OPIN value fields.
 * Can be: {amount: 1000}, [{amount: "1000", currency: "BRL"}], or number
 */
function extractAmount(val: unknown): number | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val

  // Array format: [{amount: "1000.00", currency: "BRL"}]
  if (Array.isArray(val) && val.length > 0) {
    const first = val[0] as Record<string, unknown>
    const amount = first?.amount
    if (typeof amount === 'number') return amount
    if (typeof amount === 'string') return parseFloat(amount) || null
  }

  // Object format: {amount: 1000}
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    const amount = obj.amount
    if (typeof amount === 'number') return amount
    if (typeof amount === 'string') return parseFloat(amount) || null
  }

  return null
}

/**
 * Extracts string array, handling both string[] and other formats.
 */
function extractStringArray(val: unknown): string[] | null {
  if (!val) return null
  if (Array.isArray(val)) return val.map(String)
  return null
}

/**
 * Converts OPIN grace period to days.
 * Can be: {amount: 60, unit: "DIAS"}, {amount: "60", unit: "DIAS"}, or string
 */
function parseGracePeriod(gracePeriod: unknown): number | null {
  if (!gracePeriod) return null

  if (typeof gracePeriod === 'number') return gracePeriod

  if (typeof gracePeriod === 'string') {
    const num = parseInt(gracePeriod, 10)
    return isNaN(num) ? null : num
  }

  if (typeof gracePeriod === 'object') {
    const gp = gracePeriod as Record<string, unknown>
    const amount = typeof gp.amount === 'number' ? gp.amount
      : typeof gp.amount === 'string' ? parseInt(gp.amount, 10) : null

    if (amount === null || isNaN(amount)) return null

    const unit = ((gp.unit as string) ?? 'DIAS').toUpperCase()
    switch (unit) {
      case 'DIAS':
      case 'DAYS':
        return amount
      case 'MESES':
      case 'MONTHS':
        return amount * 30
      case 'ANOS':
      case 'YEARS':
        return amount * 365
      default:
        return amount
    }
  }

  return null
}

/**
 * Parses all products from a set of fetch results for a given insurer ID.
 */
export function parseOPINResults(
  results: FetchResult[],
  insurerId: string
): ParseResult {
  const products: ParsedProduct[] = []
  let skippedCoverages = 0
  let totalCoverages = 0

  for (const result of results) {
    if (result.error) continue

    for (const rawProduct of result.products) {
      const rawCoverageCount = (rawProduct.coverages as unknown[])?.length ?? 0
      totalCoverages += rawCoverageCount

      const parsed = parseProduct(rawProduct, insurerId)
      skippedCoverages += rawCoverageCount - parsed.coverages.length

      products.push(parsed)
    }
  }

  return { products, skippedCoverages, totalCoverages }
}

/**
 * Extracts all unique terms_url values from parsed products.
 */
export function extractTermsUrls(products: ParsedProduct[]): string[] {
  const urls = new Set<string>()
  for (const { product } of products) {
    if (product.terms_url) {
      urls.add(product.terms_url)
    }
  }
  return Array.from(urls)
}
