/**
 * Server-side auth helpers (Phase 5.2 — minimal auth).
 *
 * THE security boundary for SOLOMON's data APIs. Before 5.2 every data route
 * trusted a `brokerId` query/body param while running with the service-role
 * key (RLS bypass) — a textbook IDOR (any UUID = any broker's data). These
 * helpers replace that with a broker identity DERIVED FROM THE VERIFIED
 * SESSION. The route must never again read brokerId from the client.
 *
 * Identity model (unchanged semantics, new source):
 *   - `brokerId` historically meant the Supabase `auth.users.id`
 *     (stored as `brokers.auth_user_id`). We keep that meaning; we only change
 *     WHERE it comes from: the verified session, not the request.
 *
 * Allowlist (pilot): optional env `PILOT_BROKER_ALLOWLIST` (comma-separated
 * lowercase emails). When set, only those emails may use the app; when unset,
 * any authenticated user is allowed (so the pilot isn't locked out before the
 * env is configured). Account creation itself should be admin-only (disable
 * public signups in Supabase Auth) — that is the first line of the allowlist.
 */

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase'

export interface AuthUser {
  id: string
  email: string | null
}

export function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export function forbidden(message = 'forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

/** Parses PILOT_BROKER_ALLOWLIST into a lowercase email set (empty = allow all). */
function allowlist(): Set<string> {
  const raw = process.env.PILOT_BROKER_ALLOWLIST ?? ''
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/** True if the email passes the pilot allowlist (empty allowlist = everyone). */
export function isAllowlisted(email: string | null): boolean {
  const list = allowlist()
  if (list.size === 0) return true
  return email != null && list.has(email.toLowerCase())
}

/**
 * Verified user from the session cookie, or null. Uses getUser() (revalidates
 * with the Supabase Auth server) — never getSession() alone, which trusts the
 * unvalidated cookie.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return { id: data.user.id, email: data.user.email ?? null }
}

/**
 * Requires a verified, allowlisted session. Returns the auth user id
 * (== `brokerId` in the legacy data model), or a NextResponse (401/403) the
 * route should return as-is.
 *
 * Usage:
 *   const auth = await requireAuthUserId()
 *   if (auth instanceof NextResponse) return auth
 *   const brokerId = auth   // derived from session — NEVER from the request
 */
export async function requireAuthUserId(): Promise<string | NextResponse> {
  const user = await getAuthUser()
  if (!user) return unauthorized()
  if (!isAllowlisted(user.email)) return forbidden('not in pilot allowlist')
  return user.id
}

/** Optional session — for oracle routes (ask/stream) that also serve the eval
 * harness and must not 401 when unauthenticated. Returns the auth user id only
 * when there is a valid, allowlisted session; otherwise null (no attribution). */
export async function getOptionalAuthUserId(): Promise<string | null> {
  const user = await getAuthUser()
  if (!user || !isAllowlisted(user.email)) return null
  return user.id
}

/**
 * Resolves the `brokers.id` row id for a given auth user id, or null if the
 * broker row doesn't exist yet. Used by routes that key `broker_clients` by the
 * broker ROW id (not the auth user id).
 */
export async function getBrokerRowId(authUserId: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('brokers')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
