/**
 * Task 8: PRE_SINISTRO_ENABLED feature flag — isPreSinistroEnabled() unit tests.
 *
 * Default-OFF is the whole point: trilho pre-sinistro fica gated ate
 * promocao formal (decisao CEO, legalmente fora do piloto). Este teste
 * garante que unset/"false"/lixo == OFF e SO "true" liga o trilho.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/pre-sinistro-flag.test.ts
 */

import assert from 'node:assert/strict'
import { isPreSinistroEnabled } from '@/config/constants'

let passed = 0
let failed = 0

function check(label: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ok  ${label}`)
  } catch (err) {
    failed++
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`  FAIL  ${label} (${detail})`)
  }
}

/** Runs fn with PRE_SINISTRO_ENABLED set to `value` (undefined = unset), then restores. */
function withEnv(value: string | undefined, fn: () => void): void {
  const original = process.env.PRE_SINISTRO_ENABLED
  if (value === undefined) delete process.env.PRE_SINISTRO_ENABLED
  else process.env.PRE_SINISTRO_ENABLED = value
  try {
    fn()
  } finally {
    if (original === undefined) delete process.env.PRE_SINISTRO_ENABLED
    else process.env.PRE_SINISTRO_ENABLED = original
  }
}

console.log('\n## isPreSinistroEnabled — default OFF, explicit "true" only')

withEnv(undefined, () => {
  check('unset -> false (default OFF)', () => assert.equal(isPreSinistroEnabled(), false))
})

withEnv('true', () => {
  check('"true" -> true', () => assert.equal(isPreSinistroEnabled(), true))
})

withEnv('false', () => {
  check('"false" -> false', () => assert.equal(isPreSinistroEnabled(), false))
})

withEnv('1', () => {
  check('"1" -> false (nao e "true" literal)', () => assert.equal(isPreSinistroEnabled(), false))
})

withEnv('TRUE', () => {
  check('"TRUE" (uppercase) -> false (comparacao estrita)', () => assert.equal(isPreSinistroEnabled(), false))
})

withEnv('yes', () => {
  check('"yes" (lixo) -> false', () => assert.equal(isPreSinistroEnabled(), false))
})

withEnv('', () => {
  check('"" (string vazia) -> false', () => assert.equal(isPreSinistroEnabled(), false))
})

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('passed')
