/**
 * The loaded-window ∪ turnOutline merge: covered turns render their loaded
 * rows, uncovered turns render outline rows, and the interleave keeps
 * transcript order without a final sort.
 */
import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TurnOutlineEntry } from '../src/client/outline.ts'
import { mergeRows, type RailRow } from '../src/client/rows.ts'
import type { TimelineItem } from '../src/client/slots.ts'

/** One loaded-window row stub: only the key and anchorSeq matter to the merge. */
function item(key: string, anchorSeq: number): TimelineItem {
  return { key, node: { key, anchorSeq } as unknown as ChatConversationViewNode }
}

/** One outline entry stub. */
function entry(turn: number, seq: number, prompt = `消息${turn}`): TurnOutlineEntry {
  return { turn, seq: seq as TurnOutlineEntry['seq'], prompt, response: '' }
}

/** Compact the merge result for assertions: loaded → key, outline → turn:<n>. */
function ids(rows: readonly RailRow[]): readonly string[] {
  return rows.map(row => row.id)
}

describe('mergeRows', () => {
  it('maps loaded rows without turn affinity when the outline is absent', () => {
    const rows = mergeRows([item('k1', 1), item('k2', 2)], undefined)
    expect(ids(rows)).toEqual(['k1', 'k2'])
    expect(rows.every(row => row.kind === 'loaded' && row.turn === undefined)).toBe(true)
  })

  it('emits one outline row per turn when nothing is loaded', () => {
    const rows = mergeRows([], [entry(0, 10), entry(2, 30)])
    expect(ids(rows)).toEqual(['turn:0', 'turn:2'])
    const [first] = rows
    expect(first).toMatchObject({ kind: 'outline', turn: 0, seq: 10, prompt: '消息0' })
  })

  it('drops the outline row of a covered turn and tags the loaded rows with their turn', () => {
    // Turn 1 covers [20, 30): its prompt and one steering row are loaded.
    const rows = mergeRows(
      [item('k3', 25), item('k4', 28)],
      [entry(0, 10), entry(1, 20), entry(2, 30)],
    )
    expect(ids(rows)).toEqual(['turn:0', 'k3', 'k4', 'turn:2'])
    expect(rows[1]).toMatchObject({ kind: 'loaded', turn: 1 })
    expect(rows[2]).toMatchObject({ kind: 'loaded', turn: 1 })
  })

  it('keeps transcript order when covered and uncovered turns interleave', () => {
    // Turns 0 and 2 loaded, turn 1 outline-only.
    const rows = mergeRows(
      [item('k1', 12), item('k5', 42)],
      [entry(0, 10), entry(1, 20), entry(2, 40)],
    )
    expect(ids(rows)).toEqual(['k1', 'turn:1', 'k5'])
  })

  it('attributes tail rows to the last outline entry when the window ran ahead', () => {
    // The projection feed lags one turn behind the window: rows past the last
    // entry's start read as that turn — suppressing its outline row beats
    // duplicating the turn — until the feed catches up and re-attributes them.
    const rows = mergeRows(
      [item('k1', 12), item('k9', 55)],
      [entry(0, 10), entry(1, 20)],
    )
    expect(ids(rows)).toEqual(['k1', 'k9'])
    expect(rows[1]).toMatchObject({ kind: 'loaded', turn: 1 })
  })

  it('leaves loaded rows unowned when the outline is present but empty', () => {
    const rows = mergeRows([item('k1', 1)], [])
    expect(ids(rows)).toEqual(['k1'])
    expect(rows[0]).toMatchObject({ kind: 'loaded', turn: undefined })
  })

  it('does not let a loaded row before the first entry cover it', () => {
    // Defensive: a turn's prompt never precedes its turn/start, but a skewed
    // window must not swallow the outline row either.
    const rows = mergeRows([item('k0', 5)], [entry(0, 10)])
    expect(ids(rows)).toEqual(['k0', 'turn:0'])
    expect(rows[0]).toMatchObject({ kind: 'loaded', turn: undefined })
  })
})
