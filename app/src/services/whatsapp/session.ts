/**
 * WhatsApp Conversation Session Manager (Wave B — persistent).
 *
 * Sessao curta por phone (TTL 30 min). Persistida em public.whatsapp_sessions
 * para sobreviver a cold start serverless da Vercel — antes era Map em
 * memoria e toda mensagem do mesmo corretor entrava como conversa nova.
 *
 * TTL eh validado em leitura (lazy): se a row esta stale (updated_at > 30min),
 * tratamos messages como vazias mas preservamos brokerId — assim o lookup por
 * phone nao precisa repetir a cada hora.
 *
 * Concorrencia: o fluxo real e sequencial por phone (1 webhook -> 1 handler ->
 * 3 calls em serie). Race entre 2 mensagens simultaneas do mesmo numero pode
 * perder ate uma entrada — aceitavel pra MVP, nao corrompe nada.
 */

import { createServiceClient } from '@/lib/supabase'

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes
const MAX_MESSAGES_PER_SESSION = 20

export interface Session {
  phone: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  lastActivity: number
  brokerId?: string
}

interface DbRow {
  phone: string
  broker_id: string | null
  messages: Array<{ role: 'user' | 'assistant'; content: string }> | null
  updated_at: string
}

function rowToSession(row: DbRow): Session {
  return {
    phone: row.phone,
    messages: Array.isArray(row.messages) ? row.messages : [],
    lastActivity: new Date(row.updated_at).getTime(),
    brokerId: row.broker_id ?? undefined,
  }
}

function isExpired(lastActivity: number): boolean {
  return Date.now() - lastActivity > SESSION_TTL_MS
}

/**
 * Le a sessao do banco. Se nao existir, devolve uma session "fresca"
 * (sem gravar — addMessage/setBrokerId fazem o write). Se a row existir
 * mas estiver expirada, zeramos messages mas preservamos brokerId.
 */
export async function getSession(phone: string): Promise<Session> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('whatsapp_sessions')
    .select('phone, broker_id, messages, updated_at')
    .eq('phone', phone)
    .maybeSingle()

  if (error) {
    console.error('[whatsapp/session] getSession query failed:', error.message)
    return { phone, messages: [], lastActivity: Date.now() }
  }

  if (!data) {
    return { phone, messages: [], lastActivity: Date.now() }
  }

  const session = rowToSession(data as DbRow)
  if (isExpired(session.lastActivity)) {
    return {
      phone,
      messages: [],
      lastActivity: Date.now(),
      brokerId: session.brokerId,
    }
  }
  return session
}

/**
 * Append a message (truncado a MAX_MESSAGES_PER_SESSION ultimas) e atualiza
 * updated_at. Read-modify-write — aceitavel pelo padrao sequencial do canal.
 */
export async function addMessage(
  phone: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const supabase = createServiceClient()
  const current = await getSession(phone)
  const messages = [...current.messages, { role, content }].slice(-MAX_MESSAGES_PER_SESSION)

  const { error } = await supabase
    .from('whatsapp_sessions')
    .upsert(
      {
        phone,
        broker_id: current.brokerId ?? null,
        messages,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'phone' }
    )

  if (error) {
    console.error('[whatsapp/session] addMessage upsert failed:', error.message)
  }
}

/**
 * Persiste o broker_id na sessao apos lookup por phone. Preserva messages
 * existentes — usa read-modify-write pra evitar zerar a coluna no upsert.
 */
export async function setBrokerId(phone: string, brokerId: string): Promise<void> {
  const supabase = createServiceClient()
  const current = await getSession(phone)

  const { error } = await supabase
    .from('whatsapp_sessions')
    .upsert(
      {
        phone,
        broker_id: brokerId,
        messages: current.messages,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'phone' }
    )

  if (error) {
    console.error('[whatsapp/session] setBrokerId upsert failed:', error.message)
  }
}
