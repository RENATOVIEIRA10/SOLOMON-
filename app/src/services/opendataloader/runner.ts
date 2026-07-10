/**
 * Runs the OpenDataLoader-PDF CLI (a Java jar) and returns its parsed JSON.
 *
 * The published package is Python-only (no npm SDK exists), but it merely
 * shells out to `java -jar opendataloader-pdf-cli.jar`. We do the same
 * directly from Node — no Python in the path.
 *
 * The jar is ~24 MB, so it is NOT committed. Point `OPENDATALOADER_JAR` at it
 * (the pip package ships it under
 * `site-packages/opendataloader_pdf/jar/opendataloader-pdf-cli.jar`).
 *
 * Local, offline, no credentials: it never touches the network.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { OdlDocument } from './types'

const DEFAULT_TIMEOUT_MS = 300_000

export interface JavaArgsInput {
  jarPath: string
  pdfPath: string
  outputDir: string
  /** Cap the JVM heap — the VPS runs production alongside this. */
  maxHeapMb?: number
}

/** Pure: the exact argv handed to `java`. Split out so it can be asserted. */
export function buildJavaArgs(input: JavaArgsInput): string[] {
  const args = ['-Djava.awt.headless=true']
  if (input.maxHeapMb) args.push(`-Xmx${input.maxHeapMb}m`)
  args.push(
    '-jar',
    input.jarPath,
    input.pdfPath,
    '--output-dir',
    input.outputDir,
    '--format',
    'json',
  )
  return args
}

export interface RunOptions {
  jarPath?: string
  javaBin?: string
  maxHeapMb?: number
  timeoutMs?: number
}

/**
 * Parse `pdfPath` with OpenDataLoader and return the raw document tree.
 * Writes into a throwaway temp dir which is always cleaned up.
 */
export async function runOpenDataLoader(
  pdfPath: string,
  opts: RunOptions = {},
): Promise<OdlDocument> {
  const jarPath = opts.jarPath ?? process.env.OPENDATALOADER_JAR
  if (!jarPath) {
    throw new Error(
      'OpenDataLoader jar not configured: set OPENDATALOADER_JAR or pass jarPath',
    )
  }
  if (!existsSync(jarPath)) {
    throw new Error(`OpenDataLoader jar not found at ${jarPath}`)
  }
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found at ${pdfPath}`)
  }

  const outputDir = mkdtempSync(path.join(tmpdir(), 'odl-'))
  try {
    await execJava(
      opts.javaBin ?? 'java',
      buildJavaArgs({ jarPath, pdfPath, outputDir, maxHeapMb: opts.maxHeapMb }),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    const jsonFile = readdirSync(outputDir).find((f) => f.endsWith('.json'))
    if (!jsonFile) {
      throw new Error(`OpenDataLoader produced no JSON for ${pdfPath}`)
    }
    return JSON.parse(readFileSync(path.join(outputDir, jsonFile), 'utf8')) as OdlDocument
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
}

function execJava(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`OpenDataLoader timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`failed to spawn ${bin}: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`OpenDataLoader exited ${code}: ${stderr.slice(-500)}`))
    })
  })
}
