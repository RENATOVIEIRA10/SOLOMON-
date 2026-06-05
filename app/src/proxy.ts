/**
 * Auth proxy (Phase 5.2 - minimal auth).
 *
 * Two jobs:
 *  1. Refresh the Supabase auth session cookie on navigation (@supabase/ssr).
 *  2. Gate dashboard page routes: unauthenticated or non-allowlisted visitors
 *     hitting protected app pages are redirected to /login.
 *
 * Scope: PAGE routes only. API routes self-enforce auth (401/403) so the
 * Ragas eval harness and WhatsApp webhook, which call APIs without a browser
 * session, keep working. The matcher therefore excludes /api.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/** URL prefixes that require a session. */
const PROTECTED_PREFIXES = [
  '/app',
  '/chat',
  '/clientes',
  '/comparador',
  '/base',
  '/alertas',
  '/perfil',
  '/pre-sinistro',
]

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  )
}

function allowlisted(email: string | null | undefined): boolean {
  const raw = process.env.PILOT_BROKER_ALLOWLIST ?? ''
  const list = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  if (list.length === 0) return true
  return !!email && list.includes(email.toLowerCase())
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  // getUser() revalidates with the Auth server; do not trust cookie alone.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (isProtected(pathname) && (!user || !allowlisted(user.email))) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    if (user && !allowlisted(user.email)) {
      loginUrl.searchParams.set('denied', '1')
    }
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  // Run on everything except API routes, Next internals and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)'],
}
