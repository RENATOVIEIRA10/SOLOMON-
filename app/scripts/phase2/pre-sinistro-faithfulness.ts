/**
 * Harness de faithfulness do pre-sinistro — direto (sem HTTP/auth/deploy).
 *
 * Chama analyzePreSinistro (Gemini real do pre-sinistro) para Q46-Q50, pega
 * rationale + chunks, e julga faithfulness com um juiz Gemini (temp 0, estilo
 * Ragas: extrai claims atomicos do rationale e marca cada um como suportado
 * SOMENTE pelos chunks). Roda legacy vs shadow togglando SHADOW_CORPUS_ALLOWLIST.
 *
 * faithfulness = claims_suportados / claims_totais (calculado aqui, nao pelo LLM).
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/pre-sinistro-faithfulness.ts
 */
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { analyzePreSinistro } from '../../src/services/rag/pre-sinistro'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

// Forca o OpenRouter (a diretriz): callGeminiJson tenta o Gemini DIRETO primeiro
// quando GEMINI_API_KEY existe, e o direto liga o thinking e trunca o JSON
// (MAX_TOKENS) sem lancar -> o fallback pro OpenRouter nunca dispara. Removendo
// a chave direta, tanto o pre-sinistro quanto o juiz passam pelo OpenRouter.
delete process.env.GEMINI_API_KEY
console.log('provider forcado: OpenRouter (GEMINI_API_KEY removida do processo)')

interface Q { id: string; insurerName: string; claimType: string; description: string; commercial: boolean }

const QUESTIONS: Q[] = [
  { id: 'Q46', insurerName: 'Prudential do Brasil', claimType: 'Doencas Graves', commercial: true,
    description: 'Cliente 52 anos diagnosticada com cancer de mama ha 4 meses. Apolice Doencas Graves Plus vigente ha 5 anos, pagamentos em dia. Quero saber se ha cobertura para acionar sinistro.' },
  { id: 'Q47', insurerName: 'Prudential do Brasil', claimType: 'Morte por suicidio', commercial: true,
    description: 'Segurado cometeu suicidio apos 18 meses de contrato no produto Vida Inteira da Prudential. Beneficiarios querem saber se ha cobertura do capital segurado.' },
  { id: 'Q48', insurerName: 'Prudential do Brasil', claimType: 'Morte natural por infarto', commercial: true,
    description: 'Segurado faleceu de infarto agudo do miocardio. Produto: Seguro Temporario Prudential, vigente ha 3 anos com pagamentos em dia. Beneficiario quer saber se ha cobertura para o capital segurado.' },
  { id: 'Q49', insurerName: 'Zurich', claimType: 'Morte com omissao em DPS', commercial: false,
    description: 'Segurado contratou Zurich Vida ha 1 ano e veio a falecer. A familia descobriu que ele tinha diabetes ha 3 anos, fato nao declarado na DPS. Quero saber se ha cobertura e qual o risco de recusa por ma-fe (art. 766 CC).' },
  { id: 'Q50', insurerName: 'Zurich', claimType: 'Acidente Pessoal em trajeto/trabalho', commercial: false,
    description: 'Empregado foi atropelado em horario de trabalho, dirigindo veiculo da empresa. A empresa possui Zurich Vida Empresa com cobertura AP (Acidentes Pessoais). Quero saber se a cobertura AP aplica ao caso.' },
]

const CONFIGS = [
  { name: 'legacy', allowlist: '' },
  { name: 'shadow', allowlist: 'MAG,Azos,MetLife,Prudential' },
] as const

// Juiz via OpenRouter (mesmo caminho que o pre-sinistro agora usa).
async function orJson(prompt: string): Promise<any> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY ausente')
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  })
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j: any = await r.json()
  const text = j?.choices?.[0]?.message?.content ?? '{}'
  return JSON.parse(text)
}

async function judgeFaithfulness(rationale: string, chunks: Array<{ content: string }>): Promise<{ f: number; n: number }> {
  if (!rationale?.trim() || chunks.length === 0) return { f: 0, n: 0 }
  const ctx = chunks.map((c, i) => `[chunk_${i + 1}] ${c.content}`).join('\n\n')
  const prompt = `Voce e um juiz rigoroso de FAITHFULNESS (grounding) para um analisador de sinistros de seguro.

Dado o RACIONAL de uma analise e os CHUNKS de condicoes gerais recuperados, faca:
1. Extraia cada AFIRMACAO FACTUAL atomica do racional (cobertura, exclusao, carencia, prazo, definicao, citacao de artigo/clausula, valor).
2. Para cada, marque supported=true SOMENTE se a afirmacao pode ser inferida DIRETAMENTE dos chunks. Se depende de conhecimento externo, generico, ou nao aparece nos chunks -> supported=false.
Nao invente. Nao de o beneficio da duvida.

Retorne JSON: {"claims":[{"claim":"...","supported":true|false}]}

RACIONAL:
${rationale}

CHUNKS:
${ctx}`
  try {
    const res = await orJson(prompt)
    const claims: Array<{ supported: boolean }> = Array.isArray(res?.claims) ? res.claims : []
    if (claims.length === 0) return { f: 0, n: 0 }
    const sup = claims.filter((c) => c.supported === true).length
    return { f: sup / claims.length, n: claims.length }
  } catch (e) {
    console.error('  judge erro:', (e as Error).message)
    return { f: -1, n: 0 }
  }
}

async function main(): Promise<void> {
  const rows: Array<{ config: string; id: string; commercial: boolean; verdict: string; f: number; n: number; chunks: number }> = []
  for (const cfg of CONFIGS) {
    process.env.SHADOW_CORPUS_ALLOWLIST = cfg.allowlist
    console.log(`\n### config=${cfg.name} (SHADOW_CORPUS_ALLOWLIST="${cfg.allowlist}")`)
    for (const q of QUESTIONS) {
      try {
        const r = await analyzePreSinistro({ insurerName: q.insurerName, claimType: q.claimType, description: q.description })
        const j = await judgeFaithfulness(r.rationale, r.chunks)
        rows.push({ config: cfg.name, id: q.id, commercial: q.commercial, verdict: r.verdict, f: j.f, n: j.n, chunks: r.chunks.length })
        console.log(`  ${q.id} ${q.commercial ? '[comercial]' : '[fora]     '} verdict=${r.verdict.padEnd(11)} chunks=${String(r.chunks.length).padStart(2)} claims=${String(j.n).padStart(2)} faithfulness=${j.f.toFixed(3)}`)
      } catch (e) {
        console.error(`  ${q.id} FALHOU: ${(e as Error).message}`)
        rows.push({ config: cfg.name, id: q.id, commercial: q.commercial, verdict: 'ERRO', f: -1, n: 0, chunks: 0 })
      }
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  console.log('\n=== RESUMO faithfulness (media) ===')
  for (const cfg of CONFIGS) {
    const all = rows.filter((r) => r.config === cfg.name && r.f >= 0).map((r) => r.f)
    const com = rows.filter((r) => r.config === cfg.name && r.commercial && r.f >= 0).map((r) => r.f)
    console.log(`  ${cfg.name.padEnd(7)} todas=${avg(all).toFixed(3)} (n=${all.length})  |  so comercial(Prudential)=${avg(com).toFixed(3)} (n=${com.length})`)
  }
  console.log('\ngate: pre-sinistro so libera com faithfulness >= 0.80')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
