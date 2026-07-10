/**
 * OpenDataLoader runner test.
 *
 * The pure part (`buildJavaArgs`) is asserted directly. The impure part
 * (`runOpenDataLoader`) is asserted for its failure contract, plus a real
 * end-to-end run that only executes when the jar and a test PDF are present:
 *
 *   OPENDATALOADER_JAR=/path/opendataloader-pdf-cli.jar \
 *   ODL_TEST_PDF=/root/pixelrag-poc/pdfs/mag-vida-inteira.pdf \
 *   npm run phase2:odl:runner:test
 *
 * Standalone tsx, exit code 0/1. No network, no DB, no credentials.
 */

import { existsSync } from 'node:fs'

import { buildJavaArgs, runOpenDataLoader } from '../../src/services/opendataloader/runner'

let passed = 0
let failed = 0

function ok(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function runArgsTests(): void {
  console.log('\n## buildJavaArgs (pure)')

  const args = buildJavaArgs({
    jarPath: '/opt/odl.jar',
    pdfPath: '/docs/a.pdf',
    outputDir: '/tmp/out',
  })

  ok('runs headless', args.includes('-Djava.awt.headless=true'))
  ok('-jar is followed by the jar path', args[args.indexOf('-jar') + 1] === '/opt/odl.jar')
  ok('the pdf path is passed', args.includes('/docs/a.pdf'))
  ok('asks for json output', args[args.indexOf('--format') + 1] === 'json')
  ok('passes the output dir', args[args.indexOf('--output-dir') + 1] === '/tmp/out')
  ok('no heap cap unless asked', !args.some((a) => a.startsWith('-Xmx')))

  const capped = buildJavaArgs({
    jarPath: '/opt/odl.jar',
    pdfPath: '/docs/a.pdf',
    outputDir: '/tmp/out',
    maxHeapMb: 512,
  })
  ok(
    'heap cap is a JVM flag, so it must precede -jar',
    capped.includes('-Xmx512m') && capped.indexOf('-Xmx512m') < capped.indexOf('-jar'),
  )
}

async function runFailureContract(): Promise<void> {
  console.log('\n## failure contract')

  let missingJar = ''
  try {
    await runOpenDataLoader('/docs/a.pdf', { jarPath: '/nope/missing.jar' })
  } catch (err) {
    missingJar = (err as Error).message
  }
  ok(
    'a missing jar raises a clear error naming the jar',
    /jar not found/i.test(missingJar),
    missingJar,
  )

  let missingPdf = ''
  const jar = process.env.OPENDATALOADER_JAR
  if (jar && existsSync(jar)) {
    try {
      await runOpenDataLoader('/nope/missing.pdf', { jarPath: jar })
    } catch (err) {
      missingPdf = (err as Error).message
    }
    ok('a missing pdf raises a clear error', /pdf not found/i.test(missingPdf), missingPdf)
  } else {
    console.log('  skip missing-pdf check (no OPENDATALOADER_JAR)')
  }
}

async function runIntegration(): Promise<void> {
  console.log('\n## integration (real jar + real pdf)')

  const jar = process.env.OPENDATALOADER_JAR
  const pdf = process.env.ODL_TEST_PDF
  if (!jar || !pdf || !existsSync(jar) || !existsSync(pdf)) {
    console.log('  skip (set OPENDATALOADER_JAR and ODL_TEST_PDF)')
    return
  }

  const doc = await runOpenDataLoader(pdf, { jarPath: jar, maxHeapMb: 512 })
  ok('returns a document tree with kids', Array.isArray(doc.kids) && doc.kids.length > 0)
  ok(
    'the MAG conditions PDF yields exactly 2 tables',
    doc.kids.filter((k) => k.type === 'table').length === 2,
    `got ${doc.kids.filter((k) => k.type === 'table').length}`,
  )
  ok('page count is reported', (doc['number of pages'] ?? 0) > 0)
}

async function main(): Promise<void> {
  console.log('# opendataloader runner test')
  runArgsTests()
  await runFailureContract()
  await runIntegration()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
