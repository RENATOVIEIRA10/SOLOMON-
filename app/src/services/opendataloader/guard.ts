/**
 * Insurer-scope guard for the OpenDataLoader shadow path.
 *
 * The Azure DI path is Prudential-only by design (PR 3B slice 3B.5). The
 * OpenDataLoader path targets the four insurers that actually carry the
 * commercial life-insurance business: Prudential, MAG, MetLife and Azos.
 * Three of them (MAG, MetLife, Azos) are indexed today by the legacy text
 * extractor, whose corpus has zero table chunks.
 *
 * SCOPE ONLY. This decides *which insurer* may be shadow-indexed. It does not
 * — and must not — relax inertness: `assertRowsAreInert`, the embedder's
 * `assertEmbeddingTargetIsShadow`, and the read-path leak probes still apply
 * to every row, and no caller can opt out of them.
 */

/** Insurer-name substrings allowed on the OpenDataLoader shadow path. */
export const OPENDATALOADER_ALLOWED_INSURERS = [
  'prudential',
  'mag',
  'metlife',
  'azos',
] as const

/** Raised when an insurer falls outside the OpenDataLoader scope. */
export class InsurerNotAllowedError extends Error {
  readonly insurerName: string

  constructor(insurerName: string, allowed: readonly string[]) {
    super(
      `Insurer "${insurerName}" is outside the OpenDataLoader scope. ` +
        `Allowed (substring match): ${allowed.join(', ')}.`,
    )
    this.name = 'InsurerNotAllowedError'
    this.insurerName = insurerName
  }
}

/**
 * Throws {@link InsurerNotAllowedError} unless `insurerName` matches one of
 * `allowed` (case-insensitive substring). Defense-in-depth: even if a CLI
 * passes the wrong insurer id, the pipeline still refuses.
 */
export function assertInsurerAllowed(
  insurerName: string,
  allowed: readonly string[] = OPENDATALOADER_ALLOWED_INSURERS,
): void {
  const normalized = insurerName.trim().toLowerCase()
  if (normalized.length === 0) {
    throw new InsurerNotAllowedError(insurerName, allowed)
  }
  if (!allowed.some((keyword) => normalized.includes(keyword))) {
    throw new InsurerNotAllowedError(insurerName, allowed)
  }
}
