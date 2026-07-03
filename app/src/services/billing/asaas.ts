/**
 * Cliente fino da API Asaas v3 (sandbox e prod via ASAAS_BASE_URL).
 * Docs: https://docs.asaas.com — customers, subscriptions.
 * billingType UNDEFINED = o corretor escolhe Pix/boleto/cartão na fatura hospedada.
 */
const BASE = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3'

async function asaas<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.ASAAS_API_KEY
  if (!key) throw new Error('ASAAS_API_KEY ausente')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', access_token: key, ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const desc = body?.errors?.[0]?.description ?? `HTTP ${res.status}`
    throw new Error(`Asaas ${path}: ${desc}`)
  }
  return body as T
}

export async function createAsaasSubscription(
  broker: { id: string; name: string; email: string | null; phone: string; asaas_customer_id: string | null },
  valueBRL: number
): Promise<{ customerId: string; subscriptionId: string; invoiceUrl: string | null }> {
  let customerId = broker.asaas_customer_id
  if (!customerId) {
    const customer = await asaas<{ id: string }>('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: broker.name,
        email: broker.email ?? undefined,
        mobilePhone: broker.phone.replace('+55', ''),
        externalReference: broker.id,
      }),
    })
    customerId = customer.id
  }
  const nextDueDate = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) // 3 dias p/ 1a fatura
  const sub = await asaas<{ id: string }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'UNDEFINED',
      cycle: 'MONTHLY',
      value: valueBRL,
      nextDueDate,
      description: 'SOLOMON — assinatura do piloto',
      externalReference: broker.id,
    }),
  })
  // 1a cobrança da assinatura carrega a invoiceUrl
  const payments = await asaas<{ data: Array<{ invoiceUrl?: string }> }>(`/subscriptions/${sub.id}/payments`)
  return { customerId, subscriptionId: sub.id, invoiceUrl: payments.data?.[0]?.invoiceUrl ?? null }
}
