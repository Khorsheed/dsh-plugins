/**
 * The container path's data layer: turning the plan's `unit` segment and each
 * condition's `unit.scopedHome` into ONE lab `AcquireSpec` per cell, and
 * checking the host-side credential directory the human staged for it.
 *
 * The split is the same one the whole orchestrator rests on — **agent 改数据,
 * 人改程序, 编排器只解释数据**: the plan says which image, network, user and
 * ceilings every cell of this run gets; the condition says where its own
 * scoped credential directory is mounted inside the unit and which variable
 * names it. The HOST side of that directory is neither of their business — it
 * is the evaluation instance's own scoped home for that harness, the one
 * `/<harness> login` writes into and the one the delegation read-back parses.
 * No host path ever appears in a reviewed data file, and no credential value
 * ever reaches an argv.
 *
 * Nothing here knows the word docker: an image reference, a network name and
 * a user string are lab's vocabulary, and lab is the only plugin that holds
 * the socket (frozen decision 12).
 * @module @khorsheed/dsh-eval
 */
import { readdirSync, statSync } from 'node:fs'
import type { EvalDiagnostic } from './validate.ts'
import type { LabAcquireSpec, LabFingerprintComponents } from './faces.ts'

/** The in-unit working directory every cell's workspace is populated into. */
export const UNIT_WORKSPACE = '/workspace'

/** In-unit scratch the probe verdicts are written to — never `/workspace` (the archive must not carry judging output). */
export const UNIT_VERDICTS_DIR = '/run/dsh-lab/verdicts'

/**
 * The node flag the dsh harness needs inside a sealed unit. dsh's HTTP client
 * is node's `fetch` (undici), which does not read `HTTP(S)_PROXY`: without
 * this the round dials the API directly and fails while the whitelist proxy
 * never even receives a `CONNECT` (measured in T16 and again in T17). The
 * provider injects it too; declaring it on the unit keeps the environment the
 * cell runs in fully described by the orchestrator rather than half by a
 * provider's private default.
 */
export const DSH_CONTAINER_NODE_OPTIONS = '--use-env-proxy'

/** The plan's `unit` segment — the run-wide half of a unit declaration. */
export interface PlanUnitDecl {
  image: string
  network?: string
  user?: string
  resources?: { cpus?: string | number; memory?: string | number }
  /** The in-unit egress self-check, when the plan declares one. */
  egressCheck?: EgressCheckDecl
}

/**
 * One in-unit command that answers "can this unit reach what it needs to".
 *
 * The COMMAND and its target live in the plan (or the dataset's env layer
 * beside it), never here: an evaluation network's proxy, registry and
 * whitelist are the dataset's apparatus, and an address compiled into the
 * orchestrator would be the one thing a plan could not change. What the
 * orchestrator owns is only the rule — exit 0 passes, anything else refuses
 * the run before a delegation is spent.
 */
export interface EgressCheckDecl {
  /** argv run inside the unit through `lab.verify` (no shell unless the argv names one). */
  command: string[]
  /** How long the check may take. Defaults to {@link DEFAULT_EGRESS_CHECK_TIMEOUT_MS}. */
  timeoutMs?: number
}

/**
 * Default budget for the egress check: long enough for a proxy CONNECT and a
 * TLS handshake on a cold unit, short enough that a dead proxy is named in
 * seconds rather than at the readiness window's far end (T29c: a unit with no
 * egress produced a 230-second EMPTY turn and no network error at all).
 */
export const DEFAULT_EGRESS_CHECK_TIMEOUT_MS = 30_000

/** One condition's `unit` segment — the per-subject half. */
export interface ConditionUnitDecl {
  scopedHome: { container: string; var: string }
}

