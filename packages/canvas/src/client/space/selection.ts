/**
 * The selection shared by the canvas space's two seats: the board panel
 * (`main`) writes it, the card-detail reader (`sidebar.right.pane.tab`)
 * follows it. One instance lives in this client bundle's apply closure and
 * reaches both through their inject faces (`hooks.selection`, which the slot
 * runtime materializes into the `useSelection` prop).
 *
 * The `rev` field is the cross-seat freshness channel: whichever seat mutates
 * a board touches the store (the apply-level face wrappers do it centrally),
 * and the other seat re-reads. Selection changes never bump it — opening a
 * detail is not a board change.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** What the detail reader follows: which card of which canvas, plus freshness. */
export interface CanvasCardSelection {
  /** The selected canvas, or null when nothing was ever picked. */
  readonly canvasId: string | null
  /** The selected card, or null with the canvas. */
  readonly cardId: string | null
  /** Bumped on every board mutation from either seat (a re-read trigger). */
  readonly rev: number
}

/** The selection feed's published shape (the store's read face). */
export type CanvasSelectionSource = SnapshotStore<CanvasCardSelection>

/**
 * The board↔detail selection store. `select` opens a card in the detail
 * reader; `touch` notes a board mutation from either seat so the other
 * re-reads.
 */
export class CanvasSelectionStore {
  /** The published feed (what the inject faces hand to `hooks.selection`). */
  readonly source: CanvasSelectionSource = createSnapshotStore<CanvasCardSelection>({
    canvasId: null, cardId: null, rev: 0,
  })

  /** Open one card in the detail reader (a board click; `rev` untouched). */
  select(canvasId: string, cardId: string): void {
    const current = this.source.getSnapshot()
    if (current.canvasId === canvasId && current.cardId === cardId) return
    this.source.set({ canvasId, cardId, rev: current.rev })
  }

  /** Note that a board changed under the open detail (either seat's mutation). */
  touch(): void {
    const current = this.source.getSnapshot()
    this.source.set({ ...current, rev: current.rev + 1 })
  }
}
