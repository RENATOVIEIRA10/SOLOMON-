import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhoneBR } from '../../src/lib/phone'

test('celular com mascara vira E.164', () => {
  assert.equal(normalizePhoneBR('(11) 98765-4321'), '+5511987654321')
})
test('ja em E.164 passa direto', () => {
  assert.equal(normalizePhoneBR('+5511987654321'), '+5511987654321')
})
test('com 55 sem + ganha o +', () => {
  assert.equal(normalizePhoneBR('5511987654321'), '+5511987654321')
})
test('fixo 10 digitos e valido', () => {
  assert.equal(normalizePhoneBR('11 3456-7890'), '+551134567890')
})
test('curto demais e null', () => {
  assert.equal(normalizePhoneBR('98765'), null)
})
test('vazio e null', () => {
  assert.equal(normalizePhoneBR('  '), null)
})
