/**
 * Server-side Supabase client bound to the request cookies (auth session).
 *
 * Uses the ANON key + @supabase/ssr so it carries the authenticated user's
 * session from cookies. This is the client used to READ the verified identity
 * (auth.getUser()) on the server. It is NOT a replacement for
 * `createServiceClient()` — service-role data access stays in `@/lib/supabase`.
 *
 * Phase 5.2 (minimal auth): introduced to derive broker identity from the
 * session instead of trusting a client-supplied brokerId.
 */

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Creates a request-scoped Supabase client that reads/writes the auth cookies.
 * Call inside Route Handlers and Server Components (cookies() is async in
 * Next 15+/16). Cookie writes are best-effort: in pure Server Components the
 * store is read-only and setAll throws — we swallow it (session refresh then
 * happens in middleware).
 */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component (read-only cookie store). Safe to
          // ignore — middleware refreshes the session cookie on navigation.
        }
      },
    },
  })
}
