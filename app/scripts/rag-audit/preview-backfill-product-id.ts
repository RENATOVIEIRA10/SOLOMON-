/**
 * Phase 3A — Gate G1 — Backfill PRODUCT_ID preview (READ-ONLY).
 *
 * Targets the 5 insurers whose chunk pool has `product_id=NULL` and whose
 * `metadata.product_name` is already populated (per Phase 1 audit §1.4):
 *   - MAG Seguros
 *   - Azos
 *   - MetLife
 *   - MAPFRE Seguros
 *   - Caixa Vida e Previdencia
 *
 * What this script DOES:
 *   1. Reads chunks (`public.documents`) and products (`public.products`).
 *   2. Applies the 4-strategy match ladder from the Phase 3A plan §1.2.
 *   3. Writes 3 CSVs to `docs/audit-runs/`:
 *        - phase-3a-backfill-proposal-YYYYMMDD.csv
 *        - phase-3a-unmatched-YYYYMMDD.csv
 *        - phase-3a-conflicts-YYYYMMDD.csv
 *   4. Prints a markdown summary table to stdout.
 *
 * What this script DOES NOT do:
 *   - No UPDATE / INSERT / DELETE on Supabase. EVER.
 *   - No migration creation. No RPC creation. No schema change.
 *   - No write outside the local `docs/audit-runs/` directory.
 *   - No environment variable mutation.
 *
 * Strategy ladder (per plan §1.2 — first match wins per chunk):
 *   1) EXACT_NORMALIZED   : normalized(metadata.product_name) == normalized(products.name), same insurer
 *   2) EXACT_GLOBAL       : (used only to detect cross-insurer leak conflicts; never proposed)
 *   3) TOKEN_SIMILARITY   : Jaccard token-set similarity ≥ threshold, same insurer (TS-side equivalent of pg_trgm)
 *   4) UNMATCHED          : chunk has no match; queued for Phase 2 review
 *
 * Conflict definition (CSV `phase-3a-conflicts`):
 *   - Two different products from the SAME insurer tie under strategy #3 (ambiguous).
 *   - Or any case where strategy #2 (global, ignoring insurer scope) returns a product
 *     whose insurer_id differs from the chunk's insurer_id. This is the cross-insurer
 *     leak guard. Such chunks are NOT proposed — they are written to the conflicts CSV
 *     instead so a human can audit before the backfill is approved.
 *
 * Usage (from `app/`):
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/preview-backfill-product-id.ts
 *   JACCARD_THRESHOLD=0.6 npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/preview-backfill-product-id.ts
 *
 * Note: Jaccard token similarity is used as the TS-side equivalent of pg_trgm because the
 * Supabase JS client does not expose trigram operators directly and we are forbidden from
 * creating a server-side function in Gate G1. The threshold default (0.7) matches the plan.
 */

import 'dotenv/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGET_INSURERS = [
  'MAG Seguros',
  'Azos',
  'MetLife',
  'MAPFRE Seguros',
  'Caixa Vida e Previdencia',
] as const

const JACCARD_THRESHOLD = Number(process.env.JACCARD_THRESHOLD ?? '0.7')
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../../../docs/audit-runs')

type Strategy =
  | 'EXACT_NORMALIZED'
  | 'TOKEN_SIMILARITY'
  | 'UNMATCHED'

interface InsurerRow {
  id: string
  name: string
}

interface ProductRow {
  id: string
  name: string
  insurer_id: string
  // The catalog uses these fields when available; we read them defensively.
  susep_process?: string | null
}

interface ChunkRow {
  id: string
  insurer_id: string | null
  product_id: string | null
  source_type: string
  metadata: Record<string, unknown> | null
}

interface Proposal {
  chunk_id: string
  insurer_name: string
  insurer_id: string
  current_product_id: string | null
  proposed_product_id: string
  proposed_product_name: string
  strategy: Strategy
  jaccard_score: number | null
  product_name_chunk: string
}

interface Unmatched {
  chunk_id: string
  insurer_name: string
  insurer_id: string
  product_name_chunk: string
  reason: string
}

interface Conflict {
  chunk_id: string
  insurer_name: string
  insurer_id: string
  product_name_chunk: string
  candidates: string
  reason: string
}

function getClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      '[phase-3a-g1] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in app/.env.local'
    )
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

