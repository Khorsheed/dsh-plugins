/**
 * Durable launch-configuration cutovers.
 *
 * A launch change is not a repository rollback: the command, home, checkout,
 * profile, port, readiness handoff, and recovery choice move as one unit. The
 * selected side lives in launch-spec.json (one atomic write); the redacted,
 * append-only-ish operational receipt lives in launch-cutover.json. The full
 * commands never enter the receipt because a launch command may carry secret
 * environment values.
 */
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { stateFile } from './state-files.ts'

export type CutoverRecoveryPolicy = 'restore-previous' | 'wait-for-user'
export type BrowserHandoffPolicy = 'required' | 'off'
export type LaunchRole = 'target' | 'previous'

/** Everything needed to launch one supervised instance. The state directory is the transaction anchor. */
export interface LaunchSpec {
  version: 1
  command: string
  port: number
  home: string
  repo: string
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
  repo: string
  profile: string
}

export interface CutoverAttempt {
  role: LaunchRole
  number: number
  childPid: number
  startedAt: number
  outcome?: 'failed' | 'ready'
  detail?: string
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
    targetDriverPid?: number
    targetPid?: number
  }
  child: {
    previousPid?: number
    targetPid?: number
    restoredPid?: number
  }
  authentication: {
    transportStatus?: number
    launchUrlObserved?: boolean
    exchangeStatus?: number
    authenticatedStatus?: number
    browserHandoff: 'pending' | 'accepted' | 'off' | 'failed' | 'not-required'
  }
  canary?: { outcome: 'pass' | 'fail'; detail?: string }
  attempts: CutoverAttempt[]
  recovery: {
    policy: CutoverRecoveryPolicy
    result: 'pending' | 'not-needed' | 'restored' | 'waiting-for-user' | 'prepare-failed'
    detail?: string
  }
  events: Array<{ at: number; kind: string; detail?: string }>
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
    && typeof spec.repo === 'string' && spec.repo !== ''
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
    repo: spec.repo,
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
    return receipt.version === 1 && typeof receipt.id === 'string' && Array.isArray(receipt.events) ? receipt : null
  } catch {
    return null
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
  previousChildPid?: number
  initiator?: string
  now: number
}): LaunchCutoverReceipt {
  if (!isLaunchSpec(input.previous) || !isLaunchSpec(input.target)) throw new Error('invalid launch specification')
  if (input.id === '') throw new Error('cutover id is required')
  if (!Number.isInteger(input.previousSupervisorPid) || input.previousSupervisorPid <= 0) throw new Error('invalid previous supervisor pid')
  if (input.previousChildPid !== undefined && (!Number.isInteger(input.previousChildPid) || input.previousChildPid <= 0)) {
    throw new Error('invalid previous child pid')
  }
  if (input.previous.port !== input.target.port) {
    throw new Error('online cutover requires previous and target to use the same port')
  }
  const receipt: LaunchCutoverReceipt = {
    version: 1,
    id: input.id,
    phase: 'prepared',
    preparedAt: input.now,
    updatedAt: input.now,
    ...(input.initiator !== undefined && input.initiator !== '' ? { initiator: input.initiator } : {}),
    previous: summarizeLaunchSpec(input.previous),
    target: summarizeLaunchSpec(input.target),
    supervisor: { previousPid: input.previousSupervisorPid },
    child: { ...(input.previousChildPid !== undefined ? { previousPid: input.previousChildPid } : {}) },
    authentication: {
      browserHandoff: input.browserHandoff === 'required' ? 'pending' : 'off',
    },
    attempts: [],
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
      break
    case 'supervisor-ready':
      receipt.phase = 'supervisor-ready'
      receipt.supervisor.targetPid = pidAt(0, 'supervisor pid')
      break
    case 'child-started': {
      const role = args[0]
      if (role !== 'target' && role !== 'previous') throw new Error('child-started: invalid role')
      const attempt = numberAt(1, 'attempt')
      const childPid = pidAt(2, 'child pid')
      receipt.phase = role === 'target' ? 'target-starting' : 'restoring'
      if (role === 'target') receipt.child.targetPid = childPid
      else receipt.child.restoredPid = childPid
      receipt.attempts.push({ role, number: attempt, childPid, startedAt: now })
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
      if (outcome !== 'accepted' && outcome !== 'off' && outcome !== 'failed') throw new Error('browser-handoff: invalid outcome')
      receipt.authentication.browserHandoff = outcome
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
      receipt.phase = role === 'target' ? 'target-retrying' : 'restoring'
      receipt.recovery.detail = detail
      break
    }
    case 'restoring':
      receipt.phase = 'restoring'
      receipt.recovery.detail = args.join(' ')
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
      const found = [...receipt.attempts].reverse().find(candidate => candidate.role === role)
      if (found !== undefined) found.outcome = 'ready'
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
