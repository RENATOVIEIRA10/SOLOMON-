import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Troca o code do link de convite/reset por sessao e segue o next.
 *
 * Usa `request.nextUrl` (NextURL, tem `.clone()`) em vez de `new URL(request.url)`
 * (URL nativa NAO tem `.clone()` — lancaria TypeError em runtime).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/app'
  const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/app' // só caminhos internos; '//' seria protocol-relative (open redirect)

  if (code) {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      const login = url.clone()
      login.pathname = '/login'
      login.search = '?invite_error=1'
      return NextResponse.redirect(login)
    }
  }
  const destUrl = url.clone()
  destUrl.pathname = dest
  destUrl.search = ''
  return NextResponse.redirect(destUrl)
}
