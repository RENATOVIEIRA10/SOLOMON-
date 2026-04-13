/**
 * WhatsApp Webhook — Next.js API Route
 *
 * GET:  Webhook verification (returns challenge token)
 * POST: Receives messages, parses via provider, calls handler, sends response
 */

import { NextRequest, NextResponse } from 'next/server'
import { parseWebhook, sendMessage } from '@/services/whatsapp/providers'
import { handleMessage } from '@/services/whatsapp/handler'

const PROVIDER = process.env.WHATSAPP_PROVIDER ?? 'kapso'
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? ''

/**
 * GET /api/webhook/whatsapp
 *
 * Webhook verification endpoint. Providers send a GET with a challenge
 * token that must be echoed back to confirm ownership.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  // Meta/WhatsApp Cloud API format
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }

  // Generic format (Evolution/Kapso)
  const verifyToken = searchParams.get('token') ?? searchParams.get('verify_token')
  if (verifyToken === VERIFY_TOKEN) {
    return NextResponse.json({ status: 'ok' })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * POST /api/webhook/whatsapp
 *
 * Receives incoming messages from the WhatsApp provider webhook.
 * Processes the message and sends the response back via the provider API.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Log raw payload for debugging
    console.log('[webhook/whatsapp] RAW PAYLOAD:', JSON.stringify(body).slice(0, 1000))

    // Optional: validate webhook token from header
    const headerToken = request.headers.get('x-webhook-token') ?? request.headers.get('apikey')
    if (VERIFY_TOKEN && headerToken && headerToken !== VERIFY_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse incoming message using the configured provider
    const message = parseWebhook(PROVIDER, body)

    if (!message) {
      // Not a processable message (status update, group msg, etc.) — acknowledge
      return NextResponse.json({ status: 'ignored' })
    }

    console.log(`[webhook/whatsapp] Message from ${message.from}: ${message.body.slice(0, 100)}`)

    // Process message and get response(s)
    const responses = await handleMessage(message)

    // Send each response chunk back via the provider
    for (const text of responses) {
      try {
        await sendMessage(PROVIDER, { to: message.from, body: text })
      } catch (sendError) {
        console.error(`[webhook/whatsapp] Failed to send response to ${message.from}:`, sendError)
      }
    }

    return NextResponse.json({ status: 'ok', messages: responses.length })
  } catch (error) {
    console.error('[webhook/whatsapp] Error processing webhook:', error)
    // Always return 200 to prevent provider retries on our errors
    return NextResponse.json({ status: 'error' }, { status: 200 })
  }
}
