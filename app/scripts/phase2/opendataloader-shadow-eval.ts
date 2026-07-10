/**
 * OpenDataLoader shadow eval — legacy vs shadow retrieval, table-focused.
 *
 * The point of the whole pipeline is tables: the legacy extractor collapsed
 * them ("Até 6 meses5%", "16 anos-44 anos1,0988…"), so questions whose answer
 * lives INSIDE a table are the decisive measurement. Text questions are
 * included as controls (legacy already handles prose fine — we expect parity).
 *
 * For each question:
 *   embed (text-embedding-3-small)
 *     -> match_documents        (production corpus, filter by insurer)
 *     -> match_shadow_documents (shadow corpus,     filter by insurer)
 *   score = expectedTokens found in the union of top-k contents (CR proxy,
 *   same convention as azure-di-shadow-eval).
 *
 * Prudential note: its shadow corpus holds BOTH azure-di-layout-v3 and
 * opendataloader-v1 rows; shadow hits are annotated by parser.
 *
 * Standalone tsx, read-only (SELECT + RPC). No writes.
 *
 * Run from app/:
 *   npm run phase2:odl:shadow-eval
 */

import path from 'node:path'

import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { embedChunks } from '../../src/services/embeddings/embedder'
import { formatEmbeddingVector } from '../../src/services/azure-di/shadow-embedder'
import type { Database } from '../../src/types/database'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

interface EvalQuestion {
  id: string
  insurer: string
  insurerId: string
  kind: 'table' | 'text'
  question: string
  /** All must appear in the union of retrieved chunk contents. */
  expectedTokens: string[]
}

const MAG = '2f9b2aa3-51ac-45ae-a3d2-f99d8720f273'
const METLIFE = 'de69235a-3cb0-4229-a5d4-389b0b5e4697'
const AZOS = 'dfb52b5b-93e0-46a5-8f82-ca29490b6c88'
const PRUD = 'dac17baa-c623-4023-9184-3ed2049a6237'

const QUESTIONS: EvalQuestion[] = [
  // --- MAG: the two tables the legacy corpus destroyed ---
  {
    id: 'mag-carencia-20m',
    insurer: 'MAG',
    insurerId: MAG,
    kind: 'table',
    question:
      'Na carencia do vida inteira da MAG, qual percentual do capital segurado e pago se o evento ocorre entre 19 e 24 meses de vigencia do plano?',
    expectedTokens: ['19', '24 meses', '20%'],
  },
  {
    id: 'mag-reajuste-44',
    insurer: 'MAG',
    insurerId: MAG,
    kind: 'table',
    question: 'Qual o percentual de reajuste por idade aos 44 anos no seguro vida inteira da MAG?',
    expectedTokens: ['44 anos', '8,61'],
  },
  {
    id: 'mag-dps-texto',
    insurer: 'MAG',
    insurerId: MAG,
    kind: 'text',
    question: 'Na MAG, se o cliente preenche a declaracao pessoal de saude a carencia de 24 meses cai para zero?',
    expectedTokens: ['declaração pessoal de saúde', 'carência', '24'],
  },
  // --- MetLife: invalidez table (% sobre capital) ---
  {
    id: 'metlife-mao-60',
    insurer: 'MetLife',
    insurerId: METLIFE,
    kind: 'table',
    question:
      'Na tabela de invalidez permanente da MetLife, qual o percentual sobre o capital pago pela perda total do uso de uma das maos?',
    expectedTokens: ['mãos', '60'],
  },
  {
    id: 'metlife-suicidio-texto',
    insurer: 'MetLife',
    insurerId: METLIFE,
    kind: 'text',
    question: 'A MetLife cobre suicidio ocorrido nos dois primeiros anos de vigencia?',
    expectedTokens: ['suicídio', 'dois primeiros anos'],
  },
  // --- Azos ---
  {
    id: 'azos-carencia-doenca',
    insurer: 'Azos',
    insurerId: AZOS,
    kind: 'text',
    question: 'Qual a carencia para eventos decorrentes de doenca no seguro da Azos?',
    expectedTokens: ['60', 'carência', 'doença'],
  },
  {
    id: 'azos-reajuste-tabela',
    insurer: 'Azos',
    insurerId: AZOS,
    kind: 'table',
    question: 'Como funciona o reenquadramento do premio por mudanca de idade na Azos, conforme a tabela de reajuste?',
    expectedTokens: ['reenquadramento', 'idade'],
  },
  // --- Prudential (shadow mixes azure-di + opendataloader) ---
  {
    id: 'prud-carencia-texto',
    insurer: 'Prudential',
    insurerId: PRUD,
    kind: 'text',
    question: 'Na Prudential, o que acontece se a pessoa segurada falecer durante o periodo de carencia do vida inteira?',
    expectedTokens: ['carência', 'reserva matemática'],
  },
]

