/**
 * The board state the canvas tabs share: the strip of open tabs, which one is
 * showing, and a rev that says "a board changed somewhere". One instance lives
 * in this client bundle's apply closure and reaches every seat through their
 * inject faces (`hooks.selection`, which the slot runtime materializes into
 * the `useSelection` prop).
 *
 * The `rev` field is the cross-tab freshness channel: whichever tab mutates a
 * board touches the store (the apply-level face wrappers do it centrally), and
 * the others re-read. Selection changes never bump it — opening a card is not
 * a board change.
 *
 * The strip holds CANVASES only (scheme B, 2026-09-27 review). Round 3 had a
 * board, a card of it and a card's draft as three rows of one strip; with a
 * few cards open the strip filled with look-alike rows and the user lost track
 * of which canvas a card belonged to. Now a row is one canvas, and `at` says
 * where inside it the row stands — its board, one card, or its draft. Moving
 * between board and card is the breadcrumb's job, not the strip's, and a
 * canvas you come back to returns to the card you left it on. Row ids are
 * DERIVED from the canvas (`b:` prefix), which is what makes "open the same
 * canvas twice and you get one tab" a property of the id rather than a search
 * the caller has to remember to do.
 *
 * The strip also survives a reload, which the host dock never did: the list
 * rides `sessionStorage`, so closing the browser page and coming back returns
 * the canvases the user laid out and the card each one stood on. Draft TEXT
 * does not ride along — an unsaved draft is held by the view that shows it,
 * and a page reload dropping it is the same behaviour every other editor here
 * has.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CardCategoryId } from '../../types.ts'

/**
 * Where one canvas row stands inside its canvas: the board, one card of it,
 * its unsaved new card, or one of its manuscripts. One draft per canvas, so the ＋新卡 menu
 * re-categorizes the draft that is open instead of seating a second blank.
 */
export type CanvasPlace =
  | { readonly kind: 'board' }
  | { readonly kind: 'card'; readonly cardId: string; readonly heading: string }
  | { readonly kind: 'draft'; readonly catKind: CardCategoryId; readonly heading: string }
  | { readonly kind: 'manuscript'; readonly manuscriptId: string; readonly heading: string }

/** One row of the canvas surface's tab strip: one canvas, and where in it. */
export interface CanvasTabRow {
  readonly id: string
  readonly canvasId: string
  readonly at: CanvasPlace
}

/** The row a canvas occupies. */
export function boardTabId(canvasId: string): string {
  return `b:${canvasId}`
}

/** The key one card's reader is mounted under (two cards never share an editor's DOM). */
export function cardTabId(canvasId: string, cardId: string): string {
  return `c:${canvasId}:${cardId}`
}

/** The key one canvas's draft is held and mounted under. */
export function draftTabId(canvasId: string): string {
  return `d:${canvasId}`
}

/** The board place, shared so an unchanged row compares by identity. */
const AT_BOARD: CanvasPlace = { kind: 'board' }

/**
 * How many rows the strip holds. Past this a new canvas evicts another one
 * (see `withinCap`): losing a canvas row costs one click in the 画布 menu, and
 * losing a draft costs words the user typed.
 */
const MAX_TABS = 16

/** Where the strip is stashed across a reload. */
const STORAGE_KEY = 'dsh-canvas.tabs'

/** What the tabs share: the strip, the active row, and freshness. */
export interface CanvasBoardState {
  /** The open rows, left to right. */
  readonly tabs: readonly CanvasTabRow[]
  /** The showing row's id, or `''` when the strip is empty. */
  readonly active: string
  /**
   * The active row's canvas — what the board reads, what the session's canvas
   * tools target. Kept as its own field (not a getter) because every existing
   * reader wants exactly this one answer.
   */
  readonly canvasId: string | null
  /** Bumped on every board mutation from either seat (a re-read trigger). */
  readonly rev: number
}

/** The shared feed's published shape (the store's read face). */
export type CanvasSelectionSource = SnapshotStore<CanvasBoardState>

/** The persisted half of a snapshot. */
interface StoredTabs {
  tabs: CanvasTabRow[]
  active: string
}

/** The empty strip. */
const EMPTY: CanvasBoardState = { tabs: [], active: '', canvasId: null, rev: 0 }

/**
 * The strip/freshness store. `touch` notes a board mutation from any seat so
 * the others re-read; every place operation is an ensure-and-activate, because
 * that is what clicking a card means.
 */
