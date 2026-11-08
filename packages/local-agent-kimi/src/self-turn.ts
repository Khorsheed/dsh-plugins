/**
 * Reading kimi's wire for turns kimi opened on its own (a background task's
 * completion notification, `turn.prompt` with `origin.kind` other than
 * `user` — legacy `background_task` included), so the live driver never sends
 * a `session/prompt` into one blind.
 *
 * Why it matters (kimi 2.4.1, read from the installed binary): the ACP
 * server's `assertNoActiveTurn` only guards ACP's OWN in-flight request. While
 * a self-opened turn runs, `session/prompt` reaches `agent.prompt()`, the v2
 * engine QUEUES it FIFO (the facade's own note: "v1 drops a prompt submitted
 * while a turn is active … v2 queues it FIFO"), the launch resolves
 * `undefined`, and ACP settles the request with `end_turn` at once — no
 * chunks, no error. The queued prompt then runs as its own turn after the
 * self turn ends, and ACP forwards none of its events (`driverFor(turnId)`
 * filters everything but its own request's turn). The wire is the only place
 * that turn is visible.
 *
 * Pure functions over the wire text; the driver owns reading and waiting.
 * @module @khorsheed/dsh-local-agent-kimi/self-turn
 */

type Row = Record<string, unknown>

/** The rows of a wire text keyed by their 0-based line index (unparseable or partial lines skipped). */
function rows(wire: string, fromLine = 0): { line: number; row: Row }[] {
  const out: { line: number; row: Row }[] = []
  const lines = wire.split('\n')
  for (let line = Math.max(0, fromLine); line < lines.length; line++) {
    const text = lines[line]!
    if (text.trim() === '') continue
    try {
      const row = JSON.parse(text) as unknown
      if (row !== null && typeof row === 'object' && !Array.isArray(row)) out.push({ line, row: row as Row })
    } catch { /* a partial last line or a foreign line: not a row yet */ }
  }
  return out
}

/** The origin kind of a `turn.prompt` row; an absent origin is a user prompt (older wires). */
function originKind(row: Row): string {
  const kind = (row['origin'] as { kind?: unknown } | undefined)?.kind
  return typeof kind === 'string' ? kind : 'user'
}

/** The number of complete lines in a wire text (the line index the next appended row gets). */
export function wireLineCount(wire: string): number {
  return Math.max(0, wire.split('\n').length - 1)
}

/** A kimi-opened turn that has not ended yet. */
export interface OpenSelfTurn {
  /** Its `turn.prompt` line. */
  readonly line: number
  /** Its origin kind (`task`, `background_task`, `cron_job`, …). */
  readonly origin: string
}

/**
 * The self-opened turn still running at the wire's end, if any: the last
 * `turn.prompt` has no `turn.ended` after it and its origin is not `user`.
 * A prompt stamped before `sinceMs` belongs to an earlier process (a turn a
 * crash or restart cut off never writes its `turn.ended`) and is not running.
 * @param wire - the wire.jsonl text.
 * @param sinceMs - the current kimi process's spawn time (epoch ms).
 * @param anyOrigin - count an open user-origin turn too (a queued prompt whose follow was abandoned).
 */
export function findOpenSelfTurn(wire: string, sinceMs?: number, anyOrigin = false): OpenSelfTurn | undefined {
  let open: { line: number; row: Row } | undefined
  for (const entry of rows(wire)) {
    const type = entry.row['type']
    if (type === 'turn.prompt') open = entry
    else if (type === 'turn.ended') open = undefined
  }
  if (open === undefined) return undefined
  const origin = originKind(open.row)
  if (origin === 'user' && !anyOrigin) return undefined
  const time = open.row['time']
  if (sinceMs !== undefined && typeof time === 'number' && time < sinceMs) return undefined
  return { line: open.line, origin }
}

/** Where a prompt sent at `fromLine` stands on the wire. */
export type QueuedPromptState =
  /** Our prompt opened its turn with no self turn ahead of it: ACP drove it, nothing to follow. */
  | { readonly phase: 'direct' }
  /** Nothing on the wire yet tells which way it went. */
  | { readonly phase: 'unknown' }
  /** A self turn ran ahead of our prompt, which has not opened its turn yet (queued in the engine). */
  | { readonly phase: 'queued' }
  /** Our queued prompt's turn is running. */
  | { readonly phase: 'running'; readonly line: number; readonly segments: readonly string[] }
  /** Our queued prompt's turn ended. */
  | { readonly phase: 'ended'; readonly line: number; readonly reason: string; readonly segments: readonly string[] }

/**
 * Follow a prompt sent at wire line `fromLine` (the line count read right
 * before the send). Turns run one at a time in wire order, so the first
 * user-origin `turn.prompt` at or after `fromLine` is ours; it is a queued
 * one exactly when a self turn was running at the send (`selfOpenAtSend`) or
 * a self `turn.prompt` lands between the send and it. The segments are the
 * turn's answer text, one entry per model step (the driver joins them).
 * @param wire - the wire.jsonl text.
 * @param fromLine - the line count before the send.
 * @param selfOpenAtSend - a self turn was still running when the prompt went out.
 */
