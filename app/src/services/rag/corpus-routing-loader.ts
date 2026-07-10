/**
 * Runtime loader for the `corpus_routing` table (slice 3C-d wiring).
 *
 * `chooseRetrievalCorpus` is an AND-gate: an insurer only reaches the shadow
 * corpus when it is BOTH in the `SHADOW_CORPUS_ALLOWLIST` env var AND has a
 * `corpus_routing` row with mode='shadow'. The helper and the table shipped in
 * slices 3C-a/b, but no caller ever loaded the table — `corpusDbRouting` was
 * threaded through the types and never populated, so the DB half of the gate
 * could not fire. This module closes that gap.
 *
 * Fail-open to LEGACY: any error (table missing, network, bad row) yields an
 * empty map, which `chooseRetrievalCorpus` resolves to 'legacy'. A routing
 * outage must degrade to the old corpus, never take retrieval down.
 *
 * Cached for CACHE_TTL_MS per process so the ask path does not add a DB
 * round-trip per request. The flip is operational (minutes), not real-time.
 */

import { createServiceClient } from '@/lib/supabase'
import type { Corpus } from '@/config/corpus-routing'

const CACHE_TTL_MS = 60_000

interface RoutingRow {
  insurer_name: string
  mode: string
}

/** Minimal client surface, injectable for tests. */
export interface RoutingClientLike {
  from(table: 'corpus_routing'): {
    select(columns: string): PromiseLike<{ data: RoutingRow[] | null; error: { message: string } | null }>
  }
}

let cache: { at: number; map: ReadonlyMap<string, Corpus> } | null = null

/** Pure: rows → routing map. Unknown modes are dropped (legacy by omission). */
export function routingRowsToMap(rows: readonly RoutingRow[]): ReadonlyMap<string, Corpus> {
  const map = new Map<string, Corpus>()
  for (const row of rows) {
    if (!row || typeof row.insurer_name !== 'string' || row.insurer_name.length === 0) continue
    if (row.mode !== 'legacy' && row.mode !== 'shadow') continue
    map.set(row.insurer_name, row.mode)
  }
  return map
}

/**
 * Load the routing map, cached. On any failure returns an empty map (legacy).
 * `deps` exists for tests only; production callers pass nothing.
 */
export async function loadCorpusRoutingMap(deps?: {
  client?: RoutingClientLike
  now?: () => number
}): Promise<ReadonlyMap<string, Corpus>> {
  const now = deps?.now ?? Date.now
  if (!deps?.client && cache && now() - cache.at < CACHE_TTL_MS) {
    return cache.map
  }
  try {
    const client = deps?.client ?? (createServiceClient() as unknown as RoutingClientLike)
    const { data, error } = await client.from('corpus_routing').select('insurer_name, mode')
    if (error) throw new Error(error.message)
    const map = routingRowsToMap(data ?? [])
    if (!deps?.client) cache = { at: now(), map }
    return map
  } catch (err) {
    console.warn(
      `[corpus-routing] load failed, degrading to legacy for all insurers: ${(err as Error).message}`,
    )
    return new Map()
  }
}

/** Test-only: reset the module cache. */
export function _resetCorpusRoutingCache(): void {
  cache = null
}
