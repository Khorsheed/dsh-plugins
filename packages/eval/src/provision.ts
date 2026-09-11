/**
 * Writing a condition's lock — the record of what was actually BUILT for a
 * subject, as against what its declaration claims.
 *
 * A condition document is a claim: "this subject runs harness H under preset
 * P with a scoped home hashing to S". Three of those four had a checkable
 * counterpart long before this module (the condition hash, the harness the
 * readiness probe delegates to, `home.sha`); `preset` had none — nothing
 * wrote a preset anywhere, so nothing could disagree with the claim. The
 * lock's `provisioned` block is where the claim meets the build:
 * `provisioned.preset` is the preset read back from the sub-profile that was
 * written, and `provisioned.capabilities.sha` is the capability fingerprint
 * `capability-catalog` computed over that environment's skill and tool face.
 *
 * This module owns the FILE and the SHAPE, not the act: it never provisions
 * a scoped home, launches anything, or computes a capability hash. Its
 * caller — `conditions provision` — materializes the environment, asks the
 * catalog for the face, and hands the results here. Keeping the write
 * separate is what lets the lock's contract be tested without a machine.
 * @module @khorsheed/dsh-eval
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { hashConditionDocument } from './hash.ts'
import { LOCK_SCHEMA, LOCK_SCHEMA_ID, SHA256_HEX_RE, validateJson } from './schema.ts'

/** The capability fingerprint a provisioned environment reports. */
export interface ProvisionedCapabilities {
  /**
   * 64-hex sha256 of the canonical capability face — `capability-catalog`'s
   * `hashOf(snapshotFor(preset))`, the `caps:` tag without its prefix. This
   * module accepts the digest and never recomputes it: the canonical form is
   * the catalog's contract, and eval imports no sibling package.
   */
  sha: string
  /** The preset the face was taken under; null for an environment with no roster. */
  preset?: string | null
  /** Reader aids — how many rows the face carried. The sha is the identity. */
  skills?: number
  tools?: number
}

/** What {@link writeConditionLock} records beyond the condition hash. */
export interface ConditionLockFacts {
  /** The scoped home's config hash (`hashHome`), once it is materialized. */
  homeSha?: string
  /** The preset the provisioned environment composes, read back from what was written. */
  preset?: string | null
  /** The provisioned environment's capability fingerprint. */
  capabilities?: ProvisionedCapabilities
}

/** The lock document, as written. */
export interface ConditionLock {
  schema: typeof LOCK_SCHEMA_ID
  condition: string
  sha: string
  home?: { sha: string }
  provisioned?: {
    preset?: string | null
    capabilities?: ProvisionedCapabilities
  }
}

/**
 * Build a condition's lock document from its declaration plus what provision
 * built. Pure — no filesystem — so the shape is testable on its own.
 * @param id - the condition id (its file stem under `conditions/`).
 * @param document - the condition declaration, verbatim.
 * @param facts - what provision built; an empty object locks the hash alone.
 * @returns the lock document.
 * @throws when a supplied digest is not a 64-hex sha256 (a lock carrying a
 *   malformed hash is worse than no lock: it reads as verified).
 */
export function conditionLockOf(id: string, document: unknown, facts: ConditionLockFacts = {}): ConditionLock {
  const sha = hashConditionDocument(document)
  if (facts.homeSha !== undefined && !SHA256_HEX_RE.test(facts.homeSha)) {
    throw new TypeError(`condition ${id}: home sha ${JSON.stringify(facts.homeSha)} is not a 64-hex sha256`)
  }
  if (facts.capabilities !== undefined && !SHA256_HEX_RE.test(facts.capabilities.sha)) {
    throw new TypeError(`condition ${id}: capability sha ${JSON.stringify(facts.capabilities.sha)} is not a 64-hex sha256`)
  }
  const provisioned = {
    ...facts.preset !== undefined ? { preset: facts.preset } : {},
    ...facts.capabilities !== undefined
      ? {
        capabilities: {
          sha: facts.capabilities.sha,
          ...facts.capabilities.preset !== undefined ? { preset: facts.capabilities.preset } : {},
          ...facts.capabilities.skills !== undefined ? { skills: facts.capabilities.skills } : {},
          ...facts.capabilities.tools !== undefined ? { tools: facts.capabilities.tools } : {},
        },
      }
      : {},
  }
  const lock: ConditionLock = {
    schema: LOCK_SCHEMA_ID,
    condition: id,
    sha,
    ...facts.homeSha !== undefined ? { home: { sha: facts.homeSha } } : {},
    // An empty `provisioned` is not written: "provision has not run" and
    // "provision ran and built nothing" must not read alike.
    ...Object.keys(provisioned).length > 0 ? { provisioned } : {},
  }
  const violations = validateJson(LOCK_SCHEMA, lock)
  if (violations.length > 0) {
    throw new TypeError(`condition ${id}: the lock this would write violates ${LOCK_SCHEMA_ID}: ${violations.join('; ')}`)
  }
  return lock
}

/**
 * Write `conditions/<id>.lock.json` under a dataset root.
 * @param datasetRoot - the dataset-set directory holding `conditions/`.
 * @param id - the condition id.
 * @param document - the condition declaration the hash is taken over.
 * @param facts - what provision built.
 * @returns the lock written and the path it landed at.
 */
export async function writeConditionLock(
  datasetRoot: string,
  id: string,
  document: unknown,
  facts: ConditionLockFacts = {},
): Promise<{ path: string; lock: ConditionLock }> {
  const lock = conditionLockOf(id, document, facts)
  const path = join(datasetRoot, 'conditions', `${id}.lock.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  return { path, lock }
}
