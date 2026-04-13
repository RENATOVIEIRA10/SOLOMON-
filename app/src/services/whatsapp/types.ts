/**
 * WhatsApp Bot — Common types for all providers
 *
 * Provider-agnostic message interfaces used across Kapso, Evolution API, Z-API, etc.
 */

export interface IncomingMessage {
  /** Phone number in E.164 format (e.g. +5511999998888) */
  from: string
  /** Message text body */
  body: string
  /** Provider-specific message ID */
  messageId: string
  /** Unix timestamp (seconds) */
  timestamp: number
  /** Message type */
  type: 'text' | 'image' | 'document' | 'audio'
  /** URL for media attachments (images, documents, audio) */
  mediaUrl?: string
}

export interface OutgoingMessage {
  /** Phone number in E.164 format */
  to: string
  /** Message text body */
  body: string
  /** URL for media to send (e.g. PDF reports) */
  mediaUrl?: string
}

export type WhatsAppProvider = 'kapso' | 'evolution' | 'zapi'
