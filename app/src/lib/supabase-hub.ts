import { createClient } from '@supabase/supabase-js'

export function createHubClient() {
  const url = process.env.MANAGED_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.MANAGED_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabase client parameters url and key are required.')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
