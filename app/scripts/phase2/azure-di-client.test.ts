/**
 * Phase 2 / PR 3B slice 3B.1 — Azure DI client wrapper test.
 *
 * Standalone tsx test, exit code 0/1 (same pattern as the rag-audit
 * regression guards). Offline by default: every assertion runs against
 * an injected mock `fetch`, so it touches no network and needs no
 * credentials.
 *
 * Run from app/:
 *   npm run phase2:azure-di:client:test
 *   npm run phase2:azure-di:client:test -- --live   # one real call (needs creds)
 */

import { config as loadEnv } from 'dotenv'
import {
  AzureDiError,
  AzureDiLayoutClient,
  buildAnalyzeUrl,
  maskEndpoint,
  resolveAzureDiCredentials,
} from '../../src/services/azure-di/client'
import type { AnalyzeOperation } from '../../src/services/azure-di/types'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

let passed = 0
let failed = 0

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL ${label}`)
  }
}

async function expectThrows(
  label: string,
  fn: () => unknown | Promise<unknown>,
  check?: (err: unknown) => boolean
): Promise<void> {
  try {
    await fn()
    failed++
    console.error(`  FAIL ${label} — expected a throw`)
  } catch (err) {
    if (check && !check(err)) {
      failed++
      console.error(`  FAIL ${label} — threw, but check failed: ${String(err)}`)
      return
    }
    passed++
    console.log(`  ok  ${label}`)
  }
}

/** Builds a `fetch` stand-in that replays the given responses in order. */
function mockFetch(steps: Array<() => Response>): typeof fetch {
  let i = 0
  return (async () => {
    const step = steps[Math.min(i, steps.length - 1)]
    i++
    return step()
  }) as typeof fetch
}

const SUCCEEDED_OPERATION: AnalyzeOperation = {
  status: 'succeeded',
  analyzeResult: {
    apiVersion: '2024-11-30',
    modelId: 'prebuilt-layout',
    contentFormat: 'markdown',
    content: '# MOCK\n\nmock markdown body',
    pages: [{ pageNumber: 1, spans: [{ offset: 0, length: 22 }] }],
    paragraphs: [
      { content: 'MOCK', spans: [{ offset: 2, length: 4 }], role: 'title' },
    ],
  },
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

async function run(): Promise<void> {
  console.log('# azure-di client wrapper test (offline)')

  // --- resolveAzureDiCredentials ---
  console.log('\n## resolveAzureDiCredentials')
  ok(
    'reads primary env names',
    (() => {
      const c = resolveAzureDiCredentials({
        AZURE_DI_ENDPOINT: 'https://x.cognitiveservices.azure.com',
        AZURE_DI_KEY: 'k1',
      })
      return c.endpoint.includes('x.cognitiveservices') && c.key === 'k1'
    })()
  )
  ok(
    'reads accepted aliases',
    (() => {
      const c = resolveAzureDiCredentials({
        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: 'https://y.cognitiveservices.azure.com',
        AZURE_DOCUMENT_INTELLIGENCE_KEY: 'k2',
      })
      return c.endpoint.includes('y.cognitiveservices') && c.key === 'k2'
    })()
  )
  await expectThrows(
    'throws when credentials are missing',
    () => resolveAzureDiCredentials({}),
    (err) => err instanceof AzureDiError
  )

  // --- buildAnalyzeUrl ---
  console.log('\n## buildAnalyzeUrl')
  const url = buildAnalyzeUrl('https://r.cognitiveservices.azure.com/', '2024-11-30', {
    pages: '1-2',
  })
  ok('targets the prebuilt-layout :analyze path', url.includes('/documentintelligence/documentModels/prebuilt-layout:analyze'))
  ok('strips the trailing slash from the endpoint', !url.includes('.com//documentintelligence'))
  ok('sets api-version', url.includes('api-version=2024-11-30'))
  ok('defaults outputContentFormat to markdown', url.includes('outputContentFormat=markdown'))
  ok('passes the pages selection', url.includes('pages=1-2'))
  ok(
    'omits pages when not provided',
    !buildAnalyzeUrl('https://r.cognitiveservices.azure.com', '2024-11-30').includes('pages=')
  )

  // --- maskEndpoint ---
  console.log('\n## maskEndpoint')
  ok(
    'masks the resource subdomain',
    maskEndpoint('https://rgsolomon.cognitiveservices.azure.com') ===
      'https://***.cognitiveservices.azure.com'
  )
  ok('handles a missing endpoint', maskEndpoint('') === '(missing)')

  // --- AzureDiLayoutClient (mock fetch) ---
  console.log('\n## AzureDiLayoutClient — happy path')
  {
    const client = new AzureDiLayoutClient({
      endpoint: 'https://r.cognitiveservices.azure.com',
      key: 'k',
      pollIntervalMs: 1,
      timeoutMs: 2000,
      fetchImpl: mockFetch([
        () =>
          new Response(null, {
            status: 202,
            headers: { 'operation-location': 'https://r.cognitiveservices.azure.com/op/1' },
          }),
        () => jsonResponse(SUCCEEDED_OPERATION, 200),
      ]),
    })
    const result = await client.analyzeUrlSource('https://example.com/doc.pdf', {
      pages: '1-2',
    })
    ok('returns the typed analyzeResult content', result.content === '# MOCK\n\nmock markdown body')
    ok('returns pages', result.pages.length === 1 && result.pages[0].pageNumber === 1)
    ok('returns paragraphs with roles', result.paragraphs?.[0].role === 'title')
    ok('exposes a masked endpoint', client.maskedEndpoint === 'https://***.cognitiveservices.azure.com')
  }

  console.log('\n## AzureDiLayoutClient — error paths')
  await expectThrows(
    'throws AzureDiError on a non-2xx submit',
    async () => {
      const client = new AzureDiLayoutClient({
        endpoint: 'https://r.cognitiveservices.azure.com',
        key: 'k',
        pollIntervalMs: 1,
        fetchImpl: mockFetch([
          () => jsonResponse({ error: { code: 'InvalidRequest', message: 'bad input' } }, 400),
        ]),
      })
      await client.analyzeUrlSource('https://example.com/doc.pdf')
    },
    (err) => err instanceof AzureDiError && err.statusCode === 400 && err.code === 'InvalidRequest'
  )
  await expectThrows(
    'throws when operation-location header is absent',
    async () => {
      const client = new AzureDiLayoutClient({
        endpoint: 'https://r.cognitiveservices.azure.com',
        key: 'k',
        pollIntervalMs: 1,
        fetchImpl: mockFetch([() => new Response(null, { status: 202 })]),
      })
      await client.analyzeUrlSource('https://example.com/doc.pdf')
    },
    (err) => err instanceof AzureDiError
  )
  await expectThrows(
    'throws when the operation reports failed',
    async () => {
      const client = new AzureDiLayoutClient({
        endpoint: 'https://r.cognitiveservices.azure.com',
        key: 'k',
        pollIntervalMs: 1,
        fetchImpl: mockFetch([
          () =>
            new Response(null, {
              status: 202,
              headers: { 'operation-location': 'https://r.cognitiveservices.azure.com/op/1' },
            }),
          () =>
            jsonResponse(
              { status: 'failed', error: { code: 'InternalError', message: 'parser crashed' } },
              200
            ),
        ]),
      })
      await client.analyzeUrlSource('https://example.com/doc.pdf')
    },
    (err) => err instanceof AzureDiError && err.code === 'InternalError'
  )
  await expectThrows(
    'throws when succeeded but analyzeResult is missing',
    async () => {
      const client = new AzureDiLayoutClient({
        endpoint: 'https://r.cognitiveservices.azure.com',
        key: 'k',
        pollIntervalMs: 1,
        fetchImpl: mockFetch([
          () =>
            new Response(null, {
              status: 202,
              headers: { 'operation-location': 'https://r.cognitiveservices.azure.com/op/1' },
            }),
          () => jsonResponse({ status: 'succeeded' }, 200),
        ]),
      })
      await client.analyzeUrlSource('https://example.com/doc.pdf')
    },
    (err) => err instanceof AzureDiError
  )

  // --- Optional live smoke (opt-in, needs real credentials) ---
  if (process.argv.includes('--live')) {
    console.log('\n## live smoke (real Azure DI call)')
    const client = new AzureDiLayoutClient()
    const liveResult = await client.analyzeUrlSource(
      'https://www.bradescoseguros.com.br/wcm/connect/27d3efc8-319b-48d5-ba61-0269f0d6a5a2/Condi%C3%A7%C3%B5es_Gerais_Vida_Viva_Corretor_Maio24.pdf?MOD=AJPERES',
      { pages: '1-2' }
    )
    ok('live: returns non-empty content', liveResult.content.length > 0)
    ok('live: returns at least one page', liveResult.pages.length >= 1)
    console.log(`  endpoint=${client.maskedEndpoint} pages=${liveResult.pages.length} chars=${liveResult.content.length}`)
  } else {
    console.log('\n(skipping live smoke — pass --live to run one real Azure DI call)')
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('[azure-di-client.test] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
