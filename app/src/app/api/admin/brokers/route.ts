import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { normalizePhoneBR } from '@/lib/phone'
import { sendPilotWelcome } from '@/services/pilot/welcome'

const VALID_PLANS = ['free', 'corretor', 'consultor', 'corretora']
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app-atalaia.vercel.app'

export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brokers')
    .select('id, name, phone, email, plan, active, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Falha ao listar corretores' }, { status: 500 })

  // welcome_sent: registrado em brokers_welcome (criada nesta task) — join manual barato
  const { data: welcomes } = await supabase.from('brokers_welcome').select('broker_id')
  const sent = new Set((welcomes ?? []).map((w: { broker_id: string }) => w.broker_id))
  return NextResponse.json({
    brokers: (data ?? []).map((b) => ({ ...b, billing_status: null, welcome_sent: sent.has(b.id) })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })

  const supabase = createServiceClient()

  // Reenvio de welcome
  if (body.resendWelcome && typeof body.brokerId === 'string') {
    const { data: broker } = await supabase
      .from('brokers').select('id, name, phone').eq('id', body.brokerId).maybeSingle()
    if (!broker) return NextResponse.json({ error: 'Corretor nao encontrado' }, { status: 404 })
    try {
      await sendPilotWelcome(broker.phone, broker.name)
      await supabase.from('brokers_welcome').upsert({ broker_id: broker.id })
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ error: 'Falha ao enviar WhatsApp' }, { status: 502 })
    }
  }

  // Provisionamento
  const { name, phone, email, plan } = body as Record<string, string>
  if (!name?.trim() || !email?.trim()) return NextResponse.json({ error: 'Nome e email obrigatorios' }, { status: 400 })
  if (!VALID_PLANS.includes(plan)) return NextResponse.json({ error: 'Plano invalido' }, { status: 400 })
  const phoneE164 = normalizePhoneBR(phone ?? '')
  if (!phoneE164) return NextResponse.json({ error: 'Telefone invalido (use DDD + numero)' }, { status: 400 })

  // 1) Convite no Supabase Auth (email oficial de convite). Falhou -> nada persiste.
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email.trim().toLowerCase(),
    { redirectTo: `${SITE_URL}/auth/callback?next=/definir-senha` }
  )
  if (inviteError || !invited.user) {
    return NextResponse.json({ error: `Convite falhou: ${inviteError?.message ?? 'sem usuario'}` }, { status: 502 })
  }

  // 2) Linha do broker amarrada ao auth user
  const { data: broker, error: brokerError } = await supabase
    .from('brokers')
    .insert({ auth_user_id: invited.user.id, name: name.trim(), phone: phoneE164, email: email.trim().toLowerCase(), plan })
    .select('id, name, phone, email, plan, active, created_at')
    .single()
  if (brokerError || !broker) {
    // rollback do convite para não deixar auth órfão
    await supabase.auth.admin.deleteUser(invited.user.id)
    return NextResponse.json({ error: `Broker falhou: ${brokerError?.message}` }, { status: 500 })
  }

  // 3) Welcome no WhatsApp — falha NÃO bloqueia (badge "welcome pendente" no painel)
  let welcomeSent = true
  try {
    await sendPilotWelcome(phoneE164, broker.name)
    await supabase.from('brokers_welcome').upsert({ broker_id: broker.id })
  } catch {
    welcomeSent = false
  }

  return NextResponse.json({ broker: { ...broker, billing_status: null, welcome_sent: welcomeSent } })
}
