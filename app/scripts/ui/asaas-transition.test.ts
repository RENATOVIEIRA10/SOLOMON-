import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideWebhookTransition } from '../../src/services/billing/webhook-transition'

const NOW = '2026-07-10T12:00:00.000Z'
const OVERDUE_SINCE = '2026-07-05T09:00:00.000Z'

test('PAYMENT_CONFIRMED reativa e limpa overdue_since', () => {
  const result = decideWebhookTransition({ eventType: 'PAYMENT_CONFIRMED', currentOverdueSince: OVERDUE_SINCE, nowISO: NOW })
  assert.deepEqual(result, {
    update: { billing_status: 'active', overdue_since: null, billing_updated_at: NOW },
    notify: false,
  })
})

test('PAYMENT_RECEIVED reativa e limpa overdue_since', () => {
  const result = decideWebhookTransition({ eventType: 'PAYMENT_RECEIVED', currentOverdueSince: null, nowISO: NOW })
  assert.deepEqual(result, {
    update: { billing_status: 'active', overdue_since: null, billing_updated_at: NOW },
    notify: false,
  })
})

test('PAYMENT_OVERDUE pela primeira vez seta overdue_since = now e notifica', () => {
  const result = decideWebhookTransition({ eventType: 'PAYMENT_OVERDUE', currentOverdueSince: null, nowISO: NOW })
  assert.deepEqual(result, {
    update: { billing_status: 'overdue', overdue_since: NOW, billing_updated_at: NOW },
    notify: true,
  })
})

test('PAYMENT_OVERDUE repetido preserva overdue_since original e nao notifica', () => {
  const result = decideWebhookTransition({ eventType: 'PAYMENT_OVERDUE', currentOverdueSince: OVERDUE_SINCE, nowISO: NOW })
  assert.deepEqual(result, {
    update: { billing_status: 'overdue', overdue_since: OVERDUE_SINCE, billing_updated_at: NOW },
    notify: false,
  })
  assert.notEqual(result.update?.overdue_since, NOW)
})

test('evento desconhecido nao gera update nem notificacao', () => {
  const result = decideWebhookTransition({ eventType: 'PAYMENT_DELETED', currentOverdueSince: null, nowISO: NOW })
  assert.deepEqual(result, { update: null, notify: false })
})

test('nomes de evento sao case-exact — lowercase nao casa', () => {
  const result = decideWebhookTransition({ eventType: 'payment_confirmed', currentOverdueSince: null, nowISO: NOW })
  assert.deepEqual(result, { update: null, notify: false })
})

test('PAYMENT_CONFIRMED com pendingPlan aplica o plano e limpa pending_plan', () => {
  const result = decideWebhookTransition({
    eventType: 'PAYMENT_CONFIRMED',
    currentOverdueSince: null,
    nowISO: NOW,
    pendingPlan: 'corretor',
  })
  assert.deepEqual(result, {
    update: { billing_status: 'active', overdue_since: null, billing_updated_at: NOW, plan: 'corretor', pending_plan: null },
    notify: false,
  })
})

test('PAYMENT_CONFIRMED sem pendingPlan nao inclui campos de plano no update', () => {
  const result = decideWebhookTransition({
    eventType: 'PAYMENT_CONFIRMED',
    currentOverdueSince: null,
    nowISO: NOW,
    pendingPlan: null,
  })
  assert.deepEqual(result, {
    update: { billing_status: 'active', overdue_since: null, billing_updated_at: NOW },
    notify: false,
  })
  assert.ok(!('plan' in (result.update ?? {})))
  assert.ok(!('pending_plan' in (result.update ?? {})))
})