export class CanvasSelectionStore {
  /** The published feed (what the inject faces hand to `hooks.selection`). */
  readonly source: SnapshotStore<CanvasBoardState> = createSnapshotStore<CanvasBoardState>(readStored() ?? EMPTY)

  /**
   * Switch to a canvas, opening its row if it is not on the strip. A row that
   * is already there keeps its place inside the canvas: coming back to a
   * canvas returns to the card you left it on.
   */
  openCanvas(canvasId: string): void {
    const existing = this.source.getSnapshot().tabs.find(row => row.canvasId === canvasId)
    this.ensure(canvasId, existing?.at ?? AT_BOARD)
  }

  /** Go back from a card (or the draft) to its canvas's board. */
  backToBoard(canvasId: string): void {
    this.ensure(canvasId, AT_BOARD)
  }

  /** Open one card inside its canvas's row. */
  openCardTab(canvasId: string, cardId: string, heading: string): void {
    this.ensure(canvasId, { kind: 'card', cardId, heading })
  }

  /** Open one canvas's draft inside its row (re-categorizing an open one). */
  openDraftTab(canvasId: string, catKind: CardCategoryId, heading: string): void {
    this.ensure(canvasId, { kind: 'draft', catKind, heading })
  }

  /** Open one manuscript inside its canvas's row. */
  openManuscriptTab(canvasId: string, manuscriptId: string, heading: string): void {
    this.ensure(canvasId, { kind: 'manuscript', manuscriptId, heading })
  }

  /** Show a row that is already open. A row that is gone changes nothing. */
  activate(id: string): void {
    const current = this.source.getSnapshot()
    const row = current.tabs.find(candidate => candidate.id === id)
    if (row === undefined || current.active === id) return
    this.commit(current.tabs, id)
  }

  /**
   * Take a row off the strip. Closing the showing row activates its left
   * neighbour (or the next one), so the strip is never left blank mid-work;
   * closing a row that is not showing leaves the view alone.
   */
  close(id: string): void {
    const current = this.source.getSnapshot()
    const at = current.tabs.findIndex(candidate => candidate.id === id)
    if (at < 0) return
    const tabs = current.tabs.filter(candidate => candidate.id !== id)
    if (current.active !== id) {
      this.commit(tabs, current.active)
      return
    }
    const neighbour = tabs[Math.min(at, tabs.length - 1)]
    this.commit(tabs, neighbour?.id ?? '')
  }

  /**
   * Drop what a delete took away. A deleted card (or manuscript) sends its
   * canvas's row back to the board when the row stood on it; a deleted canvas takes its row off
   * the strip and, when that row was showing, hands the view to the neighbour.
   */
  forget(canvasId: string, cardId?: string, manuscriptId?: string): void {
    const current = this.source.getSnapshot()
    const index = current.tabs.findIndex(row => row.canvasId === canvasId)
    if (index < 0) return
    const row = current.tabs[index]!
    if (manuscriptId !== undefined) {
      if (row.at.kind !== 'manuscript' || row.at.manuscriptId !== manuscriptId) return
      const tabs = [...current.tabs]
      tabs[index] = { ...row, at: AT_BOARD }
      this.commit(tabs, current.active)
      return
    }
    if (cardId !== undefined) {
      if (row.at.kind !== 'card' || row.at.cardId !== cardId) return
      const tabs = [...current.tabs]
      tabs[index] = { ...row, at: AT_BOARD }
      this.commit(tabs, current.active)
      return
    }
    this.close(row.id)
  }

  /** Note that a board changed under the open tabs (any seat's mutation). */
  touch(): void {
    const current = this.source.getSnapshot()
    this.set({ ...current, rev: current.rev + 1 })
  }

  /**
   * Put a canvas's row on the strip at one place and show it. A row already
   * there keeps its slot but takes the NEW place: re-opening a card after an
   * edit refreshes its heading, and picking another category on an open draft
   * re-categorizes it.
   */
  private ensure(canvasId: string, at: CanvasPlace): void {
    const current = this.source.getSnapshot()
    const id = boardTabId(canvasId)
    const index = current.tabs.findIndex(candidate => candidate.id === id)
    if (index >= 0) {
      const existing = current.tabs[index]!
      if (current.active === id && samePlace(existing.at, at)) return
      const tabs = [...current.tabs]
      tabs[index] = samePlace(existing.at, at) ? existing : { id, canvasId, at }
      this.commit(tabs, id)
      return
    }
    this.commit(withinCap([...current.tabs, { id, canvasId, at }], current.active, id), id)
  }

