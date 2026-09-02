/**
 * Durable launch-configuration cutovers.
 *
 * A launch change is not a repository rollback: the command, home, credential
 * repository, host root, profile, port, readiness handoff, and recovery choice
 * move as one unit. The selected side lives in launch-spec.json (one atomic
 * write); the redacted,
 * append-only-ish operational receipt lives in launch-cutover.json. The full
 * commands never enter the receipt because a launch command may carry secret
 * environment values.
 */
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { stateFile } from './state-files.ts'

export type CutoverRecoveryPolicy = 'restore-previous' | 'wait-for-user'
export type BrowserHandoffPolicy = 'required' | 'off'
export type LaunchRole = 'target' | 'previous'
export type CutoverControlAction = 'abort' | 'restore-previous'

/** Everything needed to launch one supervised instance. The state directory is the transaction anchor. */
export interface LaunchSpec {
  version: 1
  command: string
  port: number
  home: string
  /** Repository whose HEAD is bound to the guard credential and rollback. */
  credentialRepo: string
  /** dsh host checkout used by preflight and exported as DSH_HARNESS. */
  harnessRoot: string
  profile: string
}

export interface StableLaunchState {
  version: 1
  mode: 'stable'
  active: LaunchSpec
}

export interface CutoverLaunchState {
  version: 1
  mode: 'cutover'
  cutoverId: string
  selected: LaunchRole
  previous: LaunchSpec
  target: LaunchSpec
}

export type LaunchState = StableLaunchState | CutoverLaunchState

export type CutoverPhase =
  | 'prepared'
  | 'supervisor-starting'
  | 'supervisor-ready'
  | 'target-starting'
  | 'target-retrying'
  | 'restoring'
  | 'ready'
  | 'restored'
  | 'awaiting-user'
  | 'prepare-failed'

export interface LaunchSpecSummary {
  commandSha256: string
  port: number
  home: string
  credentialRepo: string
  harnessRoot: string
  profile: string
}

export interface CutoverAttempt {
  role: LaunchRole
  number: number
  childPid: number
  childStartToken?: string
  startedAt: number
  outcome?: 'failed' | 'ready'
  detail?: string
}

/** PID identity proof safe to persist in the redacted operational receipt. */
export interface CutoverProcessOwnership {
  childPid: number
  childStartToken: string
  listenerPid: number
  listenerStartToken: string
}

export interface CutoverBrowserHandoff {
  required: boolean
  status: 'pending' | 'acknowledged' | 'fallback-opened' | 'off' | 'failed' | 'not-required'
  channel?: 'original-tab' | 'fallback-tab'
  authentication?: 'existing-cookie' | 'launch-url'
  authority?: string
  acknowledgedAt?: number
}

export interface LaunchCutoverReceipt {
  version: 1
  id: string
  phase: CutoverPhase
  preparedAt: number
  updatedAt: number
  initiator?: string
  previous: LaunchSpecSummary
  target: LaunchSpecSummary
  supervisor: {
    previousPid: number
    previousStartToken: string
    targetDriverPid?: number
    targetDriverStartToken?: string
    targetPid?: number
    targetStartToken?: string
    previousRetirement?: 'yielded' | 'identity-gone' | 'forced'
  }
  child: {
    previousPid?: number
    targetPid?: number
    restoredPid?: number
  }
  ownership: {
    previous: CutoverProcessOwnership
    target?: CutoverProcessOwnership
    restored?: CutoverProcessOwnership
  }
  readiness?: {
    role: LaunchRole
    childPid: number
    listenerPid: number
    stableWindowMs: number
    retryCount: number
  }
  authentication: {
    transportStatus?: number
    launchUrlObserved?: boolean
    exchangeStatus?: number
    authenticatedStatus?: number
    /** Compatibility summary; detailed browser evidence lives in browserHandoff. */
    browserHandoff: CutoverBrowserHandoff['status']
  }
  /** Browser acknowledgement is independent of server transport/readiness/canary. */
  browserHandoff: CutoverBrowserHandoff
  canary?: { outcome: 'pass' | 'fail'; detail?: string }
  attempts: CutoverAttempt[]
  failureCount: { target: number; previous: number }
  recovery: {
    policy: CutoverRecoveryPolicy
    result: 'pending' | 'not-needed' | 'restored' | 'waiting-for-user' | 'prepare-failed'
    detail?: string
  }
  events: Array<{ at: number; kind: string; detail?: string }>
}

