/**
 * Which host process this is, and which one ran before it — the durable
 * boot evidence a restart's "was this round cut off by THIS restart?" needs
 * (member-self-started-rounds, the M9 hotfix's known residual).
 *
 * A round's ledger row (or room journal) can still say `running` long after
 * the restart that cut it off, when no process loaded it since; whichever
 * process loads it first then converts it with a fresh time. When the rows
 * were written says nothing about which restart that was. What does: a round
 * that started before the PREVIOUS host process did was already cut off by
 * that process's start, so it is never the latest restart's.
 *
 * The record is one small file next to the ledgers: the current process and
 * the one before it. A process is identified by its pid and its start time
 * (`performance.timeOrigin`), so a plugin reload inside the same process
 * keeps the record as it is; only a new process rotates it.
 * @module @khorsheed/dsh-local-agent/host-process
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** One host process: its identity and when it started (epoch ms). */
export interface HostProcess {
  readonly id: string
  readonly startedAt: number
}

/** This process and the one before it, as far as the record knows. */
export interface HostProcesses {
  readonly current: HostProcess
  /** Absent on the first boot with this record (no evidence: callers keep their old rule). */
  readonly previous?: HostProcess
}

/** This OS process. */
export function currentHostProcess(): HostProcess {
  const startedAt = Math.round(performance.timeOrigin)
  return { id: `${process.pid}@${startedAt}`, startedAt }
}

function valid(value: unknown): value is HostProcess {
  const row = value as Partial<HostProcess> | undefined
  return typeof row?.id === 'string' && Number.isFinite(row.startedAt)
}

/**
 * Read the record and, when it names another process as current, rotate it:
 * that process becomes `previous`, this one `current`. A record that already
 * names this process (a plugin reload) is returned unchanged. An unreadable
 * record counts as none; a failed write is logged by the caller and the
 * answer still holds for this process.
 * @param file - the record's path.
 * @param self - this process (tests stand in other processes).
 * @param onError - where a write failure goes.
 */
export function recordHostProcess(file: string, self: HostProcess = currentHostProcess(), onError: (error: unknown) => void = () => {}): HostProcesses {
  let stored: { current?: unknown; previous?: unknown } | undefined
  try { stored = JSON.parse(readFileSync(file, 'utf8')) as typeof stored } catch { stored = undefined }
  const current = valid(stored?.current) ? stored.current : undefined
  if (current?.id === self.id) return { current, ...valid(stored?.previous) ? { previous: stored.previous } : {} }
  const next: HostProcesses = { current: self, ...current === undefined ? {} : { previous: current } }
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) { onError(error) }
  return next
}

/**
 * Whether a round that started at `startedAt` was cut off by an EARLIER
 * restart than the one that started this process: it began before the
 * previous process did. Without evidence (no previous process on record, no
 * start time) the answer is false — the caller's old rule stands.
 */
export function startedBeforePreviousProcess(startedAt: number | undefined, processes: HostProcesses | undefined): boolean {
  const previous = processes?.previous?.startedAt
  return previous !== undefined && startedAt !== undefined && Number.isFinite(startedAt) && startedAt < previous
}
