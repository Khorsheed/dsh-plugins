/**
 * The board state the canvas tabs share: which canvas the board tab shows, and
 * a rev that says "a board changed somewhere". One instance lives in this client
 * bundle's apply closure and reaches every seat through their inject faces
 * (`hooks.selection`, which the slot runtime materializes into the
 * `useSelection` prop).
 *
 * The `rev` field is the cross-tab freshness channel: whichever tab mutates a
 * board touches the store (the apply-level face wrappers do it centrally), and
 * the others re-read. Selection changes never bump it — opening a detail is not
 * a board change. Which card a detail shows is NOT in here since stage ⑧: that
 * is the tab's own address, so two cards can be open at once.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** What the tabs share: the open canvas plus freshness. */
export interface CanvasBoardState {
  /** The selected canvas, or null when nothing was ever picked. */
  readonly canvasId: string | null
  /** Bumped on every board mutation from either seat (a re-read trigger). */
  readonly rev: number
}

/** The shared feed's published shape (the store's read face). */
export type CanvasSelectionSource = SnapshotStore<CanvasBoardState>

/**
 * The board/freshness store. `touch` notes a board mutation from any seat so
 * the others re-read.
 */
export class CanvasSelectionStore {
  /** The published feed (what the inject faces hand to `hooks.selection`). */
  readonly source: CanvasSelectionSource = createSnapshotStore<CanvasBoardState>({
    canvasId: null, rev: 0,
  })

  /** Switch the open canvas. */
  openCanvas(canvasId: string): void {
    const current = this.source.getSnapshot()
    if (current.canvasId === canvasId) return
    this.source.set({ canvasId, rev: current.rev })
  }

  /** Note that a board changed under the open tabs (any seat's mutation). */
  touch(): void {
    const current = this.source.getSnapshot()
    this.source.set({ ...current, rev: current.rev + 1 })
  }
}
