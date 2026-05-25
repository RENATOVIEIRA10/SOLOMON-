/**
 * Browser-side Supabase client (@supabase/ssr) — manages the auth session in
 * cookies so the server can read it. Used by client components for the login
 * flow and to read the current user id.
 *
 * Phase 5.2 (minimal auth).
 */

'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export function createBrowserSupabase() {
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}
