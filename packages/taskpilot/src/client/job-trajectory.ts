/**
 * Fold the session log into the per-job execution trail.
 *
 * The detail tab reads the same durable log the trajectory view reads; this pure
 * function picks out the events one background job produced. Row shapes are
 * read through `./session-wire.ts` so both host lines' wire forms resolve
 * (the current one keys a result by `message.toolCallId` with flat content
 * blocks, the older one nests both), and malformed rows are skipped: a
 * compaction-folded or otherwise degraded log degrades to fewer rows, never a
 * throw.
 *
 * A `bash` call enters the trail in either of the two ways the tool can hand
 * the model a job id — a registered background call (paired with its
 * `started background job <id>` ack) or a foreground call its timeout promoted
 * (paired with `moved to background job <id>`) — and in no other case, so a
 * plain foreground call never mints a row.
 *
 * @module dsh-taskpilot/client/job-trajectory
 */

import type { TrajectoryEntry } from '../types.ts'
import {
  PROMOTED_JOB_ACK, asRecord, isJobsNotice, parseArgs, resultCallId, rowText,
} from './session-wire.ts'
import type { SessionLogRow } from './session-wire.ts'

export type { SessionLogRow } from './session-wire.ts'

/** The model-supplied command of a background bash call, when the log kept it. */
function commandOf(args: Record<string, unknown> | undefined): string | undefined {
  const command = args?.['command']
  return typeof command === 'string' && command.length > 0 ? command : undefined
}

/** One-line clip with an ellipsis for long commands in row titles. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * Multi-line command block for the expandable start-row detail: the command,
 * workdir, and description exactly as the model issued them, so the tab
 * shows what actually ran even though the background ack text carries none of
 * it. Empty when the call arguments were not logged.
 */
function commandDetail(args: Record<string, unknown> | undefined): string {
  if (args === undefined) return ''
  const lines: string[] = []
  const command = commandOf(args)
  if (command !== undefined) lines.push(`$ ${command}`)
  const workdir = args['workdir']
  if (typeof workdir === 'string' && workdir.length > 0) lines.push(`workdir: ${workdir}`)
  const description = args['description']
  if (typeof description === 'string' && description.length > 0) lines.push(`description: ${description}`)
  return lines.join('\n')
}

function formatTime(time: number): string {
  const date = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function jsonArgs(args: Record<string, unknown> | undefined): string {
  if (args === undefined) return ''
  try {
    return JSON.stringify(args)
  } catch {
    return ''
  }
}

/** Mutable row the fold fills in; frozen into {@link TrajectoryEntry} on return. */
interface MutableEntry {
  seq: number
  time: number
  kind: 'start' | 'read' | 'kill' | 'notice'
  title: string
  detail?: string
}

/** One call awaiting its paired result, or (for the job controls) its detail upgrade. */
interface PendingCall {
  name: string
  /** Parsed call arguments; undefined when the row's argument string was unreadable. */
  args: Record<string, unknown> | undefined
  entry?: MutableEntry
}

/**
 * Whether a paired `bash` result hands the model this job id: a background
 * call owns any ack that names its id (and mints even when the ack is
 * unreadable, because the call itself is proof the job exists), while a
 * foreground call counts only the promotion that renamed it into a job.
 */
function startOfJob(text: string, args: Record<string, unknown> | undefined, jobId: string): boolean {
  if (args?.['run_in_background'] === true) return text.length === 0 || text.includes(jobId)
  return PROMOTED_JOB_ACK.exec(text)?.[1] === jobId
}

/**
 * Slack allowed between a call row's time and the registry's `startedAt`: the
 * call event is written when the model issues it, a parse before the job
 * registers, so the row can precede the registration by a few milliseconds.
 */
const REGISTRATION_SLACK_MS = 2_000

/**
 * Fold one event window into the job's timeline.
 *
 * `registeredAt` exists because a job id is unique only within one host
 * process: a restart restarts the `<kind>-N` ordinal, so a long session's log
 * can hold several different jobs under one id. A caller that knows the row's
 * registration time passes it, and the fold keeps only that job's trail; a
 * caller without it folds the whole page.
 *
 * @param events - session log rows, oldest first (a history page in order).
 * @param jobId - the target job id (e.g. `bash-1`).
 * @param registeredAt - the job's registry registration time, when known.
 * @returns the chronological trail entries for that job.
 */
export function buildJobTrajectory(
  events: readonly SessionLogRow[],
  jobId: string,
  registeredAt?: number,
): TrajectoryEntry[] {
  const entries: MutableEntry[] = []
  // callId -> the pending call awaiting its paired result (bash) or its row (job controls).
  const pending = new Map<string, PendingCall>()
  const floor = registeredAt === undefined ? undefined : registeredAt - REGISTRATION_SLACK_MS

  for (const raw of events) {
    if (floor !== undefined && raw.time < floor) continue
    const data = asRecord(raw.data)
    if (data === undefined) continue

    if (raw.type === 'tool/call') {
      const name = data['name']
      const callId = data['callId']
      if (typeof name !== 'string' || typeof callId !== 'string') continue
      const args = parseArgs(data['arguments'])
      if (name === 'job_output' || name === 'job_kill') {
        if (args?.['job_id'] === jobId) {
          const entry: MutableEntry = {
            seq: raw.seq,
            time: raw.time,
            kind: name === 'job_output' ? 'read' : 'kill',
            title: `${formatTime(raw.time)} ${name} ${jobId}`,
            detail: jsonArgs(args),
          }
          entries.push(entry)
          // Row minted at the call; the paired result (when present) upgrades its detail.
          pending.set(callId, { name, args, entry })
        }
      } else if (name === 'bash') {
        // Start candidate: the paired result says whether this call was
        // registered in the background or promoted into one.
        pending.set(callId, { name, args })
      }
      continue
    }

    if (raw.type === 'tool/result') {
      const callId = resultCallId(data)
      if (callId === undefined) continue
      const call = pending.get(callId)
      if (call === undefined) continue
      pending.delete(callId)
      const text = rowText(data)
      const fallback = jsonArgs(call.args)
      if (call.name === 'bash') {
        if (startOfJob(text, call.args, jobId)) {
          const command = commandOf(call.args)
          const block = commandDetail(call.args)
          const detail = [block, text].filter(part => part.length > 0).join('\n')
          entries.push({
            seq: raw.seq,
            time: raw.time,
            kind: 'start',
            title: command === undefined
              ? `${formatTime(raw.time)} ${jobId} started`
              : `${formatTime(raw.time)} ${jobId} started · ${clip(command, 80)}`,
            detail: detail.length > 0 ? detail : fallback,
          })
        }
      } else if (call.entry !== undefined && text.length > 0) {
        call.entry.detail = text
      }
      continue
    }

    if (raw.type === 'user/message' && isJobsNotice(asRecord(data['source']))) {
      const text = rowText(data)
      if (text.includes(jobId)) {
        entries.push({
          seq: raw.seq,
          time: raw.time,
          kind: 'notice',
          title: `${formatTime(raw.time)} ${text.slice(0, 120)}`,
          detail: text,
        })
      }
    }
  }

  return entries.sort((left, right) => left.seq - right.seq)
}