/** One cell's resolved unit inputs: everything `acquire` needs but the mission ids. */
export interface CellUnitPlan {
  conditionId: string
  image: string
  network?: string
  user?: string
  resources?: { cpus?: string | number; memory?: string | number }
  /** The scoped credential directory: host side (never in a data file), unit side, and its variable. */
  scopedHome: { host: string; container: string; var: string }
  /**
   * The condition's named harness scope, when it declares one — the NAME
   * behind the host side above (`<harness>@<scope>`). Recorded so the run's
   * own metadata can say that two cells of one harness mounted two different
   * directories without ever writing a host path into the bundle.
   */
  scope?: string
  /** Extra unit environment beyond the scoped-home variable (dsh's node flag). */
  extraEnv: Record<string, string>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a plan document's `unit` segment; null when the plan takes the host path. */
export function planUnitOf(plan: unknown): PlanUnitDecl | null {
  if (!isPlainObject(plan) || !isPlainObject(plan['unit'])) return null
  const unit = plan['unit']
  const image = unit['image']
  if (typeof image !== 'string' || image === '') return null
  const decl: PlanUnitDecl = { image }
  if (typeof unit['network'] === 'string') decl.network = unit['network']
  if (typeof unit['user'] === 'string') decl.user = unit['user']
  if (isPlainObject(unit['resources'])) decl.resources = unit['resources'] as NonNullable<PlanUnitDecl['resources']>
  const egress = egressCheckOf(unit['egressCheck'])
  if (egress !== null) decl.egressCheck = egress
  return decl
}

/**
 * Read an `egressCheck` declaration. A malformed one reads as absent here and
 * is reported by {@link planUnitDiagnostics} — parsing and complaining are
 * separate jobs, as everywhere else in this module.
 * @param value - the declaration as it appears in the plan document.
 * @returns the declaration, or null when it is absent or unusable.
 */
export function egressCheckOf(value: unknown): EgressCheckDecl | null {
  if (!isPlainObject(value)) return null
  const command = value['command']
  if (!Array.isArray(command) || command.length === 0) return null
  if (!command.every((word): word is string => typeof word === 'string' && word !== '')) return null
  const decl: EgressCheckDecl = { command: [...command] }
  const timeoutMs = value['timeoutMs']
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) decl.timeoutMs = timeoutMs
  return decl
}

/**
 * Diagnostics for a plan's `unit.egressCheck` that the SCHEMA cannot state.
 * The contract subset has type/required/properties/items and no cardinality
 * keywords, so `{ command: [] }` and `{ command: [''] }` are schema-valid and
 * meaningless — and a check that silently evaporates is worse than a plan
 * that declared none, because the run then believes it was checked.
 * @param plan - the plan document.
 * @returns diagnostics; empty when the declaration is usable or absent.
 */
export function planUnitDiagnostics(plan: unknown): EvalDiagnostic[] {
  if (planUnitOf(plan) === null) return []
  const raw = isPlainObject(plan) && isPlainObject(plan['unit']) ? plan['unit']['egressCheck'] : undefined
  if (raw === undefined || egressCheckOf(raw) !== null) return []
  return [{
    code: 'EGRESS_CHECK_MALFORMED',
    message: 'unit.egressCheck needs a non-empty command of non-empty words'
      + ' (and, if given, a positive timeoutMs)'
      + ` — got ${JSON.stringify(raw)}`,
  }]
}

/**
 * The one-line note a networked run without an egress check prints, or
 * undefined when there is nothing to say.
 * @param decl - the plan's unit segment.
 * @returns the log line, or undefined.
 */
export function egressCheckAbsentNote(decl: PlanUnitDecl): string | undefined {
  if (decl.egressCheck !== undefined || decl.network === undefined) return undefined
  return `egress: this plan's unit segment declares network ${JSON.stringify(decl.network)} but no unit.egressCheck`
    + ' — a unit that cannot reach its proxy answers nothing rather than failing, so a dead proxy will look'
    + ' like a model that said nothing (declare unit.egressCheck to have the run refuse instead)'
}

/** Read a condition document's `unit` segment; null when it declares none. */
export function conditionUnitOf(condition: unknown): ConditionUnitDecl | null {
  if (!isPlainObject(condition) || !isPlainObject(condition['unit'])) return null
  const scoped = condition['unit']['scopedHome']
  if (!isPlainObject(scoped)) return null
  const container = scoped['container']
  const variable = scoped['var']
  if (typeof container !== 'string' || container === '' || typeof variable !== 'string' || variable === '') return null
  return { scopedHome: { container, var: variable } }
}

/** The `env.keys` a condition declares (names only — the contract carries no values). */
function envKeysOf(condition: unknown): string[] {
  if (!isPlainObject(condition) || !isPlainObject(condition['env'])) return []
  const keys = condition['env']['keys']
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []
}

