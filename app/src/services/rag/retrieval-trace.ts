/**
 * Per-retrieval telemetry writer.
 *
 * Slice 3C-b. Writes one row to the `retrieval_traces` table for every
 * successful or failed retrieval. The write is best-effort and MUST
 * NEVER propagate failures: if the insert errors, the user request
 * continues to serve normally.
 *
 * Design ref: docs/phase-2-pr3c-promotion-design.md sections 3.5, 3.7.
 *
 * Notes:
 *  - PII: only sha256(question) is stored in `user_question_hash`. The
 *    raw question text is never written here (per CEO decision at PR
 *    #49 merge: v1 is hash-only).
 *  - Concurrency: this module never awaits the insert. The Promise is
 *    intentionally fire-and-forget with an attached .catch() so that
 *    Node does not emit unhandled rejection warnings.
 *  - Coupling: this helper holds NO state and reads NO env. The only
 *    side-effect is the DB insert + a single console.warn on failure.
 */

import { randomUUID, createHash } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase'
import type { Corpus } from '@/config/corpus-routing'

/** Callers that invoke the retrieval pipeline. */
export type RetrievalSource =
  | 'ask'
  | 'stream'
  | 'compare'
  | 'pre-sinistro'
  | 'api-search'
  | 'api-knowledge-search'
  | 'unknown'

export type TraceMode = 'serve' | 'preview-only'

export type FallbackReason =
  | 'rpc_error'
  | 'empty_result'
  | 'flag_off'
  | 'timeout'

export interface RetrievalTraceInput {
  /**
   * Stable id correlating this trace with caller-side logs / Langfuse.
   * Optional: when absent, the writer generates a fresh UUID. Callers
   * that have a request_id (e.g. ask() with a langfuse trace) SHOULD
   * pass it to enable cross-system correlation.
   */
  requestId?: string

  /**
   * Canonical insurer name (e.g. 'Prudential') from detectInsurers(),
   * if the caller knows it. `null`-friendly because some callers do
   * not pass insurerNames in slice 3C-b.
   */
  insurerName?: string | null

  /** Which RPC actually served (or attempted) the chunks. */
  corpus: Corpus

  /** Default 'serve'. 'preview-only' reserved for slice 3C-c. */
  mode?: TraceMode

  /** Wall-clock duration of the RPC call. Must be >= 0. */
  latencyMs: number

  /** Length of the chunks array returned. 0 on RPC error or empty. */
  chunksReturned: number

  /**
   * true if the originally chosen corpus failed and we fell back to
   * legacy. Slice 3C-b never auto-falls-back, so this is always false
   * in this slice. Reserved for slice 3C-c+.
   */
  fallbackUsed?: boolean
  fallbackReason?: FallbackReason | null

  /** Whether Cohere rerank was used downstream. Default false. */
  rerankUsed?: boolean

  /** Which caller asked. Used to filter dashboards. */
  source: RetrievalSource

  /**
   * Optional raw question text. When provided, hashed here before insert.
   * Callers that don't have the question (e.g. semanticSearchWithEmbedding
   * called directly) pass nothing -> user_question_hash stays NULL.
   */
  question?: string
}

/**
 * Fire-and-forget retrieval trace writer.
 *
 * Returns immediately; the actual DB insert runs on the microtask queue
 * and any failure is logged but never thrown. Designed to be the LAST
 * statement of an instrumented retrieval block, after `data` and
 * `error` are already known.
 */
export function recordRetrievalTrace(input: RetrievalTraceInput): void {
  // Compute the hash synchronously so we don't capture potentially
  // large question strings into the async closure.
  const hash =
    typeof input.question === 'string' && input.question.length > 0
      ? sha256Hex(normalizeQuestion(input.question))
      : null

  void writeTraceRow(input, hash).catch((err) => {
    // Best-effort: log + swallow. The user request continues either way.
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[rag/retrieval-trace] insert failed:', msg)
  })
}

/** Normalize a question before hashing: trim + lowercase. */
function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase()
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

async function writeTraceRow(
  input: RetrievalTraceInput,
  questionHash: string | null
): Promise<void> {
  const supabase = createServiceClient()
  const row = {
    request_id: input.requestId ?? randomUUID(),
    user_question_hash: questionHash,
    insurer_name: input.insurerName ?? null,
    corpus: input.corpus,
    mode: input.mode ?? 'serve',
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    chunks_returned: Math.max(0, Math.round(input.chunksReturned)),
    fallback_used: input.fallbackUsed ?? false,
    fallback_reason: input.fallbackReason ?? null,
    rerank_used: input.rerankUsed ?? false,
    source: input.source,
  }
  // The Database types do not yet know retrieval_traces (no codegen run
  // in this slice). Cast to any to avoid a heavy schema regen for a
  // single insert; the row shape is enforced by the migration's CHECK
  // constraints at the DB level.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from as any)('retrieval_traces').insert([row])
  if (error) {
    throw new Error(error.message ?? 'unknown insert error')
  }
}