export interface CutoverControlRequest {
  version: 1
  cutoverId: string
  action: CutoverControlAction
  requestedAt: number
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
  // rename over an older file keeps the tmp inode's mode on POSIX. chmod is a
  // belt-and-suspenders guarantee for state dirs copied from older installs.
  try { chmodSync(file, 0o600) } catch { /* best effort on non-POSIX filesystems */ }
}

function isLaunchSpec(value: unknown): value is LaunchSpec {
  if (typeof value !== 'object' || value === null) return false
  const spec = value as Partial<LaunchSpec>
  return spec.version === 1
    && typeof spec.command === 'string' && spec.command !== ''
    && Number.isInteger(spec.port) && (spec.port ?? 0) > 0 && (spec.port ?? 0) <= 65535
    && typeof spec.home === 'string' && spec.home !== ''
    && typeof spec.credentialRepo === 'string' && spec.credentialRepo !== ''
    && typeof spec.harnessRoot === 'string' && spec.harnessRoot !== ''
    && typeof spec.profile === 'string' && spec.profile !== ''
}

/** Read the selected launch state, or null for a deployment predating this protocol. */
export function readLaunchState(stateDir: string): LaunchState | null {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(stateDir, 'launchSpec'), 'utf8')) as Partial<LaunchState>
    if (parsed.version !== 1) return null
    if (parsed.mode === 'stable' && isLaunchSpec(parsed.active)) return parsed as StableLaunchState
    if (parsed.mode === 'cutover' && typeof parsed.cutoverId === 'string'
      && (parsed.selected === 'target' || parsed.selected === 'previous')
      && isLaunchSpec(parsed.previous) && isLaunchSpec(parsed.target)) {
      return parsed as CutoverLaunchState
    }
    return null
  } catch {
    return null
  }
}

/** The exact spec a newly starting supervisor must honor. */
export function selectedLaunchSpec(state: LaunchState): LaunchSpec {
  if (state.mode === 'stable') return state.active
  return state[state.selected]
}

/** Persist an ordinary, non-transactional active spec. */
export function writeStableLaunchSpec(stateDir: string, spec: LaunchSpec, ifAbsent = false): boolean {
  if (!isLaunchSpec(spec)) throw new Error('invalid launch specification')
  if (ifAbsent && readLaunchState(stateDir) !== null) return false
  atomicWriteJson(stateFile(stateDir, 'launchSpec'), { version: 1, mode: 'stable', active: spec } satisfies StableLaunchState)
  return true
}

export function summarizeLaunchSpec(spec: LaunchSpec): LaunchSpecSummary {
  return {
    commandSha256: createHash('sha256').update(spec.command).digest('hex').slice(0, 16),
    port: spec.port,
    home: spec.home,
    credentialRepo: spec.credentialRepo,
    harnessRoot: spec.harnessRoot,
    profile: spec.profile,
  }
}

/** Safe operator view: preserve topology and selection without printing commands. */
export function summarizeLaunchState(state: LaunchState | null): unknown {
  if (state === null) return null
  if (state.mode === 'stable') {
    return { version: state.version, mode: state.mode, active: summarizeLaunchSpec(state.active) }
  }
  return {
    version: state.version,
    mode: state.mode,
    cutoverId: state.cutoverId,
    selected: state.selected,
    previous: summarizeLaunchSpec(state.previous),
    target: summarizeLaunchSpec(state.target),
  }
}

