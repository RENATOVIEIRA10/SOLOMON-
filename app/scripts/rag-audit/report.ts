/**
 * RAG audit — single-file consolidated report runner.
 *
 * READ-ONLY. Runs every other script in this directory and concatenates the
 * markdown output, so a fresh snapshot can be regenerated with one command.
 *
 * Usage (from app/):
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/rag-audit/report.ts > ../docs/audit-runs/full-$(date +%Y%m%d).md
 */

import { spawn } from 'node:child_process'
import path from 'node:path'

const SCRIPTS = [
  'inventory.ts',
  'audit-azure-di.ts',
  'test-rag-exclude.ts',
  'test-source-type-routing.ts',
]

async function runOne(scriptName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
    const target = path.join(here, scriptName)
    const child = spawn(
      'npx',
      ['tsx', '--tsconfig', 'scripts/tsconfig.json', target],
      {
        stdio: ['ignore', 'inherit', 'inherit'],
        shell: process.platform === 'win32',
      }
    )
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${scriptName} exited with code ${code}`))
    })
  })
}

async function main() {
  console.log(`# SOLOMON RAG full audit report`)
  console.log(`_Generated: ${new Date().toISOString()}_`)
  console.log()
  console.log(`Read-only. No production data is modified.`)
  console.log()

  for (const s of SCRIPTS) {
    console.log(`\n\n---\n# Section: ${s}\n`)
    try {
      await runOne(s)
    } catch (err) {
      console.log(`\n_Error running ${s}: ${(err as Error).message}_`)
    }
  }
}

main().catch((err) => {
  console.error('[rag-audit/report] fatal:', err)
  process.exit(1)
})
