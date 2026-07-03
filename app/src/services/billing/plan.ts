/** Carência de inadimplência (dias). Enforcement on-read — sem cron. */
export const GRACE_DAYS = 5

export interface BillingView {
  plan: string
  billing_status: string | null
  overdue_since: string | null
}

/** Plano efetivo considerando inadimplência com carência. Falha aberto em dado inconsistente. */
export function effectivePlanId(b: BillingView, now: Date = new Date()): string {
  if (b.billing_status !== 'overdue' || !b.overdue_since) return b.plan
  const overdueMs = now.getTime() - new Date(b.overdue_since).getTime()
  return overdueMs > GRACE_DAYS * 864e5 ? 'free' : b.plan
}

/** True quando o rebaixamento on-read está ativo E o plano nominal não era free. */
export function needsDowngradeNotice(b: BillingView, now: Date = new Date()): boolean {
  return b.plan !== 'free' && effectivePlanId(b, now) === 'free'
}