/**
 * Contract-check one condition against a plan that declares a unit segment:
 * it must carry `unit.scopedHome`, and the variable naming that directory
 * must also be one of the names the condition says it injects.
 *
 * Both are ERRORS rather than warnings: a condition without a scoped home has
 * nowhere to read its credentials from inside the unit, and a variable absent
 * from `env.keys` means the declaration and the injection disagree — the run
 * would inject a name the reviewed document never admitted to.
 * @param conditionId - the condition's id, for the message.
 * @param condition - the condition document.
 * @returns diagnostics; empty means the condition can run in a unit.
 */
export function conditionUnitDiagnostics(conditionId: string, condition: unknown): EvalDiagnostic[] {
  const decl = conditionUnitOf(condition)
  if (decl === null) {
    return [{
      code: 'UNIT_SCOPED_HOME_MISSING',
      message: `condition ${conditionId}: the plan declares a unit, so the condition must declare unit.scopedHome`
        + ' {container, var} — where its credential directory is mounted inside the unit and which variable names it',
    }]
  }
  const diagnostics: EvalDiagnostic[] = []
  if (!decl.scopedHome.container.startsWith('/')) {
    diagnostics.push({
      code: 'UNIT_SCOPED_HOME_RELATIVE',
      message: `condition ${conditionId}: unit.scopedHome.container must be an absolute in-container path, got ${JSON.stringify(decl.scopedHome.container)}`,
    })
  }
  if (!envKeysOf(condition).includes(decl.scopedHome.var)) {
    diagnostics.push({
      code: 'UNIT_SCOPED_HOME_VAR_UNDECLARED',
      message: `condition ${conditionId}: unit.scopedHome.var ${JSON.stringify(decl.scopedHome.var)} is not in env.keys`
        + ' — the variable the unit injects must be one the condition declares it injects',
    })
  }
  return diagnostics
}

/**
 * Resolve one condition's cell unit plan.
 * @param planUnit - the plan's unit segment.
 * @param conditionId - the condition id (also the credential directory name).
 * @param condition - the condition document.
 * @param hostHome - the harness's own scoped home on this host: what gets
 *   mounted, and what the read-back reads. The two must be one directory.
 *   For a condition declaring a `scope` this is that scope's directory
 *   (`<homesRoot>/<harness>@<scope>`), which the caller resolved through the
 *   family — the mount source and the read-back source stay one directory in
 *   exactly the way they do for the default scope.
 * @returns the resolved plan, or the diagnostics that stopped it.
 */
export function resolveCellUnit(
  planUnit: PlanUnitDecl,
  conditionId: string,
  condition: unknown,
  hostHome: string,
): { ok: true; plan: CellUnitPlan } | { ok: false; diagnostics: EvalDiagnostic[] } {
  const diagnostics = conditionUnitDiagnostics(conditionId, condition)
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  const decl = conditionUnitOf(condition) as ConditionUnitDecl
  const harness = isPlainObject(condition) && isPlainObject(condition['harness']) ? condition['harness'] : undefined
  const harnessName = typeof harness?.['name'] === 'string' ? harness['name'] : ''
  const scope = isPlainObject(condition) && typeof condition['scope'] === 'string' ? condition['scope'] : undefined
  const plan: CellUnitPlan = {
    conditionId,
    image: planUnit.image,
    scopedHome: { host: hostHome, container: decl.scopedHome.container, var: decl.scopedHome.var },
    extraEnv: harnessName === 'dsh' ? { NODE_OPTIONS: DSH_CONTAINER_NODE_OPTIONS } : {},
    ...(scope === undefined ? {} : { scope }),
  }
  if (planUnit.network !== undefined) plan.network = planUnit.network
  if (planUnit.user !== undefined) plan.user = planUnit.user
  if (planUnit.resources !== undefined) plan.resources = planUnit.resources
  return { ok: true, plan }
}

/**
 * The acquire spec for one cell (or, without mission ids, for a readiness
 * probe unit). Exactly one mount — this condition's credential directory,
 * read-write so the CLI's own refresh lands back on the host — and exactly
 * the environment the unit needs: the scoped-home variable, plus dsh's node
 * flag. Nothing else, because every env NAME enters the fingerprint.
 * @param plan - the resolved cell unit plan.
 * @param binding - the mission this unit serves, when it serves one.
 */
