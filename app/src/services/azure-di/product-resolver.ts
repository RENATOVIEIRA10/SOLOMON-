/**
 * Azure DI Layout → product resolver.
 *
 * Pure function. Given a set of resolution signals extracted from a PDF
 * (its URL, free-text product-name candidates, SUSEP process numbers,
 * product codes) and the relevant insurer's product catalog, returns
 * a {@link ProductResolution} — either a resolved `productId` with a
 * strategy + confidence, or an explicit `productUnresolved: true` with
 * a reason.
 *
 * Strategy cascade (highest confidence first):
 *   1. `terms_url` exact match    → confidence 1.00
 *   2. `susep_process` match       → confidence 0.95
 *   3. `code` match (exact-CI)     → confidence 0.85
 *   4. `fuzzy_name` (Jaccard ≥ θ) → confidence = score
 *   5. nothing matches             → unresolved
 *
 * The catalog is passed in (never read from a DB by this module). When
 * the catalog is empty (Azos / MAG today — see PR #17 §2), the resolver
 * returns `productUnresolved: true` with reason `catalog_empty`. This
 * is the correct, contract-compliant outcome — NOT a bug.
 *
 * Phase 2 / PR 3B slice 3B.4.
 * Scope guardrails: pure function, no DB write, no DB read (the caller
 * fetches the catalog), no indexer call, no read-path import, no
 * promotion. The chunk-gate (3B.3) consumes the productId/
 * productUnresolved fields the resolver produces.
 */

/** One row of the `products` catalog. */
export interface ProductCatalogRow {
  id: string
  name: string
  code?: string | null
  susep_process?: string | null
  terms_url?: string | null
}

/** Signals extracted from the PDF source that the resolver matches against. */
export interface ProductResolverSignals {
  /** The PDF's source URL. Compared verbatim against `products.terms_url`. */
  sourceUrl?: string
  /** Free-text product-name candidates (PDF title, link text, slug from URL). */
  productNameCandidates?: readonly string[]
  /** SUSEP process numbers found in the URL or content. */
  susepCandidates?: readonly string[]
  /** Product codes detected in the URL or content. */
  codeCandidates?: readonly string[]
}

/** Which strategy produced the match (or `unresolved`). */
export type ResolutionStrategy =
  | 'terms_url'
  | 'susep_process'
  | 'code'
  | 'fuzzy_name'
  | 'unresolved'

/** The unresolved-reason taxonomy. Stable strings for the report bucket. */
export type UnresolvedReason =
  | 'catalog_empty'
  | 'no_signals_matched'
  | 'fuzzy_below_threshold'

/** Result of a resolve call. */
export interface ProductResolution {
  productId?: string
  productName?: string
  strategy: ResolutionStrategy
  /** [0, 1]. 1.0 only on `terms_url`. Always 0 when `productUnresolved`. */
  confidence: number
  reason: string
  /** Other catalog rows that scored above 0 but lost — for review. */
  alternates: ReadonlyArray<{
    productId: string
    productName: string
    confidence: number
    strategy: ResolutionStrategy
  }>
  productUnresolved: boolean
  unresolvedReason?: UnresolvedReason
}

/** Options for {@link resolveProduct}. */
export interface ProductResolverOptions {
  /** Minimum Jaccard score (0–1) to accept a fuzzy_name match. Default 0.65. */
  minFuzzyScore?: number
}

const DEFAULT_MIN_FUZZY = 0.65

