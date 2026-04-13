/**
 * WhatsApp Provider Factory
 *
 * Selects the correct provider adapter based on WHATSAPP_PROVIDER env var.
 * Supported: 'kapso', 'evolution', 'zapi'
 */

import type { IncomingMessage, OutgoingMessage, WhatsAppProvider } from '../types'
import { parseKapsoWebhook, sendKapsoMessage } from './kapso'
import { parseEvolutionWebhook, sendEvolutionMessage } from './evolution'

/**
 * Parse an incoming webhook body using the appropriate provider adapter.
 */
export function parseWebhook(provider: string, body: unknown): IncomingMessage | null {
  switch (provider as WhatsAppProvider) {
    case 'kapso':
      return parseKapsoWebhook(body)

    case 'evolution':
      return parseEvolutionWebhook(body)

    case 'zapi':
      // Z-API uses a similar format to Kapso; reuse for now
      return parseKapsoWebhook(body)

    default:
      console.warn(`[whatsapp/providers] Unknown provider: ${provider}`)
      return null
  }
}

/**
 * Send a message using the appropriate provider adapter.
 */
export async function sendMessage(provider: string, msg: OutgoingMessage): Promise<void> {
  switch (provider as WhatsAppProvider) {
    case 'kapso':
      return sendKapsoMessage(msg)

    case 'evolution':
      return sendEvolutionMessage(msg)

    case 'zapi':
      // Z-API uses a similar REST format to Kapso
      return sendKapsoMessage(msg)

    default:
      throw new Error(`[whatsapp/providers] Unknown provider: ${provider}`)
  }
}