/** Read the durable receipt, or null when absent/malformed. */
export function readCutoverReceipt(stateDir: string): LaunchCutoverReceipt | null {
  try {
    const receipt = JSON.parse(readFileSync(stateFile(stateDir, 'launchCutover'), 'utf8')) as LaunchCutoverReceipt
    if (receipt.version !== 1 || typeof receipt.id !== 'string' || !Array.isArray(receipt.events)) return null
    // Rolling migration from receipts written before browser acknowledgement
    // became its own evidence plane. A legacy "accepted" means only that the
    // opener returned success; never relabel it as a page acknowledgement.
    if (receipt.browserHandoff === undefined) {
      const legacy = receipt.authentication?.browserHandoff as string | undefined
      const status: CutoverBrowserHandoff['status'] = legacy === 'off' ? 'off'
        : legacy === 'not-required' ? 'not-required'
          : legacy === 'failed' ? 'failed'
            : legacy === 'accepted' ? 'fallback-opened' : 'pending'
      receipt.browserHandoff = {
        required: status !== 'off',
        status,
      }
      if (legacy === 'accepted') receipt.authentication.browserHandoff = status
    }
    return receipt
  } catch {
    return null
  }
}

/** Persist an operator control request for the current watchdog to consume. */
export function writeCutoverControl(
  stateDir: string, cutoverId: string, action: CutoverControlAction, now: number,
): CutoverControlRequest {
  const active = activeCutover(stateDir)
  if (active === null || active.receipt.id !== cutoverId) throw new Error(`cutover ${cutoverId} is not active`)
  const request: CutoverControlRequest = { version: 1, cutoverId, action, requestedAt: now }
  // Separate monotonic markers remove the read-then-overwrite race between
  // independent operator sessions. Once restore exists, no later abort write
  // can downgrade the durable effective action.
  if (action === 'restore-previous') {
    atomicWriteJson(stateFile(stateDir, 'cutoverRestorePrevious'), request)
  } else {
    const existing = readControlFile(stateFile(stateDir, 'cutoverRestorePrevious'))
    if (existing?.cutoverId === cutoverId) return existing
    atomicWriteJson(stateFile(stateDir, 'cutoverAbort'), request)
  }
  const effective = readCutoverControl(stateDir)
  return effective?.cutoverId === cutoverId ? effective : request
}

function readControlFile(file: string): CutoverControlRequest | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<CutoverControlRequest>
    if (value.version !== 1 || typeof value.cutoverId !== 'string'
      || (value.action !== 'abort' && value.action !== 'restore-previous')
      || typeof value.requestedAt !== 'number') return null
    return value as CutoverControlRequest
  } catch {
    return null
  }
}

export function readCutoverControl(stateDir: string): CutoverControlRequest | null {
  const restore = readControlFile(stateFile(stateDir, 'cutoverRestorePrevious'))
  if (restore?.action === 'restore-previous') return restore
  const legacy = readControlFile(stateFile(stateDir, 'cutoverControl'))
  if (legacy?.action === 'restore-previous') return legacy
  return readControlFile(stateFile(stateDir, 'cutoverAbort')) ?? legacy
}

export function clearCutoverControl(stateDir: string, cutoverId: string): void {
  for (const role of ['cutoverRestorePrevious', 'cutoverAbort', 'cutoverControl'] as const) {
    const file = stateFile(stateDir, role)
    if (readControlFile(file)?.cutoverId === cutoverId) rmSync(file, { force: true })
  }
}

/**
 * Prepare one cutover. The receipt lands first; the single launch-state rename
 * is the commit point selecting target. A crash before that rename leaves the
 * previous stable state authoritative and the old supervisor untouched.
 */
