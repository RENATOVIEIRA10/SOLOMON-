/**
 * Phase 2 / Slice 3C-b — retrieval-trace + search.ts wiring tests.
 *
 * Standalone tsx, exit code 0/1. Two layers:
 *  1. Source-text assertions (search.ts + retrieval-trace.ts + migrations).
 *  2. A runtime assertion that recordRetrievalTrace is fire-and-forget
 *     even when the Supabase insert errors. We exercise the real code
 *     path with bogus env vars so the insert fails fast; the synchronous
 *     return must NOT throw, and no unhandledRejection must escape.
 *
 * Run from app/:
 *   npm run phase2:retrieval-trace:test
 */

// IMPORTANT: ES module imports are hoisted above any top-level statement.
// We set bogus Supabase env vars FIRST, then load the trace module via
// dynamic import inside the runtime test. Static imports of node:* and
// pure files (readFileSync, path, url) are safe because they do not pull
// `@/lib/supabase`.
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let passed = 0
let failed = 0

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`)
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  ok(label, actual === expected, `expected ${String(expected)}, got ${String(actual)}`)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..', '..')
const SEARCH_TS = path.join(APP_ROOT, 'src', 'services', 'rag', 'search.ts')
const TRACE_TS = path.join(APP_ROOT, 'src', 'services', 'rag', 'retrieval-trace.ts')
const MIGRATIONS_DIR = path.join(APP_ROOT, 'supabase', 'migrations')

function readFile(p: string): string {
  return readFileSync(p, 'utf8')
}

// ---------------------------------------------------------------------------
// Source-text wiring assertions
// ---------------------------------------------------------------------------
function gateSourceWiring(): void {
  console.log('\n## source-text wiring (search.ts + retrieval-trace.ts)')
  const search = readFile(SEARCH_TS)
  const trace = readFile(TRACE_TS)

  ok(
    'search.ts imports recordRetrievalTrace',
    /import\s*\{[^}]*recordRetrievalTrace[^}]*\}\s*from\s*['"]@\/services\/rag\/retrieval-trace['"]/.test(
      search
    )
  )
  ok(
    'search.ts measures latency (Date.now() before RPC)',
    /const\s+t0\s*=\s*Date\.now\(\)/.test(search)
  )
  ok(
    'search.ts computes latencyMs from t0',
    /const\s+latencyMs\s*=\s*Date\.now\(\)\s*-\s*t0/.test(search)
  )
  ok(
    'search.ts records trace on error path',
    /recordRetrievalTrace\([\s\S]+?fallbackReason:\s*['"]rpc_error['"]/.test(search)
  )
  ok(
    'search.ts records trace on success path with chunksReturned',
    /recordRetrievalTrace\([\s\S]+?chunksReturned,/.test(search)
  )
  ok(
    "search.ts updates langfuseTrace with corpus tag (duck-typed, no langfuse import)",
    /options\?\.langfuseTrace\?\.update\(\s*\{\s*tags:\s*\[`corpus:\$\{corpus\}`\]/.test(
      search
    )
  )
  ok(
    "search.ts does NOT import 'langfuse' (light coupling rule)",
    !/from\s*['"]langfuse['"]/.test(search)
  )

  ok(
    'retrieval-trace.ts is fire-and-forget (uses void + .catch)',
    /void\s+writeTraceRow\([^)]*\)\.catch\(/.test(trace)
  )
  ok(
    'retrieval-trace.ts hashes the question (never stores raw)',
    /createHash\(\s*['"]sha256['"]/.test(trace) && /input\.question/.test(trace)
  )
  ok(
    'retrieval-trace.ts logs failures as console.warn (does not throw to caller)',
    /console\.warn\(\s*['"]\[rag\/retrieval-trace\] insert failed:/.test(trace)
  )
  ok(
    'retrieval-trace.ts inserts into retrieval_traces table',
    /\.from[^)]*\)\s*\(\s*['"]retrieval_traces['"]\s*\)\s*\.insert/.test(trace)
  )
}

// ---------------------------------------------------------------------------
// Migration sanity assertions
// ---------------------------------------------------------------------------
function gateMigrations(): void {
  console.log('\n## migration files exist and have expected shape')

  const corpusMigrationPath = path.join(
    MIGRATIONS_DIR,
    '20260517190000_corpus_routing.sql'
  )
  const tracesMigrationPath = path.join(
    MIGRATIONS_DIR,
    '20260517190100_retrieval_traces.sql'
  )

  const corpusSql = readFile(corpusMigrationPath)
  const tracesSql = readFile(tracesMigrationPath)

  // corpus_routing
  ok(
    'corpus_routing CREATE TABLE present',
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.corpus_routing/i.test(corpusSql)
  )
  ok(
    "corpus_routing.mode has CHECK constraint ('legacy' | 'shadow')",
    /CHECK\s*\(\s*mode\s+IN\s*\(\s*'legacy'\s*,\s*'shadow'\s*\)\s*\)/i.test(corpusSql)
  )
  ok(
    "corpus_routing.mode defaults to 'legacy'",
    /DEFAULT\s+'legacy'/i.test(corpusSql)
  )
  ok(
    "corpus_routing seeds Prudential with mode='legacy'",
    /INSERT\s+INTO\s+public\.corpus_routing[\s\S]+'Prudential'[\s\S]+'legacy'/.test(
      corpusSql
    )
  )
  ok(
    'corpus_routing migration documents DROP TABLE rollback',
    /DROP\s+TABLE\s+public\.corpus_routing/i.test(corpusSql)
  )
  ok(
    'corpus_routing migration does NOT touch documents table',
    !/ALTER\s+TABLE\s+public\.documents/i.test(corpusSql) &&
      !/UPDATE\s+public\.documents/i.test(corpusSql) &&
      !/DELETE\s+FROM\s+public\.documents/i.test(corpusSql)
  )

  // retrieval_traces
  ok(
    'retrieval_traces CREATE TABLE present',
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.retrieval_traces/i.test(tracesSql)
  )
  ok(
    "retrieval_traces.corpus has CHECK constraint ('legacy' | 'shadow')",
    /CHECK\s*\(\s*corpus\s+IN\s*\(\s*'legacy'\s*,\s*'shadow'\s*\)\s*\)/i.test(
      tracesSql
    )
  )
  ok(
    "retrieval_traces.mode has CHECK constraint ('serve' | 'preview-only')",
    /CHECK\s*\(\s*mode\s+IN\s*\(\s*'serve'\s*,\s*'preview-only'\s*\)\s*\)/i.test(
      tracesSql
    )
  )
  ok(
    'retrieval_traces.latency_ms has CHECK (>= 0)',
    /CHECK\s*\(\s*latency_ms\s*>=\s*0\s*\)/i.test(tracesSql)
  )
  ok(
    'retrieval_traces has ts DESC index',
    /CREATE\s+INDEX[^\n]+retrieval_traces[^\n]+ts/i.test(tracesSql)
  )
  ok(
    'retrieval_traces migration documents DROP TABLE rollback',
    /DROP\s+TABLE\s+public\.retrieval_traces/i.test(tracesSql)
  )
  ok(
    'retrieval_traces does NOT touch documents or corpus_routing',
    !/ALTER\s+TABLE\s+public\.documents/i.test(tracesSql) &&
      !/UPDATE\s+public\.documents/i.test(tracesSql) &&
      !/ALTER\s+TABLE\s+public\.corpus_routing/i.test(tracesSql)
  )
  ok(
    'retrieval_traces documents PII contract (hash-only)',
    /hash[\s\S]+only|sha256/i.test(tracesSql)
  )
}

// ---------------------------------------------------------------------------
// Runtime behaviour: trace insert failure must be fire-and-forget
// ---------------------------------------------------------------------------
async function gateRuntimeBestEffort(): Promise<void> {
  console.log('\n## runtime: trace insert failures are swallowed')

  // The bogus NEXT_PUBLIC_SUPABASE_URL set at module-top means the real
  // insert will fail (DNS resolution / network unreachable). The helper
  // must absorb that failure without throwing to the caller.
  //
  // Dynamic import so the supabase singleton loads AFTER our env stub.
  const traceMod = (await import('../../src/services/rag/retrieval-trace')) as {
    recordRetrievalTrace: (input: Record<string, unknown>) => void
  }
  const { recordRetrievalTrace } = traceMod

  // Capture console.warn output so we can verify the helper logged.
  const originalWarn = console.warn
  const warnCalls: string[] = []
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args.map((a) => String(a)).join(' '))
  }

  // Capture unhandled rejections globally during this block.
  let unhandledCount = 0
  const onUnhandled = () => {
    unhandledCount += 1
  }
  process.on('unhandledRejection', onUnhandled)

  let threwSync = false
  try {
    recordRetrievalTrace({
      corpus: 'legacy',
      latencyMs: 42,
      chunksReturned: 3,
      source: 'unknown',
    })
  } catch {
    threwSync = true
  }
  ok(
    'recordRetrievalTrace does NOT throw synchronously on insert failure',
    !threwSync
  )

  // Second call with full payload + question, to exercise hashing.
  let threwSync2 = false
  try {
    recordRetrievalTrace({
      requestId: 'req-abc-123',
      corpus: 'legacy',
      mode: 'serve',
      latencyMs: 7,
      chunksReturned: 10,
      fallbackUsed: false,
      fallbackReason: null,
      rerankUsed: true,
      source: 'ask',
      insurerName: 'Prudential',
      question: 'Qual o periodo de carencia para suicidio?',
    })
  } catch {
    threwSync2 = true
  }
  ok(
    'recordRetrievalTrace with full payload + question does NOT throw',
    !threwSync2
  )

  // Give the async insert + .catch handler time to run. The bogus URL
  // resolves to a network error reasonably fast.
  await new Promise((r) => setTimeout(r, 3000))

  console.warn = originalWarn
  process.off('unhandledRejection', onUnhandled)

  ok(
    'no unhandledRejection escaped during best-effort inserts',
    unhandledCount === 0,
    `got ${unhandledCount}`
  )
  ok(
    'console.warn was called at least once (telemetry surfaced its own error)',
    warnCalls.some((m) => m.includes('[rag/retrieval-trace] insert failed'))
  )
}

async function main(): Promise<void> {
  console.log('# retrieval-trace + search.ts wiring test (slice 3C-b)')
  gateSourceWiring()
  gateMigrations()
  await gateRuntimeBestEffort()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[retrieval-trace.test] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
