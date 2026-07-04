/**
 * Decisão pura de transição de billing_status a partir de um evento do webhook Asaas.
 * Extraído da rota para permitir TDD sem mockar Supabase/WhatsApp — ver Fix 4 da wave T7.
 */
export interface TransitionInput {
  eventType: string
  currentOverdueSince: string | null
  nowISO: string
  /** Plano contratado no checkout público (T13) — aplicado no 1o pagamento confirmado, depois limpo. */
  pendingPlan?: string | null
}

export interface TransitionResult {
  update: {
    billing_status: string
    overdue_since: string | null
    billing_updated_at: string
    plan?: string
    pending_plan?: null
  } | null
  notify: boolean
}

export function decideWebhookTransition(input: TransitionInput): TransitionResult {
  const { eventType, currentOverdueSince, nowISO, pendingPlan } = input

  if (eventType === 'PAYMENT_CONFIRMED' || eventType === 'PAYMENT_RECEIVED') {
    return {
      update: {
        billing_status: 'active',
        overdue_since: null,
        billing_updated_at: nowISO,
        ...(pendingPlan ? { plan: pendingPlan, pending_plan: null } : {}),
      },
      notify: false,
    }
  }

  if (eventType === 'PAYMENT_OVERDUE') {
    const isFirstOverdue = currentOverdueSince === null
    return {
      update: {
        billing_status: 'overdue',
        overdue_since: isFirstOverdue ? nowISO : currentOverdueSince,
        billing_updated_at: nowISO,
      },
      notify: isFirstOverdue,
    }
  }

  return { update: null, notify: false }
}
