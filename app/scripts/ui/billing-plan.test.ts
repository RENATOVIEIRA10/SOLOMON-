import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePlanId, needsDowngradeNotice, GRACE_DAYS } from '../../src/services/billing/plan'

const NOW = new Date('2026-07-10T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString()

test('ativo mantem o plano', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'active', overdue_since: null }, NOW), 'corretor')
})
test('overdue dentro da carencia mantem o plano', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(3) }, NOW), 'corretor')
})
test('overdue alem da carencia vira free', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(GRACE_DAYS + 1) }, NOW), 'free')
})
test('sem billing (null) mantem o plano — pilotos manuais continuam funcionando', () => {
  assert.equal(effectivePlanId({ plan: 'consultor', billing_status: null, overdue_since: null }, NOW), 'consultor')
})
test('overdue sem overdue_since nao rebaixa (dado inconsistente falha aberto)', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'overdue', overdue_since: null }, NOW), 'corretor')
})
test('needsDowngradeNotice so quando rebaixado', () => {
  assert.equal(needsDowngradeNotice({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(6) }, NOW), true)
  assert.equal(needsDowngradeNotice({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(2) }, NOW), false)
  assert.equal(needsDowngradeNotice({ plan: 'free', billing_status: 'overdue', overdue_since: daysAgo(6) }, NOW), false)
})
