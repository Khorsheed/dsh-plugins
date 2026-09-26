/**
 * Which roster rows belong to jobs the tool announced to the model.
 *
 * The `bash` tool registers every call — foreground included — in the job
 * registry and removes a foreground call's record the moment it settles
 * (`@deepseek-ai/dsh-tool-bash`), so a roster row alone cannot say whether a
 * `bash` job outlives its command: a foreground row appears while the command
 * runs and vanishes with it, and a command finishing inside the roster's
 * coalescing window never appears in a frame at all. The session log does say
 * it: a background call's result reads `started background job <id>`, a
 * foreground call that outlived its timeout is promoted with `moved to
 * background job <id>`, and a plain foreground result carries no id. This
 * module folds one history page into that announced set and decides which
 * rows the dock may show.
 *
 * Hiding is the strict direction, so it demands strict evidence: a `bash` row
 * is dropped only when the page covers its registration (`startedAt >=
 * since`), its id is absent from the announced set, and no background call in
 * the page is still waiting for a readable ack. Announcing is deliberately
 * cheap — the promotion ack is trusted even unpaired, because a false positive
 * only shows a row that would otherwise be hidden. Every unreadable path fails
 * open: without a window (channel absent, read failed, malformed rows) every
 * row shows, exactly as it did before this filter existed.
 *
 * @module dsh-taskpilot/client/announced-jobs
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import type { LoadHistory } from './history-loader.ts'
import type { SessionLogRow } from './job-trajectory.ts'

/** Default tail depth of one announcement read, in session events. */
export const ANNOUNCED_TAIL_MESSAGES = 200

/**
 * How long a live `bash` row the log has not announced keeps its ack in
 * flight before the dock stops re-reading. A background call's ack is durable
 * in the same step that registers the job, so seconds are ample.
 */
export const BASH_ANNOUNCE_GRACE_MS = 5_000

/** Re-read cadence while an unannounced live `bash` row is inside its grace window. */
export const ANNOUNCED_REFRESH_MS = 1_500

/** One history page's announcement evidence, narrowed to what the filter reads. */
export interface AnnouncedBashWindow {
  /** Background and promoted bash job ids the page announced. */
  readonly ids: ReadonlySet<string>
  /** Earliest event time the page covered; a row registered before it is outside its judgement. */
  readonly since: number
  /**
   * Earliest time of a background call whose paired ack was not readable, when
   * the page holds any. A row registered at or after it may belong to that
   * call, so it is shown rather than hidden.
   */
  readonly ambiguousSince?: number
}

/** The dock's announcement read; `undefined` means the log could not be read. */
export type LoadAnnouncedBashJobs = (sessionId: SessionId) => Promise<AnnouncedBashWindow | undefined>

/**
 * Background acknowledgment: the id is only credited when the paired call was
 * a registered background call, so a command that merely printed this sentence
 * cannot whitelist a job.
 */
const BACKGROUND_ACK = /started background job ([A-Za-z0-9][A-Za-z0-9._-]*)/

/** Promotion acknowledgment: a foreground call that timed out became a background job. */
const PROMOTED_ACK = /moved to background job ([A-Za-z0-9][A-Za-z0-9._-]*)/

