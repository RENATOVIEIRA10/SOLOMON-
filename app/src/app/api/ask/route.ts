/**
 * POST /api/ask
 *
 * Main SOLOMON query endpoint.
 * Body: { question: string, insurer?: string, history?: Array<{role, content}> }
 * Response: { answer, citations, model, latencyMs }
 */

import { NextRequest, NextResponse } from 'next/server'
import { ask, detectInsurers, resolveInsurerIds } from '@/services/rag/answer'
import { detectRateIntent, queryRateTable } from '@/services/rag/rate-lookup'

interface AskRequestBody {
  question: string
  insurer?: string
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

    if (body.debug) {
      const q = body.question.trim()
      const mentioned = detectInsurers(q)
      const intent = mentioned.length === 1 ? detectRateIntent(q, mentioned[0]) : { hasIntent: false }
      let resolvedIds: Record<string, string[]> = {}
      let rateRowCount = 0
      let firstRow: unknown = null
      if (mentioned.length === 1 && intent.hasIntent) {
        const m = await resolveInsurerIds(mentioned)
        for (const [k, v] of m) resolvedIds[k] = v
        const ids = Object.values(resolvedIds)[0]
        if (ids && ids.length > 0) {
          const rows = await queryRateTable({
            insurerId: ids[0],
            productHint: (intent as any).productHint,
            age: (intent as any).age,
            gender: (intent as any).gender,
            rendaMensal: (intent as any).rendaMensal,
            capital: (intent as any).capital,
            franquia: (intent as any).franquia,
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

    const result = await ask(body.question.trim(), {
      brokerId: body.brokerId,
      channel: body.channel ?? 'api',
      insurerFilter: body.insurer,
      conversationHistory: body.history,
    })

    const response: Record<string, unknown> = {
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
      conversationId: result.conversationId,
    }

    if (body.evalMode) {
      response.sources = result.sources
      response.confidenceScore = result.confidenceScore
      response.avgSimilarity = result.avgSimilarity
      response.sourceCount = result.sourceCount
      response.lowConfidence = result.lowConfidence
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[api/ask] Error:', error)

    return NextResponse.json(
      { error: 'Erro interno ao processar a pergunta. Tente novamente.' },
      { status: 500 }
    )
  }
}
