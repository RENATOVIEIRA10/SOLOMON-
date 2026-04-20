import { NextRequest, NextResponse } from 'next/server'
import { detectInsurers, resolveInsurerIds } from '@/services/rag/answer'
import { detectRateIntent, queryRateTable } from '@/services/rag/rate-lookup'

export async function GET() {
  return NextResponse.json({
    ok: true,
    marker: 'deploy-rev-3-post-fast-path-debug',
    builtAt: new Date().toISOString(),
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { question?: string }
    const q = (body.question ?? '').trim()
    if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 })

    const mentioned = detectInsurers(q)
    const intent =
      mentioned.length === 1 ? detectRateIntent(q, mentioned[0]) : { hasIntent: false }

    let resolvedIds: Record<string, string[]> = {}
    let rateRowCount = 0
    let firstRow: unknown = null

    if (mentioned.length === 1 && (intent as any).hasIntent) {
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
      question: q,
      mentionedInsurers: mentioned,
      rateIntent: intent,
      resolvedInsurerIds: resolvedIds,
      rateRowCount,
      firstRow,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
