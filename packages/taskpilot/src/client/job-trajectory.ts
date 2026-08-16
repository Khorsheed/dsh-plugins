/**
 * Fold the session log into the per-job execution trail.
 *
 * The drawer reads the same durable log the trajectory view reads; this pure
 * function picks out the events one background job produced. The fold is
 * deliberately tolerant: wire shapes are accessed through narrow local
 * interfaces and malformed rows are skipped, so a compaction-folded or
 * otherwise degraded log degrades to fewer rows, never a throw.
 *
 * @module dsh-taskpilot/client/job-trajectory
 */

import type { TrajectoryEntry } from '../types.ts'

/** One session-log row as the fold sees it: the discriminant plus opaque data. */
export interface SessionLogRow {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Narrow wire views of the three event families a job leaves behind. */
interface WireData {
  readonly callId?: string
  readonly name?: string
  readonly arguments?: string
  readonly message?: {
    readonly content?: readonly {
      readonly toolCallId?: string
      readonly content?: readonly { readonly text?: string }[]
    }[]
  }
  readonly content?: readonly { readonly text?: string }[]
  readonly source?: { readonly plugin?: string; readonly form?: string }
}

/** Safe JSON parse of the model-produced arguments string. */
function parseArgs(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Concatenated text of a message content block list. */
function textOf(blocks: readonly { readonly text?: string }[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks.map(block => block.text ?? '').join('')
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

/**
 * Fold one event window into the job's timeline.
 * @param events - session log rows, oldest first (a history page in order).
 * @param jobId - the target job id (e.g. `bash-1`).
 * @returns the chronological trail entries for that job.
 */
export function buildJobTrajectory(
  events: readonly SessionLogRow[],
  jobId: string,
): TrajectoryEntry[] {
  const entries: MutableEntry[] = []
  // callId -> the pending call awaiting its paired result (bash) or its row (job controls).
  const pending = new Map<string, { name: string; args?: Record<string, unknown>; entry?: MutableEntry }>()

  for (const raw of events) {
    const data = typeof raw.data === 'object' && raw.data !== null ? raw.data as WireData : {}
    if (raw.type === 'tool/call' && data.name !== undefined && data.arguments !== undefined && data.callId !== undefined) {
      const args = parseArgs(data.arguments)
      if (data.name === 'job_output' || data.name === 'job_kill') {
        if (args?.job_id === jobId) {
          const entry: MutableEntry = {
            seq: raw.seq,
            time: raw.time,
            kind: data.name === 'job_output' ? 'read' : 'kill',
            title: `${formatTime(raw.time)} ${data.name} ${jobId}`,
            detail: jsonArgs(args),
          }
          entries.push(entry)
          // Row minted at the call; the paired result (when present) upgrades its detail.
          pending.set(data.callId, { name: data.name, args, entry })
        }
      } else if (data.name === 'bash' && args?.run_in_background === true) {
        // Start candidate; the paired result ack carries the job id.
        pending.set(data.callId, { name: 'bash', args })
      }
      continue
    }

    if (raw.type === 'tool/result') {
      const resultBlock = data.message?.content?.[0]
      const call = pending.get(resultBlock?.toolCallId ?? '')
      if (call === undefined) continue
      pending.delete(resultBlock?.toolCallId ?? '')
      const text = textOf(resultBlock?.content) || textOf(data.content)
      const fallback = jsonArgs(call.args)
      if (call.name === 'bash') {
        if (text.includes(jobId)) {
          entries.push({
            seq: raw.seq,
            time: raw.time,
            kind: 'start',
            title: `${formatTime(raw.time)} ${jobId} started`,
            detail: text.length > 0 ? text : fallback,
          })
        }
      } else if (call.entry !== undefined && text.length > 0) {
        call.entry.detail = text
      }
      continue
    }

    if (raw.type === 'user/message' && data.source?.plugin === 'tool-jobs' && data.source.form === 'notice') {
      const text = textOf(data.content)
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
