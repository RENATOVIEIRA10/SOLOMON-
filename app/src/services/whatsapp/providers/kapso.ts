/**
 * Kapso WhatsApp Provider Adapter
 *
 * Parses incoming webhooks from Kapso and sends messages via Kapso API.
 * Kapso webhook format can vary; this handles the most common structures.
 */

import type { IncomingMessage, OutgoingMessage } from '../types'

const API_URL = process.env.WHATSAPP_API_URL ?? ''
const API_TOKEN = process.env.WHATSAPP_API_TOKEN ?? ''

interface KapsoWebhookPayload {
  // Kapso sends various formats; handle the common ones
  event?: string
  data?: {
    key?: { remoteJid?: string; id?: string }
    message?: {
      conversation?: string
      extendedTextMessage?: { text?: string }
      imageMessage?: { url?: string; caption?: string }
      documentMessage?: { url?: string; caption?: string }
      audioMessage?: { url?: string }
    }
    messageTimestamp?: number | string
    pushName?: string
  }
  // Alternative flat format
  from?: string
  body?: string
  messageId?: string
  timestamp?: number
  type?: string
  mediaUrl?: string
}

/**
 * Extract phone number from Kapso's remoteJid format.
 * e.g. "5511999998888@s.whatsapp.net" -> "+5511999998888"
 */
function extractPhone(jid: string): string {
  const number = jid.split('@')[0]
  return number.startsWith('+') ? number : `+${number}`
}

/**
 * Parse a Kapso webhook body into a normalized IncomingMessage.
 * Returns null if the payload is not a valid user message.
 */
export function parseKapsoWebhook(body: unknown): IncomingMessage | null {
  if (!body || typeof body !== 'object') return null

  const payload = body as KapsoWebhookPayload

  // Format 1: Flat format (simplified Kapso webhook)
  if (payload.from && payload.body) {
    return {
      from: payload.from.startsWith('+') ? payload.from : `+${payload.from}`,
      body: payload.body,
      messageId: payload.messageId ?? `kapso-${Date.now()}`,
      timestamp: payload.timestamp ?? Math.floor(Date.now() / 1000),
      type: (payload.type as IncomingMessage['type']) ?? 'text',
      mediaUrl: payload.mediaUrl,
    }
  }

  // Format 2: Nested data format (Baileys-based Kapso)
  const data = payload.data
  if (!data?.key?.remoteJid) return null

  // Skip status broadcasts and group messages
  const jid = data.key.remoteJid
  if (jid === 'status@broadcast' || jid.includes('@g.us')) return null

  const msg = data.message
  if (!msg) return null

  // Extract text from different message types
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

  const timestamp =
    typeof data.messageTimestamp === 'string'
      ? parseInt(data.messageTimestamp, 10)
      : data.messageTimestamp ?? Math.floor(Date.now() / 1000)

  return {
    from: extractPhone(jid),
    body: text,
    messageId: data.key.id ?? `kapso-${Date.now()}`,
    timestamp,
    type,
    mediaUrl,
  }
}

/**
 * Send a message via Kapso API.
 */
export async function sendKapsoMessage(msg: OutgoingMessage): Promise<void> {
  const phone = msg.to.replace('+', '')
  const instanceName = process.env.WHATSAPP_INSTANCE_NAME ?? 'solomon'

  const url = `${API_URL}/message/sendText/${instanceName}`

  const payload: Record<string, unknown> = {
    number: phone,
    text: msg.body,
  }

  // If media URL is provided, use sendMedia endpoint instead
  if (msg.mediaUrl) {
    const mediaUrl = `${API_URL}/message/sendMedia/${instanceName}`
    const mediaPayload = {
      number: phone,
      mediatype: 'document',
      media: msg.mediaUrl,
      caption: msg.body,
    }

    const response = await fetch(mediaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: API_TOKEN,
      },
      body: JSON.stringify(mediaPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Kapso sendMedia failed (${response.status}): ${errorText}`)
    }
    return
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
    throw new Error(`Kapso sendText failed (${response.status}): ${errorText}`)
  }
}