export function readQueuedPrompt(wire: string, fromLine: number, selfOpenAtSend: boolean): QueuedPromptState {
  let selfAhead = selfOpenAtSend
  let ours: number | undefined
  const segments: string[] = []
  let segmentKey: unknown
  for (const { line, row } of rows(wire, fromLine)) {
    const type = row['type']
    if (ours === undefined) {
      if (type !== 'turn.prompt') continue
      if (originKind(row) !== 'user') { selfAhead = true; continue }
      if (!selfAhead) return { phase: 'direct' }
      ours = line
      continue
    }
    if (type === 'turn.ended') {
      const reason = typeof row['reason'] === 'string' ? row['reason'] : 'completed'
      return { phase: 'ended', line: ours, reason, segments }
    }
    segmentKey = collectSegment(row, segments, segmentKey)
  }
  if (ours !== undefined) return { phase: 'running', line: ours, segments }
  return selfAhead ? { phase: 'queued' } : { phase: 'unknown' }
}

/** A kimi-opened turn's prompt, as its `turn.prompt` row states it. */
export interface SelfTurnPrompt {
  /** Its `turn.prompt` line. */
  readonly line: number
  /** Its origin kind (`task`, legacy `background_task`, `cron_job`, …). */
  readonly origin: string
  /** A background task's id (`origin.taskId`), when the origin names one. */
  readonly taskId?: string
  /** The task's ending (`origin.status`: `completed`, `failed`, `timed_out`, …). */
  readonly taskStatus?: string
  /** The notification id (`origin.notificationId`, `task:<id>:<status>`). */
  readonly notificationId?: string
  /** The row's timestamp (epoch ms), when stamped. */
  readonly time?: number
}

/** The line of the wire's last user-origin `turn.prompt` (an absent origin is a user prompt), or -1. */
export function lastUserPromptLine(wire: string): number {
  let last = -1
  for (const { line, row } of rows(wire)) {
    if (row['type'] === 'turn.prompt' && originKind(row) === 'user') last = line
  }
  return last
}

/**
 * The next kimi-opened turn the self-turn observer has not dealt with: the
 * first `turn.prompt` with a non-user origin after the member's last user
 * prompt (one before it was a round's to wait for, or the fold's), stamped by
 * the current process (`sinceMs`; an unstamped or older one belongs to a
 * process that is gone), and not in `handled`.
 * @param wire - the wire.jsonl text.
 * @param sinceMs - the current kimi process's spawn time.
 * @param handled - `turn.prompt` lines already dealt with.
 */
export function nextSelfTurn(wire: string, sinceMs: number, handled: ReadonlySet<number>): SelfTurnPrompt | undefined {
  return selfTurnPrompts(wire, lastUserPromptLine(wire) + 1)
    .find(prompt => !handled.has(prompt.line) && prompt.time !== undefined && prompt.time >= sinceMs)
}

/** Whether a self-opened turn's origin is a background task's notification (current and legacy spelling). */
export function isTaskOrigin(origin: string): boolean {
  return origin === 'task' || origin === 'background_task'
}

/**
 * Every kimi-opened `turn.prompt` at or after `fromLine` (the self-turn
 * observer's incremental read).
 * @param wire - the wire.jsonl text.
 * @param fromLine - the first line to look at.
 */
export function selfTurnPrompts(wire: string, fromLine = 0): SelfTurnPrompt[] {
  const found: SelfTurnPrompt[] = []
  for (const { line, row } of rows(wire, fromLine)) {
    if (row['type'] !== 'turn.prompt') continue
    const origin = originKind(row)
    if (origin === 'user') continue
    const stated = (row['origin'] ?? {}) as Row
    const text = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined
    const time = row['time']
    const taskId = text(stated['taskId'])
    const taskStatus = text(stated['status'])
    const notificationId = text(stated['notificationId'])
    found.push({
      line, origin,
      ...taskId === undefined ? {} : { taskId },
      ...taskStatus === undefined ? {} : { taskStatus },
      ...notificationId === undefined ? {} : { notificationId },
      ...typeof time === 'number' && Number.isFinite(time) ? { time } : {},
    })
  }
  return found
}

/** Where a turn opened at a known `turn.prompt` line stands. */
export type SelfTurnState =
  | { readonly phase: 'running'; readonly segments: readonly string[] }
  | { readonly phase: 'ended'; readonly reason: string; readonly segments: readonly string[] }

/**
 * Follow the turn whose `turn.prompt` sits at `line`: running until the
 * next `turn.ended`, with its answer text one segment per model step.
 * @param wire - the wire.jsonl text.
 * @param line - the turn's `turn.prompt` line.
 */
