/**
 * Kapso WhatsApp Provider Adapter
 *
 * Kapso wraps the Meta WhatsApp Cloud API:
 *   POST https://api.kapso.ai/meta/whatsapp/v24.0/{PHONE_NUMBER_ID}/messages
 *   Header: X-API-Key: {KAPSO_API_KEY}
 *   Body: Meta Cloud API format
 *
 * Webhook: receives Meta Cloud API webhook format
 */

import type { IncomingMessage, OutgoingMessage } from '../types'

const KAPSO_API_KEY = process.env.WHATSAPP_API_TOKEN ?? ''
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? ''
const KAPSO_BASE = 'https://api.kapso.ai/meta/whatsapp/v24.0'

// ---------------------------------------------------------------------------
// Webhook parsing (Meta Cloud API format via Kapso)
// ---------------------------------------------------------------------------

interface MetaWebhookEntry {
  changes?: Array<{
    value?: {
      messages?: Array<{
        from?: string
        id?: string
        timestamp?: string
        type?: string
        text?: { body?: string }
        image?: { id?: string; caption?: string }
        document?: { id?: string; caption?: string; filename?: string }
        audio?: { id?: string }
      }>
      statuses?: unknown[]
    }
  }>
}

interface MetaWebhookPayload {
  object?: string
  entry?: MetaWebhookEntry[]
}

/**
 * Parse a Kapso webhook into a normalized IncomingMessage.
 *
 * Real Kapso format:
 * {
 *   "message": { "id": "wamid...", "from": "558192724824", "text": { "body": "Oiiiiii" }, "type": "text", "timestamp": "..." },
 *   "conversation": { "phone_number": "558192724824", "contact_name": "..." },
 *   "phone_number_id": "1076079088920772"
 * }
 */
export function parseKapsoWebhook(body: unknown): IncomingMessage | null {
  if (!body || typeof body !== 'object') return null

  const payload = body as Record<string, unknown>

  // Kapso native format: { message: { from, text, type, ... }, conversation: { ... } }
  const message = payload.message as Record<string, unknown> | undefined
  if (message && message.from) {
    const from = String(message.from)
    const phone = from.startsWith('+') ? from : `+${from}`
    const msgType = String(message.type ?? 'text')

    // Skip outbound messages
    const kapsoMeta = message.kapso as Record<string, unknown> | undefined
    if (kapsoMeta?.direction === 'outbound') return null

    let text = ''
    let type: IncomingMessage['type'] = 'text'

    switch (msgType) {
      case 'text': {
        const textObj = message.text as Record<string, unknown> | undefined
        text = String(textObj?.body ?? kapsoMeta?.content ?? '')
        type = 'text'
        break
      }
      case 'image': {
        const imgObj = message.image as Record<string, unknown> | undefined
        text = String(imgObj?.caption ?? '')
        type = 'image'
        break
      }
      case 'document': {
        const docObj = message.document as Record<string, unknown> | undefined
        text = String(docObj?.caption ?? '')
        type = 'document'
        break
      }
      case 'audio':
        type = 'audio'
        break
      default:
        text = String(kapsoMeta?.content ?? '')
    }

    if (type === 'text' && !text.trim()) return null

    return {
      from: phone,
      body: text,
      messageId: String(message.id ?? `kapso-${Date.now()}`),
      timestamp: message.timestamp ? parseInt(String(message.timestamp), 10) : Math.floor(Date.now() / 1000),
      type,
    }
  }

  // Fallback: Meta Cloud API format (whatsapp_business_account)
  const metaPayload = payload as MetaWebhookPayload
  if (metaPayload.object === 'whatsapp_business_account' && metaPayload.entry) {
    for (const entry of metaPayload.entry) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages
        if (!messages || messages.length === 0) continue
        const msg = messages[0]
        if (!msg.from) continue

        return {
          from: msg.from.startsWith('+') ? msg.from : `+${msg.from}`,
          body: msg.text?.body ?? '',
          messageId: msg.id ?? `kapso-${Date.now()}`,
          timestamp: msg.timestamp ? parseInt(msg.timestamp, 10) : Math.floor(Date.now() / 1000),
          type: (msg.type as IncomingMessage['type']) ?? 'text',
        }
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Message sending (Meta Cloud API format via Kapso)
// ---------------------------------------------------------------------------

/**
 * Send a text message via Kapso (Meta Cloud API).
 */
export async function sendKapsoMessage(msg: OutgoingMessage): Promise<void> {
  const phone = msg.to.replace('+', '')

  if (!PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID not configured')
  }

  const url = `${KAPSO_BASE}/${PHONE_NUMBER_ID}/messages`

  // Text message
  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { body: msg.body },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': KAPSO_API_KEY,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Kapso send failed (${response.status}): ${errorText}`)
  }
}
