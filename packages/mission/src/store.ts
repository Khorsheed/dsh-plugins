/**
 * The store: one run one `runs/<runId>.json`, an append-only run-data tree
 * under `runs/<runId>/data/…`, and cross-process write safety. The service
 * (in-host), the tools, and the CLI (separate processes) all mutate through
 * this one module, so a CLI call and a host call writing the same run
 * serialize on a per-run lock file; every mutation is
 * lock → read → modify → temp-write → atomic-rename.
 *
 * The lock is hand-rolled (no dependency): exclusive-create (`wx`) of a
 * `<runId>.json.lock` file carrying `{pid, at}`; a lock whose pid is dead or
 * older than the stale threshold is reclaimed. This is the documented
 * trade-off of JSON-file storage — fine at the expected write density,
 * replaceable (sqlite) without touching the data model.
 */
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { RunRecord } from './types.ts'

/** Ids become path segments — keep them inside a safe alphabet. */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/

/** Assert an id is usable as a path segment (no traversal, no separators). */
export function assertSafeId(id: string, what: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`mission: ${what} ${JSON.stringify(id)} is not a usable id (allowed: letters, digits, '.', '_', '-')`)
  }
}

/**
 * Assert a relative path stays inside its base directory.
 * @returns the absolute target path.
 */
export function resolveInside(base: string, rel: string, what: string): string {
  if (rel === '' || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`mission: ${what} must be a relative path, got ${JSON.stringify(rel)}`)
  }
  const target = resolve(base, rel)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`mission: ${what} escapes its base directory: ${JSON.stringify(rel)}`)
  }
  return target
}

/** A held lock; `release` is idempotent. */
interface LockHandle {
  release(): void
}

const LOCK_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 60_000
/** A lock file younger than this but not yet parseable is a writer mid-create — wait, don't reclaim. */
const LOCK_GRACE_MS = 5_000

async function sleep(ms: number): Promise<void> {
  await new Promise(resolvePromise => { setTimeout(resolvePromise, ms) })
}

function lockIsStale(lockPath: string): boolean {
  let raw: string
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch {
    return false // vanished between checks, or unreadable — let the create retry decide
  }
  let pid: number | undefined
  let at: number | undefined
  try {
    const info = JSON.parse(raw) as { pid?: unknown; at?: unknown }
    if (typeof info.pid === 'number') pid = info.pid
    if (typeof info.at === 'number') at = info.at
  } catch {
    // Half-written lock (create and write are two syscalls): young → wait.
    try {
      return Date.now() - statSync(lockPath).mtimeMs > LOCK_GRACE_MS
    } catch {
      return false
    }
  }
  if (at !== undefined && Date.now() - at > LOCK_STALE_MS) return true
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return false // owner alive
  } catch {
    return true // ESRCH: owner is dead, the lock is orphaned
  }
}

async function acquireLock(lockPath: string): Promise<LockHandle> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`)
      } finally {
        closeSync(fd)
      }
      let released = false
      return {
        release() {
          if (released) return
          released = true
          try {
            unlinkSync(lockPath)
          } catch {
            // Already reclaimed as stale — nothing to do.
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
      if (lockIsStale(lockPath)) {
        try {
          unlinkSync(lockPath)
        } catch {
          // Someone else reclaimed it first — loop around.
        }
        continue
      }
      if (Date.now() > deadline) {
        throw new Error(`mission: timed out waiting for the run lock ${lockPath}`)
      }
      await sleep(15 + Math.random() * 35)
    }
  }
}

/** The outcome of one locked mutation: `run` replaces the stored record (null deletes nothing / creates nothing), `result` returns to the caller. */
export interface Mutation<T> {
  run: RunRecord | null
  result: T
}

/**
 * The mission store rooted at a data directory. All writes funnel through
 * {@link update}; reads are unlocked (a read may observe any committed
 * revision, never a partial one — writes are atomic renames).
 */
export class MissionStore {
  constructor(readonly root: string) {}

  get runsDir(): string {
    return join(this.root, 'runs')
  }

  runFile(runId: string): string {
    assertSafeId(runId, 'run id')
    return join(this.runsDir, `${runId}.json`)
  }

  /** The append-only run-data root: `<root>/runs/<runId>/data`. */
  runDataDir(runId: string): string {
    assertSafeId(runId, 'run id')
    return join(this.runsDir, runId, 'data')
  }

  /** One attempt's run-data directory — the base `file-check` dirs resolve against. */
  attemptDataDir(runId: string, missionId: string, attempt: number): string {
    assertSafeId(missionId, 'mission id')
    return join(this.runDataDir(runId), missionId, `attempt-${attempt}`)
  }

  listRunIds(): string[] {
    if (!existsSync(this.runsDir)) return []
    return readdirSync(this.runsDir)
      .filter(name => name.endsWith('.json'))
      .map(name => name.slice(0, -'.json'.length))
      .sort()
  }

  /**
   * Read one run. Absent → null; malformed → loud error (never silently
   * treated as absent — the invariant companion reports the same corruption).
   */
  readRun(runId: string): RunRecord | null {
    const file = this.runFile(runId)
    if (!existsSync(file)) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`mission: run file ${file} is malformed: ${String(error)}`)
    }
    return parsed as RunRecord
  }

  /**
   * Lock → read → mutate → atomic write. A throwing mutator aborts without
   * writing, so a failed guard or validation never leaves a half-applied run.
   */
  async update<T>(runId: string, mutator: (run: RunRecord | null) => Mutation<T>): Promise<T> {
    mkdirSync(this.runsDir, { recursive: true })
    const lock = await acquireLock(`${this.runFile(runId)}.lock`)
    try {
      const current = this.readRun(runId)
      const { run, result } = mutator(current)
      if (run !== null) {
        const file = this.runFile(runId)
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
        writeFileSync(tmp, `${JSON.stringify(run, null, 2)}\n`)
        renameSync(tmp, file)
      }
      return result
    } finally {
      lock.release()
    }
  }

  /**
   * Append one file into an attempt's run-data directory. Append-only: an
   * existing path with IDENTICAL bytes is an idempotent no-op, with different
   * bytes a loud refusal — run data is never rewritten.
   * @returns true when the file was written, false on the idempotent no-op.
   */
  appendDataFile(runId: string, missionId: string, attempt: number, relPath: string, content: Buffer): boolean {
    const base = this.attemptDataDir(runId, missionId, attempt)
    const target = resolveInside(base, relPath, 'data file path')
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target)) {
      const existing = readFileSync(target)
      if (existing.equals(content)) return false
      throw new Error(`mission: run data is append-only — ${relPath} already exists with different content (run ${runId}, mission ${missionId}, attempt ${attempt})`)
    }
    writeFileSync(target, content, { flag: 'wx' })
    return true
  }
}
