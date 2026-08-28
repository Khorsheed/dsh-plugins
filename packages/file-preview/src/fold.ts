/** Pure log fold over the files a session read, wrote, or edited. @module @khorsheed/dsh-file-preview/fold */

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
        // The render-intent vocabulary: a result diff registers its path even
        // when no write/edit call recorded it (non-write/edit mutation tools
        // like the official deliverables' follow-along locations).
        if (!entries.has(diff.path)) {
          record({ op: 'edit', path: diff.path }, event.seq, event.data.turn, event.data.step)
        }
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

/** Lines in one diff text: a trailing newline terminates the last line rather than adding one. */
export function lineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n').length
  return text.endsWith('\n') ? lines - 1 : lines
}

/** One file's mutation facts within one turn — the turn card's vocabulary. */
export interface TurnFileFact {
  readonly path: string
  /** Seq of the first mutation recorded for this path in this turn (stable ordering). */
  readonly seq: number
  readonly step: number
  /** Lines added across the turn's mutations of this path. */
  readonly added?: number
  /** Lines removed; absent when any mutation reported no prior content (create/overwrite). */
  readonly removed?: number
}

/** Per-turn file maps: turn number → path → mutation facts (first-seen within the turn). */
export type TurnFilesByTurn = ReadonlyMap<number, ReadonlyMap<string, TurnFileFact>>

/** Sum two optional counts; unknown wins (any uncounted mutation reports no total). */
function sumKnown(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined || b === undefined ? undefined : a + b
}

/** One write-tool call's create-fallback facts (see {@link foldFilePreviewByTurn}). */
interface WriteCallFacts {
  readonly path: string
  /** The full content the call wrote. */
  readonly content: string
  /** Whether the path had never been touched in the session log before this call (a create). */
  readonly firstTouch: boolean
}

/** Extract the full written content from a `write` tool call's arguments JSON. */
function contentFromWriteCall(argumentsJson: string): string | undefined {
  try {
    const args = JSON.parse(argumentsJson) as unknown
    if (args !== null && typeof args === 'object') {
      const content = (args as Record<string, unknown>).content
      if (typeof content === 'string') return content
    }
  } catch {
    // Model arguments are expected JSON; a malformed payload has no content.
  }
  return undefined
}

/** Read the tool-result block's call identity and failure flag off a result message. */
function resultCallFacts(
  message: { readonly content: readonly unknown[] },
): { callId: string; isError: boolean } | undefined {
  const block = message.content[0] as { type?: unknown; toolCallId?: unknown; isError?: unknown } | undefined
  if (block?.type !== 'tool-result' || typeof block.toolCallId !== 'string') return undefined
  return { callId: block.toolCallId, isError: block.isError === true }
}

/**
 * Fold a session's events into per-turn file-mutation maps — the turn card's
 * single source of truth. Unlike {@link foldFilePreview}, this does NOT dedupe
 * a path to its last occurrence: a file touched in two turns appears in BOTH
 * turn maps, so each turn's card lists exactly what that turn mutated.
 * Reads leave no card entry (the card is the mutation vocabulary — write/edit
 * only), so a pure-read call never registers; write/edit calls register with
 * their own turn; nested Code Mode dispatches borrow the enclosing root call's
 * turn (dispatch events carry none); a `tool/result` whose presentation meta
 * carries diffs registers its paths (the render-intent vocabulary) with the
 * result's turn, and per-turn line deltas are summed from the diffs. A `write` whose result carries no diffs is a
 * create (the write tool records no diffs when the file had no prior content):
 * its full written content — read from the call arguments, which the log keeps
 * — is the added-line count, once per file per turn.
 *
 * Count discipline: a write/edit tool/call only registers the path's location
 * and never touches counts (its counted result follows); the first count
 * contribution for a turn+path is adopted verbatim, later ones accumulate per
 * field with unknown-wins — an uncounted mutation (a Code Mode dispatch, or a
 * diff whose side reports no prior content) poisons that field to undefined
 * rather than reporting a misleading partial.
 * @param events - the session's events in ascending seq order.
 * @returns turn → path → facts, in event order per turn.
 */
