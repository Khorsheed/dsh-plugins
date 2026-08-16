/** Pure log fold over the files a session read, wrote, or edited. @module @deepseek-ai/dsh-file-preview/fold */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: pulls the SessionEventMap merge for 'tool/code-dispatch'.
import type {} from '@deepseek-ai/dsh-tools/types'
import type { FilePreviewDiff, FilePreviewEntry, FilePreviewList, FilePreviewOp } from './types.ts'

/** Tool names whose calls record a touched file path. */
const FILE_TOOL_NAMES: ReadonlySet<string> = new Set(['read', 'write', 'edit'])

/** The argument key carrying the touched path (shared by all three file tools). */
const FILE_PATH_ARGUMENT = 'file_path'

/** The extracted touch operation and display path of one tool call. */
export interface FilePreviewCallTarget {
  /** The operation the tool performs. */
  readonly op: FilePreviewOp
  /** The display path recorded in the call arguments. */
  readonly path: string
}

/** One write/edit diff captured from a tool result's presentation meta. */
export type FilePreviewResultDiff = {
  /** The changed file's path (the same display path the call recorded). */
  readonly path: string
  /** Prior content, or null for a new file / an overwrite. */
  readonly oldText: string | null
  /** Content after the change. */
  readonly newText: string
}

/**
 * Extract the touched path and operation from parsed file-tool arguments.
 * @param name - the tool name.
 * @param args - the parsed arguments payload (an object when well-formed).
 * @returns the touch target, or undefined when the call is not a file touch.
 */
function targetFromArguments(name: string, args: unknown): FilePreviewCallTarget | undefined {
  if (!FILE_TOOL_NAMES.has(name)) return undefined
  if (args !== null && typeof args === 'object') {
    const candidate = (args as Record<string, unknown>)[FILE_PATH_ARGUMENT]
    if (typeof candidate === 'string' && candidate.length > 0) {
      return { op: name as FilePreviewOp, path: candidate }
    }
  }
  return undefined
}

/** Extract the touched path and operation from one tool call's raw arguments JSON. */
export function pathFromToolCall(name: string, argumentsJson: string): FilePreviewCallTarget | undefined {
  try {
    return targetFromArguments(name, JSON.parse(argumentsJson))
  } catch {
    // Model arguments are expected JSON; a malformed payload contributes no path.
    return undefined
  }
}

/** Read the write/edit diff list out of a tool result's tool-private meta. */
export function diffsFromResultMeta(meta: unknown): readonly FilePreviewResultDiff[] | undefined {
  if (meta === null || typeof meta !== 'object') return undefined
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return undefined
  const result: FilePreviewResultDiff[] = []
  for (const item of diffs) {
    if (item === null || typeof item !== 'object') return undefined
    const { path, oldText, newText } = item as Record<string, unknown>
    if (typeof path !== 'string' || path.length === 0) return undefined
    if (typeof newText !== 'string') return undefined
    if (oldText !== null && typeof oldText !== 'string') return undefined
    result.push({ path, oldText, newText })
  }
  return result
}

/**
 * Fold a session's events into the files it read, wrote, or edited, in
 * first-seen order and deduplicated by display path; a later occurrence
 * refreshes the entry's op and location without moving it, and each write/edit
 * tool result appends its change's diff to the entry's `diffs` in event order.
 * Nested Code Mode file dispatches (`tool/code-dispatch` events) count too —
 * they carry no turn/step of their own, so the entry borrows the enclosing
 * root call's location.
 * @param events - the session's events in ascending seq order.
 * @param maxFiles - cap on returned entries; excess files are dropped in
 *   first-seen order after the cap is reached.
 * @returns the capped list plus the last scanned seq and the truncation flag.
 */
export function foldFilePreview(events: readonly SessionEvent[], maxFiles: number): FilePreviewList {
  const entries = new Map<string, FilePreviewEntry>()
  /** Root tool/call locations, so nested code dispatches borrow their turn/step. */
  const callSites = new Map<string, { turn: number; step: number }>()
  let asOfSeq = -1
  /** Upsert one touched path, refreshing a repeat in place and keeping its diffs. */
  const record = (target: FilePreviewCallTarget, seq: number, turn: number, step: number): void => {
    const next: FilePreviewEntry = { path: target.path, op: target.op, seq, turn, step, diffs: [] }
    const existing = entries.get(target.path)
    if (existing === undefined && entries.size >= maxFiles) return
    entries.set(target.path, existing === undefined ? next : { ...existing, ...next, diffs: existing.diffs })
  }
  for (const event of events) {
    asOfSeq = event.seq
    if (event.type === 'tool/call') {
      callSites.set(String(event.data.callId), { turn: event.data.turn, step: event.data.step })
      const target = pathFromToolCall(event.data.name, event.data.arguments)
      if (target === undefined) continue
      record(target, event.seq, event.data.turn, event.data.step)
      continue
    }
    if (event.type === 'tool/code-dispatch') {
      // The dispatch event IS the settled outcome: a failed sub-call changed
      // nothing, so only successful file touches record.
      if (event.data.isError) continue
      const target = targetFromArguments(event.data.name, event.data.arguments)
      if (target === undefined) continue
      const site = callSites.get(String(event.data.rootCallId)) ?? { turn: 0, step: 0 }
      record(target, event.seq, site.turn, site.step)
      continue
    }
    if (event.type === 'tool/result') {
      const diffs = diffsFromResultMeta(event.data.meta)
      if (diffs === undefined) continue
      for (const diff of diffs) {
        const entry = entries.get(diff.path)
        if (entry === undefined) continue
        const change: FilePreviewDiff = {
          seq: event.seq,
          turn: event.data.turn,
          step: event.data.step,
          oldText: diff.oldText,
          newText: diff.newText,
        }
        entries.set(diff.path, { ...entry, diffs: [...entry.diffs, change] })
      }
    }
  }
  return {
    entries: [...entries.values()].map((entry) => {
      const last = entry.diffs[entry.diffs.length - 1]
      return last === undefined ? entry : { ...entry, lastDiff: { oldText: last.oldText, newText: last.newText } }
    }),
    asOfSeq,
    truncated: entries.size >= maxFiles,
  }
}
