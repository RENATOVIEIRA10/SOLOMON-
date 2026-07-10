/**
 * MAG conditions_pdf noise cleanup.
 *
 * 73% of MAG's `conditions_pdf` corpus is not general conditions at all: a
 * sales guide (275 chunks), a sustainability report (26), a salary-equality
 * e-book (3), a law explainer (6) and an operating procedure (4) — 314 rows
 * across 5 documents, all visible to the read path. When a broker asks about
 * MAG carência, three quarters of the candidate pool is noise. Likely a big
 * part of MAG's 1.7/5 tier1 score.
 *
 * Fix: stamp `metadata.rag_exclude = 'true'` on those rows. This is EXISTING
 * production semantics — `match_documents` already filters
 * `metadata->>'rag_exclude' <> 'true'` — so no read-path code changes, and the
 * fix is reversible (set it back to null). Rows are NOT deleted; `source_type`
 * is NOT rewritten (the ingestion mislabeling is a separate concern).
 *
 * Modes:
 *   (default)  dry-run: shows what would be stamped, writes nothing
 *   --write    stamps the rows, then re-probes visibility
 *
 * Run from app/:
 *   npm run phase2:mag-noise-exclude
 *   npm run phase2:mag-noise-exclude -- --write
 */

import path from 'node:path'

import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../../src/types/database'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

const MAG_INSURER_ID = '2f9b2aa3-51ac-45ae-a3d2-f99d8720f273'

/** The five documents that are not general conditions. Exact URLs, no regex. */
const NOISE_SOURCE_URLS = [
  'local://mag/guia-vendas-por-cobertura-v02-mar2025.pdf',
  'https://magportaisinststgprd.blob.core.windows.net/magseguros/2025/06/MAG_Relatorio-de-Sustentabildade-2024_maio2025-5_compressed.pdf',
  'https://magportaisinststgprd.blob.core.windows.net/magseguros/2026/04/Lei-da-Igualdade-Salarial-2025-2.pdf',
  'https://magportaisinststgprd.blob.core.windows.net/magseguros/2025/09/Procedimento-Operacional-Resolucao-Cj12.pdf',
  'https://magportaisinststgprd.blob.core.windows.net/magseguros/2025/09/E-Book-lei-da-equidade-Salarial-2-Ciclo-2025.pdf',
] as const

const EXCLUDE_REASON =
  'nao e condicao geral (guia de vendas/relatorio/e-book/procedimento) rotulado conditions_pdf por engano — excluido do RAG em 2026-07-10, PR mag-noise'

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name]
    if (v && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function makeClient(): SupabaseClient<Database> {
  const url = envValue('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing Supabase credentials in .env.local.')
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

/** Rows for one noise URL that are still visible to retrieval. */
async function visibleRows(
  client: SupabaseClient<Database>,
  sourceUrl: string,
): Promise<Array<{ id: string; metadata: unknown }>> {
  const { data, error } = await client
    .from('documents')
    .select('id, metadata')
    .eq('insurer_id', MAG_INSURER_ID)
    .eq('source_url', sourceUrl)
    .is('valid_until', null)
  if (error) throw error
  // retrieval-visible = not already excluded
  return (data ?? []).filter((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>
    return meta.rag_exclude !== 'true'
  })
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write')
  const client = makeClient()

  console.log(`# mag-noise-exclude ${write ? '(WRITE)' : '(dry-run)'}`)

  let total = 0
  let stamped = 0
  for (const url of NOISE_SOURCE_URLS) {
    const rows = await visibleRows(client, url)
    total += rows.length
    console.log(`\n${url.split('/').pop()}: ${rows.length} rows visiveis ao RAG`)
    if (!write || rows.length === 0) continue

    for (const row of rows) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>
      const { error } = await client
        .from('documents')
        .update({
          metadata: { ...meta, rag_exclude: 'true', rag_exclude_reason: EXCLUDE_REASON },
        })
        .eq('id', row.id)
        // guard: never touch a row that is not one of the five noise docs
        .eq('insurer_id', MAG_INSURER_ID)
        .eq('source_url', url)
      if (error) throw new Error(`update ${row.id} failed: ${error.message}`)
      stamped++
    }
  }

  if (!write) {
    console.log(`\nDRY-RUN: ${total} rows seriam marcadas rag_exclude='true'. Nada foi escrito.`)
    return
  }

  console.log(`\nstamped=${stamped}`)

  // verify: nothing from these URLs is retrieval-visible anymore
  let leftovers = 0
  for (const url of NOISE_SOURCE_URLS) leftovers += (await visibleRows(client, url)).length
  console.log(`probe pos-write: ${leftovers} rows de ruido ainda visiveis (tem que ser 0)`)
  if (leftovers !== 0) process.exit(1)

  // sanity: the three REAL general conditions remain visible
  const { count } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('insurer_id', MAG_INSURER_ID)
    .eq('source_type', 'conditions_pdf')
    .is('valid_until', null)
    .or('metadata->>rag_exclude.is.null,metadata->>rag_exclude.neq.true')
  console.log(`condicoes gerais da MAG que SEGUEM visiveis: ${count} rows (esperado ~117)`)
}

void main()
