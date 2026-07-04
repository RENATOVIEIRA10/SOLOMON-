import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { normalizePhoneBR } from '@/lib/phone'
import { sendPilotWelcome } from '@/services/pilot/welcome'
import { createAsaasSubscription } from '@/services/billing/asaas'
import { PRICING, type BillingOption } from '@/config/pricing'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app-atalaia.vercel.app'

function normalizeCpfCnpj(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.length === 11 || digits.length === 14 ? digits : null
}

/**
 * POST /api/checkout — rota PÚBLICA (sem auth), consumida pela vitrine /planos (T14).
 * Fluxo: convite Supabase Auth -> broker (plan='free', pending_plan='corretor', cpf) ->
 * assinatura Asaas (pricing SSoT em @/config/pricing) -> persiste ids/billing_status ->
 * welcome best-effort -> { invoiceUrl }.
 *
 * pending_plan só vira plan de verdade no webhook Asaas (T13, decideWebhookTransition)
 * quando o 1o pagamento é confirmado — até lá o broker fica no free (sem custo se nunca pagar).
 *
 * Qualquer falha depois do convite tenta rollback total (broker + deleteUser): nunca deixar
 * usuário Auth órfão nem broker sem assinatura correspondente.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  // honeypot: campo oculto no form, só bot preenche. Finge sucesso e não faz nada.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phoneRaw = typeof body.phone === 'string' ? body.phone : ''
  const billingRaw = body.billing

  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Informe seu nome completo.' }, { status: 400 })
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido.' }, { status: 400 })
  }
  const phoneE164 = normalizePhoneBR(phoneRaw)
  if (!phoneE164) {
    return NextResponse.json({ error: 'Telefone inválido — use DDD + número.' }, { status: 400 })
  }
  const cpfCnpj = normalizeCpfCnpj(body.cpfCnpj)
  if (!cpfCnpj) {
    return NextResponse.json({ error: 'CPF/CNPJ inválido (use 11 ou 14 dígitos).' }, { status: 400 })
  }
  if (typeof billingRaw !== 'string' || !(billingRaw in PRICING)) {
    return NextResponse.json({ error: 'Plano de cobrança inválido — escolha mensal ou anual.' }, { status: 400 })
  }
  const billing = billingRaw as BillingOption
  const option = PRICING[billing]

  const supabase = createServiceClient()

  // Rate limit durável do checkout público (tabela checkout_attempts) — antes de qualquer
  // chamada externa (Auth/Asaas). Fail-open: se a tabela ainda não existir (migration
  // pendente de apply), loga e segue — o guard nunca pode derrubar o checkout.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  try {
    const insertAttempt = await supabase.from('checkout_attempts').insert({ ip, email })
    if (insertAttempt.error) throw insertAttempt.error

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const [ipWindow, emailWindow] = await Promise.all([
      supabase
        .from('checkout_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('ip', ip)
        .gte('created_at', since),
      supabase
        .from('checkout_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('email', email)
        .gte('created_at', since),
    ])
    if (ipWindow.error) throw ipWindow.error
    if (emailWindow.error) throw emailWindow.error

    if ((ipWindow.count ?? 0) > 5 || (emailWindow.count ?? 0) > 3) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' },
        { status: 429 }
      )
    }
  } catch (err) {
    console.error(
      '[checkout] rate-limit check falhou (tabela checkout_attempts ausente?) — seguindo fail-open:',
      err
    )
  }

  // Email já cadastrado -> 409 amigável (nunca reconvida nem duplica broker)
  const { data: existing } = await supabase.from('brokers').select('id').eq('email', email).maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'Este email já tem conta no SOLOMON — fale com a gente no WhatsApp.' },
      { status: 409 }
    )
  }

  // 1) Convite no Supabase Auth (email oficial de convite). Falhou -> nada persiste.
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/auth/callback?next=/definir-senha`,
  })
  if (inviteError || !invited.user) {
    return NextResponse.json({ error: `Convite falhou: ${inviteError?.message ?? 'sem usuario'}` }, { status: 502 })
  }

  // 2) Broker amarrado ao auth user — free + pending_plan até o 1o pagamento confirmar
  const { data: broker, error: brokerError } = await supabase
    .from('brokers')
    .insert({
      auth_user_id: invited.user.id,
      name,
      phone: phoneE164,
      email,
      cpf: cpfCnpj,
      plan: 'free',
      pending_plan: 'corretor',
    })
    .select('id')
    .single()
  if (brokerError || !broker) {
    // rollback do convite para não deixar auth órfão
    const { error: rollbackError } = await supabase.auth.admin.deleteUser(invited.user.id)
    if (rollbackError) {
      console.error('[checkout] ROLLBACK FALHOU', {
        step: 'deleteUser-apos-broker-insert-falhar',
        authUserId: invited.user.id,
        error: rollbackError,
      })
    }
    // corrida no checkout público: pre-check de email passou mas o insert colidiu com o
    // índice único uq_brokers_email (defesa em profundidade) -> mesmo 409 amigável
    if (brokerError?.code === '23505') {
      return NextResponse.json(
        { error: 'Este email já tem conta no SOLOMON — fale com a gente no WhatsApp.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: `Cadastro falhou: ${brokerError?.message}` }, { status: 500 })
  }

  // 3) Assinatura Asaas — falhou -> rollback total (broker + auth user), nunca deixar órfão
  let asaasResult: { customerId: string; subscriptionId: string; invoiceUrl: string | null }
  try {
    asaasResult = await createAsaasSubscription(
      { id: broker.id, name, email, phone: phoneE164, asaas_customer_id: null },
      option.valueBRL,
      cpfCnpj,
      {
        description: option.description,
        maxPayments: 'maxPayments' in option ? option.maxPayments : undefined,
      }
    )
  } catch (err) {
    const { error: brokerDeleteError } = await supabase.from('brokers').delete().eq('id', broker.id)
    if (brokerDeleteError) {
      console.error('[checkout] ROLLBACK FALHOU', {
        step: 'brokers.delete-apos-asaas-falhar',
        brokerId: broker.id,
        authUserId: invited.user.id,
        error: brokerDeleteError,
      })
    }
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(invited.user.id)
    if (authDeleteError) {
      console.error('[checkout] ROLLBACK FALHOU', {
        step: 'deleteUser-apos-asaas-falhar',
        brokerId: broker.id,
        authUserId: invited.user.id,
        error: authDeleteError,
      })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha ao gerar assinatura no Asaas' },
      { status: 502 }
    )
  }

  // 4) Persiste ids + billing_status pending. Falha aqui é grave: assinatura JÁ existe no
  // Asaas — não dá pra rollback limpo (cobrança real criada), então loga alto e pede
  // intervenção manual em vez de deixar o corretor tentar de novo e duplicar cobrança.
  const { error: updateError } = await supabase
    .from('brokers')
    .update({
      asaas_customer_id: asaasResult.customerId,
      asaas_subscription_id: asaasResult.subscriptionId,
      billing_status: 'pending',
      billing_updated_at: new Date().toISOString(),
    })
    .eq('id', broker.id)
  if (updateError) {
    console.error(
      `[checkout] assinatura criada no Asaas (customer ${asaasResult.customerId}, subscription ${asaasResult.subscriptionId}) mas UPDATE no broker ${broker.id} falhou:`,
      updateError.message
    )
    return NextResponse.json(
      {
        error:
          'Assinatura criada mas o cadastro falhou ao salvar — NÃO tente de novo, fale com a gente no WhatsApp.',
      },
      { status: 500 }
    )
  }

  // 5) Welcome no WhatsApp — best-effort, nunca bloqueia o checkout (corretor já tem o invoice)
  try {
    const result = await sendPilotWelcome(phoneE164, name)
    if (result === 'sent') {
      await supabase.from('brokers_welcome').upsert({ broker_id: broker.id })
    }
    // 'awaiting_first_contact' é estado esperado (janela 24h) — sem ação aqui, reenvio fica no admin
  } catch {
    // falha de envio não pode derrubar o checkout
  }

  return NextResponse.json({ invoiceUrl: asaasResult.invoiceUrl })
}
