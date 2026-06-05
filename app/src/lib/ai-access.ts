import { NextRequest, NextResponse } from 'next/server'

import { PLANS, type BrokerPlan } from '@/config/constants'
import { createServiceClient } from '@/lib/supabase'
import { getOptionalBrokerContext, requireBrokerContext, type BrokerContext } from '@/lib/auth'

export interface AiAccessContext extends BrokerContext {
  plan: BrokerPlan
  planName: string
  queriesToday: number
  queriesPerDay: number
}

type AiAccessResult = AiAccessContext | NextResponse

interface AiAccessOptions {
  allowEvalBypass?: boolean
  evalMode?: boolean
}

interface BrokerUsageRow {
  active: boolean
  plan: string
  queries_today: number
  queries_reset_at: string | null
}

export function isAiAccessResponse(value: AiAccessResult | null): value is NextResponse {
  return value instanceof NextResponse
}

export function validateEvalBypass(request: NextRequest): boolean {
  const expected = process.env.SOLOMON_EVAL_TOKEN?.trim()
  const supplied =
    request.headers.get('x-solomon-eval-token')?.trim() ??
    request.headers.get('x-eval-token')?.trim()

  if (expected) return supplied === expected

  // Local/dev eval harnesses historically call /api/ask without a browser
  // session. Production should set SOLOMON_EVAL_TOKEN before enabling evalMode.
  return process.env.NODE_ENV !== 'production'
}

export async function requireAiAccess(
  request: NextRequest,
  options: AiAccessOptions = {}
): Promise<AiAccessResult | null> {
  if (options.allowEvalBypass && options.evalMode && validateEvalBypass(request)) {
    return null
  }

  const context = await requireBrokerContext()
  if (context instanceof NextResponse) return context
  return loadUsageContext(context)
}

export async function getOptionalAiAccess(
  request: NextRequest,
  options: AiAccessOptions = {}
): Promise<AiAccessResult | null> {
  if (options.allowEvalBypass && options.evalMode && validateEvalBypass(request)) {
    return null
  }

  const context = await getOptionalBrokerContext()
  if (!context) return null
  return loadUsageContext(context)
}

async function loadUsageContext(context: BrokerContext): Promise<AiAccessResult> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brokers')
    .select('active, plan, queries_today, queries_reset_at')
    .eq('id', context.brokerId)
    .maybeSingle()

  if (error) {
    console.error('[ai-access] failed to load broker usage:', error.message)
    return NextResponse.json({ error: 'failed to load broker usage' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'broker not found - call /api/profile first' }, { status: 404 })
  }

  const row = data as BrokerUsageRow
  if (!row.active) {
    return NextResponse.json({ error: 'broker inactive' }, { status: 403 })
  }

  const queriesToday = await resetDailyCounterIfNeeded(context.brokerId, row)
  const plan = normalizePlan(row.plan)
  const limits = PLANS[plan]

  return {
    ...context,
    plan,
    planName: limits.name,
    queriesToday,
    queriesPerDay: limits.queriesPerDay,
  }
}

export function enforceAiQuota(context: AiAccessContext): NextResponse | null {
  if (context.queriesPerDay === -1) return null
  if (context.queriesToday < context.queriesPerDay) return null

  return NextResponse.json(
    {
      error: `Limite diario atingido para o plano ${context.planName}.`,
      plan: context.plan,
      limit: context.queriesPerDay,
      queriesToday: context.queriesToday,
    },
    {
      status: 429,
      headers: aiQuotaHeaders(context),
    }
  )
}

export async function incrementAiQuota(context: AiAccessContext | null): Promise<void> {
  if (!context) return

  const supabase = createServiceClient()
  const { error } = await supabase.rpc('increment_broker_queries', {
    p_broker_id: context.brokerId,
  })

  if (error) {
    console.error('[ai-access] increment_broker_queries failed:', error.message)
  }
}

export function aiQuotaHeaders(context: AiAccessContext): Record<string, string> {
  const remaining =
    context.queriesPerDay === -1
      ? 'unlimited'
      : String(Math.max(0, context.queriesPerDay - context.queriesToday))

  return {
    'X-Solomon-Plan': context.plan,
    'X-Solomon-Quota-Limit': context.queriesPerDay === -1 ? 'unlimited' : String(context.queriesPerDay),
    'X-Solomon-Quota-Remaining': remaining,
  }
}

async function resetDailyCounterIfNeeded(brokerId: string, row: BrokerUsageRow): Promise<number> {
  const resetAt = row.queries_reset_at ? new Date(row.queries_reset_at) : null
  const now = new Date()
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (resetAt && resetAt >= todayMidnight) {
    return row.queries_today
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('brokers')
    .update({
      queries_today: 0,
      queries_reset_at: now.toISOString(),
    })
    .eq('id', brokerId)

  if (error) {
    console.error('[ai-access] failed to reset broker query counter:', error.message)
  }

  return 0
}

function normalizePlan(plan: string): BrokerPlan {
  if (plan === 'corretor' || plan === 'consultor' || plan === 'corretora') {
    return plan
  }
  return 'free'
}
