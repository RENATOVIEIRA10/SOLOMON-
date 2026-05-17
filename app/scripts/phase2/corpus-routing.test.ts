/**
 * Phase 2 / Slice 3C-a — pure-helper tests for chooseRetrievalCorpus.
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no LLM, no OpenAI.
 *
 * Covers the 9 gates the CEO authorized for slice 3C-a:
 *   1. empty allowlist               -> legacy
 *   2. global query (no insurer)     -> legacy
 *   3. multi-insurer query           -> legacy
 *   4. insurer NOT in allowlist      -> legacy
 *   5. insurer in allowlist + no DB  -> legacy
 *   6. insurer in allowlist + DB shadow -> shadow
 *   7. non-Prudential insurer (whitelist literal mismatch) -> legacy
 *   8. overrideCorpus test hook works
 *   9. search.ts uses rpcName variable (not literal 'match_documents')
 *      AND defaults to 'match_documents' when env is empty (asserted by
 *      a source-text read; equivalent integration assertion that
 *      doesn't require a live Supabase client).
 *
 * Run from app/:
 *   npm run phase2:corpus-routing:test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  chooseRetrievalCorpus,
  getShadowAllowlistFromEnv,
  SHADOW_ALLOWLIST_ENV_VAR,
  type Corpus,
} from '../../src/config/corpus-routing'

const SEARCH_TS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'services',
  'rag',
  'search.ts'
)

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
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
  try {
    return fn()
  } finally {
    if (prev === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = prev
    }
  }
}

// ---------------------------------------------------------------------------
// Gate 1 — empty allowlist => legacy
// ---------------------------------------------------------------------------
function gateEmptyAllowlist(): void {
  console.log('\n## gate 1 — empty allowlist => legacy')
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, undefined, () => {
    eq(
      "unset env, Prudential single-insurer -> 'legacy'",
      chooseRetrievalCorpus({ insurerNames: ['Prudential'] }),
      'legacy' as Corpus
    )
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, '', () => {
    eq(
      "empty env, Prudential single-insurer -> 'legacy'",
      chooseRetrievalCorpus({ insurerNames: ['Prudential'] }),
      'legacy' as Corpus
    )
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, '   ', () => {
    eq(
      "whitespace-only env, Prudential -> 'legacy'",
      chooseRetrievalCorpus({ insurerNames: ['Prudential'] }),
      'legacy' as Corpus
    )
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, ',,,', () => {
    eq(
      "commas-only env, Prudential -> 'legacy'",
      chooseRetrievalCorpus({ insurerNames: ['Prudential'] }),
      'legacy' as Corpus
    )
  })
}

// ---------------------------------------------------------------------------
// Gate 2 — global query (zero insurers) => legacy
// ---------------------------------------------------------------------------
function gateGlobalQuery(): void {
  console.log('\n## gate 2 — global query (zero insurers) => legacy')
  // Even with Prudential in the allowlist + DB shadow set, a query that
  // mentioned NO insurer must use the legacy (full) corpus.
  const allowlist = new Set(['Prudential'])
  const dbRouting = new Map<string, Corpus>([['Prudential', 'shadow']])
  eq(
    "empty insurerNames + permissive env + permissive DB -> 'legacy'",
    chooseRetrievalCorpus({
      insurerNames: [],
      envAllowlist: allowlist,
      dbRouting,
    }),
    'legacy' as Corpus
  )
}

// ---------------------------------------------------------------------------
// Gate 3 — multi-insurer query => legacy
// ---------------------------------------------------------------------------
function gateMultiInsurer(): void {
  console.log('\n## gate 3 — multi-insurer query => legacy')
  const allowlist = new Set(['Prudential'])
  const dbRouting = new Map<string, Corpus>([['Prudential', 'shadow']])
  eq(
    "['Prudential', 'Bradesco'] -> 'legacy'",
    chooseRetrievalCorpus({
      insurerNames: ['Prudential', 'Bradesco'],
      envAllowlist: allowlist,
      dbRouting,
    }),
    'legacy' as Corpus
  )
  eq(
    "3-insurer fanout -> 'legacy'",
    chooseRetrievalCorpus({
      insurerNames: ['Prudential', 'Bradesco', 'MAG'],
      envAllowlist: allowlist,
      dbRouting,
    }),
    'legacy' as Corpus
  )
}

// ---------------------------------------------------------------------------
// Gate 4 — insurer NOT in allowlist => legacy
// ---------------------------------------------------------------------------
function gateInsurerNotInAllowlist(): void {
  console.log('\n## gate 4 — insurer not in allowlist => legacy')
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, 'Prudential', () => {
    eq(
      "env=Prudential, query=Bradesco -> 'legacy'",
      chooseRetrievalCorpus({ insurerNames: ['Bradesco'] }),
      'legacy' as Corpus
    )
  })
  // Case-sensitive: the canonical name from detectInsurers is the source
  // of truth; the env value must match exactly.
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, 'prudential', () => {
    eq(
      "env='prudential' (lowercase), query='Prudential' -> 'legacy' (case-sensitive)",
      chooseRetrievalCorpus({ insurerNames: ['Prudential'] }),
      'legacy' as Corpus
    )
  })
}

// ---------------------------------------------------------------------------
// Gate 5 — insurer in allowlist BUT dbRouting absent => legacy
// ---------------------------------------------------------------------------
function gateAllowlistButNoDb(): void {
  console.log('\n## gate 5 — allowlisted but DB routing absent => legacy')
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, 'Prudential', () => {
    eq(
      'env permits, no dbRouting at all -> legacy',
      chooseRetrievalCorpus({ insurerNames: ['Prudential'] }),
      'legacy' as Corpus
    )
    eq(
      'env permits, empty dbRouting Map -> legacy',
      chooseRetrievalCorpus({
        insurerNames: ['Prudential'],
        dbRouting: new Map<string, Corpus>(),
      }),
      'legacy' as Corpus
    )
    eq(
      "env permits, dbRouting has 'Prudential'='legacy' -> legacy",
      chooseRetrievalCorpus({
        insurerNames: ['Prudential'],
        dbRouting: new Map<string, Corpus>([['Prudential', 'legacy']]),
      }),
      'legacy' as Corpus
    )
  })
}

// ---------------------------------------------------------------------------
// Gate 6 — allowlist + DB shadow => shadow (the only path to shadow)
// ---------------------------------------------------------------------------
function gateAllowlistAndDbShadow(): void {
  console.log('\n## gate 6 — allowlist AND db=shadow => shadow')
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, 'Prudential', () => {
    eq(
      "env=Prudential, dbRouting={Prudential:shadow} -> 'shadow'",
      chooseRetrievalCorpus({
        insurerNames: ['Prudential'],
        dbRouting: new Map<string, Corpus>([['Prudential', 'shadow']]),
      }),
      'shadow' as Corpus
    )
  })
  // The env allowlist can carry multiple insurers; only the queried one
  // is checked against the DB.
  eq(
    "envAllowlist={'Prudential','Azos'}, DB only Prudential shadow, query=Prudential -> 'shadow'",
    chooseRetrievalCorpus({
      insurerNames: ['Prudential'],
      envAllowlist: new Set(['Prudential', 'Azos']),
      dbRouting: new Map<string, Corpus>([['Prudential', 'shadow']]),
    }),
    'shadow' as Corpus
  )
}

// ---------------------------------------------------------------------------
// Gate 7 — non-Prudential insurer route stays legacy
// (covers the symmetric mismatch the CEO called out)
// ---------------------------------------------------------------------------
function gateNonPrudentialStayLegacy(): void {
  console.log('\n## gate 7 — non-Prudential insurers stay on legacy')
  eq(
    "env=Prudential, query=Azos (Azos in DB shadow) -> 'legacy' (env gate blocks)",
    chooseRetrievalCorpus({
      insurerNames: ['Azos'],
      envAllowlist: new Set(['Prudential']),
      dbRouting: new Map<string, Corpus>([['Azos', 'shadow']]),
    }),
    'legacy' as Corpus
  )
  eq(
    "no env, no DB, query=Azos -> 'legacy'",
    chooseRetrievalCorpus({ insurerNames: ['Azos'] }),
    'legacy' as Corpus
  )
}

// ---------------------------------------------------------------------------
// Gate 8 — overrideCorpus test hook
// ---------------------------------------------------------------------------
function gateOverrideHook(): void {
  console.log('\n## gate 8 — overrideCorpus bypass for tests/preview')
  // Override wins over everything below it.
  eq(
    "override='shadow' wins even with empty env",
    chooseRetrievalCorpus({
      insurerNames: ['Prudential'],
      overrideCorpus: 'shadow',
    }),
    'shadow' as Corpus
  )
  eq(
    "override='legacy' wins even when env+DB say shadow",
    chooseRetrievalCorpus({
      insurerNames: ['Prudential'],
      envAllowlist: new Set(['Prudential']),
      dbRouting: new Map<string, Corpus>([['Prudential', 'shadow']]),
      overrideCorpus: 'legacy',
    }),
    'legacy' as Corpus
  )
  // null and undefined are passthrough (treated as "not set").
  eq(
    'overrideCorpus: null falls through to env+DB',
    chooseRetrievalCorpus({
      insurerNames: ['Prudential'],
      envAllowlist: new Set(['Prudential']),
      dbRouting: new Map<string, Corpus>([['Prudential', 'shadow']]),
      overrideCorpus: null,
    }),
    'shadow' as Corpus
  )
  eq(
    'overrideCorpus: undefined falls through to env+DB',
    chooseRetrievalCorpus({
      insurerNames: ['Prudential'],
      envAllowlist: new Set(['Prudential']),
      dbRouting: new Map<string, Corpus>([['Prudential', 'shadow']]),
    }),
    'shadow' as Corpus
  )
}

// ---------------------------------------------------------------------------
// Gate 9 — search.ts uses rpcName variable; default env => match_documents
// ---------------------------------------------------------------------------
function gateSearchTsWiring(): void {
  console.log('\n## gate 9 — search.ts wired correctly (default env stays legacy)')
  const source = readFileSync(SEARCH_TS_PATH, 'utf8')

  ok(
    "search.ts imports chooseRetrievalCorpus",
    /import\s*\{[^}]*chooseRetrievalCorpus[^}]*\}\s*from\s*['"]@\/config\/corpus-routing['"]/.test(
      source
    )
  )
  ok(
    "search.ts imports the Corpus type",
    /import\s*\{[^}]*type\s+Corpus[^}]*\}\s*from\s*['"]@\/config\/corpus-routing['"]/.test(
      source
    )
  )
  ok(
    'search.ts declares an rpcName variable (typed union match_documents | match_shadow_documents)',
    /rpcName\s*:\s*['"]match_documents['"]\s*\|\s*['"]match_shadow_documents['"]/.test(source)
  )
  ok(
    'search.ts calls supabase.rpc with the rpcName variable (not the literal string)',
    /supabase\.rpc\s+as\s+any\)\(\s*rpcName\s*,/.test(source) ||
      /supabase\.rpc\s*as\s*any\)\(\s*rpcName\s*,/.test(source)
  )
  ok(
    "search.ts does NOT call supabase.rpc with the bare 'match_documents' literal anymore",
    !/supabase\.rpc\s*as\s*any\)\(\s*['"]match_documents['"]\s*,/.test(source)
  )
  ok(
    'search.ts uses chooseRetrievalCorpus to pick the rpcName',
    /chooseRetrievalCorpus\s*\(/.test(source)
  )

  // Equivalent behavioural assertion: with the default empty env and no
  // insurerNames threaded from callers (slice 3C-a state), the helper
  // returns 'legacy'. That maps directly to rpcName='match_documents'.
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, undefined, () => {
    eq(
      'default env + no insurerNames -> legacy (=> rpcName match_documents)',
      chooseRetrievalCorpus({ insurerNames: [] }),
      'legacy' as Corpus
    )
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, '', () => {
    eq(
      'empty env + Prudential single-insurer -> legacy (rpcName match_documents)',
      chooseRetrievalCorpus({ insurerNames: ['Prudential'] }),
      'legacy' as Corpus
    )
  })
}

// ---------------------------------------------------------------------------
// Bonus — env parsing helper directly
// ---------------------------------------------------------------------------
function gateAllowlistParser(): void {
  console.log('\n## bonus — getShadowAllowlistFromEnv parser')
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, undefined, () => {
    eq('unset env -> empty set size', getShadowAllowlistFromEnv().size, 0)
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, '', () => {
    eq('empty string -> empty set size', getShadowAllowlistFromEnv().size, 0)
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, 'Prudential', () => {
    const set = getShadowAllowlistFromEnv()
    ok('single value parsed', set.has('Prudential') && set.size === 1)
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, ' Prudential , Azos , MAG ', () => {
    const set = getShadowAllowlistFromEnv()
    ok(
      'whitespace tolerant + multi-value',
      set.has('Prudential') && set.has('Azos') && set.has('MAG') && set.size === 3
    )
  })
  withEnv(SHADOW_ALLOWLIST_ENV_VAR, 'Prudential,,Azos,', () => {
    const set = getShadowAllowlistFromEnv()
    ok(
      'empty segments dropped',
      set.has('Prudential') && set.has('Azos') && set.size === 2
    )
  })
}

function main(): void {
  console.log('# corpus-routing pure-helper test (slice 3C-a)')
  gateEmptyAllowlist()
  gateGlobalQuery()
  gateMultiInsurer()
  gateInsurerNotInAllowlist()
  gateAllowlistButNoDb()
  gateAllowlistAndDbShadow()
  gateNonPrudentialStayLegacy()
  gateOverrideHook()
  gateSearchTsWiring()
  gateAllowlistParser()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
