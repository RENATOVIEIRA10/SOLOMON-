/**
 * Evolution API WhatsApp Provider Adapter
 *
 * Parses incoming webhooks from Evolution API and sends messages via REST.
 * Evolution API docs: https://doc.evolution-api.com
 */

import type { IncomingMessage, OutgoingMessage } from '../types'

const API_URL = process.env.WHATSAPP_API_URL ?? ''
const API_TOKEN = process.env.WHATSAPP_API_TOKEN ?? ''

interface EvolutionWebhookPayload {
  event?: string
  instance?: string
  data?: {
    key?: {
      remoteJid?: string
      fromMe?: boolean
      id?: string
    }
    pushName?: string
    message?: {
      conversation?: string
      extendedTextMessage?: { text?: string }
      imageMessage?: { url?: string; caption?: string; mimetype?: string }
      documentMessage?: { url?: string; caption?: string; mimetype?: string; fileName?: string }
      audioMessage?: { url?: string; mimetype?: string }
    }
    messageType?: string
    messageTimestamp?: number
  }
}

/**
 * Extract phone number from Evolution's remoteJid format.
 */
function extractPhone(jid: string): string {
  const number = jid.split('@')[0]
  return number.startsWith('+') ? number : `+${number}`
}

/**
 * Parse an Evolution API webhook body into a normalized IncomingMessage.
 * Returns null if the payload is not a valid user message.
 */
export function parseEvolutionWebhook(body: unknown): IncomingMessage | null {
  if (!body || typeof body !== 'object') return null

  const payload = body as EvolutionWebhookPayload

  // Only process message events
  if (payload.event && payload.event !== 'messages.upsert') return null

  const data = payload.data
  if (!data?.key?.remoteJid) return null

  // Skip messages from the bot itself
  if (data.key.fromMe) return null

  // Skip status broadcasts and group messages
  const jid = data.key.remoteJid
  if (jid === 'status@broadcast' || jid.includes('@g.us')) return null

  const msg = data.message
  if (!msg) return null

  let text = ''
  let type: IncomingMessage['type'] = 'text'
  let mediaUrl: string | undefined

  if (msg.conversation) {
    text = msg.conversation
  } else if (msg.extendedTextMessage?.text) {
    text = msg.extendedTextMessage.text
  } else if (msg.imageMessage) {
    text = msg.imageMessage.caption ?? ''
    type = 'image'
    mediaUrl = msg.imageMessage.url
  } else if (msg.documentMessage) {
    text = msg.documentMessage.caption ?? ''
    type = 'document'
    mediaUrl = msg.documentMessage.url
  } else if (msg.audioMessage) {
    type = 'audio'
    mediaUrl = msg.audioMessage.url
  }

  // Skip empty text messages
  if (type === 'text' && !text.trim()) return null

  return {
    from: extractPhone(jid),
    body: text,
    messageId: data.key.id ?? `evo-${Date.now()}`,
    timestamp: data.messageTimestamp ?? Math.floor(Date.now() / 1000),
    type,
    mediaUrl,
  }
}

/**
 * Send a message via Evolution API.
 */
export async function sendEvolutionMessage(msg: OutgoingMessage): Promise<void> {
  const phone = msg.to.replace('+', '')
  const instanceName = process.env.WHATSAPP_INSTANCE_NAME ?? 'solomon'

  // If media URL provided, send as document
  if (msg.mediaUrl) {
    const url = `${API_URL}/message/sendMedia/${instanceName}`
    const payload = {
      number: phone,
      mediatype: 'document',
      media: msg.mediaUrl,
      caption: msg.body,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: API_TOKEN,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Evolution sendMedia failed (${response.status}): ${errorText}`)
    }
    return
  }

  // Send text message
  const url = `${API_URL}/message/sendText/${instanceName}`
  const payload = {
    number: phone,
    text: msg.body,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: API_TOKEN,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Evolution sendText failed (${response.status}): ${errorText}`)
  }
}