export function readTurnAt(wire: string, line: number): SelfTurnState {
  const segments: string[] = []
  let segmentKey: unknown
  for (const { row } of rows(wire, line + 1)) {
    const type = row['type']
    if (type === 'turn.ended') return { phase: 'ended', reason: typeof row['reason'] === 'string' ? row['reason'] : 'completed', segments }
    // A turn that never wrote its end (a process cut off) is followed by the next prompt.
    if (type === 'turn.prompt') return { phase: 'ended', reason: 'interrupted', segments }
    segmentKey = collectSegment(row, segments, segmentKey)
  }
  return { phase: 'running', segments }
}

/** Add one row's answer text to `segments` (one entry per model step); answers the step key seen. */
function collectSegment(row: Row, segments: string[], segmentKey: unknown): unknown {
  if (row['type'] !== 'context.append_loop_event') return segmentKey
  const event = row['event'] as Row | undefined
  if (event?.['type'] !== 'content.part') return segmentKey
  const part = event['part'] as { type?: unknown; text?: unknown } | undefined
  if (part?.type !== 'text' || typeof part.text !== 'string' || part.text === '') return segmentKey
  const key = event['stepUuid'] ?? event['step']
  if (segments.length === 0 || key !== segmentKey) segments.push(part.text)
  else segments[segments.length - 1] += part.text
  return key
}

/**
 * A background task's result kimi folded into a turn that was already
 * running (member-self-started-rounds A④ 「轮内收到的结果」): the task ended
 * mid-round, so its notification joined the round as a user-role
 * `context.append_message` with `origin.kind: 'task'` instead of opening a
 * turn of its own.
 */
export interface FoldedTaskResult {
  readonly taskId: string
  /** `origin.status`: `completed`, `failed`, `timed_out`, … */
  readonly taskStatus: string
  /** `origin.notificationId` (`task:<id>:<status>`), when stated. */
  readonly notificationId?: string
  /** The task's description from its `task.started` row, when the wire has one. */
  readonly label?: string
}

/**
 * The line of the first user-origin `turn.prompt` at or after `fromLine`
 * (a live round's own prompt: turns run one at a time in wire order).
 * @param wire - the wire.jsonl text.
 * @param fromLine - the line count read before the prompt was sent.
 */
export function firstUserPromptLine(wire: string, fromLine: number): number | undefined {
  for (const { line, row } of rows(wire, fromLine)) {
    if (row['type'] === 'turn.prompt' && originKind(row) === 'user') return line
  }
  return undefined
}

/**
 * The background-task results kimi folded into the turn whose `turn.prompt`
 * sits at `line`: every task-origin `context.append_message` inside the turn
 * (up to its `turn.ended`, or the next prompt for a turn cut off) except the
 * turn's own notification — a self-opened turn's prompt is echoed as an
 * append with the same notification id, and that is the turn's cause, not a
 * result it received. One entry per notification, in wire order.
 * @param wire - the wire.jsonl text.
 * @param line - the turn's `turn.prompt` line.
 */
export function foldedTaskResults(wire: string, line: number): FoldedTaskResult[] {
  const all = rows(wire)
  const prompt = all.find(entry => entry.line === line)?.row
  if (prompt?.['type'] !== 'turn.prompt') return []
  const text = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined
  const own = text((prompt['origin'] as Row | undefined)?.['notificationId'])
  const found: Omit<FoldedTaskResult, 'label'>[] = []
  for (const { line: at, row } of all) {
    if (at <= line) continue
    const type = row['type']
    if (type === 'turn.ended' || type === 'turn.prompt') break
    if (type !== 'context.append_message') continue
    const message = row['message'] as Row | undefined
    if (message?.['role'] !== 'user') continue
    const origin = (message['origin'] ?? {}) as Row
    const kind = text(origin['kind'])
    if (kind === undefined || !isTaskOrigin(kind)) continue
    const taskId = text(origin['taskId'])
    const taskStatus = text(origin['status'])
    const notificationId = text(origin['notificationId'])
    if (taskId === undefined || taskStatus === undefined) continue
    if (own !== undefined && notificationId === own) continue
    const key = notificationId ?? `${taskId}:${taskStatus}`
    if (found.some(entry => (entry.notificationId ?? `${entry.taskId}:${entry.taskStatus}`) === key)) continue
    found.push({ taskId, taskStatus, ...notificationId === undefined ? {} : { notificationId } })
  }
  if (found.length === 0) return []
  // The task's own words: its `task.started` row (anywhere on the wire — a
  // task started rounds earlier, possibly by an earlier process).
  const labels = new Map<string, string>()
  for (const { row } of all) {
    if (row['type'] !== 'task.started') continue
    const info = row['info'] as Row | undefined
    const id = text(info?.['taskId'])
    const description = text(info?.['description'])
    if (id !== undefined && description !== undefined) labels.set(id, description)
  }
  return found.map((entry) => {
    const label = labels.get(entry.taskId)
    return label === undefined ? entry : { ...entry, label }
  })
}

/** A kimi `turn.ended` reason as the shared stop contract. */
export function turnEndedStopReason(reason: string): 'completed' | 'aborted' | 'error' {
  if (reason === 'completed') return 'completed'
  if (reason === 'cancelled' || reason === 'aborted' || reason === 'interrupted') return 'aborted'
  return 'error'
}
