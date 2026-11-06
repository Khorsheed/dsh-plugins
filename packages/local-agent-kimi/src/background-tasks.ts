/**
 * A Kimi member's background tasks, read from Kimi's own task state
 * (member-self-started-rounds M1): `agents/main/tasks/<taskId>.json`, which
 * Kimi rewrites on every state change. Read-only — no watcher, nothing
 * started, adopted or replayed, and no `lost` judgment of our own yet (only
 * a file Kimi itself rewrote to `lost` reads as lost).
 *
 * The wire (`agents/main/wire.jsonl`) is read only to fill a task's
 * `parentToolCallId` when its state file lacks one (its `task.started`
 * line carries the same `info`). `startedBy` and `resultIn` come from the
 * member's own child log through the core's lookups: the task's tool call →
 * the mirrored call's turn → the execution holding that turn; a missing
 * link leaves the field out.
 * @module @khorsheed/dsh-local-agent-kimi/background-tasks
 */

import { open, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAgentBackgroundTask, LocalAgentBackgroundTaskState } from '@khorsheed/dsh-local-agent/types'
import { wirePath } from './session-view.ts'

/** Ended tasks stay listed this long after they ended. */
export const KIMI_TASK_RECENT_MS = 60 * 60 * 1000

/** A label taken from the command is cut to this many characters. */
const COMMAND_LABEL_CHARS = 60

/** Kimi's task statuses, in our vocabulary; an unknown status is not listed (never guessed). */
const STATES: Readonly<Record<string, LocalAgentBackgroundTaskState>> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed-out',
  killed: 'stopped',
  cancelled: 'stopped',
  stopped: 'stopped',
  lost: 'lost',
}

/** Kimi's task kinds that are background work; `question` (an ask-user record) and others are not. */
const KINDS: Readonly<Record<string, LocalAgentBackgroundTask['kind']>> = {
  process: 'shell',
  agent: 'agent',
}

/** The lookups over the member's own child log (see `LocalAgentBackgroundTasksRequest`). */
export interface KimiBackgroundTaskLookups {
  /** Epoch ms "now" for the recent-ended window (tests pin it). */
  readonly now?: number
  readonly executionOfCall?: (callId: string) => Promise<string | undefined>
  readonly selfExecutionOf?: (taskId: string) => Promise<string | undefined>
}

/** The tasks directory for a session directory. */
export function kimiTasksDir(sessionDir: string): string {
  return join(sessionDir, 'agents', 'main', 'tasks')
}

type TaskInfo = Record<string, unknown>

const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value : undefined
const time = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

/**
 * List a Kimi session's background tasks: running and lost ones, and the
 * ones that ended within {@link KIMI_TASK_RECENT_MS}, oldest first.
 * @param sessionDir - the Kimi session directory (`…/session_<id>`).
 * @param lookups - the core's child-log lookups and the clock.
 * @returns the tasks (empty when the session has no tasks directory).
 */
export async function readKimiBackgroundTasks(sessionDir: string, lookups: KimiBackgroundTaskLookups = {}): Promise<LocalAgentBackgroundTask[]> {
  const now = lookups.now ?? Date.now()
  const dir = kimiTasksDir(sessionDir)
  let names: string[]
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const listed: Array<{ info: TaskInfo; task: LocalAgentBackgroundTask }> = []
  for (const name of names) {
    let info: TaskInfo
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
      info = parsed as TaskInfo
    } catch {
      // A file Kimi is rewriting right now, or not a task: skip it this read.
      continue
    }
    const task = taskOf(info, name.slice(0, -'.json'.length))
    if (task === undefined) continue
    const live = task.state === 'running' || task.state === 'lost'
    if (!live && (task.endedAt ?? task.startedAt) < now - KIMI_TASK_RECENT_MS) continue
    listed.push({ info, task })
  }
  if (listed.length === 0) return []
  // The wire fills a missing tool call id, read once and only when needed.
  const missing = listed.filter(({ info }) => text(info['parentToolCallId']) === undefined).map(({ task }) => task.id)
  const fromWire = missing.length === 0 ? new Map<string, string>() : await wireToolCallIds(sessionDir, new Set(missing))
  for (const { info, task } of listed) {
    const callId = text(info['parentToolCallId']) ?? fromWire.get(task.id)
    if (callId !== undefined) task.callId = callId
    if (task.kind === 'shell') {
      const tail = await outputTail(join(dir, task.id, 'output.log'))
      if (tail !== undefined) task.outputTail = tail
    }
    const startedBy = callId === undefined ? undefined : await lookups.executionOfCall?.(callId)
    if (startedBy !== undefined) task.startedBy = startedBy
    if (task.state !== 'running') {
      const resultIn = await lookups.selfExecutionOf?.(task.id)
      if (resultIn !== undefined) task.resultIn = resultIn
    }
  }
  return listed.map(({ task }) => task).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
}

