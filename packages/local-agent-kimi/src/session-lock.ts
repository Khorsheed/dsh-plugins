/**
 * kimi's per-session lock file, read from outside the CLI.
 *
 * `kimi acp` (2.4.x) claims `<KIMI_CODE_HOME>/locks/sessions/<sessionId>.lock`
 * when it loads or creates a session — JSON `{version, token: "<pid>:<uuid>",
 * pid, hostname, startedAt, clientIdentity, clientDisplayName}` — and removes
 * it on a clean exit (stdin EOF). A process that dies by signal (SIGTERM,
 * SIGKILL, a host restart's teardown) leaves the file behind, and a later
 * `session/load` refuses with "This session is in use by another … instance"
 * whenever the CLI judges the holder alive.
 *
 * This module only answers "is this lock provably stale?" and, when it is,
 * moves it aside. It is used ONLY on the member's scoped kimi home, which
 * this dsh host creates under its own home and never shares across
 * machines: a lock there is local by construction. The lock's `hostname` is
 * therefore diagnostic text, not a criterion — macOS hostnames drift with
 * network state (a prod lock read `Macmini` while `os.hostname()` was
 * `<name>.local`), and kimi itself treats a different hostname as a live
 * holder forever. Provably stale means the lock parses and its pid is gone
 * (`kill(pid, 0)` → ESRCH) or runs something that is not kimi (pid reuse).
 * A live kimi process, or a file we cannot parse, is never touched — the
 * caller fails with a clear message instead.
 *
 * The lock is renamed to `<name>.stale-<timestamp>` in the same directory
 * rather than deleted: the rename is atomic, the CLI only ever reads the exact
 * `<sessionId>.lock` path (so the aside copy is inert), and the evidence of
 * which process held the session stays on disk for diagnosis.
 * @module @khorsheed/dsh-local-agent-kimi/session-lock
 */

import { execFile } from 'node:child_process'
import { link, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** The fields of a kimi session lock this module reads. */
export interface KimiSessionLockHolder {
  readonly pid: number
  readonly hostname: string
  readonly token: string
  readonly startedAt?: number
  readonly clientDisplayName?: string
}

/** What a session's lock file says about its holder. */
export type KimiSessionLockState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly path: string }
  /** The holder pid runs a kimi process: never touched. */
  | { readonly kind: 'alive'; readonly path: string; readonly holder: KimiSessionLockHolder }
  /** The holder pid is gone (`dead`) or runs something other than kimi (`not-kimi`, pid reuse). */
  | { readonly kind: 'stale'; readonly path: string; readonly holder: KimiSessionLockHolder; readonly reason: 'dead' | 'not-kimi' }

/** Host probes; tests inject them. */
export interface KimiSessionLockProbes {
  readonly pidAlive?: (pid: number) => boolean
  /**
   * The command a live pid runs (`ps -o command= -p <pid>`), or undefined
   * when it cannot be read — which counts as a kimi process (never cleared).
   */
  readonly processCommand?: (pid: number) => Promise<string | undefined>
}

/** The lock file kimi writes for one ACP session id (`session_<uuid>`). */
export function kimiSessionLockPath(homeDir: string, acpSessionId: string): string {
  return join(homeDir, 'locks', 'sessions', `${acpSessionId}.lock`)
}

/**
 * Whether a pid names a running process. Only ESRCH proves it gone; EPERM
 * (another user's process) and anything unexpected count as alive.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function parseHolder(raw: string): KimiSessionLockHolder | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  const pid = record['pid']
  const host = record['hostname']
  // pid 0 / negatives address process groups under kill(2): never probe them.
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined
  return {
    pid,
    hostname: typeof host === 'string' ? host : '',
    token: typeof record['token'] === 'string' ? record['token'] : '',
    ...typeof record['startedAt'] === 'number' ? { startedAt: record['startedAt'] } : {},
    ...typeof record['clientDisplayName'] === 'string' ? { clientDisplayName: record['clientDisplayName'] } : {},
  }
}

/** `ps -o command= -p <pid>`: the full command line, or undefined when unreadable. */
export function processCommand(pid: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'command=', '-p', String(pid)], { timeout: 2_000 }, (error, stdout) => {
      const text = String(stdout ?? '').trim()
      resolve(error !== null || text === '' ? undefined : text)
    })
  })
}

/**
 * Whether a command line may be a kimi process: any word or path segment in
 * it starts with `kimi`. Deliberately loose — a false "kimi" only leaves a
 * lock alone, while a false "not kimi" would take a live session over.
 */
export function isKimiCommand(command: string): boolean {
  return /(?:^|[\s/])kimi/iu.test(command)
}

/** Read and classify one session's lock file. */
export async function inspectKimiSessionLock(
  homeDir: string,
  acpSessionId: string,
  probes: KimiSessionLockProbes = {},
): Promise<KimiSessionLockState> {
  const path = kimiSessionLockPath(homeDir, acpSessionId)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', path }
  }
  const holder = parseHolder(raw)
  if (holder === undefined) return { kind: 'unreadable', path }
  const alive = probes.pidAlive ?? pidAlive
  if (!alive(holder.pid)) return { kind: 'stale', path, holder, reason: 'dead' }
  const command = await (probes.processCommand ?? processCommand)(holder.pid).catch(() => undefined)
  // The process left between the two probes: gone.
  if (command === undefined && !alive(holder.pid)) return { kind: 'stale', path, holder, reason: 'dead' }
  if (command !== undefined && !isKimiCommand(command)) return { kind: 'stale', path, holder, reason: 'not-kimi' }
  return { kind: 'alive', path, holder }
}

/**
 * Move a stale lock aside. Returns the aside path, or undefined when the lock
 * changed hands meanwhile (a new holder's lock is put back untouched) or is
 * already gone.
 */
export async function setAsideKimiSessionLock(
  state: Extract<KimiSessionLockState, { kind: 'stale' }>,
  now: number = Date.now(),
): Promise<string | undefined> {
  const aside = `${state.path}.stale-${now}`
  try {
    await rename(state.path, aside)
  } catch {
    return undefined
  }
  // A CLI that claimed the session between our read and the rename wrote a
  // new token: put its lock back (the CLI claims by link(2), so the original
  // path is free unless yet another claim landed — then theirs stands).
  const moved = parseHolder(await readFile(aside, 'utf8').catch(() => ''))
  if (moved === undefined || moved.token !== state.holder.token || moved.pid !== state.holder.pid) {
    await link(aside, state.path).then(() => unlink(aside), () => undefined).catch(() => undefined)
    return undefined
  }
  return aside
}

/** kimi's refusal when another process holds the session lock. */
const SESSION_OCCUPIED = /session is in use by another/i

/** Whether an ACP error text is kimi's "session in use" refusal. */
export function isKimiSessionOccupied(text: string | undefined): boolean {
  return text !== undefined && SESSION_OCCUPIED.test(text)
}
