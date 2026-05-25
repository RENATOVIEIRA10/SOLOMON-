/**
 * GET/POST /auth/signout — clears the Supabase auth session and redirects to
 * /login. Phase 5.2 (minimal auth).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

async function handle(request: NextRequest) {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
