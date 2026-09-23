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
 * The tab rows are what the round-3 review asked for: 「打开一张卡」 used to add
 * a tab to the HOST dock, one level up from the board it came from. Inside this
 * surface a tab is a row here instead, and a row says which canvas it belongs
 * to — so a board, a card of it, and a card's unsaved draft are three rows of
 * one strip and one click moves between them. Row ids are DERIVED from their
 * subject (`b:`/`c:`/`d:` prefixes), which is what makes "open the same card
 * twice and you get one tab" a property of the id rather than a search the
 * caller has to remember to do.
 *
 * The strip also survives a reload, which the host dock never did: the list
 * rides `sessionStorage`, so closing the browser page and coming back returns
 * the tabs the user laid out. Draft TEXT does not ride along — an unsaved draft
 * is held by the view that shows it, and a page reload dropping it is the same
 * behaviour every other editor here has.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CardCategoryId } from '../../types.ts'

/** One row of the canvas surface's tab strip. */
export type CanvasTabRow =
  /** A canvas's board (its own face — 卡板 or 连线 — is the page's local state). */
  | { readonly id: string; readonly kind: 'board'; readonly canvasId: string }
  /** One card, opened to read or edit. */
  | { readonly id: string; readonly kind: 'card'; readonly canvasId: string; readonly cardId: string; readonly heading: string }
  /** One canvas's unsaved new card. One per canvas, so the ＋新卡 menu
   *  re-categorizes the draft that is open instead of seating a second blank. */
  | { readonly id: string; readonly kind: 'draft'; readonly canvasId: string; readonly catKind: CardCategoryId; readonly heading: string }

/** The row a canvas's board occupies. */
export function boardTabId(canvasId: string): string {
  return `b:${canvasId}`
}

/** The row one card occupies. */
export function cardTabId(canvasId: string, cardId: string): string {
  return `c:${canvasId}:${cardId}`
}

/** The row one canvas's draft occupies. */
export function draftTabId(canvasId: string): string {
  return `d:${canvasId}`
}

/**
 * How many rows the strip holds. Past this a new tab evicts another one (see
 * `withinCap`): the cards are the rows that pile up, losing a board row costs
 * one click in the ＋ menu, and losing a draft costs words the user typed.
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
 * the others re-read; every row operation is an ensure-and-activate, because
 * that is what clicking a card means.
 */
export class CanvasSelectionStore {
  /** The published feed (what the inject faces hand to `hooks.selection`). */
  readonly source: SnapshotStore<CanvasBoardState> = createSnapshotStore<CanvasBoardState>(readStored() ?? EMPTY)

  /** Switch to a canvas's board, opening its row if it is not on the strip. */
  openCanvas(canvasId: string): void {
    this.ensure({ id: boardTabId(canvasId), kind: 'board', canvasId })
  }

  /** Open one card, or focus the row already showing it. */
  openCardTab(canvasId: string, cardId: string, heading: string): void {
    this.ensure({ id: cardTabId(canvasId, cardId), kind: 'card', canvasId, cardId, heading })
  }

  /** Open one canvas's draft, or focus the one that is open. */
  openDraftTab(canvasId: string, catKind: CardCategoryId, heading: string): void {
    this.ensure({ id: draftTabId(canvasId), kind: 'draft', canvasId, catKind, heading })
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

  /** Note that a board changed under the open tabs (any seat's mutation). */
  touch(): void {
    const current = this.source.getSnapshot()
    this.set({ ...current, rev: current.rev + 1 })
  }

  /**
   * Put a row on the strip and show it. A row already there keeps its place but
   * takes the NEW payload: re-opening a card after an edit refreshes the strip's
   * label, and picking another category on an open draft re-categorizes it —
   * both are what the same click meant when the detail was a host tab and the
   * facts travelled as navigation params.
   */
  private ensure(row: CanvasTabRow): void {
    const current = this.source.getSnapshot()
    const at = current.tabs.findIndex(candidate => candidate.id === row.id)
    if (at >= 0) {
      const existing = current.tabs[at]!
      if (current.active === row.id && sameRow(existing, row)) return
      const tabs = [...current.tabs]
      tabs[at] = row
      this.commit(tabs, row.id)
      return
    }
    this.commit(withinCap([...current.tabs, row], row.id), row.id)
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

/**
 * True when two rows of ONE id carry the same facts. Ids are derived from the
 * subject, so a repeat `ensure` differs only in what the label says (an edited
 * card's first line) or which category the ＋新卡 menu moved a draft to.
 */
function sameRow(a: CanvasTabRow, b: CanvasTabRow): boolean {
  if (a.kind === 'draft' && b.kind === 'draft') return a.catKind === b.catKind && a.heading === b.heading
  if (a.kind === 'card' && b.kind === 'card') return a.heading === b.heading
  return a.kind === b.kind
}

/** Drop the oldest evictable row when the strip is full. */
function withinCap(tabs: readonly CanvasTabRow[], added: string): readonly CanvasTabRow[] {
  if (tabs.length <= MAX_TABS) return tabs
  // A card first: it is the row that piles up, and re-opening one is one click
  // on the card. A board row costs a trip through the ＋ menu, and a draft row
  // costs the words the user typed into it — neither is a fair price for space.
  const victim = tabs.find(candidate => candidate.id !== added && candidate.kind === 'card')
    ?? tabs.find(candidate => candidate.id !== added && candidate.kind !== 'draft')
    ?? tabs.find(candidate => candidate.id !== added)
  /* v8 ignore next -- the strip always has at least the row just added */
  if (victim === undefined) return tabs
  return tabs.filter(candidate => candidate.id !== victim.id)
}

/** Read a stashed strip, dropping anything the shape check cannot vouch for. */
function readStored(): CanvasBoardState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<StoredTabs>
    if (!Array.isArray(parsed.tabs)) return null
    const tabs = parsed.tabs.filter(isTabRow)
    if (tabs.length === 0) return null
    const active = tabs.some(row => row.id === parsed.active) ? String(parsed.active) : tabs[0]!.id
    const row = tabs.find(candidate => candidate.id === active)
    return { tabs, active, canvasId: row?.canvasId ?? null, rev: 0 }
  } catch {
    // No stash is a fine answer; a private-mode throw must not cost the board.
    return null
  }
}

/** True for a row this store could have written. */
function isTabRow(value: unknown): value is CanvasTabRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.canvasId !== 'string') return false
  if (row.kind === 'board') return true
  if (row.kind === 'card') return typeof row.cardId === 'string' && typeof row.heading === 'string'
  if (row.kind === 'draft') return typeof row.catKind === 'string' && typeof row.heading === 'string'
  return false
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
