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

    // 5. Format response with citations + optional low-confidence warning
    let formatted = formatRagResponse(result.answer, result.citations)
    if (result.lowConfidence) {
      formatted +=
        `\n\n⚠️ *Confiança baixa* (${Math.round(result.confidenceScore * 100)}%` +
        ` · ${result.sourceCount} fonte${result.sourceCount === 1 ? '' : 's'}).` +
        `\nValide no PDF oficial antes de usar com cliente.` +
        `\nResponda */feedback* com nota 1-5 para ajudar a melhorar.`
    }
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

/**
 * Generate phone-number variants for a lookup.
 *
 * Brazilian carriers / WhatsApp sometimes deliver mobile numbers with or
 * without the leading 9 added in 2012. Kapso has been observed sending both
 * "5581991010313" (with 9) and "558191010313" (without 9) for the same user.
 * We must match a broker regardless of that noise.
 *
 * Returns raw + '+' prefixed, and for BR mobile numbers both the 9-added and
 * 9-stripped versions.
 */
function phoneLookupVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, '')
  const out = new Set<string>([phone, `+${digits}`, digits])

  if (digits.startsWith('55')) {
    const rest = digits.slice(2)
    if (rest.length === 10) {
      // DDD (2) + 8 digits → add the 9 after DDD
      const ddd = rest.slice(0, 2)
      const num = rest.slice(2)
      out.add(`+55${ddd}9${num}`)
      out.add(`55${ddd}9${num}`)
    } else if (rest.length === 11 && rest[2] === '9') {
      // DDD (2) + 9 + 8 digits → also variant without the 9
      const ddd = rest.slice(0, 2)
      const num = rest.slice(3)
      out.add(`+55${ddd}${num}`)
      out.add(`55${ddd}${num}`)
    }
  }

  return Array.from(out)
}

async function findBrokerByPhone(phone: string): Promise<BrokerRow | null> {
  const supabase = createServiceClient()

  const phoneVariants = phoneLookupVariants(phone)

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

  const validCommands = ['/ajuda', '/help', '/comparar', '/sinistro', '/plano', '/feedback']
  if (!validCommands.includes(name)) return null

  return { name, args }
}

async function handleCommand(cmd: ParsedCommand, broker: BrokerRow): Promise<string[]> {
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

    case '/feedback':
      return [await handleFeedbackCommand(cmd.args, broker)]

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

/**
 * Handle the /feedback command.
 *
 * Syntax:
 *   /feedback <1-5>
 *   /feedback <1-5> <issue>
 *   /feedback <1-5> <issue> <comentário livre>
 *
 * Issues aceitos: hallucination | wrong_insurer | outdated | incomplete | other
 * Anexa o feedback à ÚLTIMA conversa do broker.
 */
async function handleFeedbackCommand(args: string, broker: BrokerRow): Promise<string> {
  const helpText =
    `*Como usar /feedback:*\n` +
    `\`/feedback 5\` — só a nota\n` +
    `\`/feedback 2 hallucination\` — nota + problema\n` +
    `\`/feedback 3 outdated PDF da Prudential foi atualizado\` — nota + problema + comentário\n\n` +
    `*Problemas aceitos:* hallucination, wrong_insurer, outdated, incomplete, other` +
    SIGNATURE

  const parts = args.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return helpText

  const rating = parseInt(parts[0], 10)
  if (isNaN(rating) || rating < 1 || rating > 5) {
    return `Nota precisa ser um número de 1 a 5.\n\n${helpText}`
  }

  const VALID_ISSUES = ['hallucination', 'wrong_insurer', 'outdated', 'incomplete', 'other']
  let flaggedIssue: string | null = null
  let comment: string | null = null

  if (parts.length >= 2 && VALID_ISSUES.includes(parts[1].toLowerCase())) {
    flaggedIssue = parts[1].toLowerCase()
    if (parts.length > 2) comment = parts.slice(2).join(' ')
  } else if (parts.length >= 2) {
    // No issue provided, rest is just a free comment
    comment = parts.slice(1).join(' ')
  }

  // Find latest conversation for this broker
  const supabase = createServiceClient()
  const { data: lastConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('broker_id', broker.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!lastConv) {
    return `Não achei uma conversa sua recente para avaliar. Faça uma pergunta primeiro e depois envie /feedback.${SIGNATURE}`
  }

  const { error } = await supabase
    .from('conversation_feedback')
    .insert({
      conversation_id: lastConv.id,
      broker_id: broker.id,
      rating,
      flagged_issue: flaggedIssue,
      comment,
      channel: 'whatsapp',
    } as never)

  if (error) {
    console.error('[whatsapp/feedback] insert failed:', error.message)
    return `Não consegui registrar o feedback agora. Tente de novo em instantes.${SIGNATURE}`
  }

  const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating)
  const issueText = flaggedIssue ? `\nProblema: *${flaggedIssue}*` : ''
  const commentText = comment ? `\nComentário: _${comment}_` : ''

  return (
    `*Feedback registrado* ${stars}${issueText}${commentText}\n\n` +
    `Obrigado — isso ajuda o SOLOMON a melhorar.` +
    SIGNATURE
  )
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
    `/feedback 1-5 — Avaliar a última resposta\n` +
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
  sourceUrl?: string | null
}

function formatRagResponse(answer: string, citations: CitationInfo[]): string {
  // Strip markdown links the LLM embeds inline (WhatsApp renders them literal)
  let text = answer.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')

  if (citations.length > 0) {
    text += '\n\n*Fontes:*'
    for (const cite of citations) {
      const susep = cite.susepProcess ? ` (SUSEP ${cite.susepProcess})` : ''
      text += `\n[${cite.index}] ${cite.insurerName} — ${cite.productName}${susep}`
      if (cite.sourceUrl) {
        text += `\n${cite.sourceUrl}`
      }
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