export function acquireSpecFor(plan: CellUnitPlan, binding: { missionId?: string; runId?: string } = {}): LabAcquireSpec {
  const spec: LabAcquireSpec = {
    image: plan.image,
    mounts: [{ source: plan.scopedHome.host, target: plan.scopedHome.container, type: 'bind' }],
    env: { [plan.scopedHome.var]: plan.scopedHome.container, ...plan.extraEnv },
    workdir: UNIT_WORKSPACE,
    ownWorkdir: true,
  }
  if (plan.network !== undefined) spec.network = plan.network
  if (plan.user !== undefined) spec.user = plan.user
  if (plan.resources !== undefined) spec.resources = plan.resources
  if (binding.missionId !== undefined) spec.missionId = binding.missionId
  if (binding.runId !== undefined) spec.runId = binding.runId
  return spec
}

/**
 * The printable form of an acquire spec: env NAMES only. The values here are
 * in-container paths rather than secrets, but the rule that a printed spec
 * carries no env values is the rule that keeps it true when a later condition
 * injects something that IS one.
 * @param spec - the spec to describe.
 */
export function describeAcquireSpec(spec: LabAcquireSpec): Record<string, unknown> {
  return {
    image: spec.image,
    ...(spec.network !== undefined ? { network: spec.network } : {}),
    ...(spec.user !== undefined ? { user: spec.user } : {}),
    ...(spec.resources !== undefined ? { resources: spec.resources } : {}),
    mounts: (spec.mounts ?? []).map(mount => ({
      source: mount.source,
      target: mount.target,
      type: mount.type ?? 'bind',
      readonly: mount.readonly === true,
    })),
    envKeys: Object.keys(spec.env ?? {}).sort(),
    workdir: spec.workdir ?? UNIT_WORKSPACE,
    ...(spec.missionId !== undefined ? { missionId: spec.missionId } : {}),
  }
}

/** What the credentials-directory check found. */
export interface CredentialsCheck {
  condition: string
  /** The host directory that was inspected. */
  dir: string
  ok: boolean
  /** Entries counted (never their names — the check does not read the contents). */
  entries: number
  /** Owner uid of the directory as the host reports it. */
  ownerUid: number | null
  /** Why the directory is unusable; absent when it is fine. */
  reason?: string
  /**
   * Set when the owner is not the unit's uid but IS the orchestrator's own —
   * which is what a correctly staged directory looks like wherever the
   * container runtime remaps bind-mount ownership (Docker Desktop does).
   */
  ownerNote?: string
}

/** The numeric uid of a lab `user` string (`uid[:gid]`), or null when it names a user. */
export function unitUid(user: string | undefined): number | null {
  if (user === undefined) return null
  const first = user.split(':')[0] ?? ''
  return /^\d+$/.test(first) ? Number(first) : null
}

/**
 * Check the scoped home this condition's harness will have mounted: it
 * exists, it is a directory, it is not empty, and its owner is either the
 * unit's own uid or the uid the orchestrator itself runs as. The CONTENTS are
 * never read — what a credential file must contain is the harness's business,
 * and this process has no reason to open one. What it catches is the case
 * that costs a whole run: nobody has logged in on this instance yet, so the
 * harness's scoped home is empty and every cell would 401.
 *
 * The two acceptable owners are one rule, not a platform switch: a Linux host
 * passes uids straight through, so a directory staged as the unit's uid is the
 * right answer there; Docker Desktop remaps a bind mount to the container
 * user, so a directory staged by the operator is the right answer there. A
 * third uid — root, or another account — is refused, because that is the case
 * where the unit cannot read (or cannot write back) its own credentials.
 * @param dir - the harness's host scoped home, as `homeDir(harness)` reports it.
 * @param conditionId - for the message.
 * @param uid - the unit's numeric uid, when the plan declares one.
 * @param selfUid - the orchestrator's own uid.
 */
