/**
 * Corpus selection for the SOLOMON retrieval read path.
 *
 * Pure helper. No I/O, no global state outside `process.env`. Given the
 * canonical insurer names detected in the question (plus optional
 * test/DB hooks), returns which corpus -- legacy or shadow -- the
 * retrieval should hit.
 *
 * Slice 3C-a scaffold. The helper is wired into search.ts but designed
 * so that with the default environment (SHADOW_CORPUS_ALLOWLIST unset
 * or empty), the result is ALWAYS 'legacy'. Shadow can never be reached
 * by accident.
 *
 * The `dbRouting` argument is present in the signature so the later
 * slice (3C-b, telemetry + corpus_routing table) can wire the runtime
 * routing source without changing this module's public API. In slice
 * 3C-a the DB table does not exist yet, so callers pass `undefined`
 * and that branch never fires.
 *
 * Design reference: docs/phase-2-pr3c-promotion-design.md
 *   sections 3.1 (decision tree), 3.2 (env + DB AND-gate), 3.4 (barriers
 *   against accidental global activation).
 *
 * Forward sequence:
 *   - 3C-a (this slice): helper + search.ts edit, allowlist empty.
 *   - 3C-b: corpus_routing migration + dbRouting wiring + telemetry.
 *   - 3C-c: preview-only mode.
 *   - 3C-d: canary flip.
 *   - 3C-e: full Prudential flip.
 */

/** The two corpora addressable from the read path. */
export type Corpus = 'legacy' | 'shadow'

export interface CorpusRoutingOptions {
  /**
   * Canonical insurer names detected in the user question, in the
   * shape produced by `detectInsurers(question)` (see answer.ts).
   * Single-element array is the only case eligible for shadow; zero
   * or two+ entries always resolve to legacy.
   */
  insurerNames: readonly string[]

  /**
   * Per-insurer runtime routing table. Loaded from the `corpus_routing`
   * DB table in slice 3C-b. When absent (this slice), no insurer
   * resolves to shadow regardless of the env allowlist -- both layers
   * must agree per the design.
   */
  dbRouting?: ReadonlyMap<string, Corpus>

  /**
   * Test-only / preview override. When set to a Corpus value, returned
   * verbatim and the env + DB checks are bypassed. When set to `null`
   * or omitted, the normal decision tree runs. Production callers MUST
   * NOT pass a non-null value here.
   */
  overrideCorpus?: Corpus | null

  /**
   * Allowlist source. Defaults to reading `process.env.SHADOW_CORPUS_ALLOWLIST`
   * at call time via `getShadowAllowlistFromEnv()`. Override-able for
   * deterministic tests.
   */
  envAllowlist?: ReadonlySet<string>
}

/**
 * The environment variable that gates which insurers are even eligible
 * to be routed to the shadow corpus. Comma-separated canonical names.
 * Empty / unset => no insurer is shadow-eligible.
 */
export const SHADOW_ALLOWLIST_ENV_VAR = 'SHADOW_CORPUS_ALLOWLIST'

/**
 * The environment variable that gates which insurers run a shadow
 * preview retrieval ALONGSIDE the legacy serve. Comma-separated
 * canonical names. Empty / unset => no insurer triggers preview.
 *
 * Slice 3C-c. Preview mode is strictly separate from serve mode:
 *  - SHADOW_CORPUS_ALLOWLIST controls who can be SERVED by shadow.
 *  - SHADOW_PREVIEW_INSURERS controls who is OBSERVED via shadow
 *    while legacy keeps serving.
 * The two envs can be set independently; in 3C-c both surfaces are
 * deliberately kept disjoint (allowlist empty, preview list optional).
 */
export const SHADOW_PREVIEW_ENV_VAR = 'SHADOW_PREVIEW_INSURERS'

function parseInsurerList(raw: string | undefined): ReadonlySet<string> {
  if (!raw || !raw.trim()) return new Set<string>()
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  )
}

