import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendMessage } from '@/services/whatsapp/providers'

/**
 * Webhook Asaas. Segurança: header asaas-access-token deve bater com
 * ASAAS_WEBHOOK_TOKEN (configurado ao criar o webhook no painel Asaas).
 * Idempotência: insert em billing_events com o event id como PK; conflito = já processado.
 * SEMPRE responde 200 rápido em evento desconhecido (Asaas re-tenta em erro).
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get('asaas-access-token')
  if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const event = await request.json().catch(() => null)
  if (!event?.id || !event?.event) return NextResponse.json({ ok: true })

  const supabase = createServiceClient()
  const subscriptionId: string | undefined = event.payment?.subscription
  const externalRef: string | undefined = event.payment?.externalReference

  // resolve broker por subscription (preferido) ou externalReference
  let brokerId: string | null = null
  if (subscriptionId) {
    const { data } = await supabase.from('brokers').select('id, phone, plan').eq('asaas_subscription_id', subscriptionId).maybeSingle()
    if (data) brokerId = data.id
  }
  if (!brokerId && externalRef) {
    const { data } = await supabase.from('brokers').select('id').eq('id', externalRef).maybeSingle()
    if (data) brokerId = data.id
  }

  // idempotência: PK = event id
  const { error: insertError } = await supabase
    .from('billing_events')
    .insert({ id: event.id, broker_id: brokerId, event_type: event.event, payload: event })
  if (insertError) return NextResponse.json({ ok: true, duplicate: true })
  if (!brokerId) return NextResponse.json({ ok: true, unmatched: true })

  const now = new Date().toISOString()
  if (event.event === 'PAYMENT_CONFIRMED' || event.event === 'PAYMENT_RECEIVED') {
    await supabase.from('brokers')
      .update({ billing_status: 'active', overdue_since: null, billing_updated_at: now })
      .eq('id', brokerId)
  } else if (event.event === 'PAYMENT_OVERDUE') {
    await supabase.from('brokers')
      .update({ billing_status: 'overdue', overdue_since: now, billing_updated_at: now })
      .eq('id', brokerId)
    // aviso imediato (a carência de 5 dias corre a partir daqui)
    const { data: broker } = await supabase.from('brokers').select('phone').eq('id', brokerId).maybeSingle()
    if (broker?.phone) {
      const provider = process.env.WHATSAPP_PROVIDER ?? 'evolution'
      await sendMessage(provider, {
        to: broker.phone,
        body: '*SOLOMON* — identificamos um atraso na sua assinatura. Você tem 5 dias para regularizar antes do plano voltar ao gratuito. Qualquer dúvida, é só responder aqui.',
      }).catch(() => {}) // aviso não pode derrubar o webhook
    }
  }
  return NextResponse.json({ ok: true })
}
