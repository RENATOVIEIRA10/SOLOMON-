/**
 * WhatsApp Message Handler
 *
 * Main orchestrator for incoming WhatsApp messages.
 * Flow: validate broker -> check limits -> handle commands -> RAG -> format response
 */

import { createServiceClient } from '@/lib/supabase'
import { ask } from '@/services/rag/answer'
import { compareInsurers } from '@/services/rag/compare'
import { analyzePreSinistro } from '@/services/rag/pre-sinistro'
import { BRAND, PLANS, type BrokerPlan } from '@/config/constants'
import { getSession, addMessage, setBrokerId } from './session'
import type { IncomingMessage } from './types'

const MAX_WHATSAPP_LENGTH = 4096
const SIGNATURE = `\n\n_${BRAND.tagline}_`

/**
 * Handle an incoming WhatsApp message.
 * Returns an array of response strings (may be split if too long).
 */
export async function handleMessage(msg: IncomingMessage): Promise<string[]> {
  // Only handle text messages for now
  if (msg.type !== 'text' || !msg.body.trim()) {
    return []
  }

  const session = await getSession(msg.from)
  const text = msg.body.trim()

  // 1. Look up broker by phone
  const broker = await findBrokerByPhone(msg.from)

  if (!broker) {
    return [formatOnboarding(msg.from)]
  }

  // Cache broker ID in session
  if (!session.brokerId) {
    await setBrokerId(msg.from, broker.id)
  }

  // 2. Parse special commands (still needed before limit check to know if quota applies)
  const command = parseCommand(text)
  const consumesQuota = !command || PAID_COMMANDS.has(command.name)

  // 3. Check daily query limit on quota-consuming paths (RAG livre + /comparar + /sinistro).
  // /ajuda, /plano, /feedback nunca batem o limite — sao meta-comandos sem custo de LLM/retrieval.
  if (consumesQuota) {
    const plan = PLANS[broker.plan as BrokerPlan] ?? PLANS.free
    const todayCount = await getQueriesCount(broker)
    if (plan.queriesPerDay !== -1 && todayCount >= plan.queriesPerDay) {
      return [formatLimitReached(plan.name, plan.queriesPerDay)]
    }
  }

  // 4. Dispatch commands
  if (command) {
    return handleCommand(command, broker)
  }

  // 5. Call RAG engine
  // Append local pra evitar round-trip extra ao banco — depois persiste async.
  const history = [
    ...session.messages,
    { role: 'user' as const, content: text },
  ].slice(-6)
  await addMessage(msg.from, 'user', text)

  try {
    const result = await ask(text, {
      brokerId: broker.id,
      channel: 'whatsapp',
      conversationHistory: history, // last 3 exchanges
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
    await addMessage(msg.from, 'assistant', result.answer)

    // 6. Increment query counter
    await incrementQueries(broker.id)

    // 7. Split if needed
    return splitMessage(formatted)
  } catch (error) {
    console.error('[whatsapp/handler] RAG error:', error)
    return ['Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente em instantes.']
  }
}

// Commands that consume a paid quota slot (RAG/LLM). /ajuda, /plano, /feedback are free.
const PAID_COMMANDS = new Set(['/comparar', '/sinistro'])

/** Short opaque code so the user can reference a failure in support without exposing internals. */
function brokerErrorCode(): string {
  return Math.random().toString(36).slice(2, 8)
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
  // Atomic increment via RPC. Migration 20260511150000_increment_broker_queries.sql.
  const { error } = await supabase.rpc('increment_broker_queries', { p_broker_id: brokerId })
  if (error) {
    console.error('[whatsapp/handler] increment_broker_queries failed:', error.message)
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
      return handleCompareCommand(cmd.args, broker)

    case '/sinistro':
      return handleSinistroCommand(cmd.args, broker)

    case '/feedback':
      return [await handleFeedbackCommand(cmd.args, broker)]

    case '/plano': {
      const plan = PLANS[broker.plan as BrokerPlan] ?? PLANS.free
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
// /comparar
// ---------------------------------------------------------------------------

async function handleCompareCommand(
  args: string,
  broker: BrokerRow
): Promise<string[]> {
  if (!args.trim()) {
    return [
      `*Comparador de seguradoras*\n\n` +
        `Use: \`/comparar SeguradoraA vs SeguradoraB\`\n` +
        `Ou: \`/comparar SeguradoraA, SeguradoraB, SeguradoraC\`\n\n` +
        `Exemplo: \`/comparar Prudential vs Bradesco\`` +
        SIGNATURE,
    ]
  }

  // Parse insurer names (support "vs" or comma separators)
  const rawNames = args
    .split(/\s+(?:vs|x)\s+|\s*,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)

  const insurerNames = rawNames.slice(0, 3)

  if (insurerNames.length < 2) {
    return [
      `Preciso de pelo menos 2 seguradoras para comparar.\n\n` +
        `Use: \`/comparar Prudential vs Bradesco\`` +
        SIGNATURE,
    ]
  }

  try {
    const result = await compareInsurers({
      insurerNames,
      productType: 'vida_individual',
    })

    let text = `*Comparativo: ${result.insurerNames.join(' x ')}*\n\n`

    for (const dim of result.dimensions) {
      text += `*${dim.dimension}*\n`
      for (const row of dim.rows) {
        const flag =
          row.advantage === 'win' ? ' ✅' : row.advantage === 'lose' ? ' ❌' : ''
        text += `• ${row.insurerName}: ${row.value}${flag}\n`
      }
      text += '\n'
    }

    if (result.summary) {
      text += `*Resumo:* ${result.summary}\n\n`
    }

    text += `_Analise gerada em ${result.latencyMs}ms_`
    text += SIGNATURE

    await incrementQueries(broker.id)
    return splitMessage(text)
  } catch (err) {
    const code = brokerErrorCode()
    console.error(`[whatsapp/compare] error code=${code}:`, err)
    return [
      `Não consegui gerar a comparação agora.\n\n` +
        `Tente novamente em alguns segundos ou reformule os nomes das seguradoras.\n` +
        `Código: ${code}` +
        SIGNATURE,
    ]
  }
}

// ---------------------------------------------------------------------------
// /sinistro
// ---------------------------------------------------------------------------

const VALID_CLAIM_TYPES = [
  'morte_natural',
  'morte_acidental',
  'invalidez',
  'doenca_grave',
  'diaria',
  'internacao',
]

async function handleSinistroCommand(
  args: string,
  broker: BrokerRow
): Promise<string[]> {
  if (!args.trim()) {
    return [
      `*Análise pré-sinistro*\n\n` +
        `Use: \`/sinistro <seguradora> <tipo> <descricao>\`\n\n` +
        `Tipos aceitos: ${VALID_CLAIM_TYPES.map((t) => '`' + t + '`').join(', ')}\n\n` +
        `Exemplo:\n` +
        `\`/sinistro Prudential morte_natural infarto agudo do miocardio em casa\`` +
        SIGNATURE,
    ]
  }

  const tokens = args.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 3) {
    return [
      `Argumentos insuficientes.\n\n` +
        `Use: \`/sinistro <seguradora> <tipo> <descricao>\`\n` +
        `Ex: \`/sinistro Porto Seguro morte_natural infarto agudo do miocardio\`` +
        SIGNATURE,
    ]
  }

  // Locate the claim-type token. Insurer name is everything before it (1+ words);
  // description is everything after. This supports multi-word insurer names like
  // "Porto Seguro", "Tokio Marine", "Bradesco Seguros".
  let claimTypeIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    if (VALID_CLAIM_TYPES.includes(tokens[i].toLowerCase())) {
      claimTypeIdx = i
      break
    }
  }

  if (claimTypeIdx === -1) {
    return [
      `Tipo de sinistro não reconhecido nos argumentos.\n\n` +
        `Tipos aceitos: ${VALID_CLAIM_TYPES.map((t) => '`' + t + '`').join(', ')}\n\n` +
        `Exemplo: \`/sinistro Porto Seguro morte_natural infarto agudo do miocardio\`` +
        SIGNATURE,
    ]
  }
  if (claimTypeIdx === 0) {
    return [
      `Faltou o nome da seguradora antes do tipo.\n\n` +
        `Use: \`/sinistro <seguradora> <tipo> <descricao>\`` +
        SIGNATURE,
    ]
  }
  if (claimTypeIdx === tokens.length - 1) {
    return [
      `Faltou a descrição do evento após o tipo de sinistro.\n\n` +
        `Use: \`/sinistro <seguradora> <tipo> <descricao>\`` +
        SIGNATURE,
    ]
  }

  const insurerName = tokens.slice(0, claimTypeIdx).join(' ')
  const claimType = tokens[claimTypeIdx].toLowerCase()
  const description = tokens.slice(claimTypeIdx + 1).join(' ')

  try {
    const result = await analyzePreSinistro({
      insurerName,
      claimType,
      description,
    })

    const verdictEmoji =
      result.verdict === 'COBERTO'
        ? '✅'
        : result.verdict === 'NAO_COBERTO'
          ? '❌'
          : '⚠️'

    let text = `*Análise pré-sinistro — ${insurerName}*\n\n`
    text += `*Veredicto:* ${verdictEmoji} ${result.verdict}\n`
    text += `*Confiança:* ${Math.round(result.confidence * 100)}%\n\n`

    if (result.rationale) {
      text += `*Fundamento:*\n${result.rationale}\n\n`
    }

    if (result.citation?.excerpt) {
      text += `*Base legal:*\n_${result.citation.excerpt}_\n`
      if (result.citation.source_url) {
        text += `${result.citation.source_url}\n`
      }
      text += '\n'
    }

    if (result.documentsChecklist.length > 0) {
      text += `*Documentos necessários:*\n`
      for (const doc of result.documentsChecklist) {
        text += `• ${doc}\n`
      }
      text += '\n'
    }

    if (result.laudoTerms.length > 0) {
      text += `*Termos do laudo:*\n`
      for (const term of result.laudoTerms) {
        text += `• ${term}\n`
      }
      text += '\n'
    }

    if (result.riskFlags.length > 0) {
      text += `*Alertas de risco:*\n`
      for (const flag of result.riskFlags) {
        text += `⚠️ ${flag}\n`
      }
      text += '\n'
    }

    text += `_Análise gerada em ${result.latencyMs}ms (${result.model})_`
    text += SIGNATURE

    await incrementQueries(broker.id)
    return splitMessage(text)
  } catch (err) {
    const code = brokerErrorCode()
    console.error(`[whatsapp/sinistro] error code=${code}:`, err)
    return [
      `Não consegui analisar o evento agora.\n\n` +
        `Tente novamente em alguns segundos. Se persistir, verifique o nome da seguradora.\n` +
        `Código: ${code}` +
        SIGNATURE,
    ]
  }
}

// ---------------------------------------------------------------------------
// /feedback
// ---------------------------------------------------------------------------

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
    `/comparar <seguradoraA> vs <seguradoraB> — Comparar produtos\n` +
    `/sinistro <seguradora> <tipo> <descricao> — Analise pré-sinistro` +
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
    `O plano gratuito inclui ${PLANS.free.queriesPerDay} consultas por dia.` +
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
