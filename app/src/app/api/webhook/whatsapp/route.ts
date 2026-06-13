/**
 * WhatsApp Webhook — Next.js API Route
 *
 * GET:  Webhook verification (returns challenge token)
 * POST: Receives messages, parses via provider, calls handler, sends response
 *
 * Deduplication: each incoming messageId is claimed in idempotency_keys before
 * any heavy work. A retried webhook (Kapso/Meta send the same event when our
 * response is slow) finds the key already claimed and returns 200 "duplicate"
 * without re-running the RAG pipeline or re-sending the answer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { parseWebhook, sendMessage } from '@/services/whatsapp/providers'
import { handleMessage } from '@/services/whatsapp/handler'
import { createServiceClient } from '@/lib/supabase'

const PROVIDER = process.env.WHATSAPP_PROVIDER ?? 'kapso'
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? ''
// When '1', POST webhooks MUST carry a valid token header or are rejected (401).
// Default off so enabling it is a deliberate, reversible step: confirm in the
// logs below that legit Kapso deliveries carry the token, then flip to close the
// forgeable-ingress gap without risking a production outage for the broker.
const REQUIRE_TOKEN = (process.env.WHATSAPP_REQUIRE_TOKEN ?? '') === '1'
const DEDUP_TTL_HOURS = 24

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  const verifyToken = searchParams.get('token') ?? searchParams.get('verify_token')
  if (verifyToken === VERIFY_TOKEN) return NextResponse.json({ status: 'ok' })
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * Returns true if this messageId is new (claim succeeded), false if duplicate.
 */
async function claimMessage(messageId: string): Promise<boolean> {
  try {
    const supabase = createServiceClient()
    const expires = new Date(Date.now() + DEDUP_TTL_HOURS * 3600_000).toISOString()
    const { error } = await supabase
      .from('idempotency_keys')
      .insert({
        key: messageId,
        endpoint: 'whatsapp-webhook',
        response: { claimed_at: new Date().toISOString() },
        expires_at: expires,
      } as never)
    if (error) {
      // Unique violation → duplicate
      if (error.code === '23505' || /duplicate/i.test(error.message)) return false
      // Other DB error → fail open (allow processing) but log
      console.error('[webhook/whatsapp] claim error (fail-open):', error.message)
      return true
    }
    return true
  } catch (e) {
    console.error('[webhook/whatsapp] claim exception (fail-open):', e)
    return true
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('[webhook/whatsapp] RAW PAYLOAD:', JSON.stringify(body).slice(0, 1000))

    // Webhook authentication. Kapso can be configured to send a secret header
    // (x-webhook-token / apikey) on every delivery, matching WHATSAPP_VERIFY_TOKEN.
    const headerToken = request.headers.get('x-webhook-token') ?? request.headers.get('apikey')
    const tokenValid = !!VERIFY_TOKEN && headerToken === VERIFY_TOKEN
    if (!VERIFY_TOKEN) {
      console.warn('[webhook/whatsapp] AUTH WARNING: WHATSAPP_VERIFY_TOKEN not set — endpoint is unauthenticated')
    } else if (!tokenValid) {
      if (REQUIRE_TOKEN) {
        // Enforced: reject forged/unauthenticated POSTs outright.
        console.warn('[webhook/whatsapp] REJECTED: missing/invalid webhook token (REQUIRE_TOKEN on)')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // Legacy mode: accept but log loudly so we can confirm whether legit Kapso
      // deliveries carry the token before flipping WHATSAPP_REQUIRE_TOKEN=1.
      console.warn(
        `[webhook/whatsapp] AUTH WARNING: accepted POST without valid token (REQUIRE_TOKEN off). headerPresent=${!!headerToken}. Set WHATSAPP_REQUIRE_TOKEN=1 once Kapso is confirmed to send the token.`
      )
    }

    const message = parseWebhook(PROVIDER, body)
    if (!message) return NextResponse.json({ status: 'ignored' })

    // DEDUP: claim messageId — if another request already processed it, skip.
    const isNew = await claimMessage(message.messageId)
    if (!isNew) {
      console.log(`[webhook/whatsapp] DUPLICATE messageId=${message.messageId} from=${message.from} — ignoring`)
      return NextResponse.json({ status: 'duplicate' })
    }

    console.log(`[webhook/whatsapp] Message from ${message.from}: ${message.body.slice(0, 100)}`)

    const responses = await handleMessage(message)

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
    return NextResponse.json({ status: 'error' }, { status: 200 })
  }
}
