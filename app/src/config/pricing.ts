/**
 * SSoT de preços do checkout público (T13/T14). Qualquer alteração de valor
 * ou descrição da assinatura Asaas deve partir daqui — não hardcodar em
 * outro lugar (regra "um dado, um path").
 */
export const PRICING = {
  mensal: { valueBRL: 149, label: 'Mensal', description: 'SOLOMON — assinatura mensal' },
  anual: {
    valueBRL: 99,
    label: 'Anual (12x)',
    description: 'SOLOMON — plano anual (12x)',
    maxPayments: 12,
  },
} as const

export type BillingOption = keyof typeof PRICING
