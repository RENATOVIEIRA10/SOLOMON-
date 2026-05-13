/**
 * Phase 3A — Gate G2 — Static regression test for the source_type filter.
 *
 * READ-ONLY. Does not import or execute application code. Reads `compare.ts`
 * and `pre-sinistro.ts` as text and asserts that EVERY invocation of
 * `semanticSearch(...)` in those two files carries `sourceType: 'conditions_pdf'`
 * (or `"conditions_pdf"`) in its options object.
 *
 * Rationale:
 *   - The repo has no test runner (Vitest / Jest / node:test) wired up; adding
 *     one is outside the closed scope CEO approved for G2 (memory:
 *     phase-3a-g2 scope = source_type filter + tests, no new infra).
 *   - The behavioural test that exercises pgvector routing already exists at
 *     `app/scripts/rag-audit/test-source-type-routing.ts` — it answers the
 *     question "do rate-intent queries leak into conditions_pdf at the RPC
 *     level". This script is the complementary invariant: "do the verbal
 *     query call sites pass the filter at all".
 *   - This script catches regressions that re-introduce an un-filtered
 *     `semanticSearch` call in either file (anyone editing the loop forgets
 *     the option, the test fails).
 *
 * Exit codes:
 *   0 — all `semanticSearch` calls in both files carry the required option.
 *   1 — at least one call is missing the option, or the file cannot be parsed.
 *
 * Usage (from `app/`):
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/test-source-type-filter.ts
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const APP_SRC = path.resolve(SCRIPT_DIR, '../../src')

const TARGETS = [
  { file: 'services/rag/compare.ts', label: 'compareInsurers' },
  { file: 'services/rag/pre-sinistro.ts', label: 'analyzePreSinistro' },
]

const REQUIRED_LITERAL_VARIANTS = [
  "sourceType: 'conditions_pdf'",
  'sourceType: "conditions_pdf"',
]

interface Invocation {
  /** 1-based line number of the `semanticSearch(` token. */
  line: number
  /** Raw text from `semanticSearch(` to the matching `)`. */
  text: string
}

/**
 * Extracts every `semanticSearch(...)` invocation from a source text, with
 * balanced-parens scanning so options objects with nested `{}` are tolerated.
 */
function extractInvocations(src: string): Invocation[] {
  const out: Invocation[] = []
  const needle = 'semanticSearch('
  let i = 0
  while (i < src.length) {
    const idx = src.indexOf(needle, i)
    if (idx === -1) break

    // Skip if it is part of `semanticSearchWithEmbedding(` or `semanticSearchAndRerank(`.
    // Easier: require the prior char to be a non-identifier char or start of file,
    // AND the next character after "semanticSearch" to be '(' (not letter).
    const before = idx === 0 ? '' : src[idx - 1]
    if (/[A-Za-z0-9_$]/.test(before)) {
      i = idx + needle.length
      continue
    }

    // Balanced parens scan.
    let depth = 1
    let j = idx + needle.length
    while (j < src.length && depth > 0) {
      const ch = src[j]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (depth === 0) break
      j++
    }
    if (depth !== 0) {
      throw new Error(`Unbalanced parens for semanticSearch at offset ${idx}`)
    }

    const text = src.slice(idx, j + 1)
    // 1-based line number of the call site.
    const line = src.slice(0, idx).split('\n').length
    out.push({ line, text })
    i = j + 1
  }
  return out
}

function hasRequiredFilter(invocationText: string): boolean {
  return REQUIRED_LITERAL_VARIANTS.some((v) => invocationText.includes(v))
}

interface FailureRow {
  file: string
  label: string
  line: number
  excerpt: string
}

async function main() {
  console.log('# Phase 3A G2 — source_type filter regression test')
  console.log(`_Run: ${new Date().toISOString()}_`)
  console.log()

  let totalCalls = 0
  const failures: FailureRow[] = []

  for (const t of TARGETS) {
    const full = path.join(APP_SRC, t.file)
    const src = await readFile(full, 'utf8')
    const calls = extractInvocations(src)
    if (calls.length === 0) {
      // Defensive: if a target file no longer calls semanticSearch the test
      // is still meaningful (it asserts the OPPOSITE — accidental removal
      // of the call site is itself worth surfacing).
      failures.push({
        file: t.file,
        label: t.label,
        line: 0,
        excerpt: '(no semanticSearch call found in this file — was the file refactored?)',
      })
      continue
    }
    totalCalls += calls.length
    console.log(`- \`${t.file}\` — ${calls.length} \`semanticSearch(...)\` call(s):`)
    for (const c of calls) {
      const ok = hasRequiredFilter(c.text)
      const marker = ok ? 'OK' : 'FAIL'
      const oneLine = c.text.replace(/\s+/g, ' ').slice(0, 140)
      console.log(`    ${marker} L${c.line}: ${oneLine}${c.text.length > 140 ? '…' : ''}`)
      if (!ok) failures.push({ file: t.file, label: t.label, line: c.line, excerpt: oneLine })
    }
  }

  console.log()
  console.log(`Total \`semanticSearch(...)\` call sites inspected: **${totalCalls}**`)
  console.log(`Required filter literal: \`${REQUIRED_LITERAL_VARIANTS[0]}\``)

  if (failures.length === 0) {
    console.log()
    console.log('## Verdict: PASS')
    console.log()
    console.log('Every `semanticSearch(...)` in `compare.ts` and `pre-sinistro.ts` carries the required `sourceType: "conditions_pdf"` option.')
    process.exit(0)
  }

  console.log()
  console.log('## Verdict: FAIL')
  console.log()
  console.log('| file | call site | excerpt |')
  console.log('|---|---|---|')
  for (const f of failures) {
    console.log(`| \`${f.file}\` | L${f.line} (${f.label}) | \`${f.excerpt}\` |`)
  }
  process.exit(1)
}

main().catch((err) => {
  console.error('[phase-3a-g2/test-source-type-filter] fatal:', err)
  process.exit(1)
})
