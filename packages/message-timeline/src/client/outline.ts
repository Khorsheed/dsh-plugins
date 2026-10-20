/**
 * The host `turnOutline` projection read path. The official web bundle mounts
 * `@deepseek-ai/dsh-session-turn-outline`, which folds committed session
 * events into one entry per started turn — `{ turn, seq, prompt, response }`,
 * the seq being the turn's `turn/start` — and serves the whole array over the
 * projection feed, so the rail lists every user message without paging the
 * event window. This module owns the wire narrow; the row merge lives in
 * rows.ts.
 *
 * The value reads as `unknown`: the host may run a different line than the
 * types were built against, and an assembly without the unit serves nothing —
 * both narrow to `undefined`, which the caller treats as "capability absent"
 * and degrades to window paging.
 * @module @khorsheed/dsh-message-timeline/client/outline
 */
// Type-only: merges the `turnOutline` key into SessionProjectionMap for
// useProjection, and brings the entry type home. Never a runtime edge: the
// unit lives on the host.
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import type { TurnOutlineEntry } from '@deepseek-ai/dsh-session-turn-outline/client'

export type { TurnOutlineEntry }

/**
 * Narrow one wire projection value to outline entries. `turn` and `seq` are
 * load-bearing — a row cannot exist or jump without them — so damage there
 * drops the entry; the previews are decorative and degrade to ''. A non-array
 * value (absent unit included) narrows to undefined.
 * @param value - the raw `useProjection('turnOutline')` read.
 * @returns the surviving entries in wire order, or undefined when absent.
 */
export function outlineEntries(value: unknown): readonly TurnOutlineEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries: TurnOutlineEntry[] = []
  for (const raw of value) {
    const entry = outlineEntry(raw)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/**
 * Narrow one wire entry. `turn` and `seq` must be non-negative safe integers
 * (seq additionally rejects -0); the previews default to '' when malformed.
 * @param value - one raw wire entry.
 * @returns the entry, or undefined when a load-bearing field is damaged.
 */
function outlineEntry(value: unknown): TurnOutlineEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as { turn?: unknown; seq?: unknown; prompt?: unknown; response?: unknown }
  if (typeof entry.turn !== 'number' || !Number.isSafeInteger(entry.turn) || entry.turn < 0) return undefined
  if (typeof entry.seq !== 'number' || !Number.isSafeInteger(entry.seq) || entry.seq < 0 || Object.is(entry.seq, -0)) return undefined
  return {
    turn: entry.turn,
    seq: entry.seq as TurnOutlineEntry['seq'],
    prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
    response: typeof entry.response === 'string' ? entry.response : '',
  }
}
