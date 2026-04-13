/**
 * POST /api/search
 *
 * Direct semantic search endpoint for debugging and dashboard.
 * Body: { query: string, topK?: number, insurer?: string, sourceType?: string }
 * Response: { results: SearchResult[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { semanticSearch } from '@/services/rag/search'

interface SearchRequestBody {
  query: string
  topK?: number
  insurer?: string
  sourceType?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SearchRequestBody

    // Validate input
    if (!body.query || typeof body.query !== 'string') {
      return NextResponse.json(
        { error: 'Campo "query" e obrigatorio e deve ser uma string.' },
        { status: 400 }
      )
    }

    if (body.query.trim().length < 3) {
      return NextResponse.json(
        { error: 'A query deve ter pelo menos 3 caracteres.' },
        { status: 400 }
      )
    }

    const topK = body.topK && body.topK > 0 && body.topK <= 20 ? body.topK : undefined

    const results = await semanticSearch(body.query.trim(), {
      topK,
      insurerId: body.insurer,
      sourceType: body.sourceType,
    })

    return NextResponse.json({ results })
  } catch (error) {
    console.error('[api/search] Error:', error)

    return NextResponse.json(
      { error: 'Erro interno na busca semantica. Tente novamente.' },
      { status: 500 }
    )
  }
}
