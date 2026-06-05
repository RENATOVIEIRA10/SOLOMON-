import { createServiceClient } from '@/lib/supabase'
import type { Json } from '@/types/database'

export const PRODUCT_ANALYTICS_EVENTS = {
  brokerProfileBootstrapped: 'broker_profile_bootstrapped',
  brokerProfileUpdated: 'broker_profile_updated',
  sessionStarted: 'session_started',
  conversationStarted: 'conversation_started',
  conversationCompleted: 'conversation_completed',
  comparisonStarted: 'comparison_started',
  comparisonCompleted: 'comparison_completed',
  preSinistroAnalysisStarted: 'pre_sinistro_analysis_started',
  preSinistroAnalysisCompleted: 'pre_sinistro_analysis_completed',
  clientCreated: 'client_created',
  clientUpdated: 'client_updated',
  clientDeleted: 'client_deleted',
  feedbackSubmitted: 'feedback_submitted',
  quotaExceeded: 'quota_exceeded',
  upgradeViewed: 'upgrade_viewed',
  upgradeStarted: 'upgrade_started',
  upgradeCompleted: 'upgrade_completed',
  paymentFailed: 'payment_failed',
  subscriptionCanceled: 'subscription_canceled',
} as const

export type ProductAnalyticsEvent =
  (typeof PRODUCT_ANALYTICS_EVENTS)[keyof typeof PRODUCT_ANALYTICS_EVENTS]

type ProductAnalyticsProperties = Record<string, Json | undefined>

interface TrackProductEventParams {
  eventName: ProductAnalyticsEvent
  brokerId?: string | null
  authUserId?: string | null
  source?: string
  properties?: ProductAnalyticsProperties
}

const BLOCKED_PROPERTY_KEYS = new Set([
  'question',
  'prompt',
  'description',
  'cpf',
  'phone',
  'email',
  'name',
  'notes',
  'comment',
])

export async function trackProductEvent(params: TrackProductEventParams): Promise<void> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('product_analytics_events').insert({
      broker_id: params.brokerId ?? null,
      auth_user_id: params.authUserId ?? null,
      event_name: params.eventName,
      source: params.source ?? 'server',
      properties: sanitizeProperties(params.properties ?? {}),
    })

    if (error) {
      console.warn('[product-analytics] insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[product-analytics] insert failed:', err)
  }
}

export function bucketTextLength(value: string): string {
  const length = value.trim().length
  if (length < 50) return '0_49'
  if (length < 150) return '50_149'
  if (length < 500) return '150_499'
  if (length < 1000) return '500_999'
  return '1000_plus'
}

export function quotaRemaining(queriesToday: number, queriesPerDay: number): number | 'unlimited' {
  if (queriesPerDay === -1) return 'unlimited'
  return Math.max(0, queriesPerDay - queriesToday)
}

function sanitizeProperties(properties: ProductAnalyticsProperties): Record<string, Json> {
  const sanitized: Record<string, Json> = {}

  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || BLOCKED_PROPERTY_KEYS.has(key.toLowerCase())) continue
    sanitized[key] = value
  }

  return sanitized
}