export function checkCredentialsDir(dir: string, conditionId: string, uid: number | null, selfUid: number): CredentialsCheck {
  const base: CredentialsCheck = { condition: conditionId, dir, ok: false, entries: 0, ownerUid: null }
  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(dir)
  } catch {
    return { ...base, reason: `${dir} does not exist — this harness has no scoped home on this instance yet; run /${conditionId.split('-')[0] ?? conditionId} login here first` }
  }
  if (!stats.isDirectory()) return { ...base, ownerUid: stats.uid, reason: `${dir} is not a directory` }
  const ownerUid = stats.uid
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (error) {
    return { ...base, ownerUid, reason: `${dir} cannot be listed: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (entries.length === 0) {
    return { ...base, ownerUid, reason: `${dir} is empty — the harness's scoped home holds no credentials; log in on THIS instance (the run mounts the instance's own scoped home, not a copy)` }
  }
  if (uid !== null && ownerUid !== uid && ownerUid !== selfUid) {
    return {
      ...base,
      ownerUid,
      entries: entries.length,
      reason: `${dir} is owned by uid ${ownerUid}, which is neither the unit's uid (${uid}) nor this process's (${selfUid})`
        + ' — the unit would not be able to read, or write back to, its own credentials',
    }
  }
  const check: CredentialsCheck = { condition: conditionId, dir, ok: true, entries: entries.length, ownerUid }
  if (uid !== null && ownerUid !== uid) {
    check.ownerNote = `owned by uid ${ownerUid} (this process), not the unit's ${uid}`
      + ' — accepted because the runtime may remap bind-mount ownership to the container user'
  }
  return check
}

/**
 * The components one CONDITION contributes to its unit — the ones the
 * environment class subtracts.
 *
 * They are not guessed from the components: they are read back from the same
 * two places {@link acquireSpecFor} put them, so the subtraction is exact by
 * construction rather than by pattern. The condition's declared `env.keys`
 * ride along because a condition that injects its own variables is still the
 * same environment class as one that injects different ones — the run is
 * comparing what the PLAN set up, and each subject's credentials are part of
 * the subject, not of the environment.
 */
export interface ConditionOwnedComponents {
  /** In-container mount targets this condition brought (its scoped home). */
  mountTargets: string[]
  /** Env variable NAMES this condition brought (scoped-home var, harness extras, declared keys). */
  envKeys: string[]
}

/**
 * What this condition contributed to its unit's fingerprint.
 * @param plan - the resolved cell unit plan.
 * @param condition - the condition document (for its declared `env.keys`).
 */
export function conditionOwnedComponents(plan: CellUnitPlan, condition: unknown): ConditionOwnedComponents {
  return {
    mountTargets: [plan.scopedHome.container],
    envKeys: [...new Set([plan.scopedHome.var, ...Object.keys(plan.extraEnv), ...envKeysOf(condition)])].sort(),
  }
}

/**
 * The environment CLASS of a unit: its components with every condition-owned
 * mount and env key removed.
 *
 * This is what «环境一致» has to compare. A unit's own fingerprint answers
 * "is this the same unit environment", and the answer for four harnesses in
 * one run is always no — each mounts its own credential directory at its own
 * path under its own variable (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`,
 * `KIMI_CODE_HOME`, `DSH_HOME`), so four cells produce four fingerprints and
 * the invariant reads `violated` on a run whose environment is, in every
 * sense the comparison cares about, identical. The class answers the question
 * the report is actually asking: same image, same ceilings, same network,
 * same user, same plan-level mounts and variables.
 *
 * The subtraction never touches `version`: it is the same hashing rule over a
 * smaller component set, not a new one.
 * @param components - the unit's own components.
 * @param owned - what this condition contributed.
 * @returns the class's component set, and what was removed (for the report).
 */
export function environmentClassComponents(
  components: LabFingerprintComponents,
  owned: ConditionOwnedComponents,
): { components: LabFingerprintComponents; excluded: { mounts: string[]; envKeys: string[] } } {
  const targets = new Set(owned.mountTargets)
  const keys = new Set(owned.envKeys)
  const removedMounts = components.mounts.filter(mount => targets.has(mount.target)).map(mount => mount.target)
  const removedKeys = components.envKeys.filter(key => keys.has(key))
  return {
    components: {
      ...components,
      mounts: components.mounts.filter(mount => !targets.has(mount.target)),
      envKeys: components.envKeys.filter(key => !keys.has(key)),
    },
    excluded: { mounts: removedMounts.sort(), envKeys: removedKeys.sort() },
  }
}