/** Whether a job is still live in the registry (its duration ticks). */
export function isLiveJob(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** Safe JSON parse of the model-produced arguments string. */
function parseArgs(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/**
 * The call a result answers. The current wire puts it on the message
 * (`toolCallId`, mirrored at `source.callId`); older pages nest it in the
 * first content block, so both are read.
 */
function resultCallId(data: Record<string, unknown>): string | undefined {
  const message = asRecord(data['message'])
  if (message === undefined) return undefined
  if (typeof message['toolCallId'] === 'string') return message['toolCallId']
  const source = asRecord(message['source'])
  if (source !== undefined && typeof source['callId'] === 'string') return source['callId']
  for (const block of asArray(message['content'])) {
    const record = asRecord(block)
    if (record !== undefined && typeof record['toolCallId'] === 'string') return record['toolCallId']
  }
  return undefined
}

/** Concatenated text of a result's content blocks, flat or nested. */
function resultText(data: Record<string, unknown>): string {
  const parts: string[] = []
  const push = (blocks: unknown): void => {
    for (const block of asArray(blocks)) {
      const record = asRecord(block)
      if (record === undefined) continue
      if (typeof record['text'] === 'string') parts.push(record['text'])
      for (const inner of asArray(record['content'])) {
        const innerRecord = asRecord(inner)
        if (innerRecord !== undefined && typeof innerRecord['text'] === 'string') parts.push(innerRecord['text'])
      }
    }
  }
  push(asRecord(data['message'])?.['content'])
  push(data['content'])
  return parts.join('')
}

/**
 * Fold one history page into its announcement evidence.
 * @param events - session log rows (a history page, oldest first).
 * @returns the announced ids, the earliest covered event time, and the
 *   earliest unresolved background call when the page holds one.
 */
export function collectAnnouncedBashWindow(events: readonly SessionLogRow[]): AnnouncedBashWindow {
  // callId -> the registered background call awaiting a readable ack.
  const calls = new Map<string, { time: number; resolved: boolean }>()
  const results: { callId: string | undefined; text: string }[] = []
  let since = Number.POSITIVE_INFINITY

  for (const row of events) {
    if (typeof row.time === 'number' && Number.isFinite(row.time) && row.time < since) since = row.time
    const data = asRecord(row.data)
    if (data === undefined) continue
    if (row.type === 'tool/call') {
      if (data['name'] !== 'bash' || typeof data['callId'] !== 'string') continue
      if (parseArgs(data['arguments'])?.['run_in_background'] !== true) continue
      calls.set(data['callId'], {
        time: typeof row.time === 'number' && Number.isFinite(row.time) ? row.time : 0,
        resolved: false,
      })
      continue
    }
    if (row.type === 'tool/result') {
      results.push({ callId: resultCallId(data), text: resultText(data) })
    }
  }

  const ids = new Set<string>()
  let ambiguousSince: number | undefined
  const tie = (time: number): void => {
    ambiguousSince = ambiguousSince === undefined ? time : Math.min(ambiguousSince, time)
  }

  for (const result of results) {
    const call = result.callId === undefined ? undefined : calls.get(result.callId)
    const background = BACKGROUND_ACK.exec(result.text)
    if (background !== null && call !== undefined) {
      call.resolved = true
      ids.add(background[1] as string)
    }
    // A promotion renames a foreground call into a background job, so its ack
    // is tool-authored under a call this fold never marked; it counts unpaired
    // (a false positive only shows a row).
    const promoted = PROMOTED_ACK.exec(result.text)
    if (promoted !== null) ids.add(promoted[1] as string)
  }
  for (const call of calls.values()) {
    if (!call.resolved) tie(call.time)
  }

  return {
    ids,
    since,
    ...ambiguousSince !== undefined ? { ambiguousSince } : {},
  }
}

/**
 * Whether the page is decisive about one row: it is a `bash` row the read
 * covers, and no unresolved background call could own it.
 */
function judged(job: JobView, window: AnnouncedBashWindow): boolean {
  if (job.kind !== 'bash') return false
  if (!Number.isFinite(job.startedAt)) return false
  if (job.startedAt < window.since) return false
  if (window.ambiguousSince !== undefined && job.startedAt >= window.ambiguousSince) return false
  return true
}

/**
 * The roster rows the dock may show: every row except a judged `bash` row the
 * log did not announce — those are foreground calls whose record the tool
 * removes with the command. A missing window shows every row.
 * @param jobs - the session's roster as the job channel reports it.
 * @param window - the page's evidence, or undefined when it could not be read.
 * @returns the rows to render, in the input order.
 */
export function visibleJobs(
  jobs: readonly JobView[],
  window: AnnouncedBashWindow | undefined,
): readonly JobView[] {
  if (window === undefined) return jobs
  return jobs.filter(job => !judged(job, window) || window.ids.has(String(job.id)))
}

/**
 * Ids of judged rows the page has not announced, whatever their age. A new id
 * appearing here is a fresh registration, so it is the moment a verdict may
 * have changed and the dock re-reads the log; the set is compared as a key so
 * a status tick inside the same roster shape reads nothing.
 * @param jobs - the session's roster as the job channel reports it.
 * @param window - the page's evidence, or undefined when it could not be read.
 * @returns the ids still awaiting a verdict.
 */
export function unannouncedBashIds(
  jobs: readonly JobView[],
  window: AnnouncedBashWindow | undefined,
): string[] {
  if (window === undefined) return []
  const unannounced: string[] = []
  for (const job of jobs) {
    const id = String(job.id)
    if (!judged(job, window) || window.ids.has(id)) continue
    unannounced.push(id)
  }
  return unannounced
}

/**
 * Build the dock's announcement read over the session history channel.
 * @param loadHistory - the capability-probed history loader (absent face
 *   resolves undefined, which keeps the filter fail-open).
 * @param maxMessages - tail depth of one read.
 * @returns a loader that never rejects; an unreadable page resolves undefined.
 */
export function createAnnouncedBashLoader(
  loadHistory: LoadHistory,
  maxMessages: number = ANNOUNCED_TAIL_MESSAGES,
): LoadAnnouncedBashJobs {
  return async (sessionId) => {
    try {
      const page = await loadHistory(sessionId, undefined, maxMessages)
      return page === undefined ? undefined : collectAnnouncedBashWindow(page.events)
    } catch {
      return undefined
    }
  }
}