  /** Write a strip and derive its answers from it. */
  private commit(tabs: readonly CanvasTabRow[], active: string): void {
    const row = tabs.find(candidate => candidate.id === active)
    this.set({ tabs, active, canvasId: row?.canvasId ?? null, rev: this.source.getSnapshot().rev })
  }

  private set(next: CanvasBoardState): void {
    this.source.set(next)
    writeStored(next)
  }
}

/** True when two places name the same thing with the same words. */
function samePlace(a: CanvasPlace, b: CanvasPlace): boolean {
  if (a.kind === 'draft' && b.kind === 'draft') return a.catKind === b.catKind && a.heading === b.heading
  if (a.kind === 'card' && b.kind === 'card') return a.cardId === b.cardId && a.heading === b.heading
  if (a.kind === 'manuscript' && b.kind === 'manuscript') return a.manuscriptId === b.manuscriptId && a.heading === b.heading
  return a.kind === b.kind
}

/**
 * Drop the oldest evictable row when the strip is full. Neither the row just
 * added nor the one the user was on goes, and a row holding a draft is the
 * last resort: it costs the words typed into it.
 */
function withinCap(tabs: readonly CanvasTabRow[], showing: string, added: string): readonly CanvasTabRow[] {
  if (tabs.length <= MAX_TABS) return tabs
  const spare = (row: CanvasTabRow): boolean => row.id !== added && row.id !== showing
  const victim = tabs.find(row => spare(row) && row.at.kind !== 'draft')
    ?? tabs.find(spare)
  /* v8 ignore next -- a full strip always has a spare row */
  if (victim === undefined) return tabs
  return tabs.filter(candidate => candidate.id !== victim.id)
}

/**
 * Read a stashed strip, dropping anything the shape check cannot vouch for.
 * A stash from before the strip held canvases only (card and draft rows of
 * their own, ids `c:`/`d:`) folds into one row per canvas, standing on its
 * board — the draft text never rode the stash, so nothing is lost.
 */
function readStored(): CanvasBoardState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<StoredTabs>
    if (!Array.isArray(parsed.tabs)) return null
    const tabs: CanvasTabRow[] = []
    let active = ''
    for (const value of parsed.tabs as unknown[]) {
      const row = storedRowOf(value)
      if (row === null) continue
      if (!tabs.some(candidate => candidate.id === row.id)) tabs.push(row)
      if (isRecord(value) && value.id === parsed.active) active = row.id
    }
    if (tabs.length === 0) return null
    if (active === '') active = tabs[0]!.id
    const row = tabs.find(candidate => candidate.id === active)
    return { tabs, active, canvasId: row?.canvasId ?? null, rev: 0 }
  } catch {
    // No stash is a fine answer; a private-mode throw must not cost the board.
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The row a stashed value stands for, or null when it cannot be vouched for. */
function storedRowOf(value: unknown): CanvasTabRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.canvasId !== 'string') return null
  const canvasId = value.canvasId
  const id = boardTabId(canvasId)
  // The pre-canvas-only shapes: every one of them still names its canvas.
  if (value.kind === 'board' || value.kind === 'card' || value.kind === 'draft') return { id, canvasId, at: AT_BOARD }
  if (value.id !== id || !isRecord(value.at)) return null
  const at = value.at
  if (at.kind === 'board') return { id, canvasId, at: AT_BOARD }
  if (at.kind === 'card' && typeof at.cardId === 'string' && typeof at.heading === 'string') {
    return { id, canvasId, at: { kind: 'card', cardId: at.cardId, heading: at.heading } }
  }
  if (at.kind === 'manuscript' && typeof at.manuscriptId === 'string' && typeof at.heading === 'string') {
    return { id, canvasId, at: { kind: 'manuscript', manuscriptId: at.manuscriptId, heading: at.heading } }
  }
  // A draft's words never rode the stash, so a reload stands on the board.
  if (at.kind === 'draft') return { id, canvasId, at: AT_BOARD }
  return null
}

/** Stash the strip. Its tab ids carry the canvas and card, so a reload finds them. */
function writeStored(state: CanvasBoardState): void {
  try {
    const payload: StoredTabs = { tabs: [...state.tabs], active: state.active }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // A full or blocked stash costs the reload, never the session.
  }
}