export function foldFilePreviewByTurn(events: readonly SessionEvent[]): TurnFilesByTurn {
  const byTurn = new Map<number, Map<string, TurnFileFact>>()
  /** Root tool/call locations, so nested code dispatches borrow their turn/step. */
  const callSites = new Map<string, { turn: number; step: number }>()
  /** Write-tool calls keyed by callId (create fallback; see {@link WriteCallFacts}). */
  const writeCalls = new Map<string, WriteCallFacts>()
  /** Every path the session log has written/edited or diff-reported so far
   *  (create discrimination: a first-touch write is a create). */
  const sessionSeen = new Set<string>()
  /** Turn+path keys that have received a line-count contribution. */
  const counted = new Set<string>()
  const countKey = (turn: number, path: string): string => `${turn}:${path}`
  const turnMap = (turn: number): Map<string, TurnFileFact> => {
    let map = byTurn.get(turn)
    if (map === undefined) {
      map = new Map()
      byTurn.set(turn, map)
    }
    return map
  }
  /** Upsert a path's location without touching its line counts: a write/edit
   *  tool/call precedes its counted result, so it must neither wipe counts a
   *  sibling mutation contributed nor adopt anything itself. */
  const recordLocation = (path: string, turn: number, seq: number, step: number): void => {
    const map = turnMap(turn)
    const existing = map.get(path)
    map.set(path, existing === undefined ? { path, seq, step } : { ...existing, seq, step })
  }
  /** Apply one mutation's line-count contribution. The first contribution for
   *  a turn+path is adopted verbatim (a count-less placeholder from a
   *  preceding tool/call must not poison it); later contributions accumulate
   *  per field with unknown-wins. `unknown` marks an uncountable mutation (a
   *  Code Mode dispatch): it poisons both fields. */
  const recordContribution = (
    path: string, turn: number, seq: number, step: number,
    added: number | undefined, removed: number | undefined,
    unknown: boolean,
  ): void => {
    const map = turnMap(turn)
    const key = countKey(turn, path)
    if (unknown) {
      counted.add(key)
      map.set(path, { path, seq, step })
      return
    }
    const existing = map.get(path)
    if (!counted.has(key)) {
      counted.add(key)
      map.set(path, {
        path, seq, step,
        ...(added === undefined ? {} : { added }),
        ...(removed === undefined ? {} : { removed }),
      })
      return
    }
    // Narrow the optional totals before the conditional spread so the fact
    // never carries an explicit `undefined` (exactOptionalPropertyTypes).
    const mergedAdded = added === undefined ? undefined : sumKnown(existing?.added, added)
    const mergedRemoved = removed === undefined ? undefined : sumKnown(existing?.removed, removed)
    map.set(path, {
      path, seq, step,
      ...(mergedAdded === undefined ? {} : { added: mergedAdded }),
      ...(mergedRemoved === undefined ? {} : { removed: mergedRemoved }),
    })
  }
  for (const event of events) {
    if (event.type === 'tool/call') {
      callSites.set(String(event.data.callId), { turn: event.data.turn, step: event.data.step })
      const target = pathFromToolCall(event.data.name, event.data.arguments)
      if (target === undefined) continue
      // The card's vocabulary is mutations only: a read call registers
      // nothing (it may still anchor a nested code dispatch's location via
      // callSites above).
      if (target.op === 'read') continue
      if (target.op === 'write') {
        const content = contentFromWriteCall(event.data.arguments)
        if (content !== undefined) {
          const firstTouch = !sessionSeen.has(target.path)
          sessionSeen.add(target.path)
          writeCalls.set(String(event.data.callId), { path: target.path, content, firstTouch })
        }
      }
      recordLocation(target.path, event.data.turn, event.seq, event.data.step)
      continue
    }
    if (event.type === 'tool/code-dispatch') {
      // The dispatch event IS the settled outcome: a failed sub-call changed
      // nothing, so only successful file touches record. Code Mode writes are
      // uncountable (no result diffs reach the session), so they register the
      // path and poison the line-count totals (unknown wins).
      if (event.data.isError) continue
      const target = targetFromArguments(event.data.name, event.data.arguments)
      if (target === undefined) continue
      // Reads leave no card entry here too — only mutations register.
      if (target.op === 'read') continue
      const site = callSites.get(String(event.data.rootCallId)) ?? { turn: 0, step: 0 }
      sessionSeen.add(target.path)
      recordContribution(target.path, site.turn, event.seq, site.step, undefined, undefined, true)
      continue
    }
    if (event.type === 'tool/result') {
      const diffs = diffsFromResultMeta(event.data.meta)
      if (diffs !== undefined) {
        for (const diff of diffs) {
          sessionSeen.add(diff.path)
          recordContribution(
            diff.path, event.data.turn, event.seq, event.data.step,
            lineCount(diff.newText),
            diff.oldText === null ? undefined : lineCount(diff.oldText),
            false,
          )
        }
        continue
      }
      // Create fallback: a first-touch write whose result carries no diff meta
      // — the write tool records no diffs when the file had no prior content —
      // contributed the whole written content, so the full content IS the
      // added-line count and a create removes 0. A later empty-meta write to
      // the same path (an overwrite whose prior content was not diffable)
      // contributes nothing rather than double-counting.
      const call = resultCallFacts(event.data.message)
      const write = call === undefined ? undefined : writeCalls.get(call.callId)
      if (write === undefined || !write.firstTouch || call?.isError === true) continue
      recordContribution(write.path, event.data.turn, event.seq, event.data.step, lineCount(write.content), 0, false)
    }
  }
  return byTurn
}
