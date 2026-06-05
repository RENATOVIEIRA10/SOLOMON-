/**
 * POST /api/ask
 *
 * Main SOLOMON query endpoint.
 * Body: { question: string, insurer?: string, history?: Array<{role, content}> }
 * Response: { answer, citations, model, latencyMs }
 */

import { NextRequest, NextResponse } from 'next/server'
import { ask, detectInsurers, resolveInsurerIds } from '@/services/rag/answer'
import { detectRateIntent, queryRateTable, type RateIntent } from '@/services/rag/rate-lookup'
import {
  aiQuotaHeaders,
  enforceAiQuota,
  incrementAiQuota,
  isAiAccessResponse,
  requireAiAccess,
} from '@/lib/ai-access'
import {
  PRODUCT_ANALYTICS_EVENTS,
  bucketTextLength,
  quotaRemaining,
  trackProductEvent,
} from '@/lib/product-analytics'

export const maxDuration = 60

interface AskRequestBody {
  question: string
  insurer?: string
  /** @deprecated ignored — broker is derived from the session (Phase 5.2). */
  brokerId?: string
  channel?: 'whatsapp' | 'dashboard' | 'api'
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  debug?: boolean
  /**
   * Eval mode: roda pipeline normal mas devolve tambem os chunks recuperados
   * (sources com content). Usado pelo harness Ragas em app/eval/ragas.
   * Nao altera comportamento do ask() — so expoe o que ja esta na resposta
   * interna. Nao e usado pelo webhook WhatsApp nem pelo dashboard.
   */
  evalMode?: boolean
}

// deploy-marker: rebuild-rev-2
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AskRequestBody

    // Validate input
    if (!body.question || typeof body.question !== 'string') {
      return NextResponse.json(
        { error: 'Campo "question" e obrigatorio e deve ser uma string.' },
        { status: 400 }
      )
    }

    if (body.question.trim().length < 3) {
      return NextResponse.json(
        { error: 'A pergunta deve ter pelo menos 3 caracteres.' },
        { status: 400 }
      )
    }

    if (body.question.length > 2000) {
      return NextResponse.json(
        { error: 'A pergunta deve ter no maximo 2000 caracteres.' },
        { status: 400 }
      )
    }

    // Validate history format if provided
    if (body.history) {
      if (!Array.isArray(body.history)) {
        return NextResponse.json(
          { error: 'Campo "history" deve ser um array.' },
          { status: 400 }
        )
      }

      for (const msg of body.history) {
        if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
          return NextResponse.json(
            { error: 'Cada item de "history" deve ter role ("user" ou "assistant") e content.' },
            { status: 400 }
          )
        }
      }
    }

    const aiAccess = await requireAiAccess(request, {
      allowEvalBypass: true,
      evalMode: body.evalMode === true,
    })
    if (isAiAccessResponse(aiAccess)) return aiAccess

    if (body.debug) {
      const q = body.question.trim()
      const mentioned = detectInsurers(q)
      const intent: RateIntent = mentioned.length === 1 ? detectRateIntent(q, mentioned[0]) : { hasIntent: false }
      const resolvedIds: Record<string, string[]> = {}
      let rateRowCount = 0
      let firstRow: unknown = null
      if (mentioned.length === 1 && intent.hasIntent) {
        const m = await resolveInsurerIds(mentioned)
        for (const [k, v] of m) resolvedIds[k] = v
        const ids = Object.values(resolvedIds)[0]
        if (ids && ids.length > 0) {
          const rows = await queryRateTable({
            insurerId: ids[0],
            productHint: intent.productHint,
            productHints: intent.productHints,
            productCode: intent.productCode,
            productCodes: intent.productCodes,
            age: intent.age,
            gender: intent.gender,
            rendaMensal: intent.rendaMensal,
            capital: intent.capital,
            franquia: intent.franquia,
            limit: 5,
          })
          rateRowCount = rows.length
          firstRow = rows[0] ?? null
        }
      }
      return NextResponse.json({
        debug: true,
        mentionedInsurers: mentioned,
        rateIntent: intent,
        resolvedInsurerIds: resolvedIds,
        rateRowCount,
        firstRow,
      })
    }

    const quotaBlocked = aiAccess ? enforceAiQuota(aiAccess) : null
    if (quotaBlocked) {
      await trackProductEvent({
        eventName: PRODUCT_ANALYTICS_EVENTS.quotaExceeded,
        brokerId: aiAccess?.brokerId,
        authUserId: aiAccess?.authUserId,
        source: 'api/ask',
        properties: {
          channel: body.channel ?? 'api',
          plan: aiAccess?.plan,
          queries_today: aiAccess?.queriesToday,
          queries_per_day: aiAccess?.queriesPerDay,
        },
      })
      return quotaBlocked
    }

    const startedAt = Date.now()
    await trackProductEvent({
      eventName: PRODUCT_ANALYTICS_EVENTS.conversationStarted,
      brokerId: aiAccess?.brokerId,
      authUserId: aiAccess?.authUserId,
      source: 'api/ask',
      properties: {
        channel: body.channel ?? 'api',
        plan: aiAccess?.plan,
        insurer_filter: body.insurer ?? null,
        question_length_bucket: bucketTextLength(body.question),
        history_messages_count: body.history?.length ?? 0,
        quota_remaining_before: aiAccess
          ? quotaRemaining(aiAccess.queriesToday, aiAccess.queriesPerDay)
          : null,
      },
    })

    const result = await ask(body.question.trim(), {
      brokerId: aiAccess?.brokerId,
      channel: body.channel ?? 'api',
      insurerFilter: body.insurer,
      conversationHistory: body.history,
    })

    await incrementAiQuota(aiAccess)
    await trackProductEvent({
      eventName: PRODUCT_ANALYTICS_EVENTS.conversationCompleted,
      brokerId: aiAccess?.brokerId,
      authUserId: aiAccess?.authUserId,
      source: 'api/ask',
      properties: {
        channel: body.channel ?? 'api',
        plan: aiAccess?.plan,
        model: result.model,
        latency_ms: result.latencyMs,
        wall_latency_ms: Date.now() - startedAt,
        tokens_used: result.tokensUsed,
        citations_count: result.citations.length,
        low_confidence: result.lowConfidence,
        confidence_score: result.confidenceScore,
        answer_warnings_count: result.answerWarnings?.length ?? 0,
        source_count: result.sourceCount ?? null,
        quota_remaining_after: aiAccess
          ? quotaRemaining(aiAccess.queriesToday + 1, aiAccess.queriesPerDay)
          : null,
      },
    })
    const responseQuota = aiAccess
      ? { ...aiAccess, queriesToday: aiAccess.queriesToday + 1 }
      : null

    const response: Record<string, unknown> = {
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
      conversationId: result.conversationId,
      confidenceScore: result.confidenceScore,
      lowConfidence: result.lowConfidence,
      citationCoverage: result.citationCoverage,
      invalidCitationIndexes: result.invalidCitationIndexes,
      answerWarnings: result.answerWarnings,
    }

    if (body.evalMode) {
      response.sources = result.sources
      response.avgSimilarity = result.avgSimilarity
      response.sourceCount = result.sourceCount
    }

    return NextResponse.json(response, {
      headers: responseQuota ? aiQuotaHeaders(responseQuota) : undefined,
    })
  } catch (error) {
    console.error('[api/ask] Error:', error)

    return NextResponse.json(
      { error: 'Erro interno ao processar a pergunta. Tente novamente.' },
      { status: 500 }
    )
  }
}
