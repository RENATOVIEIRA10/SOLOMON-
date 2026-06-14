/**
 * POST /api/admin/evals/trigger
 *
 * Enfileira um job de eval Ragas na tabela eval_jobs do agentes-hub.
 * O poller VPS (poll_eval_jobs.py) é quem executa de fato — este endpoint
 * NUNCA executa shell. Gate: requireAdmin (SOLOMON_ADMIN_EMAILS, opt-in).
 *
 * Segurança:
 *   - gate requireAdmin (403 para não-admin)
 *   - limit validado como int 1..50
 *   - judge validado contra whitelist {openai,gemini,anthropic}
 *   - anti-dupla-fila: 409 se já existe job requested/running
 *   - params NUNCA interpolados em shell/SQL cru (usados como json coluna)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createHubClient } from '@/lib/supabase-hub'

export const revalidate = 0

const JUDGE_WHITELIST = new Set(['openai', 'gemini', 'anthropic'])

export async function POST(request: NextRequest) {
  // 1. Gate admin
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  // 2. Parse + validar body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  // limit: inteiro 1..50, default 49
  const rawLimit = body.limit ?? 49
  const limit = Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json(
      { error: 'limit deve ser inteiro entre 1 e 50' },
      { status: 400 }
    )
  }

  // judge: whitelist {openai,gemini,anthropic}, default 'openai'
  const judge = (body.judge ?? 'openai') as string
  if (!JUDGE_WHITELIST.has(judge)) {
    return NextResponse.json(
      { error: `judge inválido: deve ser um de ${[...JUDGE_WHITELIST].join(', ')}` },
      { status: 400 }
    )
  }

  // multiJudge: boolean, default false
  const multiJudge = body.multiJudge === true

  const supabase = createHubClient()

  // 3. Anti-dupla-fila: rejeitar se já existe job ativo
  const { count, error: countErr } = await supabase
    .from('eval_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('project', 'solomon')
    .in('status', ['requested', 'running'])

  if (countErr) {
    console.error('[api/admin/evals/trigger] check ativo falhou:', countErr.message)
    return NextResponse.json({ error: 'erro ao verificar fila' }, { status: 500 })
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'já existe job ativo (requested ou running) — aguarde terminar antes de disparar outro' },
      { status: 409 }
    )
  }

  // 4. Inserir job
  // requested_by nunca pode virar '' — perde a atribuição de quem disparou um
  // processo que gera custo. requireAdmin garante email não-nulo, mas usamos
  // auth.id como fallback identificável caso de borda (auditoria > string vazia).
  const requestedBy = auth.email || auth.id
  const { data, error: insertErr } = await supabase
    .from('eval_jobs')
    .insert({
      project: 'solomon',
      status: 'requested',
      params: { limit, judge, multiJudge },
      requested_by: requestedBy,
    })
    .select('id, status')
    .single()

  if (insertErr) {
    console.error('[api/admin/evals/trigger] insert falhou:', insertErr.message)
    return NextResponse.json({ error: 'erro ao enfileirar job' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
