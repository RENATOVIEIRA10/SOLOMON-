/**
 * POST /api/ask
 *
 * Main SOLOMON query endpoint.
 * Body: { question: string, insurer?: string, history?: Array<{role, content}> }
 * Response: { answer, citations, model, latencyMs }
 */

import { NextRequest, NextResponse } from 'next/server'
import { ask } from '@/services/rag/answer'

interface AskRequestBody {
  question: string
  insurer?: string
  brokerId?: string
  channel?: 'whatsapp' | 'dashboard' | 'api'
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

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

    const result = await ask(body.question.trim(), {
      brokerId: body.brokerId,
      channel: body.channel ?? 'api',
      insurerFilter: body.insurer,
      conversationHistory: body.history,
    })

    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
      conversationId: result.conversationId,
    })
  } catch (error) {
    console.error('[api/ask] Error:', error)

    return NextResponse.json(
      { error: 'Erro interno ao processar a pergunta. Tente novamente.' },
      { status: 500 }
    )
  }
}
