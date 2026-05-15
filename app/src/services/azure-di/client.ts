/**
 * Azure Document Intelligence — prebuilt-layout client wrapper.
 *
 * A typed wrapper over the Layout REST API (version `2024-11-30`):
 * submit a document, poll the long-running operation, return the typed
 * `LayoutAnalyzeResult`. The PR 3A probe proved this REST flow works on
 * the provisioned S0 resource; this slice (3B.1) extracts it into a
 * reusable, typed module that later slices (3B.2 semantic chunker) import.
 *
 * Phase 2 / PR 3B slice 3B.1.
 * Scope guardrails: no DB write, no read-path import, no re-ingestion,
 * no rate-lookup, no shadow set. This module only talks to Azure DI.
 */

import type {
  AnalyzeOperation,
  AzureDiErrorDetail,
  ContentFormat,
  LayoutAnalyzeResult,
} from './types'

const DEFAULT_API_VERSION = '2024-11-30'
const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 120_000
const LAYOUT_MODEL = 'prebuilt-layout'

/** Endpoint env var names: primary first, then accepted aliases. */
const ENDPOINT_ENV_NAMES = [
  'AZURE_DI_ENDPOINT',
  'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT',
] as const

/** Key env var names: primary first, then accepted aliases. */
const KEY_ENV_NAMES = ['AZURE_DI_KEY', 'AZURE_DOCUMENT_INTELLIGENCE_KEY'] as const

/**
 * Error raised for any Azure DI failure: a non-2xx HTTP response, a
 * missing `operation-location` header, a `failed`/`canceled` operation,
 * or a poll timeout. `body` carries the raw service payload when present.
 */
export class AzureDiError extends Error {
  readonly statusCode?: number
  readonly code?: string
  readonly body?: unknown

  constructor(
    message: string,
    detail: { statusCode?: number; code?: string; body?: unknown } = {}
  ) {
    super(message)
    this.name = 'AzureDiError'
    this.statusCode = detail.statusCode
    this.code = detail.code
    this.body = detail.body
  }
}

/** Resolved Azure DI access pair. */
export interface AzureDiCredentials {
  endpoint: string
  key: string
}

/** A read-only view of environment variables — `process.env` satisfies this. */
export type EnvSource = Record<string, string | undefined>

