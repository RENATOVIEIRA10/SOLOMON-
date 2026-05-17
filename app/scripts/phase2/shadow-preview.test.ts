/**
 * Phase 2 / Slice 3C-c — shadow preview mode tests.
 *
 * Two layers:
 *   1. Unit tests for shouldRunShadowPreview (pure helper).
 *   2. Source-text wiring assertions for search.ts (runShadowPreview
 *      fire-and-forget on success path) and the four main callers
 *      (answer.ts / stream.ts / compare.ts / pre-sinistro.ts) threading
 *      insurerNames / requestId / question / source.
 *
 * Standalone tsx, exit code 0/1. No network, no DB.
 *
 * Run from app/:
 *   npm run phase2:shadow-preview:test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SHADOW_PREVIEW_ENV_VAR,
  getShadowPreviewListFromEnv,
  shouldRunShadowPreview,
  type Corpus,
} from '../../src/config/corpus-routing'

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

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..', '..')
const SEARCH_TS = path.join(APP_ROOT, 'src', 'services', 'rag', 'search.ts')
const ANSWER_TS = path.join(APP_ROOT, 'src', 'services', 'rag', 'answer.ts')
const STREAM_TS = path.join(APP_ROOT, 'src', 'services', 'rag', 'stream.ts')
const COMPARE_TS = path.join(APP_ROOT, 'src', 'services', 'rag', 'compare.ts')
const PRESIN_TS = path.join(APP_ROOT, 'src', 'services', 'rag', 'pre-sinistro.ts')

// ---------------------------------------------------------------------------
// Pure-helper gates
// ---------------------------------------------------------------------------
function gateHelperPure(): void {
  console.log('\n## shouldRunShadowPreview pure helper')

  // 1) Default env -> empty list -> never preview.
  withEnv(SHADOW_PREVIEW_ENV_VAR, undefined, () => {
    eq(
      'unset env, Prudential single-insurer, served=legacy -> NO preview',
      shouldRunShadowPreview({ insurerNames: ['Prudential'], servedCorpus: 'legacy' }),
      false
    )
  })
  withEnv(SHADOW_PREVIEW_ENV_VAR, '', () => {
    eq(
      'empty env -> NO preview',
      shouldRunShadowPreview({ insurerNames: ['Prudential'], servedCorpus: 'legacy' }),
      false
    )
  })

  // 2) Insurer in env list + single + served=legacy -> preview.
  withEnv(SHADOW_PREVIEW_ENV_VAR, 'Prudential', () => {
    eq(
      'env=Prudential, single Prudential, served=legacy -> preview',
      shouldRunShadowPreview({ insurerNames: ['Prudential'], servedCorpus: 'legacy' }),
      true
    )
  })

  // 3) Multi-insurer query never previews.
  eq(
    "[Prudential, Bradesco], env list permissive -> NO preview",
    shouldRunShadowPreview({
      insurerNames: ['Prudential', 'Bradesco'],
      envPreviewList: new Set(['Prudential']),
      servedCorpus: 'legacy',
    }),
    false
  )

  // 4) Global query (zero insurers) never previews.
  eq(
    'empty insurerNames -> NO preview',
    shouldRunShadowPreview({
      insurerNames: [],
      envPreviewList: new Set(['Prudential']),
      servedCorpus: 'legacy',
    }),
    false
  )

  // 5) Non-Prudential insurer + Prudential-only list -> NO preview.
  eq(
    'Azos single-insurer, env=Prudential -> NO preview',
    shouldRunShadowPreview({
      insurerNames: ['Azos'],
      envPreviewList: new Set(['Prudential']),
      servedCorpus: 'legacy',
    }),
    false
  )

  // 6) servedCorpus='shadow' -> no preview (preview only makes sense
  // when serving legacy; if shadow is already serving, it would be a
  // redundant duplicate call).
  eq(
    "servedCorpus='shadow' -> NO preview",
    shouldRunShadowPreview({
      insurerNames: ['Prudential'],
      envPreviewList: new Set(['Prudential']),
      servedCorpus: 'shadow' as Corpus,
    }),
    false
  )

  // 7) Case-sensitive: lowercase env mismatch.
  eq(
    "env='prudential' (lowercase), query='Prudential' -> NO preview",
    shouldRunShadowPreview({
      insurerNames: ['Prudential'],
      envPreviewList: new Set(['prudential']),
      servedCorpus: 'legacy',
    }),
    false
  )

  // 8) Multi-insurer allowlist + Prudential single-insurer -> preview.
  eq(
    "env={'Prudential','Azos'}, single Prudential -> preview",
    shouldRunShadowPreview({
      insurerNames: ['Prudential'],
      envPreviewList: new Set(['Prudential', 'Azos']),
      servedCorpus: 'legacy',
    }),
    true
  )
}

// ---------------------------------------------------------------------------
// Env parser sanity
// ---------------------------------------------------------------------------
function gateEnvParser(): void {
  console.log('\n## getShadowPreviewListFromEnv parser')
  withEnv(SHADOW_PREVIEW_ENV_VAR, undefined, () => {
    eq('unset env -> empty set', getShadowPreviewListFromEnv().size, 0)
  })
  withEnv(SHADOW_PREVIEW_ENV_VAR, '', () => {
    eq('empty env -> empty set', getShadowPreviewListFromEnv().size, 0)
  })
  withEnv(SHADOW_PREVIEW_ENV_VAR, '   ', () => {
    eq('whitespace-only env -> empty set', getShadowPreviewListFromEnv().size, 0)
  })
  withEnv(SHADOW_PREVIEW_ENV_VAR, ',,,', () => {
    eq('commas-only env -> empty set', getShadowPreviewListFromEnv().size, 0)
  })
  withEnv(SHADOW_PREVIEW_ENV_VAR, ' Prudential , Azos ', () => {
    const set = getShadowPreviewListFromEnv()
    ok(
      'whitespace tolerant + multi-value',
      set.size === 2 && set.has('Prudential') && set.has('Azos')
    )
  })
}

// ---------------------------------------------------------------------------
// search.ts wiring: runShadowPreview defined + fire-and-forget
// ---------------------------------------------------------------------------
function gateSearchWiring(): void {
  console.log('\n## search.ts -- runShadowPreview wiring')
  const src = readFileSync(SEARCH_TS, 'utf8')

  ok(
    'search.ts imports shouldRunShadowPreview',
    /import\s*\{[^}]*shouldRunShadowPreview[^}]*\}\s*from\s*['"]@\/config\/corpus-routing['"]/.test(
      src
    )
  )
  ok(
    'search.ts defines a runShadowPreview function',
    /async\s+function\s+runShadowPreview\s*\(/.test(src)
  )
  ok(
    'runShadowPreview calls match_shadow_documents RPC',
    /supabase\.rpc[^)]*\)\(\s*\n?\s*['"]match_shadow_documents['"]/.test(src) ||
      /['"]match_shadow_documents['"]/.test(src)
  )
  ok(
    "runShadowPreview records trace with mode='preview-only'",
    /mode:\s*['"]preview-only['"]/.test(src)
  )
  ok(
    'runShadowPreview kicked off via `void` + `.catch` (fire-and-forget)',
    /void\s+runShadowPreview\([\s\S]+?\)\.catch\(/.test(src)
  )
  ok(
    'runShadowPreview is only fired after legacy serve succeeds (after the error throw)',
    // Sanity: ensure the void runShadowPreview block lives AFTER the
    // `throw new Error(\`[rag/search] pgvector search failed:...\`)` line.
    (() => {
      const errorIdx = src.indexOf('pgvector search failed:')
      const voidIdx = src.indexOf('void runShadowPreview(')
      return errorIdx > -1 && voidIdx > -1 && voidIdx > errorIdx
    })()
  )
  ok(
    'search.ts wraps shouldRunShadowPreview in an if() gate',
    /if\s*\(\s*\n?\s*shouldRunShadowPreview\(/.test(src)
  )
}

// ---------------------------------------------------------------------------
// Caller wiring: each caller threads corpusCtx (insurerNames, requestId,
// question, source) into its search.ts call(s).
// ---------------------------------------------------------------------------
function gateCallerWiring(): void {
  console.log('\n## caller wiring (corpusCtx threaded)')

  const checks: Array<{ file: string; label: string; source: string }> = [
    { file: ANSWER_TS, label: 'answer.ts', source: 'ask' },
    { file: STREAM_TS, label: 'stream.ts', source: 'stream' },
    { file: COMPARE_TS, label: 'compare.ts', source: 'compare' },
    { file: PRESIN_TS, label: 'pre-sinistro.ts', source: 'pre-sinistro' },
  ]

  for (const c of checks) {
    const src = readFileSync(c.file, 'utf8')
    ok(`${c.label} imports randomUUID`, /import\s*\{\s*randomUUID\s*\}\s*from\s*['"]node:crypto['"]/.test(src))
    ok(
      `${c.label} declares a corpusCtx with insurerNames/requestId/question/source='${c.source}'`,
      /corpusCtx\s*=\s*\{[\s\S]*?insurerNames:[\s\S]*?requestId:[\s\S]*?question[\s\S]*?source:\s*['"]/.test(
        src
      ) && new RegExp(`source:\\s*['"]${c.source}['"]`).test(src)
    )
    ok(
      `${c.label} spreads ...corpusCtx into at least one semanticSearch* call`,
      /semanticSearch(With(Embedding))?\s*\(\s*[^)]*\n?\s*\{\s*\n?\s*\.\.\.corpusCtx/.test(
        src
      ) || /\{\s*\n\s*\.\.\.corpusCtx/.test(src)
    )
  }
}

function main(): void {
  console.log('# shadow-preview tests (slice 3C-c)')
  gateHelperPure()
  gateEnvParser()
  gateSearchWiring()
  gateCallerWiring()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
