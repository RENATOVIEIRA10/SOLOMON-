/**
 * WhatsApp Message Handler
 *
 * Main orchestrator for incoming WhatsApp messages.
 * Flow: validate broker -> check limits -> handle commands -> RAG -> format response
 */

import { createServiceClient } from '@/lib/supabase'
import { ask } from '@/services/rag/answer'
import { BRAND, PLANS } from '@/config/constants'
import { getSession, addMessage, setBrokerId } from './session'
import type { IncomingMessage } from './types'

const MAX_WHATSAPP_LENGTH = 4096
const SIGNATURE = `\n\n_${BRAND.tagline}_`

type PlanKey = keyof typeof PLANS

/**
 * Handle an incoming WhatsApp message.
 * Returns an array of response strings (may be split if too long).
 */
export async function handleMessage(msg: IncomingMessage): Promise<string[]> {
  // Only handle text messages for now
  if (msg.type !== 'text' || !msg.body.trim()) {
    return []
  }

  const session = getSession(msg.from)
  const text = msg.body.trim()

  // 1. Look up broker by phone
  const broker = await findBrokerByPhone(msg.from)

  if (!broker) {
    return [formatOnboarding(msg.from)]
  }

  // Cache broker ID in session
  if (!session.brokerId) {
    setBrokerId(msg.from, broker.id)
  }

  // 2. Handle special commands
  const command = parseCommand(text)
  if (command) {
    return handleCommand(command, broker)
  }

  // 3. Check daily query limit
  const plan = PLANS[broker.plan.toUpperCase() as PlanKey] ?? PLANS.FREE
  const todayCount = await getQueriesCount(broker)

  if (plan.queriesPerDay !== -1 && todayCount >= plan.queriesPerDay) {
    return [formatLimitReached(plan.name, plan.queriesPerDay)]
  }

  // 4. Call RAG engine
  addMessage(msg.from, 'user', text)

  try {
    const result = await ask(text, {
      brokerId: broker.id,
      channel: 'whatsapp',
      conversationHistory: session.messages.slice(-6), // last 3 exchanges
    })

    // 5. Format response with citations
    const formatted = formatRagResponse(result.answer, result.citations)
    addMessage(msg.from, 'assistant', result.answer)

    // 6. Increment query counter
    await incrementQueries(broker.id)

    // 7. Split if needed
    return splitMessage(formatted)
  } catch (error) {
    console.error('[whatsapp/handler] RAG error:', error)
    return ['Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente em instantes.']
  }
}

// ---------------------------------------------------------------------------
// Broker lookup
// ---------------------------------------------------------------------------

interface BrokerRow {
  id: string
  name: string
  phone: string
  plan: string
  queries_today: number
  queries_reset_at: string | null
  active: boolean
}

async function findBrokerByPhone(phone: string): Promise<BrokerRow | null> {
  const supabase = createServiceClient()

  // Try exact match first, then without '+'
  const phoneVariants = [phone, phone.replace('+', '')]

  const { data, error } = await supabase
    .from('brokers')
    .select('id, name, phone, plan, queries_today, queries_reset_at, active')
    .in('phone', phoneVariants)
    .eq('active', true)
    .limit(1)
    .single()

  if (error || !data) return null
  return data
}

// ---------------------------------------------------------------------------
// Query limits
// ---------------------------------------------------------------------------

/**
 * Get the current query count, resetting if past midnight.
 */
async function getQueriesCount(broker: BrokerRow): Promise<number> {
  const resetAt = broker.queries_reset_at ? new Date(broker.queries_reset_at) : null
  const now = new Date()

  // Reset if queries_reset_at is before today's midnight
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (!resetAt || resetAt < todayMidnight) {
    // Reset counter
    const supabase = createServiceClient()
    await supabase
      .from('brokers')
      .update({
        queries_today: 0,
        queries_reset_at: now.toISOString(),
      })
      .eq('id', broker.id)

    return 0
  }

  return broker.queries_today
}