function normalize(s: string): string {
  // NFD decomposes accented chars into base + combining marks (U+0300..U+036F),
  // then we strip those marks via explicit unicode escape (resilient against
  // any encoding surprises in the file itself).
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(s: string): Set<string> {
  return new Set(
    normalize(s)
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 2)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(',')
}

function today(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

async function loadInsurers(sb: SupabaseClient): Promise<InsurerRow[]> {
  const { data, error } = await sb.from('insurers').select('id, name').in('name', [...TARGET_INSURERS])
  if (error) throw new Error('[insurers] ' + error.message)
  return (data ?? []) as InsurerRow[]
}

async function loadAllInsurerIdToName(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await sb.from('insurers').select('id, name')
  if (error) throw new Error('[insurers-all] ' + error.message)
  return new Map((data ?? []).map((i: { id: string; name: string }) => [i.id, i.name]))
}

async function loadAllProducts(sb: SupabaseClient): Promise<ProductRow[]> {
  // We fetch ALL products (not just the target 5 insurers) because the
  // cross-insurer leak guard needs to know if a chunk's product_name matches
  // a product owned by a DIFFERENT insurer. Without the global view we cannot
  // raise that conflict.
  const PAGE = 1000
  let from = 0
  const out: ProductRow[] = []
  for (;;) {
    const { data, error } = await sb
      .from('products')
      .select('id, name, insurer_id, susep_process')
      .range(from, from + PAGE - 1)
    if (error) throw new Error('[products] ' + error.message)
    const rows = (data ?? []) as ProductRow[]
    out.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return out
}

async function loadChunksForInsurer(
  sb: SupabaseClient,
  insurerId: string
): Promise<ChunkRow[]> {
  // Pull only the rows we care about: product_id IS NULL AND metadata.product_name exists.
  // Pagination via range to bypass the default 1000-row cap.
  const PAGE = 1000
  let from = 0
  const out: ChunkRow[] = []
  for (;;) {
    const { data, error } = await sb
      .from('documents')
      .select('id, insurer_id, product_id, source_type, metadata')
      .eq('insurer_id', insurerId)
      .is('product_id', null)
      .not('metadata->>product_name', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error('[chunks ' + insurerId + '] ' + error.message)
    const rows = (data ?? []) as ChunkRow[]
    out.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return out
}

interface IndexEntry {
  product: ProductRow
  normalizedName: string
  tokens: Set<string>
}

function buildProductIndex(products: ProductRow[]): IndexEntry[] {
  return products.map((p) => ({
    product: p,
    normalizedName: normalize(p.name),
    tokens: tokenize(p.name),
  }))
}

function matchExactNormalized(
  chunkName: string,
  insurerId: string,
  index: IndexEntry[]
): ProductRow[] {
  const target = normalize(chunkName)
  if (!target) return []
  return index
    .filter((e) => e.product.insurer_id === insurerId && e.normalizedName === target)
    .map((e) => e.product)
}

function matchExactGlobal(
  chunkName: string,
  index: IndexEntry[]
): ProductRow[] {
  const target = normalize(chunkName)
  if (!target) return []
  return index.filter((e) => e.normalizedName === target).map((e) => e.product)
}

function matchTokenSimilarity(
  chunkName: string,
  insurerId: string,
  index: IndexEntry[],
  threshold: number
): Array<{ product: ProductRow; score: number }> {
  const chunkTokens = tokenize(chunkName)
  if (chunkTokens.size === 0) return []
  const scored: Array<{ product: ProductRow; score: number }> = []
  for (const e of index) {
    if (e.product.insurer_id !== insurerId) continue
    const s = jaccard(chunkTokens, e.tokens)
    if (s >= threshold) scored.push({ product: e.product, score: s })
  }
  return scored.sort((a, b) => b.score - a.score)
}

async function main() {
  const sb = getClient()

  console.log(`# Phase 3A Gate G1 — backfill preview`)
  console.log(`_Generated: ${new Date().toISOString()}_`)
  console.log(`_Threshold (Jaccard): ${JACCARD_THRESHOLD}_`)
  console.log()
  console.log(`**READ-ONLY.** No writes are issued to Supabase by this script.`)
  console.log()

  const targetInsurers = await loadInsurers(sb)
  if (targetInsurers.length !== TARGET_INSURERS.length) {
    const found = new Set(targetInsurers.map((i) => i.name))
    const missing = TARGET_INSURERS.filter((n) => !found.has(n))
    console.log(`> Warning: insurers not found in \`public.insurers\`: ${missing.join(', ')}`)
    console.log()
  }

  const allProducts = await loadAllProducts(sb)
  const allInsurerNames = await loadAllInsurerIdToName(sb)
  const productIndex = buildProductIndex(allProducts)

  // Per-insurer accumulators
  const proposals: Proposal[] = []
  const unmatched: Unmatched[] = []
  const conflicts: Conflict[] = []
  const summary: Array<{
    insurer: string
    catalog_products: number
    chunks_considered: number
    matched_exact: number
    matched_token: number
    unmatched: number
    conflicts: number
  }> = []

  for (const ins of targetInsurers) {
    const catalogProducts = allProducts.filter((p) => p.insurer_id === ins.id)
    const chunks = await loadChunksForInsurer(sb, ins.id)
    let matchedExact = 0
    let matchedToken = 0
    let perInsurerUnmatched = 0
    let perInsurerConflicts = 0

    for (const c of chunks) {
      const productName = (c.metadata?.product_name as string | undefined) ?? null
      if (!productName) {
        // Defensive: query already filtered, but double-check.
        unmatched.push({
          chunk_id: c.id,
          insurer_name: ins.name,
          insurer_id: ins.id,
          product_name_chunk: '',
          reason: 'metadata.product_name missing',
        })
        perInsurerUnmatched++
        continue
      }

      // Strategy 1 — exact normalized within the chunk's insurer.
      const exactSame = matchExactNormalized(productName, ins.id, productIndex)
      // Cross-insurer leak guard — exact match in a different insurer.
      const exactAll = matchExactGlobal(productName, productIndex)
      const crossInsurerHits = exactAll.filter((p) => p.insurer_id !== ins.id)

      if (exactSame.length === 1) {
        // Clean exact match within the chunk's insurer.
        proposals.push({
          chunk_id: c.id,
          insurer_name: ins.name,
          insurer_id: ins.id,
          current_product_id: c.product_id,
          proposed_product_id: exactSame[0].id,
          proposed_product_name: exactSame[0].name,
          strategy: 'EXACT_NORMALIZED',
          jaccard_score: null,
          product_name_chunk: productName,
        })
        matchedExact++
        continue
      }

      if (exactSame.length > 1) {
        // Ambiguous: same insurer has 2+ products with identical normalized name.
        // Do NOT propose. Flag as conflict.
        conflicts.push({
          chunk_id: c.id,
          insurer_name: ins.name,
          insurer_id: ins.id,
          product_name_chunk: productName,
          candidates: exactSame.map((p) => `${p.id}:${p.name}`).join('|'),
          reason: 'EXACT_NORMALIZED ambiguous (same insurer, multiple products)',
        })
        perInsurerConflicts++
        continue
      }

      // No exact match in the chunk's insurer.
      // If there is an exact match in a DIFFERENT insurer, flag conflict but still
      // try token similarity in the chunk's insurer.
      if (crossInsurerHits.length > 0) {
        // Record the cross-insurer signal but do not propose it. This is the leak
        // guard the plan §1.3 talks about.
        conflicts.push({
          chunk_id: c.id,
          insurer_name: ins.name,
          insurer_id: ins.id,
          product_name_chunk: productName,
          candidates: crossInsurerHits
            .map((p) => `${p.id}@${allInsurerNames.get(p.insurer_id) ?? p.insurer_id}:${p.name}`)
            .join('|'),
          reason: 'EXACT_NORMALIZED matched a product of a different insurer (cross-insurer leak)',
        })
        perInsurerConflicts++
        // intentional fall-through: still try Jaccard within the chunk's insurer.
      }

      // Strategy 3 — Jaccard token similarity within the chunk's insurer.
      const tokenHits = matchTokenSimilarity(productName, ins.id, productIndex, JACCARD_THRESHOLD)
      if (tokenHits.length === 0) {
        unmatched.push({
          chunk_id: c.id,
          insurer_name: ins.name,
          insurer_id: ins.id,
          product_name_chunk: productName,
          reason: `no exact, no token-similarity ≥ ${JACCARD_THRESHOLD}`,
        })
        perInsurerUnmatched++
        continue
      }

      // If the top score and the second score are tied, that's ambiguous — conflict.
      if (tokenHits.length > 1 && tokenHits[0].score === tokenHits[1].score) {
        conflicts.push({
          chunk_id: c.id,
          insurer_name: ins.name,
          insurer_id: ins.id,
          product_name_chunk: productName,
          candidates: tokenHits
            .slice(0, 5)
            .map((h) => `${h.product.id}(${h.score.toFixed(3)}):${h.product.name}`)
            .join('|'),
          reason: `TOKEN_SIMILARITY top tie at score=${tokenHits[0].score.toFixed(3)}`,
        })
        perInsurerConflicts++
        continue
      }

      // Clean token-similarity winner.
      const top = tokenHits[0]
      proposals.push({
        chunk_id: c.id,
        insurer_name: ins.name,
        insurer_id: ins.id,
        current_product_id: c.product_id,
        proposed_product_id: top.product.id,
        proposed_product_name: top.product.name,
        strategy: 'TOKEN_SIMILARITY',
        jaccard_score: top.score,
        product_name_chunk: productName,
      })
      matchedToken++
    }

    summary.push({
      insurer: ins.name,
      catalog_products: catalogProducts.length,
      chunks_considered: chunks.length,
      matched_exact: matchedExact,
      matched_token: matchedToken,
      unmatched: perInsurerUnmatched,
      conflicts: perInsurerConflicts,
    })
  }

  // ---------------- output ----------------

  console.log(`## Summary`)
  console.log()
  console.log(
    `| insurer | catalog_products | chunks_considered | matched_exact | matched_token | unmatched | conflicts |`
  )
  console.log(`|---|---|---|---|---|---|---|`)
  for (const r of summary) {
    console.log(
      `| ${r.insurer} | ${r.catalog_products} | ${r.chunks_considered} | ${r.matched_exact} | ${r.matched_token} | ${r.unmatched} | ${r.conflicts} |`
    )
  }
  console.log()

  await mkdir(OUTPUT_DIR, { recursive: true })
  const stamp = today()

  const proposalPath = path.join(OUTPUT_DIR, `phase-3a-backfill-proposal-${stamp}.csv`)
  const unmatchedPath = path.join(OUTPUT_DIR, `phase-3a-unmatched-${stamp}.csv`)
  const conflictsPath = path.join(OUTPUT_DIR, `phase-3a-conflicts-${stamp}.csv`)

  const proposalCsv = [
    csvRow([
      'chunk_id',
      'insurer_name',
      'insurer_id',
      'current_product_id',
      'proposed_product_id',
      'proposed_product_name',
      'strategy',
      'jaccard_score',
      'product_name_chunk',
    ]),
    ...proposals.map((p) =>
      csvRow([
        p.chunk_id,
        p.insurer_name,
        p.insurer_id,
        p.current_product_id ?? '',
        p.proposed_product_id,
        p.proposed_product_name,
        p.strategy,
        p.jaccard_score === null ? '' : p.jaccard_score.toFixed(4),
        p.product_name_chunk,
      ])
    ),
  ].join('\n')

  const unmatchedCsv = [
    csvRow(['chunk_id', 'insurer_name', 'insurer_id', 'product_name_chunk', 'reason']),
    ...unmatched.map((u) =>
      csvRow([u.chunk_id, u.insurer_name, u.insurer_id, u.product_name_chunk, u.reason])
    ),
  ].join('\n')

  const conflictsCsv = [
    csvRow(['chunk_id', 'insurer_name', 'insurer_id', 'product_name_chunk', 'candidates', 'reason']),
    ...conflicts.map((c) =>
      csvRow([c.chunk_id, c.insurer_name, c.insurer_id, c.product_name_chunk, c.candidates, c.reason])
    ),
  ].join('\n')

  await writeFile(proposalPath, proposalCsv, 'utf-8')
  await writeFile(unmatchedPath, unmatchedCsv, 'utf-8')
  await writeFile(conflictsPath, conflictsCsv, 'utf-8')

  console.log(`## CSV outputs`)
  console.log()
  console.log(`- Proposals  → \`${path.relative(process.cwd(), proposalPath)}\` (${proposals.length} rows)`)
  console.log(`- Unmatched  → \`${path.relative(process.cwd(), unmatchedPath)}\` (${unmatched.length} rows)`)
  console.log(`- Conflicts  → \`${path.relative(process.cwd(), conflictsPath)}\` (${conflicts.length} rows)`)
  console.log()

  console.log(`## Gate G1 verdict`)
  console.log()
  if (conflicts.length === 0) {
    console.log(`**PASS** — no conflicts detected. CEO can review the proposal CSV per insurer.`)
  } else {
    console.log(
      `**REVIEW REQUIRED** — ${conflicts.length} conflict(s) detected. The strategy ladder must be tightened, the catalog cleaned, or the affected insurer dropped from the backfill before Gate G3 is unlocked.`
    )
  }
  console.log()
  console.log(`No write was issued to Supabase. No production state has changed.`)
}

main().catch((err) => {
  console.error('[phase-3a-g1/preview-backfill] fatal:', err)
  process.exit(1)
})