export function prepareLaunchCutover(stateDir: string, input: {
  id: string
  previous: LaunchSpec
  target: LaunchSpec
  recoveryPolicy: CutoverRecoveryPolicy
  browserHandoff: BrowserHandoffPolicy
  previousSupervisorPid: number
  previousSupervisorStartToken: string
  previousOwnership: CutoverProcessOwnership
  initiator?: string
  now: number
}): LaunchCutoverReceipt {
  if (!isLaunchSpec(input.previous) || !isLaunchSpec(input.target)) throw new Error('invalid launch specification')
  if (input.id === '') throw new Error('cutover id is required')
  if (!Number.isInteger(input.previousSupervisorPid) || input.previousSupervisorPid <= 0) throw new Error('invalid previous supervisor pid')
  if (input.previousSupervisorStartToken === '') throw new Error('previous supervisor start identity is required')
  for (const [label, value] of Object.entries({
    previousChildPid: input.previousOwnership.childPid,
    previousListenerPid: input.previousOwnership.listenerPid,
  })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid ${label}`)
  }
  if (input.previousOwnership.childStartToken === '' || input.previousOwnership.listenerStartToken === '') {
    throw new Error('previous child/listener start identity is required')
  }
  if (input.previous.port !== input.target.port) {
    throw new Error('online cutover requires previous and target to use the same port')
  }
  // A terminal transaction normally clears these. Remove any abandoned
  // marker before creating a new ID so precedence is scoped to this cutover.
  for (const role of ['cutoverRestorePrevious', 'cutoverAbort', 'cutoverControl'] as const) {
    rmSync(stateFile(stateDir, role), { force: true })
  }
  rmSync(stateFile(stateDir, 'browserHandoffRequest'), { force: true })
  rmSync(stateFile(stateDir, 'browserHandoffAck'), { force: true })
  const receipt: LaunchCutoverReceipt = {
    version: 1,
    id: input.id,
    phase: 'prepared',
    preparedAt: input.now,
    updatedAt: input.now,
    ...(input.initiator !== undefined && input.initiator !== '' ? { initiator: input.initiator } : {}),
    previous: summarizeLaunchSpec(input.previous),
    target: summarizeLaunchSpec(input.target),
    supervisor: {
      previousPid: input.previousSupervisorPid,
      previousStartToken: input.previousSupervisorStartToken,
    },
    child: { previousPid: input.previousOwnership.childPid },
    ownership: { previous: input.previousOwnership },
    authentication: {
      browserHandoff: input.browserHandoff === 'required' ? 'pending' : 'off',
    },
    browserHandoff: {
      required: input.browserHandoff === 'required',
      status: input.browserHandoff === 'required' ? 'pending' : 'off',
    },
    attempts: [],
    failureCount: { target: 0, previous: 0 },
    recovery: { policy: input.recoveryPolicy, result: 'pending' },
    events: [{ at: input.now, kind: 'prepared' }],
  }
  atomicWriteJson(stateFile(stateDir, 'launchCutover'), receipt)
  atomicWriteJson(stateFile(stateDir, 'launchSpec'), {
    version: 1,
    mode: 'cutover',
    cutoverId: input.id,
    selected: 'target',
    previous: input.previous,
    target: input.target,
  } satisfies CutoverLaunchState)
  return receipt
}

function updateRestartRecord(stateDir: string, receipt: LaunchCutoverReceipt, outcome: 'target-ready' | 'restored' | 'awaiting-user' | 'prepare-failed'): void {
  const error = outcome === 'restored'
    ? 'launch cutover failed; the previous complete launch specification was restored'
    : outcome === 'awaiting-user'
      ? 'launch cutover failed; recovery policy requires waiting for user action'
      : outcome === 'prepare-failed'
        ? 'launch cutover was not started; the previous launch specification remains active'
        : undefined
  atomicWriteJson(stateFile(stateDir, 'lastRestart'), {
    exitAt: Date.now(),
    ...(receipt.initiator !== undefined ? { initiator: receipt.initiator } : {}),
    ...(receipt.child.previousPid !== undefined ? { pid: receipt.child.previousPid } : {}),
    ...(error !== undefined ? { error } : {}),
    cutover: {
      id: receipt.id,
      outcome,
      receipt: stateFile(stateDir, 'launchCutover'),
    },
  })
}

function requireReceipt(stateDir: string, id: string): LaunchCutoverReceipt {
  const receipt = readCutoverReceipt(stateDir)
  if (receipt === null || receipt.id !== id) throw new Error(`cutover receipt ${id} is not active`)
  return receipt
}

function appendEvent(receipt: LaunchCutoverReceipt, kind: string, detail: string | undefined, now: number): void {
  receipt.updatedAt = now
  receipt.events = [...receipt.events, { at: now, kind, ...(detail !== undefined && detail !== '' ? { detail } : {}) }].slice(-100)
}

/**
 * Apply one watchdog event. Arguments are deliberately credential-free; the
 * launch URL itself never crosses this boundary or lands in the receipt.
 */
export function recordCutoverEvent(stateDir: string, id: string, kind: string, args: readonly string[], now: number): LaunchCutoverReceipt {
  const receipt = requireReceipt(stateDir, id)
  const numberAt = (index: number, label: string): number => {
    const value = Number(args[index])
    if (!Number.isInteger(value) || value < 0) throw new Error(`${kind}: invalid ${label}`)
    return value
  }
  const pidAt = (index: number, label: string): number => {
    const value = numberAt(index, label)
    if (value === 0) throw new Error(`${kind}: invalid ${label}`)
    return value
  }
  let terminal: 'target-ready' | 'restored' | 'awaiting-user' | 'prepare-failed' | undefined
  let stableSpec: LaunchSpec | undefined
  switch (kind) {
    case 'driver-started':
      receipt.phase = 'supervisor-starting'
      receipt.supervisor.targetDriverPid = pidAt(0, 'driver pid')
      if (args[1] === undefined || args[1] === '') {
        throw new Error('driver-started: driver start identity is required')
      }
      receipt.supervisor.targetDriverStartToken = args[1]
      break
    case 'supervisor-ready':
      receipt.phase = 'supervisor-ready'
      receipt.supervisor.targetPid = pidAt(0, 'supervisor pid')
      if (args[1] === undefined || args[1] === '') {
        throw new Error('supervisor-ready: supervisor start identity is required')
      }
      receipt.supervisor.targetStartToken = args[1]
      break
    case 'previous-supervisor-retired': {
      const outcome = args[0]
      if (outcome !== 'yielded' && outcome !== 'identity-gone' && outcome !== 'forced') {
        throw new Error('previous-supervisor-retired: invalid outcome')
      }
      receipt.supervisor.previousRetirement = outcome
      break
    }
    case 'child-started': {
      const role = args[0]
      if (role !== 'target' && role !== 'previous') throw new Error('child-started: invalid role')
      const attempt = numberAt(1, 'attempt')
      const childPid = pidAt(2, 'child pid')
      const childStartToken = args[3]
      if (childStartToken === undefined || childStartToken === '') throw new Error('child-started: child start identity is required')
      receipt.phase = role === 'target' ? 'target-starting' : 'restoring'
      if (role === 'target') receipt.child.targetPid = childPid
      else receipt.child.restoredPid = childPid
      // Authentication, handoff, readiness, and canary belong to this exact
      // process identity. A retry must never inherit a previous process's
      // accepted launch URL or terminal proof.
      receipt.authentication = {
        browserHandoff: receipt.authentication.browserHandoff === 'off' ? 'off' : 'pending',
      }
      receipt.browserHandoff = {
        required: receipt.browserHandoff.required,
        status: receipt.browserHandoff.required ? 'pending' : 'off',
      }
      rmSync(stateFile(stateDir, 'browserHandoffAck'), { force: true })
      delete receipt.readiness
      delete receipt.canary
      receipt.attempts.push({ role, number: attempt, childPid, childStartToken, startedAt: now })
      break
    }
    case 'ownership-stable': {
      const role = args[0]
      if (role !== 'target' && role !== 'previous') throw new Error('ownership-stable: invalid role')
      const ownership: CutoverProcessOwnership = {
        childPid: pidAt(1, 'child pid'),
        childStartToken: args[2] ?? '',
        listenerPid: pidAt(3, 'listener pid'),
        listenerStartToken: args[4] ?? '',
      }
      if (ownership.childStartToken === '' || ownership.listenerStartToken === '') {
        throw new Error('ownership-stable: child/listener start identity is required')
      }
      const stableWindowMs = numberAt(5, 'stable window')
      const retryCount = numberAt(6, 'retry count')
      if (stableWindowMs < 1 || retryCount !== 0) throw new Error('ownership-stable: stable window must be positive and retry count must be zero')
      const attempt = [...receipt.attempts].reverse().find(candidate => candidate.role === role && candidate.outcome === undefined)
      if (attempt === undefined || attempt.childPid !== ownership.childPid
        || attempt.childStartToken !== ownership.childStartToken) {
        throw new Error(`ownership-stable: ${role} identity does not match the active attempt`)
      }
      if (role === 'target') receipt.ownership.target = ownership
      else receipt.ownership.restored = ownership
      receipt.readiness = {
        role, childPid: ownership.childPid, listenerPid: ownership.listenerPid,
        stableWindowMs, retryCount,
      }
      break
    }
    case 'transport':
      receipt.authentication.transportStatus = numberAt(0, 'HTTP status')
      break
    case 'launch-url':
      receipt.authentication.launchUrlObserved = true
      break
    case 'auth-exchange':
      receipt.authentication.exchangeStatus = numberAt(0, 'HTTP status')
      break
    case 'authenticated':
      receipt.authentication.authenticatedStatus = numberAt(0, 'HTTP status')
      break
    case 'browser-handoff': {
      const outcome = args[0]
      if (outcome !== 'acknowledged' && outcome !== 'off' && outcome !== 'failed') throw new Error('browser-handoff: invalid outcome')
      if (outcome === 'acknowledged') {
        const channel = args[1]
        const authentication = args[2]
        const authority = args[3]
        if ((channel !== 'original-tab' && channel !== 'fallback-tab')
          || (authentication !== 'existing-cookie' && authentication !== 'launch-url')
          || authority === undefined || authority === '') {
          throw new Error('browser-handoff: invalid acknowledgement evidence')
        }
        if (receipt.readiness === undefined) throw new Error('browser-handoff: server readiness is not proven')
        if (receipt.readiness.role === 'target' && receipt.canary?.outcome !== 'pass') {
          throw new Error('browser-handoff: target canary has not passed')
        }
        if (receipt.readiness.role === 'previous' && receipt.canary === undefined) {
          throw new Error('browser-handoff: restored-previous canary has not settled')
        }
        receipt.browserHandoff = {
          required: true,
          status: 'acknowledged',
          channel,
          authentication,
          authority,
          acknowledgedAt: now,
        }
      } else {
        receipt.browserHandoff = { required: outcome !== 'off', status: outcome }
      }
      receipt.authentication.browserHandoff = receipt.browserHandoff.status
      break
    }
    case 'browser-fallback-opened':
      if (!receipt.browserHandoff.required) throw new Error('browser-fallback-opened: handoff is disabled')
      if (receipt.readiness?.role === 'target' && receipt.canary?.outcome !== 'pass') {
        throw new Error('browser-fallback-opened: target canary has not passed')
      }
      if (receipt.readiness?.role === 'previous' && receipt.canary === undefined) {
        throw new Error('browser-fallback-opened: restored-previous canary has not settled')
      }
      receipt.browserHandoff = { required: true, status: 'fallback-opened' }
      receipt.authentication.browserHandoff = 'fallback-opened'
      break
    case 'control-requested': {
      const action = args[0]
      if (action !== 'abort' && action !== 'restore-previous') throw new Error('control-requested: invalid action')
      receipt.recovery.detail = action === 'restore-previous'
        ? 'operator explicitly requested restoration of the previous complete launch specification'
        : `operator aborted the cutover; applying pre-approved ${receipt.recovery.policy} policy`
      break
    }
    case 'attempt-failed': {
      const role = args[0]
      if (role !== 'target' && role !== 'previous') throw new Error('attempt-failed: invalid role')
      const attempt = numberAt(1, 'attempt')
      const detail = args.slice(2).join(' ')
      const found = [...receipt.attempts].reverse().find(candidate => candidate.role === role && candidate.number === attempt)
      if (found !== undefined) {
        found.outcome = 'failed'
        if (detail !== '') found.detail = detail
      }
      receipt.failureCount ??= { target: 0, previous: 0 }
      receipt.failureCount[role] += 1
      receipt.phase = role === 'target' ? 'target-retrying' : 'restoring'
      receipt.recovery.detail = detail
      break
    }
    case 'restoring':
      receipt.phase = 'restoring'
      receipt.recovery.detail = args.join(' ')
      // Authentication belongs to one concrete launch attempt. Do not let a
      // rejected target's launch URL/handoff satisfy (or block) the restored
      // previous child. Attempts retain the target failure history; this
      // summary is reset to describe the selected recovery side.
      receipt.authentication = {
        browserHandoff: receipt.authentication.browserHandoff === 'off' ? 'off' : 'pending',
      }
      receipt.browserHandoff = {
        required: receipt.browserHandoff.required,
        status: receipt.browserHandoff.required ? 'pending' : 'off',
      }
      rmSync(stateFile(stateDir, 'browserHandoffAck'), { force: true })
      delete receipt.readiness
      delete receipt.canary
      {
        const state = readLaunchState(stateDir)
        if (state?.mode !== 'cutover' || state.cutoverId !== id) throw new Error('restoring: cutover launch state is missing')
        atomicWriteJson(stateFile(stateDir, 'launchSpec'), { ...state, selected: 'previous' } satisfies CutoverLaunchState)
      }
      break
    case 'canary': {
      const outcome = args[0]
      if (outcome !== 'pass' && outcome !== 'fail') throw new Error('canary: invalid outcome')
      receipt.canary = { outcome, ...(args.length > 1 ? { detail: args.slice(1).join(' ') } : {}) }
      break
    }
    case 'ready': {
      const role = args[0]
      if (role !== 'target' && role !== 'previous') throw new Error('ready: invalid role')
      const state = readLaunchState(stateDir)
      if (state?.mode !== 'cutover' || state.cutoverId !== id) throw new Error('ready: cutover launch state is missing')
      const ownership = role === 'target' ? receipt.ownership?.target : receipt.ownership?.restored
      if (ownership === undefined || receipt.readiness?.role !== role
        || receipt.readiness.childPid !== ownership.childPid
        || receipt.readiness.listenerPid !== ownership.listenerPid
        || receipt.readiness.retryCount !== 0) {
        throw new Error(`ready: ${role} child/listener ownership was not stable and proven`)
      }
      const found = [...receipt.attempts].reverse().find(candidate => candidate.role === role && candidate.outcome === undefined)
      if (found === undefined || found.childPid !== ownership.childPid
        || found.childStartToken !== ownership.childStartToken) {
        throw new Error(`ready: ${role} ownership does not match the active attempt`)
      }
      if (role === 'target' && receipt.canary?.outcome !== 'pass') {
        throw new Error('ready: target canary has not passed')
      }
      if (receipt.authentication.launchUrlObserved === true && receipt.browserHandoff.required
        && receipt.browserHandoff.status !== 'acknowledged') {
        throw new Error('ready: authenticated launch URL has no browser acknowledgement')
      }
      found.outcome = 'ready'
      if (role === 'target') {
        receipt.phase = 'ready'
        receipt.recovery.result = 'not-needed'
        terminal = 'target-ready'
      } else {
        receipt.phase = 'restored'
        receipt.recovery.result = 'restored'
        terminal = 'restored'
      }
      if (receipt.authentication.browserHandoff === 'pending'
        && receipt.authentication.launchUrlObserved !== true) {
        receipt.authentication.browserHandoff = 'not-required'
        receipt.browserHandoff = { required: receipt.browserHandoff.required, status: 'not-required' }
      }
      // Keep the full pair until AFTER the terminal receipt rename releases
      // the wake gate. Compacting state first would make cutoverBlocksWake see
      // "stable" for a few disk operations before the report/receipt existed.
      stableSpec = state[role]
      atomicWriteJson(stateFile(stateDir, 'instanceLaunch'), {
        command: state[role].command,
        source: 'supervisor',
        supervised: true,
        port: state[role].port,
        recordedAt: now,
      })
      break
    }
    case 'awaiting-user':
      receipt.phase = 'awaiting-user'
      receipt.recovery.result = 'waiting-for-user'
      receipt.recovery.detail = args.join(' ')
      terminal = 'awaiting-user'
      break
    case 'prepare-failed': {
      const state = readLaunchState(stateDir)
      if (state?.mode === 'cutover' && state.cutoverId === id) {
        stableSpec = state.previous
      }
      receipt.phase = 'prepare-failed'
      receipt.recovery.result = 'prepare-failed'
      receipt.recovery.detail = args.join(' ')
      terminal = 'prepare-failed'
      break
    }
    default:
      throw new Error(`unknown cutover event ${kind}`)
  }
  appendEvent(receipt, kind, args.join(' '), now)
  // Write the report outcome before releasing the wake gate in the terminal
  // receipt rename: the restarted plugin must never observe "ready" with only
  // the exit agent's older, context-free record.
  if (terminal !== undefined) updateRestartRecord(stateDir, receipt, terminal)
  atomicWriteJson(stateFile(stateDir, 'launchCutover'), receipt)
  if (terminal !== undefined) clearCutoverControl(stateDir, id)
  if (terminal !== undefined) {
    // Keep hashed per-tab registrations after a successful terminal event so
    // slower registered tabs can still recover through this exact final
    // listener. A new cutover removes the registry before arming its own tabs.
    if (terminal !== 'target-ready' && terminal !== 'restored') {
      rmSync(stateFile(stateDir, 'browserHandoffRequest'), { force: true })
    }
    rmSync(stateFile(stateDir, 'browserHandoffAck'), { force: true })
  }
  if (stableSpec !== undefined) {
    atomicWriteJson(stateFile(stateDir, 'launchSpec'), { version: 1, mode: 'stable', active: stableSpec } satisfies StableLaunchState)
  }
  return receipt
}

/** A restarted instance must not wake/report while the watchdog is still proving the cutover. */
export function cutoverBlocksWake(stateDir: string): boolean {
  const state = readLaunchState(stateDir)
  // The receipt is intentionally written before the selected-state commit.
  // A crash in that gap leaves an orphan prepared receipt but the previous
  // stable spec authoritative; it must not gate every later cold start.
  if (state?.mode !== 'cutover') return false
  const receipt = readCutoverReceipt(stateDir)
  // Once launch state says cutover, a missing/mismatched receipt is corruption:
  // fail closed rather than waking a session against an unproved process.
  if (receipt === null || receipt.id !== state.cutoverId) return true
  const terminal: readonly CutoverPhase[] = ['ready', 'restored', 'awaiting-user', 'prepare-failed']
  return !terminal.includes(receipt.phase)
}

/** The active transaction's full specs plus its redacted policy receipt. */
export function activeCutover(stateDir: string): { state: CutoverLaunchState; receipt: LaunchCutoverReceipt } | null {
  const state = readLaunchState(stateDir)
  const receipt = readCutoverReceipt(stateDir)
  if (state?.mode !== 'cutover' || receipt === null || receipt.id !== state.cutoverId) return null
  // A crash in the tiny receipt-terminal → state-compaction gap is safe to
  // treat as ordinary selected-spec startup; only awaiting-user intentionally
  // retains a terminal cutover state.
  if (receipt.phase === 'ready' || receipt.phase === 'restored' || receipt.phase === 'prepare-failed') return null
  return { state, receipt }
}