const TOP_K = 8

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

interface Hit {
  id: string
  content: string
  parser: string
  has_table: boolean
  similarity?: number
}

async function callMatch(
  client: SupabaseClient<Database>,
  fn: 'match_documents' | 'match_shadow_documents',
  queryEmbedding: string,
  insurerId: string,
): Promise<Hit[] | { error: string }> {
  type Resp = { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
  let resp: Resp
  try {
    resp = (await (
      client.rpc as unknown as (
        this: SupabaseClient<Database>,
        f: string,
        a: Record<string, unknown>,
      ) => Promise<Resp>
    ).call(client, fn, {
      query_embedding: queryEmbedding,
      match_threshold: 0.1,
      match_count: TOP_K,
      filter_insurer_id: insurerId,
    })) as Resp
  } catch (err) {
    return { error: (err as Error).message }
  }
  if (resp.error) return { error: resp.error.message }

  const rows = resp.data ?? []
  const ids = rows.map((r) => String(r.id))
  if (ids.length === 0) return []
  // fetch content+metadata for scoring (the RPCs may not return full content)
  const { data, error } = await client
    .from('documents')
    .select('id, content, metadata')
    .in('id', ids)
  if (error) return { error: error.message }
  const byId = new Map((data ?? []).map((d) => [d.id, d]))
  return ids
    .map((id) => {
      const d = byId.get(id)
      if (!d) return null
      const meta = (d.metadata ?? {}) as Record<string, unknown>
      return {
        id,
        content: String(d.content ?? ''),
        parser: String(meta.parser ?? '(null)'),
        has_table: meta.has_table === true,
      }
    })
    .filter((h): h is Hit => h !== null)
}

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function score(hits: Hit[], tokens: string[]): { found: number; total: number; hitAll: boolean } {
  const union = fold(hits.map((h) => h.content).join('\n'))
  const found = tokens.filter((t) => union.includes(fold(t))).length
  return { found, total: tokens.length, hitAll: found === tokens.length }
}

async function main(): Promise<void> {
  const client = makeClient()
  console.log(`# opendataloader shadow eval — legacy vs shadow, top_k=${TOP_K}, threshold=0.1`)

  const embeddings = await embedChunks(QUESTIONS.map((q) => q.question))

  const rows: string[] = []
  let tableLegacy = 0, tableShadow = 0, tableN = 0
  let textLegacy = 0, textShadow = 0, textN = 0

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i]
    const vec = formatEmbeddingVector(embeddings[i])

    const legacy = await callMatch(client, 'match_documents', vec, q.insurerId)
    const shadow = await callMatch(client, 'match_shadow_documents', vec, q.insurerId)

    const legacyScore = Array.isArray(legacy) ? score(legacy, q.expectedTokens) : null
    const shadowScore = Array.isArray(shadow) ? score(shadow, q.expectedTokens) : null
    const shadowParsers = Array.isArray(shadow)
      ? [...new Set(shadow.map((h) => h.parser))].join(',')
      : '-'
    const shadowTables = Array.isArray(shadow) ? shadow.filter((h) => h.has_table).length : 0

    if (q.kind === 'table') { tableN++; if (legacyScore?.hitAll) tableLegacy++; if (shadowScore?.hitAll) tableShadow++ }
    else { textN++; if (legacyScore?.hitAll) textLegacy++; if (shadowScore?.hitAll) textShadow++ }

    const fmt = (s: { found: number; total: number; hitAll: boolean } | null, raw: Hit[] | { error: string }) =>
      s ? `${s.found}/${s.total}${s.hitAll ? ' HIT' : ''}` : `ERRO(${(raw as { error: string }).error.slice(0, 40)})`

    console.log(
      `\n[${q.kind.toUpperCase().padEnd(5)}] ${q.id} (${q.insurer})` +
        `\n  legacy: ${fmt(legacyScore, legacy)}   shadow: ${fmt(shadowScore, shadow)}` +
        `   (shadow parsers: ${shadowParsers}; table chunks no top-k: ${shadowTables})`,
    )
    rows.push(
      `| ${q.id} | ${q.kind} | ${legacyScore ? `${legacyScore.found}/${legacyScore.total}` : 'erro'} | ${shadowScore ? `${shadowScore.found}/${shadowScore.total}` : 'erro'} |`,
    )
  }

  console.log('\n== RESUMO (perguntas com TODOS os tokens recuperados) ==')
  console.log(`  TABELA: legacy ${tableLegacy}/${tableN}  vs  shadow ${tableShadow}/${tableN}`)
  console.log(`  TEXTO : legacy ${textLegacy}/${textN}  vs  shadow ${textShadow}/${textN}`)
  console.log('\n| pergunta | tipo | legacy | shadow |')
  console.log('|---|---|---|---|')
  rows.forEach((r) => console.log(r))
}

void main()
