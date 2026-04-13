/**
 * WhatsApp Conversation Session Manager
 *
 * In-memory session store keyed by phone number.
 * TTL: 30 minutes of inactivity. Expired sessions are cleaned up periodically.
 */

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes
const MAX_MESSAGES_PER_SESSION = 20

export interface Session {
  phone: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  lastActivity: number
  brokerId?: string
}

/** In-memory session store */
const sessions = new Map<string, Session>()

/**
 * Get or create a session for the given phone number.
 * Expired sessions are recreated fresh.
 */
export function getSession(phone: string): Session {
  const existing = sessions.get(phone)

  if (existing) {
    // Check TTL
    if (Date.now() - existing.lastActivity > SESSION_TTL_MS) {
      // Session expired — start fresh but keep brokerId
      const fresh: Session = {
        phone,
        messages: [],
        lastActivity: Date.now(),
        brokerId: existing.brokerId,
      }
      sessions.set(phone, fresh)
      return fresh
    }
    return existing
  }

  // New session
  const session: Session = {
    phone,
    messages: [],
    lastActivity: Date.now(),
  }
  sessions.set(phone, session)
  return session
}

/**
 * Add a message to a session and update lastActivity.
 * Trims old messages to keep context window manageable.
 */
export function addMessage(phone: string, role: 'user' | 'assistant', content: string): void {
  const session = getSession(phone)
  session.messages.push({ role, content })
  session.lastActivity = Date.now()

  // Keep only the last N messages for context window
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION)
  }
}

/**
 * Set the broker ID for a session (after phone lookup).
 */
export function setBrokerId(phone: string, brokerId: string): void {
  const session = getSession(phone)
  session.brokerId = brokerId
}

/**
 * Clear all expired sessions. Call periodically.
 */
export function clearExpiredSessions(): void {
  const now = Date.now()
  for (const [phone, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(phone)
    }
  }
}

// Run cleanup every 5 minutes
setInterval(clearExpiredSessions, 5 * 60 * 1000).unref()
