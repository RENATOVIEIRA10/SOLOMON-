import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendMessage } from '@/services/whatsapp/providers'
import { decideWebhookTransition } from '@/services/billing/webhook-transition'

/**
 * Webhook Asaas. Segurança: header asaas-access-token deve bater com
 * ASAAS_WEBHOOK_TOKEN (configurado ao criar o webhook no painel Asaas).
 * Idempotência: insert em billing_events com o event id como PK; conflito real (23505) = já processado.
 * Qualquer outro erro de insert é 500 (Asaas re-tenta) — nunca dropar evento silenciosamente.
 * SEMPRE responde 200 rápido em evento desconhecido/não-casado.
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
  let brokerPhone: string | null = null
  let brokerOverdueSince: string | null = null
  if (subscriptionId) {
    const { data } = await supabase.from('brokers').select('id, phone, overdue_since').eq('asaas_subscription_id', subscriptionId).maybeSingle()
    if (data) {
      brokerId = data.id
      brokerPhone = data.phone
      brokerOverdueSince = data.overdue_since
    }
  }
  if (!brokerId && externalRef) {
    const { data } = await supabase.from('brokers').select('id, phone, overdue_since').eq('id', externalRef).maybeSingle()
    if (data) {
      brokerId = data.id
      brokerPhone = data.phone
      brokerOverdueSince = data.overdue_since
    }
  }

  // idempotência: PK = event id. Só 23505 (conflito real de PK) é duplicata; qualquer outro
  // erro precisa disparar retry do Asaas (500), senão o evento some pra sempre.
  const { error: insertError } = await supabase
    .from('billing_events')
    .insert({ id: event.id, broker_id: brokerId, event_type: event.event, payload: event })
  if (insertError) {
    if (insertError.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
    console.error('[webhook/asaas] insert em billing_events falhou (nao-duplicata):', insertError)
    return NextResponse.json({ error: 'event persist failed' }, { status: 500 })
  }
  if (!brokerId) return NextResponse.json({ ok: true, unmatched: true })

  const now = new Date().toISOString()
  const { update, notify } = decideWebhookTransition({
    eventType: event.event,
    currentOverdueSince: brokerOverdueSince,
    nowISO: now,
  })

  if (update) {
    await supabase.from('brokers').update(update).eq('id', brokerId)
  }

  if (notify && brokerPhone) {
    const provider = process.env.WHATSAPP_PROVIDER ?? 'evolution'
    await sendMessage(provider, {
      to: brokerPhone,
      body: '*SOLOMON* — identificamos um atraso na sua assinatura. Você tem 5 dias para regularizar antes do plano voltar ao gratuito. Qualquer dúvida, é só responder aqui.',
    }).catch(() => {}) // aviso não pode derrubar o webhook
  }

  return NextResponse.json({ ok: true })
}
