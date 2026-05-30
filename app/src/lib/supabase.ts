import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function getSupabaseUrl(): string {
  return getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
}

function getSupabaseAnonKey(): string {
  return getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

// Client-side (browser): uses anon key and respects RLS. Kept lazy so server
// route imports do not require Supabase env vars during Next page-data build.
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = createClient<Database>(getSupabaseUrl(), getSupabaseAnonKey())
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

// Server-side: uses service role and bypasses RLS.
export function createServiceClient() {
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient<Database>(getSupabaseUrl(), serviceRoleKey, {
    auth: { persistSession: false },
  })
}
