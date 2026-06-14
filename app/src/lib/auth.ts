/**
 * Server-side auth helpers (Phase 5.2 — minimal auth).
 *
 * THE security boundary for SOLOMON's data APIs. Before 5.2 every data route
 * trusted a `brokerId` query/body param while running with the service-role
 * key (RLS bypass) — a textbook IDOR (any UUID = any broker's data). These
 * helpers replace that with a broker identity DERIVED FROM THE VERIFIED
 * SESSION. The route must never again read brokerId from the client.
 *
 * Identity model:
 *   - `authUserId` is Supabase `auth.users.id`.
 *   - `brokerId` is the product row id in `brokers.id`, used by product data
 *     tables such as conversations, clients, alerts and claim_analyses.
 *   - Both are derived from the verified session, never from the request.
 *
 * Allowlist (pilot): optional env `PILOT_BROKER_ALLOWLIST` (comma-separated
 * lowercase emails). When set, only those emails may use the app; when unset,
 * any authenticated user is allowed (so the pilot isn't locked out before the
 * env is configured). Account creation itself should be admin-only (disable
 * public signups in Supabase Auth) — that is the first line of the allowlist.
 *
 * Admin gate (Phase 9.1 — eval trigger): opt-in via `SOLOMON_ADMIN_EMAILS`
 * (comma-separated lowercase emails). When unset, NO ONE is admin (fail-safe
 * closed — the opposite of the pilot allowlist). Triggers costly VPS processes.
 */

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase'

export interface AuthUser {
  id: string
  email: string | null
}

export interface BrokerContext {
  authUserId: string
  brokerId: string
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

export async function getOptionalBrokerContext(): Promise<BrokerContext | null> {
  const user = await getAuthUser()
  if (!user || !isAllowlisted(user.email)) return null
  const brokerId = await getBrokerRowId(user.id)
  if (!brokerId) return null
  return { authUserId: user.id, brokerId, email: user.email }
}

// ---------------------------------------------------------------------------
// Admin gate (Phase 9.1 — eval trigger)
// ---------------------------------------------------------------------------

/**
 * Parses SOLOMON_ADMIN_EMAILS into a lowercase email set.
 * Returns an EMPTY set when the env var is unset/blank (fail-safe closed).
 */
function adminEmails(): Set<string> {
  const raw = process.env.SOLOMON_ADMIN_EMAILS ?? ''
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * Returns true only when the email is explicitly present in SOLOMON_ADMIN_EMAILS.
 * When the env var is empty/unset, returns FALSE for everyone (opt-in, not opt-out).
 * This is intentionally stricter than isAllowlisted, which defaults to open.
 */
export function isAdmin(email: string | null): boolean {
  if (!email) return false
  const admins = adminEmails()
  if (admins.size === 0) return false
  return admins.has(email.toLowerCase())
}

/**
 * Requires a verified session from an admin user.
 * Returns {id, email} on success, or a NextResponse (401/403) to return as-is.
 *
 * Usage:
 *   const auth = await requireAdmin()
 *   if (auth instanceof NextResponse) return auth
 *   // auth.email is an admin
 */
export async function requireAdmin(): Promise<{ id: string; email: string } | NextResponse> {
  const user = await getAuthUser()
  if (!user) return unauthorized()
  // isAdmin(null) já retorna false, então um admin sempre tem email não-nulo
  // aqui. Checar !user.email explicitamente reflete esse invariante no tipo de
  // retorno (email: string) sem precisar do fallback inseguro `?? ''`, que
  // criava um estado logicamente impossível e gravaria requested_by=''.
  if (!user.email || !isAdmin(user.email)) return forbidden('admin only')
  return { id: user.id, email: user.email }
}

// ---------------------------------------------------------------------------

export async function requireBrokerContext(): Promise<BrokerContext | NextResponse> {
  const user = await getAuthUser()
  if (!user) return unauthorized()
  if (!isAllowlisted(user.email)) return forbidden('not in pilot allowlist')

  const brokerId = await getBrokerRowId(user.id)
  if (!brokerId) {
    return NextResponse.json(
      { error: 'broker not found - call /api/profile first' },
      { status: 404 }
    )
  }

  return { authUserId: user.id, brokerId, email: user.email }
}