function firstEnvValue(
  names: readonly string[],
  env: EnvSource
): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (value && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/**
 * Resolves the Azure DI endpoint + key from environment variables,
 * accepting the documented aliases (`AZURE_DOCUMENT_INTELLIGENCE_*`).
 * Throws `AzureDiError` when either value is missing.
 */
export function resolveAzureDiCredentials(
  env: EnvSource = process.env
): AzureDiCredentials {
  const endpoint = firstEnvValue(ENDPOINT_ENV_NAMES, env)
  const key = firstEnvValue(KEY_ENV_NAMES, env)
  if (!endpoint || !key) {
    const missing = [
      !endpoint ? ENDPOINT_ENV_NAMES[0] : null,
      !key ? KEY_ENV_NAMES[0] : null,
    ]
      .filter(Boolean)
      .join(' + ')
    throw new AzureDiError(
      `Missing Azure DI credentials (${missing}). Set them from the provisioned resource.`
    )
  }
  return { endpoint, key }
}

/**
 * Masks the resource subdomain of an endpoint so it is safe to log.
 * `https://rgsolomon.cognitiveservices.azure.com` -> `https://***.cognitiveservices.azure.com`.
 */
export function maskEndpoint(endpoint: string): string {
  if (!endpoint) return '(missing)'
  try {
    const url = new URL(endpoint)
    const hostParts = url.hostname.split('.')
    if (hostParts.length > 1) {
      hostParts[0] = '***'
      return `${url.protocol}//${hostParts.join('.')}`
    }
    return `${url.protocol}//***`
  } catch {
    return endpoint.replace(/\/\/[^/]+/, '//***')
  }
}

/** Per-request analyze options. */
export interface AnalyzeOptions {
  /** 1-based page selection, e.g. `"1-2"` or `"1,3,5-7"`. Omit for all pages. */
  pages?: string
  /** Output format of `content`. Defaults to `markdown`. */
  outputContentFormat?: ContentFormat
}

/**
 * Builds the prebuilt-layout `:analyze` URL. Pure — exported for tests.
 */
export function buildAnalyzeUrl(
  endpoint: string,
  apiVersion: string,
  opts: AnalyzeOptions = {}
): string {
  const base = endpoint.replace(/\/+$/, '')
  const params = new URLSearchParams({ 'api-version': apiVersion })
  params.set('outputContentFormat', opts.outputContentFormat ?? 'markdown')
  if (opts.pages) params.set('pages', opts.pages)
  return `${base}/documentintelligence/documentModels/${LAYOUT_MODEL}:analyze?${params.toString()}`
}

/** Construction options for {@link AzureDiLayoutClient}. */
export interface AzureDiClientOptions {
  /** Endpoint override. Falls back to env resolution when omitted. */
  endpoint?: string
  /** Key override. Falls back to env resolution when omitted. */
  key?: string
  /** REST API version. Defaults to `2024-11-30`. */
  apiVersion?: string
  /** Poll interval in ms while the operation runs. Defaults to 2000. */
  pollIntervalMs?: number
  /** Hard timeout in ms for the whole analyze + poll cycle. Defaults to 120000. */
  timeoutMs?: number
  /** Injectable `fetch` (for tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function extractErrorDetail(body: unknown): AzureDiErrorDetail | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: AzureDiErrorDetail }).error
    if (error && typeof error === 'object') return error
  }
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Typed client for the Azure DI prebuilt-layout model. One instance is
 * reusable across documents; it holds credentials + config, not per-call
 * state.
 */
export class AzureDiLayoutClient {
  private readonly endpoint: string
  private readonly key: string
  private readonly apiVersion: string
  private readonly pollIntervalMs: number
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: AzureDiClientOptions = {}) {
    if (options.endpoint && options.key) {
      this.endpoint = options.endpoint
      this.key = options.key
    } else {
      const resolved = resolveAzureDiCredentials()
      this.endpoint = options.endpoint ?? resolved.endpoint
      this.key = options.key ?? resolved.key
    }
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    if (typeof this.fetchImpl !== 'function') {
      throw new AzureDiError(
        'No fetch implementation available. Pass options.fetchImpl on older runtimes.'
      )
    }
  }

  /** The masked endpoint, safe for logs. */
  get maskedEndpoint(): string {
    return maskEndpoint(this.endpoint)
  }

  /**
   * Analyzes a document referenced by a publicly reachable URL.
   * Submits the job, polls until it succeeds, returns the typed result.
   */
  async analyzeUrlSource(
    url: string,
    opts: AnalyzeOptions = {}
  ): Promise<LayoutAnalyzeResult> {
    return this.analyze({ urlSource: url }, opts)
  }

  /**
   * Analyzes a document passed as raw bytes (the service receives them
   * base64-encoded via `base64Source`).
   */
  async analyzeBytes(
    bytes: Uint8Array,
    opts: AnalyzeOptions = {}
  ): Promise<LayoutAnalyzeResult> {
    const base64Source = Buffer.from(bytes).toString('base64')
    return this.analyze({ base64Source }, opts)
  }

  private async analyze(
    body: Record<string, unknown>,
    opts: AnalyzeOptions
  ): Promise<LayoutAnalyzeResult> {
    const operationLocation = await this.startAnalyze(body, opts)
    return this.pollOperation(operationLocation)
  }

  private async startAnalyze(
    body: Record<string, unknown>,
    opts: AnalyzeOptions
  ): Promise<string> {
    const url = buildAnalyzeUrl(this.endpoint, this.apiVersion, opts)
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': this.key,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const payload = await readJsonOrText(response)
      const detail = extractErrorDetail(payload)
      throw new AzureDiError(
        detail?.message ??
          `Azure DI analyze request failed with HTTP ${response.status}`,
        { statusCode: response.status, code: detail?.code, body: payload }
      )
    }

    const operationLocation = response.headers.get('operation-location')
    if (!operationLocation) {
      throw new AzureDiError(
        'Azure DI response did not include an operation-location header',
        { statusCode: response.status }
      )
    }
    return operationLocation
  }

  private async pollOperation(
    operationLocation: string
  ): Promise<LayoutAnalyzeResult> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < this.timeoutMs) {
      await sleep(this.pollIntervalMs)

      const response = await this.fetchImpl(operationLocation, {
        method: 'GET',
        headers: { 'Ocp-Apim-Subscription-Key': this.key },
      })
      const payload = await readJsonOrText(response)

      if (!response.ok) {
        const detail = extractErrorDetail(payload)
        throw new AzureDiError(
          detail?.message ?? `Azure DI poll failed with HTTP ${response.status}`,
          { statusCode: response.status, code: detail?.code, body: payload }
        )
      }

      const operation = payload as AnalyzeOperation
      if (operation.status === 'succeeded') {
        if (!operation.analyzeResult) {
          throw new AzureDiError(
            'Azure DI operation succeeded but returned no analyzeResult',
            { body: operation }
          )
        }
        return operation.analyzeResult
      }
      if (operation.status === 'failed' || operation.status === 'canceled') {
        throw new AzureDiError(
          operation.error?.message ??
            `Azure DI operation ${operation.status}`,
          { code: operation.error?.code, body: operation }
        )
      }
    }

    throw new AzureDiError(
      `Azure DI operation timed out after ${this.timeoutMs}ms`
    )
  }
}
