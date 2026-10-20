/**
 * Rail row assembly: the merge of the loaded chat window's user rows with the
 * host turnOutline projection into the full timeline. The outline names every
 * started turn (its `turn/start` seq plus a bounded first-prompt preview); the
 * loaded window supplies richer previews, steering rows, and message-tools
 * bubbles for the turns it covers. A turn seen in the window renders its
 * loaded rows and drops out of the outline; a turn outside the window renders
 * as an outline row that pages history in on click.
 * @module @khorsheed/dsh-message-timeline/client/rows
 */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TurnOutlineEntry } from './outline.ts'
import type { TimelineItem } from './slots.ts'

/** One loaded-window row: jumps straight to its transcript anchor. */
export interface LoadedRailRow {
  readonly kind: 'loaded'
  /** Row identity: the node key, which the tracker's active marker also speaks. */
  readonly id: string
  /** The chat node key (the `data-chat-anchor-key` the jump targets). */
  readonly key: string
  /** The underlying chat node, for content preview. */
  readonly node: ChatConversationViewNode
  /** Transcript position (the node's anchor seq) — the merge key. */
  readonly anchorSeq: number
  /** The owning outline turn, or undefined outside every outline range (a stale outline). */
  readonly turn: number | undefined
}

/**
 * One outline-only row: the turn's events are outside the loaded window, so
 * the row previews from the wire entry and confirming it pages history back
 * through the turn's `turn/start` seq before landing.
 */
export interface OutlineRailRow {
  readonly kind: 'outline'
  /** Row identity (`turn:<n>` — the prefix cannot collide with a node key). */
  readonly id: string
  readonly turn: number
  /** The turn's `turn/start` seq — the loadThrough target. */
  readonly seq: TurnOutlineEntry['seq']
  /** Same position as `seq`, as the merge key. */
  readonly anchorSeq: number
  /** Bounded first-prompt preview ('' for a textless prompt). */
  readonly prompt: string
}

/** One timeline row. */
export type RailRow = LoadedRailRow | OutlineRailRow

/**
 * Wrap one loaded item as a rail row.
 * @param item - the window row.
 * @param turn - its owning outline turn, or undefined.
 * @returns the loaded rail row.
 */
function toLoadedRow(item: TimelineItem, turn: number | undefined): LoadedRailRow {
  return { kind: 'loaded', id: item.key, key: item.key, node: item.node, anchorSeq: item.node.anchorSeq, turn }
}

/**
 * Merge loaded rows with the outline into the full row list. Both inputs are
 * transcript-ordered (loaded rows anchorSeq-ascending, the outline strictly
 * increasing by turn), so one pass interleaves them without a final sort: an
 * outline entry whose seq range holds at least one loaded row is covered and
 * emits nothing; every other entry emits its outline row at the range's
 * position. A loaded row belongs to the last entry whose start it follows —
 * when the window runs ahead of the projection feed, the newest rows read as
 * the last named turn until the feed catches up (suppressing its outline row
 * beats duplicating the turn).
 * @param loaded - the window's user rows, anchorSeq-ascending.
 * @param outline - narrowed outline entries, or undefined (capability absent).
 * @returns the merged row list, transcript-ordered.
 */
export function mergeRows(
  loaded: readonly TimelineItem[],
  outline: readonly TurnOutlineEntry[] | undefined,
): readonly RailRow[] {
  if (outline === undefined) return loaded.map(item => toLoadedRow(item, undefined))
  const rows: RailRow[] = []
  let cursor = 0
  for (const [index, entry] of outline.entries()) {
    const end = outline.at(index + 1)?.seq ?? Number.POSITIVE_INFINITY
    let covered = false
    for (;;) {
      const item = loaded[cursor]
      if (item === undefined || item.node.anchorSeq >= end) break
      rows.push(toLoadedRow(item, item.node.anchorSeq >= entry.seq ? entry.turn : undefined))
      covered = covered || item.node.anchorSeq >= entry.seq
      cursor += 1
    }
    if (!covered) {
      rows.push({
        kind: 'outline',
        id: `turn:${entry.turn}`,
        turn: entry.turn,
        seq: entry.seq,
        anchorSeq: entry.seq,
        prompt: entry.prompt,
      })
    }
  }
  for (;;) {
    const item = loaded[cursor]
    if (item === undefined) break
    rows.push(toLoadedRow(item, undefined))
    cursor += 1
  }
  return rows
}