/** Normalize a string for fuzzy comparison: NFD-strip diacritics, lowercase, alnum-only tokens. */
export function normalizeForFuzzy(input: string): string {
  // ̀-ͯ is the combining-diacritic range. Use the escape form
  // (not literal chars) so the regex is robust to any JSON-mangling tool.
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(input: string): Set<string> {
  return new Set(
    normalizeForFuzzy(input)
      .split(' ')
      .filter((t) => t.length >= 2)
  )
}

/**
 * Token containment: fraction of `product` tokens that appear in `candidate`.
 * Asymmetric on purpose — product names are short ("Vida Inteira") and we
 * want them to match longer candidates that contain them ("condicoes gerais
 * vida inteira modificado 30"). Symmetric Jaccard would underscore those
 * cases (~0.33) and miss them.
 */
function tokenContainment(product: ReadonlySet<string>, candidate: ReadonlySet<string>): number {
  if (product.size === 0) return 0
  let intersection = 0
  for (const x of product) if (candidate.has(x)) intersection++
  return intersection / product.size
}

function normalizeSusep(input: string): string {
  return input.replace(/[^0-9]/g, '')
}

function normalizeCode(input: string): string {
  return input.trim().toLowerCase()
}

/**
 * Main entry point. Returns a resolution result; never throws.
 */
export function resolveProduct(
  signals: ProductResolverSignals,
  catalog: readonly ProductCatalogRow[],
  options: ProductResolverOptions = {}
): ProductResolution {
  if (catalog.length === 0) {
    return unresolved('catalog_empty', 'product catalog is empty for this insurer (e.g. Azos/MAG)')
  }

  // 1. terms_url exact match.
  if (signals.sourceUrl) {
    const target = signals.sourceUrl.trim()
    const hit = catalog.find((row) => row.terms_url && row.terms_url.trim() === target)
    if (hit) {
      return {
        productId: hit.id,
        productName: hit.name,
        strategy: 'terms_url',
        confidence: 1.0,
        reason: `terms_url exact match: ${target}`,
        alternates: [],
        productUnresolved: false,
      }
    }
  }

  // 2. susep_process match.
  if (signals.susepCandidates && signals.susepCandidates.length > 0) {
    const candidateDigits = new Set(signals.susepCandidates.map(normalizeSusep).filter((d) => d.length >= 10))
    if (candidateDigits.size > 0) {
      const hit = catalog.find((row) =>
        row.susep_process && candidateDigits.has(normalizeSusep(row.susep_process))
      )
      if (hit) {
        return {
          productId: hit.id,
          productName: hit.name,
          strategy: 'susep_process',
          confidence: 0.95,
          reason: `susep_process match: ${hit.susep_process}`,
          alternates: [],
          productUnresolved: false,
        }
      }
    }
  }

  // 3. code match (exact, case-insensitive).
  if (signals.codeCandidates && signals.codeCandidates.length > 0) {
    const candidateCodes = new Set(signals.codeCandidates.map(normalizeCode).filter((c) => c.length > 0))
    if (candidateCodes.size > 0) {
      const hit = catalog.find((row) =>
        row.code && candidateCodes.has(normalizeCode(row.code))
      )
      if (hit) {
        return {
          productId: hit.id,
          productName: hit.name,
          strategy: 'code',
          confidence: 0.85,
          reason: `code match: ${hit.code}`,
          alternates: [],
          productUnresolved: false,
        }
      }
    }
  }

  // 4. fuzzy_name across all name candidates × all catalog rows.
  const candidates = (signals.productNameCandidates ?? []).map(tokenize).filter((t) => t.size > 0)
  if (candidates.length > 0) {
    const scored: Array<{ row: ProductCatalogRow; score: number }> = []
    for (const row of catalog) {
      const rowTokens = tokenize(row.name)
      if (rowTokens.size === 0) continue
      let best = 0
      for (const candTokens of candidates) {
        const score = tokenContainment(rowTokens, candTokens)
        if (score > best) best = score
      }
      if (best > 0) scored.push({ row, score: best })
    }
    // Sort by score desc; tie-break by longer product name (more discriminating).
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.row.name.length - a.row.name.length
    })
    const minScore = options.minFuzzyScore ?? DEFAULT_MIN_FUZZY
    const top = scored[0]
    if (top && top.score >= minScore) {
      const alternates = scored
        .slice(1, 4)
        .filter((s) => s.score > 0)
        .map((s) => ({
          productId: s.row.id,
          productName: s.row.name,
          confidence: round3(s.score),
          strategy: 'fuzzy_name' as const,
        }))
      return {
        productId: top.row.id,
        productName: top.row.name,
        strategy: 'fuzzy_name',
        confidence: round3(top.score),
        reason: `fuzzy_name containment ${round3(top.score)} ≥ ${minScore} against "${top.row.name}"`,
        alternates,
        productUnresolved: false,
      }
    }
    if (top) {
      return unresolved(
        'fuzzy_below_threshold',
        `best fuzzy_name score ${round3(top.score)} < threshold ${minScore} (closest: "${top.row.name}")`
      )
    }
  }

  return unresolved('no_signals_matched', 'no terms_url, susep, code, or fuzzy-name match against the catalog')
}

function unresolved(reason: UnresolvedReason, message: string): ProductResolution {
  return {
    strategy: 'unresolved',
    confidence: 0,
    reason: message,
    alternates: [],
    productUnresolved: true,
    unresolvedReason: reason,
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

// --- signal extractors (pure helpers exported for the preview script + tests) ---

// Accepts the canonical `15414.901681/2017-97` form as well as URL-friendly
// hyphenated variants like `15414-604991-2023-12`. Any non-alphanumeric
// separator works between the four numeric groups.
const SUSEP_RE = /(\d{5})[-./]?(\d{6})[-/]?(\d{4})-?(\d{2})/g

/** Detect SUSEP process numbers in free text (URL slugs, file names, content). */
export function extractSusepCandidates(text: string): string[] {
  const out: string[] = []
  const matches = text.matchAll(SUSEP_RE)
  for (const m of matches) {
    out.push(`${m[1]}.${m[2]}/${m[3]}-${m[4]}`)
  }
  return out
}

/**
 * Derive a product-name candidate from a PDF URL by slugifying the
 * last meaningful path segment: e.g.
 * `https://.../condicoes-gerais-seguro-temporario.pdf` →
 * `condicoes gerais seguro temporario`.
 */
export function nameCandidateFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').filter((s) => s.length > 0)
    const last = segments[segments.length - 1] ?? ''
    const bare = last.replace(/\.pdf$/i, '')
    let decoded = bare
    try {
      decoded = decodeURIComponent(bare)
    } catch {
      // Malformed encoding — fall through with the raw slug.
    }
    return decoded
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return undefined
  }
}
