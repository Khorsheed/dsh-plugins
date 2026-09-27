/**
 * Session-log wire reading shared by the job fold and the announcement filter.
 *
 * The history plane's row shapes moved between host lines. The current wire
 * puts a result's call id on the message (`message.toolCallId`, mirrored at
 * `message.source.callId`) and carries flat `message.content[]` text blocks;
 * older pages nest the id one level deeper (`message.content[0].toolCallId`)
 * and the text two (`message.content[0].content[].text`). The tool-jobs notice
 * names its family at `source.kind` on the current wire and at
 * `source.plugin` on the older one. Every reader here accepts both shapes and
 * degrades to an empty reading instead of throwing, so a malformed,
 * compaction-folded, or future-shaped log yields fewer rows — never a throw
 * and never a silently wrong pairing.
 *
 * @module dsh-taskpilot/client/session-wire
 */

/** One session-log row as the readers see it: the discriminant plus opaque data. */
export interface SessionLogRow {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/**
 * Background acknowledgment: the id is only credited when the paired call was
 * a registered background call, so a command that merely printed this sentence
 * cannot whitelist a job.
 */
export const BACKGROUND_JOB_ACK = /started background job ([A-Za-z0-9][A-Za-z0-9._-]*)/

/** Promotion acknowledgment: a foreground call that timed out became a background job. */
export const PROMOTED_JOB_ACK = /moved to background job ([A-Za-z0-9][A-Za-z0-9._-]*)/

/** The producer family that writes a job's completion notice. */
const JOBS_PRODUCER = 'tool-jobs'

/** Narrow an unknown value to a plain record, or undefined. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Narrow an unknown value to an array, or an empty one. */
export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** Safe JSON parse of the model-produced arguments string. */
export function parseArgs(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/**
 * The call a result answers: the message's `toolCallId`, its mirrored
 * `source.callId`, or a nested content block's `toolCallId`.
 * @param data - a `tool/result` row's data.
 * @returns the call id, or undefined when the row carries none.
 */
export function resultCallId(data: Record<string, unknown>): string | undefined {
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

/**
 * Concatenated text of a row's own content: flat `text` blocks and the nested
 * `content[].text` blocks of the older result shape, read from both
 * `message.content` and a top-level `content`.
 * @param data - a row's data.
 * @returns the text, empty when the row carries none.
 */
export function rowText(data: Record<string, unknown>): string {
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
 * Whether a row's `source` is a job completion notice: the notice `form`
 * written by the jobs producer, which the current wire names at `kind` and the
 * older one at `plugin`.
 * @param source - the row's source record.
 * @returns true when this is a job notice.
 */
export function isJobsNotice(source: Record<string, unknown> | undefined): boolean {
  if (source === undefined || source['form'] !== 'notice') return false
  return source['kind'] === JOBS_PRODUCER || source['plugin'] === JOBS_PRODUCER
}
