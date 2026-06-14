/**
 * GET /api/admin/evals/jobs
 *
 * Retorna os últimos 10 jobs de eval Ragas (project=solomon) ordenados
 * por created_at desc. Gate: requireAdmin.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createHubClient } from '@/lib/supabase-hub'

export const revalidate = 0

export async function GET() {
  // Gate admin
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const supabase = createHubClient()

  const { data, error } = await supabase
    .from('eval_jobs')
    .select('id, status, params, requested_by, run_id, error, created_at, updated_at')
    .eq('project', 'solomon')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('[api/admin/evals/jobs] query falhou:', error.message)
    return NextResponse.json({ error: 'erro ao buscar jobs' }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
