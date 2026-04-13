/**
 * Supabase Admin Client (for scripts running outside Next.js)
 *
 * Uses service role key to bypass RLS. Reads env vars from .env.local via dotenv.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// Load .env.local (Next.js convention)
config({ path: resolve(process.cwd(), '.env.local') })
// Fallback to .env
config({ path: resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL in environment')
}

// Service role key is required for live operations but optional for dry-run
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  serviceRoleKey || anonKey,
  { auth: { persistSession: false } }
)
