/**
 * `conditions provision` (I4): the one verb that turns a condition DECLARATION
 * into a real scoped home and writes the anchor everything else reads.
 *
 * T8b built the anchor and both of its readers — `validate` reports
 * LOCK_STALE / HOME_NOT_PROVISIONED / HOME_MISMATCH off
 * `conditions/<id>.lock.json`, and the run loop refuses a stale lock outright
 * — but nothing in the repository ever WROTE one. This module is that writer,
 * and it is deliberately the only one: a lock minted by hand would claim the
 * scoped home was checked when nobody checked it.
 *
 * Five steps, each of which can stop:
 *
 * 1. resolve the condition's `(harness, scope)` to a scoped home — reading the
 *    directory materializes it;
 * 2. grade the credential. Anything but a present one stops here and prints
 *    the login command. Provision never logs in and never copies a credential
 *    from another scope: the human's login is the human's;
 * 3. read that scope's effective settings and check the declaration field by
 *    field ({@link checkAgainstEffective}). `permissions` and `model.endpoint`
 *    disagreeing is an ERROR and no lock is written;
 * 3b. compose the condition's `preset` into that scope
 *    (`localAgent.provisionScope`), which is what makes two scopes rostering
 *    two presets a property of the condition rather than of the deployment's
 *    plugin settings. It runs BEFORE the hash below, because the scope's own
 *    copy of the preset lives inside the scoped home;
 * 4. hash the scoped home's config content (`home.sha`) and WRITE IT BACK into
 *    the declaration when it disagrees ({@link ProvisionOptions.writeBack});
 * 5. measure the provisioned environment's CAPABILITY FACE, when the
 *    condition declares a `preset` ({@link ProvisionOptions.capabilities});
 * 6. write the lock.
 *
 * Step 4 used to stop at the hash. `home.sha` is hash input like every other
 * contract field, so a declaration saying null while the home hashes to
 * `29217f21…` is not ready — and the only way to make it ready was to copy the
 * digest out of the warning by hand and provision a SECOND time, because the
 * first lock had anchored the pre-edit condition hash. One human action, taken
 * twice, with a 64-character transcription in the middle (I5·T39 · G7). The
 * write-back closes it: the declaration is corrected, the condition is
 * re-hashed, and the lock minted below anchors the document as it now reads.
 * `writeBack: false` keeps the old two-step shape for a caller that wants the
 * declaration left alone.
 *
 * Step 5 is a HOOK rather than a built-in, and that is a boundary worth
 * stating: measuring a sub-dsh's capability face means booting its
 * sub-profile and asking the catalog mounted inside it, which is a launch
 * path this module deliberately does not own (see the T32 Agent Note). With
 * no hook supplied, a condition declaring a preset is locked WITHOUT a
 * capability record and warned about by name — and the readiness gate then
 * refuses it. The failure is loud at both ends rather than a lock that reads
 * as verified.
 *
 * Credentials never enter the lock, the log, or the report: the home hash
 * already excludes credential-shaped files by name and by directory, and
 * nothing here reads one.
 * @module @khorsheed/dsh-eval
 */
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { incompleteSections, readCapabilityCompositionShape } from './capability-composition.ts'
import { hashConditionDocument, hashHome, type HomeHash } from './contract/hash.ts'
import { CONDITION_ID_RE, CONDITION_SCHEMA_ID, LOCK_SCHEMA, LOCK_SCHEMA_ID, validateJson } from './contract/schema.ts'
import { checkAgainstEffective, flattenEffective, type ProvisionCheck } from './effective.ts'
import type {
  CapabilityCompositionEvidence, LocalAgentCredentialGrade, LocalAgentEffectiveSettingsFace, LocalAgentFace, LocalAgentScopeStatus,
  ScopedHomeEvidenceFace, ScopedHomeHashEvidence,
} from './faces.ts'
import { conditionDiagnostics, expandHome, type EvalDiagnostic } from './contract/validate.ts'

/** 64-hex sha256 — the shape every fingerprint crossing the evidence seam must carry. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/** The four credential grades — anything else crossing the seam is invalid evidence. */
const CREDENTIAL_GRADES: ReadonlySet<string> = new Set(['absent', 'present-unverified', 'verified', 'rejected'])

/** Thrown when provision cannot even begin — an unusable path, a facade that cannot answer. */
export class EvalProvisionRefused extends Error {
  constructor(message: string, readonly diagnostics: EvalDiagnostic[] = []) {
    super(message)
  }
}