/**
 * Parse `SHADOW_CORPUS_ALLOWLIST` into a Set of canonical insurer names.
 * Empty / unset env => empty set => no insurer eligible.
 */
export function getShadowAllowlistFromEnv(): ReadonlySet<string> {
  return parseInsurerList(process.env[SHADOW_ALLOWLIST_ENV_VAR])
}

/**
 * Parse `SHADOW_PREVIEW_INSURERS` into a Set of canonical insurer names.
 * Same shape as the allowlist parser. Empty / unset env => empty set
 * => no preview triggered for any insurer.
 */
export function getShadowPreviewListFromEnv(): ReadonlySet<string> {
  return parseInsurerList(process.env[SHADOW_PREVIEW_ENV_VAR])
}

export interface ShadowPreviewOptions {
  /** Canonical insurer names from detectInsurers(question). */
  insurerNames: readonly string[]
  /**
   * Override-able for tests. Defaults to reading SHADOW_PREVIEW_INSURERS.
   */
  envPreviewList?: ReadonlySet<string>
  /**
   * The corpus that WAS chosen to serve. Preview only makes sense
   * when serving legacy (we observe what shadow would have done).
   * If serving shadow already, preview is redundant.
   */
  servedCorpus: Corpus
}

/**
 * Decide whether to run a shadow-corpus retrieval ALONGSIDE legacy in
 * preview-only mode. The shadow result is NEVER returned to the user
 * in slice 3C-c; it is traced with mode='preview-only' and discarded.
 *
 * Conditions (all must hold):
 *   1. servedCorpus === 'legacy' (preview makes no sense if shadow served)
 *   2. insurerNames.length === 1 (single-insurer queries only)
 *   3. envPreviewList.has(insurerNames[0]) (case-sensitive whitelist)
 */
export function shouldRunShadowPreview(options: ShadowPreviewOptions): boolean {
  if (options.servedCorpus !== 'legacy') return false
  if (options.insurerNames.length !== 1) return false
  const insurer = options.insurerNames[0]
  if (typeof insurer !== 'string' || insurer.length === 0) return false
  const list = options.envPreviewList ?? getShadowPreviewListFromEnv()
  return list.has(insurer)
}

/**
 * Decide which corpus the read path should hit.
 *
 * Decision tree (first match wins):
 *   1. `overrideCorpus` set?            -> return it (test/preview hook)
 *   2. `insurerNames.length !== 1`?     -> 'legacy'   (multi/global)
 *   3. `envAllowlist.has(insurer)`?     -> if no, 'legacy'
 *   4. `dbRouting.get(insurer) === 'shadow'`?  -> 'shadow' (AND-gate satisfied)
 *   5. otherwise                        -> 'legacy'
 *
 * With the slice-3C-a default (env empty + dbRouting undefined), step
 * 3 fails for every input that survives step 2, so the function
 * returns 'legacy' for every production call.
 */
export function chooseRetrievalCorpus(options: CorpusRoutingOptions): Corpus {
  // 1) Test/preview override.
  if (options.overrideCorpus !== undefined && options.overrideCorpus !== null) {
    return options.overrideCorpus
  }

  // 2) Multi-insurer / global queries always use the full corpus.
  if (options.insurerNames.length !== 1) {
    return 'legacy'
  }

  const insurer = options.insurerNames[0]
  if (typeof insurer !== 'string' || insurer.length === 0) {
    return 'legacy'
  }

  // 3) Env allowlist gate (build-time floor).
  const allowlist = options.envAllowlist ?? getShadowAllowlistFromEnv()
  if (!allowlist.has(insurer)) {
    return 'legacy'
  }

  // 4) DB runtime selector. Empty / missing dbRouting => legacy.
  const dbMode = options.dbRouting?.get(insurer)
  if (dbMode === 'shadow') {
    return 'shadow'
  }

  // 5) Safe default.
  return 'legacy'
}
