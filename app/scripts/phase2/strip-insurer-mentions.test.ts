/**
 * stripInsurerMentions — unit + retrieval proof.
 *
 * O nome da seguradora no texto embedado e ruido (retrieval ja filtra por
 * insurer_id). No corpus shadow ele empurrava a clausula de exclusao de
 * suicidio da MetLife do rank #1 para o #23 (fora do topK=15 de producao).
 * Este teste trava:
 *   1. o helper remove o nome (word-boundary, sem comer "imagem");
 *   2. com o helper aplicado, a clausula volta ao top-15 do shadow (prova real).
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/strip-insurer-mentions.test.ts
 */
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { stripInsurerMentions } from '../../src/services/rag/answer'
import { embedChunks } from '../../src/services/embeddings/embedder'
import { formatEmbeddingVector } from '../../src/services/azure-di/shadow-embedder'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

let passed = 0
let failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ok  ${label}`) }
  else { failed++; console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const METLIFE = 'de69235a-3cb0-4229-a5d4-389b0b5e4697'

async function suicRankShadow(vec: string): Promise<number> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const resp: any = await (client.rpc as any).call(client, 'match_shadow_documents', {
    query_embedding: vec, match_threshold: 0.1, match_count: 30, filter_insurer_id: METLIFE,
  })
  const rows: any[] = resp.data ?? []
  const ids = rows.map((r) => String(r.id))
  const { data: docs } = await client.from('documents').select('id, content').in('id', ids)
  const byId = new Map<string, string>((docs ?? []).map((d: any) => [String(d.id), String(d.content ?? '')]))
  return rows.findIndex((r) => /suic/i.test(byId.get(String(r.id)) ?? '')) + 1
}

async function main(): Promise<void> {
  console.log('# stripInsurerMentions')

  console.log('\n## unit (puro)')
  ok('remove "MetLife"', !/metlife/i.test(stripInsurerMentions('A MetLife cobre suicidio?', ['MetLife'])))
  ok('remove "MAG Seguros" e "mag"', !/\bmag\b/i.test(stripInsurerMentions('carencia da MAG Seguros', ['MAG'])))
  ok('NAO come "imagem" (word-boundary)', stripInsurerMentions('a imagem do laudo', ['MAG']).includes('imagem'))
  ok('preserva o resto da pergunta', stripInsurerMentions('A MetLife cobre suicidio?', ['MetLife']).includes('suicidio'))
  ok('no-op sem seguradoras', stripInsurerMentions('cobre suicidio?', []) === 'cobre suicidio?')

  console.log('\n## prova de retrieval (shadow MetLife)')
  const Q = 'A MetLife cobre suicidio ocorrido nos dois primeiros anos de vigencia?'
  const [embRaw] = await embedChunks([Q])
  const rankRaw = await suicRankShadow(formatEmbeddingVector(embRaw))
  const [embStrip] = await embedChunks([stripInsurerMentions(Q, ['MetLife'])])
  const rankStrip = await suicRankShadow(formatEmbeddingVector(embStrip))
  console.log(`  rank com nome: #${rankRaw} | rank sem nome (fix): #${rankStrip}`)
  ok('sem o fix, a clausula fica FORA do top-15 (regressao existe)', rankRaw > 15 || rankRaw < 1)
  ok('com o fix, a clausula entra no top-15', rankStrip > 0 && rankStrip <= 15)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
