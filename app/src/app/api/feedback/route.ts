/**
 * POST /api/feedback
 *
 * Registra feedback do corretor sobre uma resposta do SOLOMON.
 * Usado pelo dashboard (e potencialmente por integrações externas).
 * No WhatsApp o feedback entra direto via comando `/feedback` no handler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireBrokerContext } from '@/lib/auth'

const VALID_ISSUES = ['hallucination', 'wrong_insurer', 'outdated', 'incomplete', 'other'] as const
const VALID_CHANNELS = ['whatsapp', 'dashboard', 'api'] as const

interface FeedbackPayload {
  conversation_id: string
  rating: number
  flagged_issue?: string | null
  comment?: string | null
  channel?: string
}

export async function POST(request: NextRequest) {
  const broker = await requireBrokerContext()
  if (broker instanceof NextResponse) return broker
  const broker_id = broker.brokerId // session-derived; client-sent broker_id is ignored

  let body: FeedbackPayload
  try {
    body = (await request.json()) as FeedbackPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { conversation_id, rating, flagged_issue, comment, channel } = body

  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
  }
  if (typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return NextResponse.json({ error: 'rating must be integer 1-5' }, { status: 400 })
  }
  if (flagged_issue && !VALID_ISSUES.includes(flagged_issue as (typeof VALID_ISSUES)[number])) {
    return NextResponse.json(
      { error: `flagged_issue must be one of: ${VALID_ISSUES.join(', ')}` },
      { status: 400 }
    )
  }
  const resolvedChannel = channel ?? 'dashboard'
  if (!VALID_CHANNELS.includes(resolvedChannel as (typeof VALID_CHANNELS)[number])) {
    return NextResponse.json(
      { error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversation_id)
    .eq('broker_id', broker_id)
    .maybeSingle()

  if (conversationError) {
    console.error('[api/feedback] conversation ownership check failed:', conversationError.message)
    return NextResponse.json({ error: 'Failed to validate conversation' }, { status: 500 })
  }

  if (!conversation) {
    return NextResponse.json({ error: 'conversation not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('conversation_feedback')
    .insert({
      conversation_id,
      broker_id,
      rating,
      flagged_issue: flagged_issue ?? null,
      comment: comment ?? null,
      channel: resolvedChannel,
    } as never)
    .select('id')
    .single()

  if (error) {
    console.error('[api/feedback] insert failed:', error.message)
    return NextResponse.json({ error: 'Failed to record feedback' }, { status: 500 })
  }

  return NextResponse.json({ id: (data as { id: string }).id, status: 'recorded' })
}
