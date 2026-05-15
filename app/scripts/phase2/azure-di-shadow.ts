/**
 * Phase 2 / PR 3A - Azure Document Intelligence F0 probe.
 *
 * Probe-only by contract:
 * - no Supabase client
 * - no DB writes
 * - no shadow set table
 * - no chunk indexing
 * - no production read-path imports
 * - no changes to rate fast-path
 *
 * Run from app/:
 *   npm run phase2:azure-di:shadow
 *   npm run phase2:azure-di:shadow -- --dry-run
 *
 * Required env:
 *   AZURE_DI_ENDPOINT or AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
 *   AZURE_DI_KEY or AZURE_DOCUMENT_INTELLIGENCE_KEY
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

const DEFAULT_API_VERSION = '2024-11-30'
const DEFAULT_OUT_ROOT = path.join('..', 'docs', 'audit-runs')
const POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 120_000

type ShadowDoc = {
  insurerName: string
  productName: string
  url: string
}

type CliOptions = {
  apiVersion: string
  dryRun: boolean
  allowNonBradesco: boolean
  maxDocs: number
  outRoot: string
  timeoutMs: number
  url?: string
  productName?: string
}

type AzureErrorBody = {
  error?: {
    code?: string
    message?: string
    innererror?: unknown
  }
}

type AnalyzeResult = {
  status?: string
  error?: AzureErrorBody['error']
  analyzeResult?: {
    apiVersion?: string
    modelId?: string
    content?: string
    pages?: unknown[]
    paragraphs?: unknown[]
    tables?: unknown[]
    figures?: unknown[]
    sections?: unknown[]
    contentFormat?: string
  }
}

type ProbeOutcome = {
  label: string
  pages: string
  ok: boolean
  statusCode?: number
  errorCode?: string
  errorMessage?: string
  elapsedMs: number
  outputFiles: string[]
  summary?: ProbeSummary
}

type ProbeSummary = {
  apiVersion?: string
  modelId?: string
  contentFormat?: string
  pageCount: number
  contentChars: number
  paragraphCount: number
  tableCount: number
  figureCount: number
  sectionCount: number
  markdownHeadingCount: number
  markdownTableLineCount: number
  expectedTermHits: Record<string, boolean>
}

type ReportMetadata = {
  apiVersion: string
  endpointMasked: string
}

class AzureDiRequestError extends Error {
  statusCode?: number
  code?: string
  body?: unknown

  constructor(message: string, statusCode?: number, code?: string, body?: unknown) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.body = body
  }
}

const BRADESCO_SHADOW_DOCS: ShadowDoc[] = [
  {
    insurerName: 'Bradesco Seguros',
    productName: 'Vida Viva',
    url: 'https://www.bradescoseguros.com.br/wcm/connect/27d3efc8-319b-48d5-ba61-0269f0d6a5a2/Condi%C3%A7%C3%B5es_Gerais_Vida_Viva_Corretor_Maio24.pdf?MOD=AJPERES',
  },
  {
    insurerName: 'Bradesco Seguros',
    productName: 'Viva Mais',
    url: 'https://www.bradescoseguros.com.br/wcm/connect/96e59108-aa04-45f1-96e5-4a9010fd6899/Condi%C3%A7%C3%B5es+Gerais_Viva+Mais.pdf?MOD=AJPERES',
  },
  {
    insurerName: 'Bradesco Seguros',
    productName: 'Vida Segura Bradesco',
    url: 'https://www.bradescoseguros.com.br/wcm/connect/4301792c-c6ce-4d30-8755-f7edd34dba89/Vida_Segura_Bradesco.pdf?MOD=AJPERES',
  },
]

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    apiVersion: DEFAULT_API_VERSION,
    dryRun: false,
    allowNonBradesco: false,
    maxDocs: 1,
    outRoot: DEFAULT_OUT_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--allow-non-bradesco') opts.allowNonBradesco = true
    else if (arg === '--api-version' && next) {
      opts.apiVersion = next
      i++
    } else if (arg === '--max-docs' && next) {
      opts.maxDocs = Number(next)
      i++
    } else if (arg === '--out-root' && next) {
      opts.outRoot = next
      i++
    } else if (arg === '--timeout-ms' && next) {
      opts.timeoutMs = Number(next)
      i++
    } else if (arg === '--url' && next) {
      opts.url = next
      i++
    } else if (arg === '--product' && next) {
      opts.productName = next
      i++
    }
    else if (arg === '--help') {
      printUsage()
      process.exit(0)
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  if (!Number.isInteger(opts.maxDocs) || opts.maxDocs < 1) {
    throw new Error('--max-docs must be a positive integer')
  }
  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 10_000) {
    throw new Error('--timeout-ms must be an integer >= 10000')
  }
  return opts
}

function printUsage(): void {
  console.log(`Azure DI shadow probe

Usage:
  npm run phase2:azure-di:shadow -- [options]

Options:
  --dry-run                  Print env/doc plan without calling Azure
  --url <pdf-url>            Override default Bradesco seed URL
  --product <name>           Product label for --url
  --max-docs <n>             Default 1, only used without --url
  --out-root <dir>           Default ../docs/audit-runs
  --api-version <version>    Default ${DEFAULT_API_VERSION}
  --timeout-ms <n>           Default ${DEFAULT_TIMEOUT_MS}
  --allow-non-bradesco       Permit --url outside bradescoseguros.com.br
`)
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return undefined
}

function maskEndpoint(endpoint?: string): string {
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

function makeRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function selectDocs(opts: CliOptions): ShadowDoc[] {
  if (opts.url) {
    if (!opts.allowNonBradesco && !opts.url.includes('bradescoseguros.com.br')) {
      throw new Error('PR 3 is Bradesco-first. Pass --allow-non-bradesco only for an explicit exception.')
    }
    return [{
      insurerName: opts.url.includes('bradescoseguros.com.br') ? 'Bradesco Seguros' : 'Unknown',
      productName: opts.productName ?? 'manual-url',
      url: opts.url,
    }]
  }
  return BRADESCO_SHADOW_DOCS.slice(0, opts.maxDocs)
}

function analyzeUrl(endpoint: string, apiVersion: string, pages: string): string {
  const base = endpoint.replace(/\/+$/, '')
  const params = new URLSearchParams({
    'api-version': apiVersion,
    outputContentFormat: 'markdown',
    pages,
  })
  return `${base}/documentintelligence/documentModels/prebuilt-layout:analyze?${params.toString()}`
}

async function startAnalyze(endpoint: string, key: string, apiVersion: string, doc: ShadowDoc, pages: string): Promise<string> {
  const response = await fetch(analyzeUrl(endpoint, apiVersion, pages), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': key,
    },
    body: JSON.stringify({ urlSource: doc.url }),
  })

  if (!response.ok) {
    const body = await readJsonOrText(response)
    const error = typeof body === 'object' && body !== null ? (body as AzureErrorBody).error : undefined
    throw new AzureDiRequestError(
      error?.message ?? `Azure DI analyze request failed with HTTP ${response.status}`,
      response.status,
      error?.code,
      body
    )
  }

  const operationLocation = response.headers.get('operation-location')
  if (!operationLocation) {
    throw new AzureDiRequestError('Azure DI response did not include operation-location header', response.status)
  }
  return operationLocation
}

async function pollAnalyze(operationLocation: string, key: string, timeoutMs: number): Promise<AnalyzeResult> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(POLL_INTERVAL_MS)
    const response = await fetch(operationLocation, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
      },
    })
    const body = await readJsonOrText(response)

    if (!response.ok) {
      const error = typeof body === 'object' && body !== null ? (body as AzureErrorBody).error : undefined
      throw new AzureDiRequestError(
        error?.message ?? `Azure DI poll failed with HTTP ${response.status}`,
        response.status,
        error?.code,
        body
      )
    }

    const result = body as AnalyzeResult
    if (result.status === 'succeeded') return result
    if (result.status === 'failed') {
      throw new AzureDiRequestError(
        result.error?.message ?? 'Azure DI operation failed',
        response.status,
        result.error?.code,
        result
      )
    }
  }

  throw new AzureDiRequestError(`Azure DI operation timed out after ${timeoutMs}ms`)
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

async function runProbe(
  endpoint: string,
  key: string,
  opts: CliOptions,
  doc: ShadowDoc,
  outDir: string,
  label: string,
  pages: string
): Promise<ProbeOutcome> {
  const startedAt = Date.now()
  const outputFiles: string[] = []

  try {
    const operationLocation = await startAnalyze(endpoint, key, opts.apiVersion, doc, pages)
    const result = await pollAnalyze(operationLocation, key, opts.timeoutMs)
    const summary = summarize(result)
    const base = `${slugify(doc.productName)}-${label}`
    const rawPath = path.join(outDir, `${base}.json`)
    const markdownPath = path.join(outDir, `${base}.md`)

    await writeFile(rawPath, JSON.stringify(result, null, 2), 'utf8')
    outputFiles.push(rawPath)

    if (result.analyzeResult?.content) {
      await writeFile(markdownPath, result.analyzeResult.content, 'utf8')
      outputFiles.push(markdownPath)
    }

    return {
      label,
      pages,
      ok: true,
      elapsedMs: Date.now() - startedAt,
      outputFiles,
      summary,
    }
  } catch (err) {
    const e = err instanceof AzureDiRequestError ? err : new AzureDiRequestError(String(err))
    return {
      label,
      pages,
      ok: false,
      statusCode: e.statusCode,
      errorCode: e.code,
      errorMessage: e.message,
      elapsedMs: Date.now() - startedAt,
      outputFiles,
    }
  }
}

function summarize(result: AnalyzeResult): ProbeSummary {
  const ar = result.analyzeResult ?? {}
  const content = ar.content ?? ''
  const lower = content.toLowerCase()
  const terms = ['bradesco', 'vida', 'cobertura', 'morte', 'invalidez', 'beneficiario', 'carencia', 'exclusao']
  return {
    apiVersion: ar.apiVersion,
    modelId: ar.modelId,
    contentFormat: ar.contentFormat,
    pageCount: ar.pages?.length ?? 0,
    contentChars: content.length,
    paragraphCount: ar.paragraphs?.length ?? 0,
    tableCount: ar.tables?.length ?? 0,
    figureCount: ar.figures?.length ?? 0,
    sectionCount: ar.sections?.length ?? 0,
    markdownHeadingCount: (content.match(/^#{1,6}\s+/gm) ?? []).length,
    markdownTableLineCount: content
      .split('\n')
      .filter((line) => line.includes('|') && line.trim().length > 2).length,
    expectedTermHits: Object.fromEntries(terms.map((term) => [term, lower.includes(term)])),
  }
}

function f0Interpretation(outcomes: ProbeOutcome[]): string {
  const firstTwo = outcomes.find((o) => o.label === 'f0-pages-1-2')
  const threePage = outcomes.find((o) => o.label === 'f0-pages-1-3')

  if (!firstTwo?.ok) {
    return 'BLOCKED: pages 1-2 failed. Validate endpoint/key/resource provisioning before any pilot.'
  }
  if (!threePage) {
    return 'UNKNOWN: three-page probe was not executed.'
  }
  if (!threePage.ok) {
    return 'F0_LIMIT_OBSERVED: pages 1-2 succeeded and pages 1-3 returned an error. Pilot must use two-page PDFs/recortes, or approve S0 for longer PDFs.'
  }
  // F0 enforces the page cap silently: the pages=1-3 request returns HTTP 200
  // but the service yields no more pages than the pages=1-2 request. HTTP
  // success alone is not proof the page span was honored — compare the actual
  // page counts.
  const twoPageCount = firstTwo.summary?.pageCount ?? 0
  const threePageCount = threePage.summary?.pageCount ?? 0
  if (threePageCount <= twoPageCount) {
    return `F0_LIMIT_OBSERVED: pages 1-3 succeeded but returned only ${threePageCount} page(s), same as the 1-2 probe — F0 caps the page span silently. Pilot must use two-page PDFs/recortes, or approve S0 for longer PDFs.`
  }
  return `F0_LIMIT_NOT_OBSERVED: pages 1-3 returned ${threePageCount} pages. Resource may not be F0, or the service behavior differs from the documented F0 PDF/TIFF limit.`
}

async function writeReport(
  outDir: string,
  metadata: ReportMetadata,
  docs: ShadowDoc[],
  outcomesByDoc: Array<{ doc: ShadowDoc; outcomes: ProbeOutcome[] }>
): Promise<void> {
  const lines: string[] = []
  lines.push('# Phase 2 PR 3A - Azure DI F0 Probe')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('Scope: Bradesco-first Azure DI F0 validation. No DB write. Production read path untouched.')
  lines.push('')
  lines.push('## PR Boundary')
  lines.push('')
  lines.push('- This PR does not create a shadow set in the database.')
  lines.push('- This PR does not index chunks.')
  lines.push('- This PR only validates Azure DI F0 behavior and generates evidence.')
  lines.push('- The real shadow set comes in the next PR.')
  lines.push('')
  lines.push('## Azure Resource')
  lines.push('')
  lines.push(`- Endpoint: ${metadata.endpointMasked}`)
  lines.push(`- API version: ${metadata.apiVersion}`)
  lines.push('- Key: not recorded')
  lines.push('')
  lines.push('## Documents')
  lines.push('')
  lines.push('| Insurer | Product | URL |')
  lines.push('|---|---|---|')
  for (const doc of docs) {
    lines.push(`| ${doc.insurerName} | ${doc.productName} | ${doc.url} |`)
  }
  lines.push('')
  lines.push('## F0 Interpretation')
  lines.push('')
  for (const { doc, outcomes } of outcomesByDoc) {
    lines.push(`- ${doc.productName}: ${f0Interpretation(outcomes)}`)
  }
  lines.push('')
  lines.push('## Probe Results')
  lines.push('')
  lines.push('| Product | Probe | Pages | OK | HTTP | Error | Elapsed ms | Page count | Chars | Paragraphs | Tables | Sections | Headings |')
  lines.push('|---|---|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const { doc, outcomes } of outcomesByDoc) {
    for (const outcome of outcomes) {
      lines.push([
        doc.productName,
        outcome.label,
        outcome.pages,
        outcome.ok ? 'yes' : 'no',
        outcome.statusCode ?? '',
        outcome.errorCode ?? outcome.errorMessage ?? '',
        outcome.elapsedMs,
        outcome.summary?.pageCount ?? '',
        outcome.summary?.contentChars ?? '',
        outcome.summary?.paragraphCount ?? '',
        outcome.summary?.tableCount ?? '',
        outcome.summary?.sectionCount ?? '',
        outcome.summary?.markdownHeadingCount ?? '',
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
    }
  }
  lines.push('')
  lines.push('## Output Files')
  lines.push('')
  for (const { doc, outcomes } of outcomesByDoc) {
    lines.push(`### ${doc.productName}`)
    for (const outcome of outcomes) {
      if (outcome.outputFiles.length === 0) {
        lines.push(`- ${outcome.label}: no output file`)
      } else {
        for (const file of outcome.outputFiles) {
          lines.push(`- ${outcome.label}: ${path.relative(outDir, file)}`)
        }
      }
    }
    lines.push('')
  }
  lines.push('## Guardrails')
  lines.push('')
  lines.push('- Probe artifact only; do not insert into `documents` from this run.')
  lines.push('- Do not use this probe output as a chunker implementation.')
  lines.push('- Keep `rate-lookup.ts` and production `/api/ask` / `/api/compare` read paths unchanged.')
  lines.push('- Run partial Ragas before/after before promoting any Azure DI chunks.')

  await writeFile(path.join(outDir, 'REPORT.md'), lines.join('\n'), 'utf8')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const docs = selectDocs(opts)
  const endpoint = envValue('AZURE_DI_ENDPOINT', 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT')
  const key = envValue('AZURE_DI_KEY', 'AZURE_DOCUMENT_INTELLIGENCE_KEY')
  const runId = makeRunId()
  const outDir = path.join(opts.outRoot, `azure-di-shadow-${runId}`)

  console.log('# Azure DI F0 probe')
  console.log(`apiVersion=${opts.apiVersion}`)
  console.log(`docs=${docs.length}`)
  console.log(`outDir=${outDir}`)
  console.log(`endpoint=${maskEndpoint(endpoint)}`)
  console.log(`key=${key ? '(present)' : '(missing)'}`)

  if (opts.dryRun) {
    console.log('\nDry run only. No Azure request sent.')
    for (const doc of docs) {
      console.log(`- ${doc.insurerName} / ${doc.productName}: ${doc.url}`)
    }
    return
  }

  if (!endpoint || !key) {
    throw new Error('Missing Azure DI env. Set AZURE_DI_ENDPOINT + AZURE_DI_KEY from the provisioned F0 resource first.')
  }

  await mkdir(outDir, { recursive: true })
  const outcomesByDoc: Array<{ doc: ShadowDoc; outcomes: ProbeOutcome[] }> = []

  for (const doc of docs) {
    console.log(`\n## ${doc.productName}`)
    const outcomes: ProbeOutcome[] = []
    outcomes.push(await runProbe(endpoint, key, opts, doc, outDir, 'f0-pages-1-2', '1-2'))
    outcomes.push(await runProbe(endpoint, key, opts, doc, outDir, 'f0-pages-1-3', '1-3'))
    outcomesByDoc.push({ doc, outcomes })

    for (const outcome of outcomes) {
      console.log(`${outcome.label}: ${outcome.ok ? 'OK' : 'FAIL'} (${outcome.elapsedMs}ms)`)
      if (!outcome.ok) console.log(`  ${outcome.errorCode ?? 'error'}: ${outcome.errorMessage}`)
    }
  }

  await writeReport(outDir, { apiVersion: opts.apiVersion, endpointMasked: maskEndpoint(endpoint) }, docs, outcomesByDoc)
  console.log(`\nReport: ${path.join(outDir, 'REPORT.md')}`)
}

main().catch((err) => {
  console.error('[phase2/azure-di-shadow] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
