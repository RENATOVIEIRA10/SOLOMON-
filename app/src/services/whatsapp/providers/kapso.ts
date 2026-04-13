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
 * Parse a Kapso/Meta Cloud API webhook into a normalized IncomingMessage.
 * Returns null if the payload is not a valid user message.
 */
export function parseKapsoWebhook(body: unknown): IncomingMessage | null {
  if (!body || typeof body !== 'object') return null

  const payload = body as MetaWebhookPayload

  // Meta Cloud API format
  if (payload.object === 'whatsapp_business_account' && payload.entry) {
    for (const entry of payload.entry) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages
        if (!messages || messages.length === 0) continue

        // Skip status updates
        if (change.value?.statuses) continue

        const msg = messages[0]
        if (!msg.from) continue

        const phone = msg.from.startsWith('+') ? msg.from : `+${msg.from}`
        let text = ''
        let type: IncomingMessage['type'] = 'text'

        switch (msg.type) {
          case 'text':
            text = msg.text?.body ?? ''
            type = 'text'
            break
          case 'image':
            text = msg.image?.caption ?? ''
            type = 'image'
            break
          case 'document':
            text = msg.document?.caption ?? ''
            type = 'document'
            break
          case 'audio':
            type = 'audio'
            break
          default:
            // Unsupported type, try to get text
            text = (msg as Record<string, unknown>).text?.toString() ?? ''
        }

        if (type === 'text' && !text.trim()) return null

        return {
          from: phone,
          body: text,
          messageId: msg.id ?? `kapso-${Date.now()}`,
          timestamp: msg.timestamp ? parseInt(msg.timestamp, 10) : Math.floor(Date.now() / 1000),
          type,
        }
      }
    }
  }

  // Fallback: flat format (some Kapso configurations)
  const flat = body as Record<string, unknown>
  if (flat.from && flat.body) {
    const from = String(flat.from)
    return {
      from: from.startsWith('+') ? from : `+${from}`,
      body: String(flat.body),
      messageId: String(flat.messageId ?? `kapso-${Date.now()}`),
      timestamp: Number(flat.timestamp ?? Math.floor(Date.now() / 1000)),
      type: 'text',
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