async function incrementQueries(brokerId: string): Promise<void> {
  const supabase = createServiceClient()

  // Use raw SQL via rpc for atomic increment, fallback to read-then-write
  const { data } = await supabase
    .from('brokers')
    .select('queries_today')
    .eq('id', brokerId)
    .single()

  if (data) {
    await supabase
      .from('brokers')
      .update({ queries_today: data.queries_today + 1 })
      .eq('id', brokerId)
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

interface ParsedCommand {
  name: string
  args: string
}

function parseCommand(text: string): ParsedCommand | null {
  if (!text.startsWith('/')) return null

  const parts = text.split(/\s+/)
  const name = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ')

  const validCommands = ['/ajuda', '/help', '/comparar', '/sinistro', '/plano']
  if (!validCommands.includes(name)) return null

  return { name, args }
}

function handleCommand(cmd: ParsedCommand, broker: BrokerRow): string[] {
  switch (cmd.name) {
    case '/ajuda':
    case '/help':
      return [formatHelp(broker.name)]

    case '/comparar':
      return [
        '*Comparador de seguradoras* esta em desenvolvimento.\n\n' +
          'Em breve voce podera comparar produtos lado a lado.\n' +
          'Ex: /comparar Prudential vs Bradesco' +
          SIGNATURE,
      ]

    case '/sinistro':
      return [
        '*Analise pre-sinistro* esta em desenvolvimento.\n\n' +
          'Em breve voce podera verificar cobertura e documentacao necessaria antes de abrir um sinistro.' +
          SIGNATURE,
      ]

    case '/plano': {
      const plan = PLANS[broker.plan.toUpperCase() as PlanKey] ?? PLANS.FREE
      const limit = plan.queriesPerDay === -1 ? 'ilimitadas' : `${plan.queriesPerDay}/dia`
      return [
        `*Seu plano: ${plan.name}*\n\n` +
          `Consultas: ${limit}\n` +
          `Consultas hoje: ${broker.queries_today}\n\n` +
          `Para upgrade, acesse o dashboard ou fale com nosso suporte.` +
          SIGNATURE,
      ]
    }

    default:
      return [formatHelp(broker.name)]
  }
}

// ---------------------------------------------------------------------------
// Response formatting
// ---------------------------------------------------------------------------

function formatHelp(brokerName: string): string {
  return (
    `Ola, *${brokerName}*! Sou o *SOLOMON*.\n\n` +
    `Pode me perguntar qualquer coisa sobre seguros de vida:\n\n` +
    `- Condicoes gerais de produtos\n` +
    `- Coberturas e exclusoes\n` +
    `- Carencias e processos SUSEP\n` +
    `- Comparacoes entre seguradoras\n\n` +
    `*Comandos:*\n` +
    `/ajuda — Este menu\n` +
    `/plano — Ver seu plano atual\n` +
    `/comparar — Comparar seguradoras (em breve)\n` +
    `/sinistro — Analise pre-sinistro (em breve)` +
    SIGNATURE
  )
}

function formatOnboarding(phone: string): string {
  return (
    `Ola! Sou o *SOLOMON* — ${BRAND.positioning}.\n\n` +
    `Seu numero (${phone}) ainda nao esta cadastrado.\n\n` +
    `Para comecar a usar:\n` +
    `1. Acesse nosso site e crie sua conta\n` +
    `2. Cadastre este numero de WhatsApp\n` +
    `3. Pronto! Pode me perguntar qualquer coisa sobre seguros de vida.\n\n` +
    `O plano gratuito inclui ${PLANS.FREE.queriesPerDay} consultas por dia.` +
    SIGNATURE
  )
}

function formatLimitReached(planName: string, limit: number): string {
  return (
    `Voce atingiu o limite de *${limit} consultas* do plano *${planName}* por hoje.\n\n` +
    `Opcoes:\n` +
    `- Aguarde ate amanha para o reset automatico\n` +
    `- Faca upgrade para mais consultas\n\n` +
    `Use /plano para ver detalhes.` +
    SIGNATURE
  )
}

interface CitationInfo {
  index: number
  insurerName: string
  productName: string
  susepProcess?: string | null
}

function formatRagResponse(answer: string, citations: CitationInfo[]): string {
  let text = answer

  if (citations.length > 0) {
    text += '\n\n*Fontes:*'
    for (const cite of citations) {
      const susep = cite.susepProcess ? ` (SUSEP ${cite.susepProcess})` : ''
      text += `\n[${cite.index}] ${cite.insurerName} — ${cite.productName}${susep}`
    }
  }

  text += SIGNATURE

  return text
}

/**
 * Split a message into WhatsApp-sized chunks (max 4096 chars).
 * Tries to split at paragraph boundaries.
 */
function splitMessage(text: string): string[] {
  if (text.length <= MAX_WHATSAPP_LENGTH) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= MAX_WHATSAPP_LENGTH) {
      chunks.push(remaining)
      break
    }

    // Find a good split point (paragraph or line break)
    let splitAt = remaining.lastIndexOf('\n\n', MAX_WHATSAPP_LENGTH)
    if (splitAt === -1 || splitAt < MAX_WHATSAPP_LENGTH / 2) {
      splitAt = remaining.lastIndexOf('\n', MAX_WHATSAPP_LENGTH)
    }
    if (splitAt === -1 || splitAt < MAX_WHATSAPP_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(' ', MAX_WHATSAPP_LENGTH)
    }
    if (splitAt === -1) {
      splitAt = MAX_WHATSAPP_LENGTH
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}
