/**
 * RAG audit — shared helpers.
 *
 * Read-only by contract: all scripts in this directory only SELECT, never
 * INSERT/UPDATE/DELETE. Output is markdown to stdout (pipe to a file in
 * `docs/audit-runs/` to capture a snapshot).
 *
 * Auth: uses SUPABASE_SERVICE_ROLE_KEY from app/.env.local (gitignored).
 * Run from `app/`:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/inventory.ts
 */

import 'dotenv/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function getClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      '[rag-audit] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in app/.env.local'
    )
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export function section(title: string): void {
  console.log(`\n## ${title}\n`)
}

export function table(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log('_(no rows)_')
    return
  }
  const headers = Object.keys(rows[0])
  console.log('| ' + headers.join(' | ') + ' |')
  console.log('|' + headers.map(() => '---').join('|') + '|')
  for (const r of rows) {
    console.log(
      '| ' +
        headers
          .map((h) => {
            const v = r[h]
            if (v === null || v === undefined) return '_null_'
            if (typeof v === 'object') return '`' + JSON.stringify(v).slice(0, 80) + '`'
            return String(v)
          })
          .join(' | ') +
        ' |'
    )
  }
}

export async function runSQL(sb: SupabaseClient, sql: string): Promise<Array<Record<string, unknown>>> {
  // Supabase has no generic raw SQL endpoint via JS client. We rely on the
  // `match_documents` RPC and equivalent typed queries. For arbitrary SELECT
  // statements we fall back to PostgREST per-table .select().
  // This helper is intentionally NOT executing raw SQL — callers should use
  // typed queries below.
  throw new Error('use typed query helpers, not runSQL: ' + sql)
}