/** One task state file → a task; undefined when it is not background work or lacks a fact we need. */
function taskOf(info: TaskInfo, fileId: string): LocalAgentBackgroundTask | undefined {
  const kind = KINDS[String(info['kind'])]
  const state = STATES[String(info['status'])]
  const startedAt = time(info['startedAt'])
  // `detached: false` is a foreground task the round waits for: not background work.
  if (kind === undefined || state === undefined || startedAt === undefined || info['detached'] === false) return undefined
  const id = text(info['taskId']) ?? fileId
  const command = kind === 'shell' ? text(info['command']) : undefined
  const label = text(info['description'])?.trim() ?? command?.trim().slice(0, COMMAND_LABEL_CHARS) ?? id
  const endedAt = time(info['endedAt'])
  const exitCode = info['exitCode']
  return {
    id, label, kind, startedAt, state,
    ...command === undefined ? {} : { command },
    ...endedAt === undefined || state === 'running' ? {} : { endedAt },
    ...typeof exitCode === 'number' && Number.isFinite(exitCode) ? { exitCode } : {},
  }
}

/** How many trailing output lines a task carries, and the most bytes read to find them. */
export const KIMI_TASK_OUTPUT_LINES = 6
const OUTPUT_TAIL_BYTES = 4096

/**
 * The last {@link KIMI_TASK_OUTPUT_LINES} non-empty lines of a task's
 * `output.log`, read from its last {@link OUTPUT_TAIL_BYTES} bytes only (the
 * file grows without bound). A cut first line is dropped; carriage-return
 * progress redraws keep their last frame. Undefined when there is no file
 * or it holds no text.
 */
export async function outputTail(path: string): Promise<string[] | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, OUTPUT_TAIL_BYTES)
    if (length === 0) return undefined
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    let lines = buffer.toString('utf8').split('\n')
    if (length < size) lines = lines.slice(1)
    const shown = lines
      .map(line => (line.split('\r').filter(frame => frame !== '').at(-1) ?? '').trimEnd())
      .filter(line => line.trim() !== '')
      .slice(-KIMI_TASK_OUTPUT_LINES)
    return shown.length === 0 ? undefined : shown
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * The `parentToolCallId` the wire's `task.started` lines name for the given
 * tasks. A missing or unreadable wire answers an empty map.
 */
async function wireToolCallIds(sessionDir: string, taskIds: ReadonlySet<string>): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  let wire: string
  try {
    wire = await readFile(wirePath(sessionDir), 'utf8')
  } catch {
    return found
  }
  for (const raw of wire.split('\n')) {
    if (!raw.includes('"task.started"')) continue
    let event: { type?: unknown; info?: TaskInfo }
    try {
      event = JSON.parse(raw) as typeof event
    } catch {
      continue
    }
    if (event.type !== 'task.started' || event.info === undefined) continue
    const id = text(event.info['taskId'])
    const callId = text(event.info['parentToolCallId'])
    if (id !== undefined && callId !== undefined && taskIds.has(id) && !found.has(id)) found.set(id, callId)
  }
  return found
}