/** The credential grades provision will anchor a lock against. */
const CREDENTIAL_PRESENT: ReadonlySet<string> = new Set(['present-unverified', 'verified'])

/** What one `conditions provision` did. */
export interface ProvisionReport {
  condition: string
  /** The declaration this ran against (absolute). */
  conditionPath: string
  /** Where the lock goes (absolute), written or not. */
  lockPath: string
  /** The directory writes are confined to — the condition library (T73). */
  repo: string
  harness: string
  /** The named scope, or null for the harness's default scoped home. */
  scope: string | null
  /** The scoped home the condition resolved to (materialized by the read). */
  homeDir: string
  /** The credential grade at provision time. */
  credentialState: string
  /** The condition hash. */
  sha: string
  /** The scoped home's config hash; null when the check stopped before step 4. */
  home: HomeHash | null
  /** Whether this provision corrected `home.sha` in the declaration (step 4). */
  homeShaWritten: boolean
  /**
   * The condition hash BEFORE the write-back corrected the declaration, or
   * null when nothing was written. `sha` above is always the hash of the
   * document as it now reads — which is what the lock anchors.
   */
  shaBeforeWriteBack: string | null
  /** The field-by-field verdicts, in contract order. */
  checks: ProvisionCheck[]
  /**
   * What composing this condition's preset into its scope reported back, or
   * null when this condition declares none (or the facade cannot compose
   * one). `preset` is the read-back, not the request.
   */
  scopeProvisioned: { preset: string | null; snapshotMatchesSource: boolean | null } | null
  /** Whether the lock was written. */
  written: boolean
  /** The lock document — present once it was built, whether or not it was written. */
  lock: Record<string, unknown> | null
  errors: EvalDiagnostic[]
  warnings: EvalDiagnostic[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Whether `child` is `root` or sits inside it. */
function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Ask the evidence face for the scoped home's fingerprint, and hold the answer
 * to the local read's contract: the producer-side identity is a non-empty
 * string, the digest is a 64-hex sha256, the counts are non-negative integers.
 * `undefined`, a throw, and every other shape are the local "the scoped home
 * cannot be read" outcome — a refusal, because a lock minted over them would
 * claim a measurement nobody made.
 */
async function readHomeEvidence(
  evidence: ScopedHomeEvidenceFace,
  harness: string,
  scope: string | null,
  named: string,
): Promise<ScopedHomeHashEvidence> {
  const homeHash = evidence.homeHash
  let answer: ScopedHomeHashEvidence | undefined
  try {
    answer = await homeHash?.(harness, scope ?? undefined)
  } catch (error) {
    throw new EvalProvisionRefused(`the evidence face could not fingerprint the scoped home for ${named}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (
    answer === undefined || !isPlainObject(answer)
    || typeof answer.homeDir !== 'string' || answer.homeDir === ''
    || typeof answer.sha !== 'string' || !SHA256_HEX_RE.test(answer.sha)
    || !Number.isInteger(answer.files) || (answer.files as number) < 0
    || !Number.isInteger(answer.denied) || (answer.denied as number) < 0
  ) {
    throw new EvalProvisionRefused(
      `the evidence face answered no usable home fingerprint for ${named}`
      + ' — the same outcome as a scoped home that cannot be read locally',
    )
  }
  return answer
}

/**
 * Ask the evidence face for the bound member's capability composition, and
 * hold the answer to the evidence contract (provider format, digest,
 * descriptor, completeness, binding). A throw and a non-evidence shape are
 * both coded refusals — NEVER a fallthrough to the management catalog, which
 * is the whole point of the verb existing.
 */
async function readCompositionEvidence(
  evidence: ScopedHomeEvidenceFace,
  harness: string,
  scope: string | null,
  named: string,
): Promise<CapabilityCompositionEvidence> {
  let answer: unknown
  try {
    answer = await evidence.capabilityComposition?.(harness, scope ?? undefined)
  } catch (error) {
    throw new EvalProvisionRefused(`CAPABILITY_COMPOSITION_INVALID: the evidence face could not answer the capability composition for ${named}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const composition = readCapabilityCompositionShape(answer)
  if (composition === undefined) {
    throw new EvalProvisionRefused(
      `CAPABILITY_COMPOSITION_INVALID: the evidence face answered the capability composition for ${named} in a shape that is not evidence`
      + ' (provider format, 64-hex digest, measurement descriptor, four-section completeness and binding are all required)',
    )
  }
  return composition
}

/**
 * The login command the human must run for one scope — the only thing
 * provision does about a missing credential.
 * @param harness - the harness name.
 * @param scope - the named scope, or null for the default scoped home.
 */
export function loginCommandFor(harness: string, scope: string | null): string {
  return `/${harness} login${scope === null ? '' : ` --scope ${scope}`}`
}

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
  /**
   * Where the measured preset directory lives relative to the scope:
   * `scope-snapshot` when the scope keeps its own byte-identical copy (the
   * arrangement a container round needs, since a unit mounts only the scoped
   * home), `instance-root` when it defers to the deployment's preset root
   * (measurable, and host-only).
   */
  source?: 'scope-snapshot' | 'instance-root'
  /**
   * The digest of the scope's own copy of the preset — EVERY file of it,
   * `SKILL.md` included. Present only in `scope-snapshot` mode, because it is
   * the only mode with a copy to hash.
   *
   * It is not a second opinion about the capability face: it is what lets the
   * readiness gate and `validate` see, with no catalog and no instance, that
   * the subject is still the one that was measured. `home.sha` cannot — it
   * hashes config-suffixed files by design, and a skill body is not one.
   */
  snapshot?: { sha: string }
}

/** What a capability probe is asked about. */
export interface CapabilityProbeInput {
  /** The condition id being provisioned. */
  condition: string
  harness: string
  /** The named scope, or null for the harness's default scoped home. */
  scope: string | null
  /** The scoped home the condition resolved to. */
  homeDir: string
  /** The preset the condition declares — never null when the probe is called. */
  preset: string
  /**
   * What the scope's provisioning reported about the scope's own copy of that
   * preset, when this provision composed the scope through
   * `localAgent.provisionScope`. Absent means nothing vouched for a copy —
   * and a scope holding one anyway is then refused rather than measured.
   */
  snapshot?: { matchesSource: boolean }
}

/**
 * Measure the capability face of a provisioned environment.
 *
 * Called only for a condition that declares a `preset`. Returning `undefined`
 * means "could not measure", which provision records as a warning and the
 * readiness gate turns into a refusal — the same outcome as no probe at all,
 * so a probe never has to lie to stay quiet.
 */
export type CapabilityProbe = (input: CapabilityProbeInput) => Promise<ProvisionedCapabilities | undefined>

/** Options of {@link provisionCondition}. */
export interface ProvisionOptions {
  /** The directory writes are confined to — the condition library, `<stateRoot>/conditions` (`~` expanded). */
  repo: string
  localAgent: LocalAgentFace
  /**
   * The execution target's scoped-home evidence, when the service was mounted
   * with one. PRESENT, every scoped-home read of this provision — the home
   * fingerprint, the credential grade, the effective settings, and (through
   * the capability probe) the roster read-back and the preset copy's
   * digest — comes from the face as plain data, and NO same-named local
   * directory is consulted: on the topology this exists for, the local path
   * is a different environment. A verb the face lacks, an answer it cannot
   * give, and an answer whose shape is not the local read's all land where
   * the corresponding local failure lands today (a refusal, or the channel's
   * own absent-answer semantics) — never a skipped check. ABSENT, everything
   * below reads the local facade exactly as before.
   */
  evidence?: ScopedHomeEvidenceFace
  /**
   * Measure the provisioned environment's capability face. Absent means the
   * face is not measured: a condition declaring a preset is then locked
   * without a capability record and warned about, and the readiness gate
   * refuses it later.
   */
  capabilities?: CapabilityProbe
  /**
   * Correct the declaration's `home.sha` from the measurement before minting
   * the lock. DEFAULT TRUE: leaving it stale is what made a condition take two
   * provisions to become ready (see the module doc). Only the declaration's
   * `home.sha` is ever touched, only when it disagrees with what was measured,
   * and only inside `repo` (the condition library).
   *
   * `false` restores the pre-T58 behavior: the disagreement is reported as a
   * warning and the document is left exactly as it was.
   */
  writeBack?: boolean
  now?: () => number
  log?: (message: string) => void
}

/**
 * Provision one condition: resolve its scope, check its credential, check the
 * declaration against the scope's effective settings, hash the scoped home,
 * and write `conditions/<id>.lock.json` beside the declaration.
 *
 * Never throws for data problems — a refused provision is a report with
 * `written: false` and the reasons on it. {@link EvalProvisionRefused} is
 * reserved for the structural ones: an unreadable declaration, a path outside
 * `repo`, a facade that cannot answer.
 * @param conditionPath - path to the `dataseek.condition/1` document. The lock
 *   is written beside it, so it must live inside `repo`.
 * @param options - the working copy, the local-agent facade, clock and log.
 */
export async function provisionCondition(conditionPath: string, options: ProvisionOptions): Promise<ProvisionReport> {
  const now = options.now ?? ((): number => Date.now())
  const writeBack = options.writeBack ?? true
  const log = options.log ?? ((): void => {})
  const conditionAbs = resolve(expandHome(conditionPath))
  const repo = resolve(expandHome(options.repo))
  if (!isInside(repo, conditionAbs)) {
    throw new EvalProvisionRefused(
      `condition ${conditionAbs} is not inside ${repo}`
      + ' — provision writes the lock beside the declaration, and only into the condition library it was given',
    )
  }
  if (conditionAbs.endsWith('.lock.json')) {
    throw new EvalProvisionRefused(`${basename(conditionAbs)} is a lock, not a declaration — provision wants conditions/<id>.json`)
  }
  const id = basename(conditionAbs).replace(/\.json$/, '')
  if (!CONDITION_ID_RE.test(id)) {
    throw new EvalProvisionRefused(`condition file name ${JSON.stringify(basename(conditionAbs))} does not yield a usable condition id`)
  }
  let document: unknown
  try {
    document = JSON.parse(await readFile(conditionAbs, 'utf8'))
  } catch (error) {
    throw new EvalProvisionRefused(`cannot read condition ${conditionAbs}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const { errors: contractErrors } = conditionDiagnostics(document)
  if (contractErrors.length > 0 || !isPlainObject(document)) {
    throw new EvalProvisionRefused(
      `condition ${id} violates ${CONDITION_SCHEMA_ID} — a lock against an invalid declaration would mean nothing`,
      contractErrors,
    )
  }

  const harnessSection = isPlainObject(document['harness']) ? document['harness'] : {}
  const harness = stringOrNull(harnessSection['name']) ?? ''
  const scope = stringOrNull(document['scope'])
  const named = `${harness}${scope === null ? '' : `@${scope}`}`
  // Re-taken after a write-back: the lock must anchor the document as it ends
  // up on disk, not as it was read.
  let sha = hashConditionDocument(document)
  const errors: EvalDiagnostic[] = []
  const warnings: EvalDiagnostic[] = []

  // ── 1. the scoped home (reading it materializes it) ────────────────────
  // With an evidence face the home lives on the execution target: the face
  // answers the fingerprint AND the producer-side identity as data, and no
  // local directory is resolved. The answer is taken here and step 4 reuses
  // it — asking twice would invite a target that moved between the two.
  const evidence = options.evidence
  let homeDir: string
  let homeEvidence: ScopedHomeHashEvidence | undefined
  if (evidence === undefined) {
    if (typeof options.localAgent.homeDir !== 'function') {
      throw new EvalProvisionRefused(
        "the mounted local-agent facade has no homeDir(harness, scope), so the condition's scoped home cannot be resolved — upgrade dsh-local-agent",
      )
    }
    homeDir = options.localAgent.homeDir(harness, scope ?? undefined)
  } else {
    if (typeof evidence.homeHash !== 'function') {
      throw new EvalProvisionRefused(
        "the evidence face has no homeHash(harness, scope), so the condition's scoped home cannot be resolved"
        + ' — a mounted face is the whole evidence source for its scopes, and this channel is missing',
      )
    }
    homeEvidence = await readHomeEvidence(evidence, harness, scope, named)
    homeDir = homeEvidence.homeDir
  }
  log(`provision ${id}: ${named} → ${homeDir}`)

  const report: ProvisionReport = {
    condition: id,
    conditionPath: conditionAbs,
    lockPath: join(dirname(conditionAbs), `${id}.lock.json`),
    repo,
    harness,
    scope,
    homeDir,
    credentialState: 'unknown',
    sha,
    home: null,
    homeShaWritten: false,
    shaBeforeWriteBack: null,
    scopeProvisioned: null,
    checks: [],
    written: false,
    lock: null,
    errors,
    warnings,
  }

  // ── 2. the credential: present, or stop and say how to get one ────────
  let credentialState: LocalAgentCredentialGrade
  if (evidence === undefined) {
    if (typeof options.localAgent.statusOf !== 'function') {
      throw new EvalProvisionRefused(
        "the mounted local-agent facade has no statusOf(harness, scope), so the scope's credential cannot be graded — upgrade dsh-local-agent"
        + ' (a lock written against an unchecked credential is exactly what provision exists to prevent)',
      )
    }
    let status: LocalAgentScopeStatus
    try {
      status = await options.localAgent.statusOf(harness, scope ?? undefined)
    } catch (error) {
      throw new EvalProvisionRefused(`local-agent could not answer status for ${named}: ${error instanceof Error ? error.message : String(error)}`)
    }
    credentialState = status.credentialState
  } else {
    if (typeof evidence.credentialGrade !== 'function') {
      throw new EvalProvisionRefused(
        "the evidence face has no credentialGrade(harness, scope), so the scope's credential cannot be graded"
        + ' — a lock written against an unchecked credential is exactly what provision exists to prevent',
      )
    }
    let grade: LocalAgentCredentialGrade | undefined
    try {
      grade = await evidence.credentialGrade(harness, scope ?? undefined)
    } catch (error) {
      throw new EvalProvisionRefused(`the evidence face could not grade the credential for ${named}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (grade === undefined || !CREDENTIAL_GRADES.has(grade)) {
      throw new EvalProvisionRefused(
        `the evidence face answered credential grade ${JSON.stringify(grade)} for ${named} — not one of the four grades, so the credential counts as ungraded`,
      )
    }
    credentialState = grade
  }
  report.credentialState = credentialState
  if (!CREDENTIAL_PRESENT.has(credentialState)) {
    const command = loginCommandFor(harness, scope)
    errors.push({
      code: credentialState === 'rejected' ? 'CREDENTIAL_REJECTED' : 'CREDENTIAL_ABSENT',
      message: `${named} reports credentialState ${JSON.stringify(credentialState)}`
        + ` — log in on this instance and provision again: ${command}`
        + ' (provision never logs in and never copies a credential from another scope)',
    })
    log(`provision ${id}: STOPPED — credential ${credentialState}; run ${command}`)
    return report
  }
  log(`provision ${id}: credential ${credentialState}`)

  // ── 3. the declaration against the scope, field by field ──────────────
  let effective: LocalAgentEffectiveSettingsFace | undefined
  if (evidence === undefined) {
    if (typeof options.localAgent.effectiveSettings !== 'function') {
      throw new EvalProvisionRefused(
        'the mounted local-agent facade has no effectiveSettings(harness, scope), so the declaration cannot be checked against the scope — upgrade dsh-local-agent',
      )
    }
    try {
      effective = await options.localAgent.effectiveSettings(harness, scope ?? undefined)
    } catch (error) {
      throw new EvalProvisionRefused(`local-agent could not answer effective settings for ${named}: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    if (typeof evidence.effectiveSettings !== 'function') {
      throw new EvalProvisionRefused(
        'the evidence face has no effectiveSettings(harness, scope), so the declaration cannot be checked against the scope'
        + ' — a mounted face is the whole evidence source for its scopes, and this channel is missing',
      )
    }
    try {
      effective = await evidence.effectiveSettings(harness, scope ?? undefined)
    } catch (error) {
      throw new EvalProvisionRefused(`the evidence face could not answer effective settings for ${named}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (effective !== undefined && !isPlainObject(effective)) {
      throw new EvalProvisionRefused(
        `the evidence face answered effective settings for ${named} that are not an object — invalid evidence, so the declaration cannot be checked against the scope`,
      )
    }
  }
  const snapshot = flattenEffective(harness, effective)
  report.checks = checkAgainstEffective(document, snapshot)
  for (const row of report.checks) {
    if (row.severity !== null) {
      const diagnostic = {
        code: row.status === 'unknown' ? 'EFFECTIVE_UNCOMPARABLE' : 'EFFECTIVE_MISMATCH',
        message: `${row.field}: ${row.detail}`,
      }
      if (row.severity === 'error') errors.push(diagnostic)
      else warnings.push(diagnostic)
    }
    log(`provision ${id}: ${row.field} ${row.status}${row.severity === null ? '' : ` (${row.severity})`} — ${row.detail}`)
  }
  if (errors.length > 0) {
    log(`provision ${id}: REFUSED — ${errors.length} field(s) disagree with the scope; no lock written`)
    return report
  }

  // ── 3.5 the scope's own composition ───────────────────────────────────
  // Only for a condition that declares a preset, and only through a facade
  // that has the verb. This is what makes "two scopes rostering two presets"
  // a property of the CONDITION rather than of the deployment's plugin
  // settings — and it must run before the hash below, because the scope's own
  // copy of the preset is inside the scoped home and enters `home.sha`.
  const declaredPreset = stringOrNull(document['preset'])
  let scopeSnapshot: { matchesSource: boolean } | undefined
  if (declaredPreset !== null && typeof options.localAgent.provisionScope === 'function') {
    try {
      const provisioned = await options.localAgent.provisionScope(harness, scope ?? undefined, { preset: declaredPreset })
      scopeSnapshot = provisioned.presetSnapshot
      report.scopeProvisioned = {
        preset: provisioned.preset ?? null,
        snapshotMatchesSource: provisioned.presetSnapshot?.matchesSource ?? null,
      }
      log(`provision ${id}: scope composed preset ${String(provisioned.preset ?? 'none')}`
        + `${provisioned.presetSnapshot === undefined ? '' : ` (own copy, matches source: ${String(provisioned.presetSnapshot.matchesSource)})`}`)
    } catch (error) {
      // Reported, not resolved. The read-back below is what decides whether
      // this condition has a subject, and it reads the scope rather than this
      // call's outcome — so a failure here that somehow left a usable scope
      // still provisions, and one that did not is refused with both reasons.
      warnings.push({
        code: 'SCOPE_NOT_PROVISIONED',
        message: `composing preset ${JSON.stringify(declaredPreset)} into ${named}'s scope failed:`
          + ` ${error instanceof Error ? error.message : String(error)}`
          + ' — the capability face is measured from what the scope actually holds, so this provision continues and reports what it finds',
      })
      log(`provision ${id}: composing the scope's preset failed — ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ── 4. the scoped home's content hash ─────────────────────────────────
  // Evidence mode already holds the fingerprint (step 1 asked once); the
  // local mode reads the directory now, exactly as before.
  if (homeEvidence !== undefined) {
    report.home = { sha: homeEvidence.sha, files: homeEvidence.files, denied: homeEvidence.denied }
  } else {
    try {
      report.home = await hashHome(homeDir)
    } catch (error) {
      throw new EvalProvisionRefused(`cannot hash the scoped home ${homeDir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const declaredHomeSha = stringOrNull((isPlainObject(document['home']) ? document['home'] : {})['sha'])
  if (declaredHomeSha !== report.home.sha) {
    if (writeBack) {
      // The correction, and the re-hash that has to follow it. `home.sha` is
      // hash input, so the document that comes out of this is a different
      // condition from the one that went in — and the lock below must anchor
      // the one that is now on disk. Writing the lock against the pre-edit sha
      // is precisely the stale-lock state the second provision existed to fix.
      const home = isPlainObject(document['home']) ? { ...document['home'] } : {}
      home['sha'] = report.home.sha
      document['home'] = home
      try {
        await writeFile(conditionAbs, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
      } catch (error) {
        throw new EvalProvisionRefused(
          `cannot write home.sha back into ${conditionAbs}: ${error instanceof Error ? error.message : String(error)}`
          + ' — provision with --no-write-back to leave the declaration alone and copy the digest in by hand',
        )
      }
      report.shaBeforeWriteBack = sha
      sha = hashConditionDocument(document)
      report.sha = sha
      report.homeShaWritten = true
      warnings.push({
        code: 'HOME_SHA_WRITTEN',
        message: `the condition declared home.sha ${declaredHomeSha === null ? 'null' : `${declaredHomeSha.slice(0, 12)}…`}`
          + ` and the scoped home hashes to ${report.home.sha}`
          + ' — the declaration was corrected and re-hashed, so the lock below anchors the condition as it now reads'
          + ` (condition ${report.shaBeforeWriteBack.slice(0, 12)}… → ${sha.slice(0, 12)}…; run with --no-write-back to leave the document alone)`,
      })
      log(`provision ${id}: home.sha written back → ${conditionAbs}`
        + ` (condition ${report.shaBeforeWriteBack.slice(0, 12)}… → ${sha.slice(0, 12)}…)`)
    } else if (declaredHomeSha === null) {
      warnings.push({
        code: 'HOME_SHA_UNDECLARED',
        message: `the condition declares home.sha null; the scoped home hashes to ${report.home.sha}`
          + ' — write that into the declaration to make the condition ready (this provision was asked not to rewrite the condition document)',
      })
    } else {
      warnings.push({
        code: 'HOME_SHA_DECLARED_STALE',
        message: `the condition declares home.sha ${declaredHomeSha.slice(0, 12)}… but the scoped home hashes to ${report.home.sha.slice(0, 12)}…`
          + ' — the lock records what is actually there; correcting the declaration re-hashes the condition (home.sha is a factor), so provision again afterwards',
      })
    }
  }

  // ── 5. the provisioned environment's capability face ──────────────────
  // Only for a condition that CLAIMS one. `preset` enters the condition
  // hash, so two conditions differing only in it are two subjects; a claim
  // nobody measured leaves them two on paper and one in fact. Measuring is
  // the caller's hook (see the module doc), and its absence is said out
  // loud rather than papered over.
  //
  // The BOUND-MEMBER path comes first: when the evidence face carries the
  // `capabilityComposition` verb, the member's own measurement IS the
  // capability evidence for these scopes — the home's roster read and the
  // management-instance catalog are never consulted (the probe below is
  // skipped entirely), and the lock records the evidence as its own kind.
  let capabilities: ProvisionedCapabilities | undefined
  let capabilityComposition: CapabilityCompositionEvidence | undefined
  if (declaredPreset !== null && evidence?.capabilityComposition !== undefined) {
    const composition = await readCompositionEvidence(evidence, harness, scope, named)
    // The completeness floor: every section must be complete (measured-zero
    // included); a partial or unavailable section is "not verified", and no
    // lock is written on it — the coded refusal the review named.
    const incomplete = incompleteSections(composition)
    if (incomplete.length > 0) {
      for (const section of incomplete) {
        const row = composition.completeness[section as keyof typeof composition.completeness]
        errors.push({
          code: 'CAPABILITY_COMPOSITION_INCOMPLETE',
          message: `the member's capability composition measures ${section} as ${row.state}`
            + `${row.reason === undefined ? '' : ` (${row.reason})`} — "not verified", so no lock is written on it`,
        })
      }
      log(`provision ${id}: REFUSED — capability composition not complete (${incomplete.join(', ')}); no lock written`)
      return report
    }
    // The identity pin (the E3 vocabulary): the home evidence and the
    // composition evidence must name ONE home identity — a face wired to two
    // targets would otherwise record a measurement about the wrong home.
    if (
      homeEvidence?.homeIdentity !== undefined && composition.homeIdentity !== undefined
      && homeEvidence.homeIdentity !== composition.homeIdentity
    ) {
      throw new EvalProvisionRefused(
        `EXECUTION_HOME_IDENTITY_MISMATCH: the home evidence pins ${JSON.stringify(homeEvidence.homeIdentity)} for ${named}`
        + ` but the capability composition pins ${JSON.stringify(composition.homeIdentity)}`
        + ' — evidence measured on one target must never record beside a home fingerprint from another',
      )
    }
    // The measurement disagreeing with the declaration is the whole reason to
    // record what was measured rather than what was asked for — a warning
    // here, the readiness gate's refusal later (the catalog path's own rule).
    if (composition.measurement.presetId !== undefined && composition.measurement.presetId !== declaredPreset) {
      warnings.push({
        code: 'CAPABILITIES_PRESET_MISMATCH',
        message: `the condition declares preset ${JSON.stringify(declaredPreset)} but the member's composition was measured under`
          + ` ${JSON.stringify(composition.measurement.presetId)} — the lock records what was measured, and the readiness gate refuses the pair`,
      })
    }
    capabilityComposition = composition
    log(`provision ${id}: capability composition caps:${composition.sha.slice(0, 12)}… (binding ${composition.binding}${composition.measurement.presetId === undefined ? '' : `, preset ${composition.measurement.presetId}`})`)
  } else if (declaredPreset !== null) {
    if (options.capabilities === undefined) {
      warnings.push({
        code: 'CAPABILITIES_UNMEASURED',
        message: `the condition declares preset ${JSON.stringify(declaredPreset)} but this provision has no capability probe`
          + ' — the lock will carry no provisioned.capabilities, and the pre-run readiness gate refuses a preset claim without one',
      })
    } else {
      try {
        capabilities = await options.capabilities({
          condition: id,
          harness,
          scope,
          homeDir,
          preset: declaredPreset,
          ...(scopeSnapshot === undefined ? {} : { snapshot: scopeSnapshot }),
        })
      } catch (error) {
        capabilities = undefined
        warnings.push({
          code: 'CAPABILITIES_UNMEASURED',
          message: `measuring the capability face of preset ${JSON.stringify(declaredPreset)} failed: ${error instanceof Error ? error.message : String(error)}`
            + ' — the lock carries no provisioned.capabilities, and the readiness gate refuses the condition',
        })
      }
      if (capabilities === undefined) {
        // A probe that DECLINED, as against one that threw. Both mean "no
        // measurement", and both have to reach the report: a log line alone
        // leaves `conditions list` and the slash output showing a lock that
        // looks complete. The probe's own log says which step declined.
        warnings.push({
          code: 'CAPABILITIES_UNMEASURED',
          message: `the capability face of preset ${JSON.stringify(declaredPreset)} could not be measured`
            + ' — the lock carries no provisioned.capabilities, and the pre-run readiness gate refuses a preset claim without one',
        })
        log(`provision ${id}: capability face NOT measured for preset ${declaredPreset}`)
      } else {
        log(`provision ${id}: capability face caps:${capabilities.sha.slice(0, 12)}… (preset ${String(capabilities.preset ?? declaredPreset)})`)
        if (capabilities.preset !== undefined && capabilities.preset !== declaredPreset) {
          // The measurement disagreeing with the declaration is the whole
          // reason to record what was measured rather than what was asked for.
          warnings.push({
            code: 'CAPABILITIES_PRESET_MISMATCH',
            message: `the condition declares preset ${JSON.stringify(declaredPreset)} but the provisioned environment reports`
              + ` ${JSON.stringify(capabilities.preset)} — the lock records what was measured, and the readiness gate refuses the pair`,
          })
        }
      }
    }
  }

  // ── 6. the lock ───────────────────────────────────────────────────────
  const effectiveOf = (field: string): string | null => report.checks.find(row => row.field === field)?.effective ?? null
  const lock: Record<string, unknown> = {
    schema: LOCK_SCHEMA_ID,
    condition: id,
    sha,
    home: { sha: report.home.sha },
    provisioned: {
      at: now(),
      cliVersion: snapshot.cliVersion,
      effective: {
        model: effectiveOf('model.declared'),
        reasoningEffort: effectiveOf('reasoning.effort'),
        permissions: effectiveOf('permissions'),
        endpoint: effectiveOf('model.endpoint'),
      },
      // Recorded only when there is something to record: a `preset: null`
      // key on a condition that declares none would read as "measured, and
      // it composes nothing", which is a different claim from silence.
      ...(declaredPreset === null ? {} : { preset: capabilities?.preset ?? capabilityComposition?.measurement.presetId ?? declaredPreset }),
      ...(capabilities === undefined ? {} : { capabilities }),
      // The bound member's evidence, recorded as its OWN kind — alongside
      // `capabilities`, never merged into it.
      ...(capabilityComposition === undefined
        ? {}
        : {
          capabilityComposition: {
            measurement: {
              kind: 'preset-composition',
              ...(capabilityComposition.measurement.presetId === undefined ? {} : { presetId: capabilityComposition.measurement.presetId }),
              ...(capabilityComposition.measurement.workdir === undefined ? {} : { workdir: capabilityComposition.measurement.workdir }),
              ...(capabilityComposition.measurement.revision === undefined ? {} : { revision: capabilityComposition.measurement.revision }),
            },
            providerFormat: capabilityComposition.providerFormat,
            sha: capabilityComposition.sha,
            completeness: capabilityComposition.completeness,
            ...(capabilityComposition.coverage === undefined ? {} : { coverage: capabilityComposition.coverage }),
            ...(capabilityComposition.homeIdentity === undefined ? {} : { homeIdentity: capabilityComposition.homeIdentity }),
            binding: capabilityComposition.binding,
          },
        }),
    },
  }
  const violations = validateJson(LOCK_SCHEMA, lock)
  if (violations.length > 0) {
    // Unreachable by construction; a loud stop beats writing a lock both
    // readers would then report as LOCK_MALFORMED forever.
    throw new EvalProvisionRefused(`the lock this provision built violates ${LOCK_SCHEMA_ID}: ${violations.join('; ')}`)
  }
  report.lock = lock
  await writeFile(report.lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  report.written = true
  log(`provision ${id}: lock written → ${report.lockPath}`
    + ` (condition ${sha.slice(0, 12)}…, home ${report.home.sha.slice(0, 12)}…, ${report.home.files} config file(s) hashed, ${report.home.denied} skipped)`)
  return report
}
