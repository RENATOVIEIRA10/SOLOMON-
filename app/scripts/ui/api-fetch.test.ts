import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { apiFetch, ApiError } from '../../src/lib/api'

type FetchArgs = { url: string; init?: RequestInit }
let lastCall: FetchArgs | null = null

function mockFetch(status: number, body: unknown, opts?: { invalidJson?: boolean; reject?: boolean }) {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    lastCall = { url: String(url), init }
    if (opts?.reject) throw new TypeError('fetch failed')
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (opts?.invalidJson) throw new SyntaxError('Unexpected token')
        return body
      },
    } as Response
  }) as typeof fetch
}

beforeEach(() => { lastCall = null })

test('retorna JSON tipado quando ok', async () => {
  mockFetch(200, { clients: [{ id: '1' }] })
  const data = await apiFetch<{ clients: { id: string }[] }>('/api/clients')
  assert.equal(data.clients[0].id, '1')
  assert.equal(lastCall?.url, '/api/clients')
})

test('lanca ApiError com mensagem do servidor em !ok', async () => {
  mockFetch(422, { error: 'Nome obrigatorio' })
  await assert.rejects(apiFetch('/api/clients'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.message, 'Nome obrigatorio')
    assert.equal(err.status, 422)
    return true
  })
})

test('lanca ApiError generico quando corpo nao e JSON', async () => {
  mockFetch(500, null, { invalidJson: true })
  await assert.rejects(apiFetch('/api/x'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 500)
    assert.match(err.message, /500/)
    return true
  })
})

test('falha de rede vira ApiError status 0', async () => {
  mockFetch(0, null, { reject: true })
  await assert.rejects(apiFetch('/api/x'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 0)
    return true
  })
})
