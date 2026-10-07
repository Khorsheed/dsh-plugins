/**
 * The canvas tab's child slots: the seats a genre (创作体裁) plugin fills to
 * put its own surfaces inside the canvas. They are declared as children of the
 * canvas tab registration and rendered through its `renderSlot`, so a genre
 * never mounts a surface of its own — the canvas stays the one UI, and a
 * canvas with no genre selected renders none of these seats at all.
 *
 * Keys of the keyed seats are `genreKey(genreId, name)`: two genres may both
 * name a role `character` or a page `ledger` without colliding.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardCard, BoardCategory, CanvasBoard } from '../types.ts'

/** Where a genre surface can send the reader, bound to the canvas it renders in. */
export interface CanvasNavigate {
  /** Open one card of this canvas. */
  openCard: (cardId: string, heading: string) => void
  /** Open one manuscript of this canvas. */
  openManuscript: (manuscriptId: string, heading: string) => void
  /** Open a genre page (`page` is its `genreKey`, `param` whatever the page reads). */
  openPage: (page: string, heading: string, param?: string) => void
  /** Back to this canvas's board. */
  backToBoard: () => void
  /** Back to this canvas's board, on its 成稿 face. */
  openManuscripts: () => void
  /** Tell every canvas seat the board changed (after a genre's own mutation landed). */
  refresh: () => void
}

/** What every genre seat is handed: the canvas as last read, and where it can go. */
export interface CanvasGenreOwnerProps {
  readonly canvasId: string
  readonly board: CanvasBoard
  /** The board freshness counter; a seat that reads its own data re-reads when it moves. */
  readonly rev: number
  readonly navigate: CanvasNavigate
  /**
   * The session a genre's own writes are fenced by; undefined where the
   * surface is read-only (no session, or an archived canvas).
   */
  readonly sessionId?: SessionId | undefined
}

/**
 * The canvas's navigation from outside the canvas tab (`ctx.canvasNav`): a
 * genre's conversation card opens one of its pages without knowing how the
 * tab is opened or where its rows live. A consumer probes it with
 * `ctx.get('canvasNav')` and degrades without it.
 */
export interface CanvasNavService {
  /** Open the canvas tab and put `canvasId`'s row on a genre page. */
  openPage: (canvasId: string, page: string, heading: string, param?: string) => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The canvas's outside navigation, provided by @khorsheed/dsh-canvas's browser half. */
    canvasNav: CanvasNavService
  }
}

/** One card, as a face or a card-page section sees it. */
export interface CanvasCardOwnerProps extends CanvasGenreOwnerProps {
  readonly card: BoardCard
  readonly category: BoardCategory
}

/**
 * The 成稿 face of a genre that owns it. `onEmpty` says the genre has written
 * nothing yet: while the user has not picked a face on this canvas, the canvas
 * opens on its cards instead (a fresh work starts from its material).
 */
export interface CanvasManuscriptsOwnerProps extends CanvasGenreOwnerProps {
  readonly onEmpty?: (() => void) | undefined
}

/** One top-face label of a genre with `faces`: which face it names. */
export interface CanvasTabLabelOwnerProps extends CanvasGenreOwnerProps {
  /** `manuscripts`, `board`, or the genre's own face key. */
  readonly face: string
  /** The canvas's own label for the face (what the entry shows besides a count, say). */
  readonly label: string
}

/** A narrower set of the board's cards, offered as one more chip on the 卡板 face. */
export interface CanvasCardScope {
  readonly id: string
  readonly label: string
  readonly cardIds: readonly string[]
  /**
   * Its cards are in use: deleting one offers 归档 first (an unused card's
   * question has no such way out — nothing would miss it).
   */
  readonly archiveFirst?: boolean
}

/**
 * The card scopes a genre offers on its canvases' 卡板 face (已进入故事 / 灵感,
 * say). The entry renders nothing: it reads its own data and hands the scopes
 * up through `onScopes`, and the canvas draws them as chips in its own style,
 * so a board never shows two chip looks.
 */
export interface CanvasScopesOwnerProps extends CanvasGenreOwnerProps {
  readonly onScopes: (scopes: readonly CanvasCardScope[]) => void
}

/** A genre page: the page key it was opened under and its parameter. */
export interface CanvasPageOwnerProps extends CanvasGenreOwnerProps {
  readonly page: string
  readonly param?: string | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * A card's face on the board, keyed `genreKey(genre, role)`: replaces the
     * plain summary of every card whose category carries that role, on a
     * canvas whose genre is that genre.
     */
    'canvas.card.face': { kind: 'keyed'; scope: 'session'; owner: CanvasCardOwnerProps }
    /** Extra sections on a card page, after the body (each entry decides whether the card is its own). */
    'canvas.card.section': { kind: 'list'; scope: 'session'; owner: CanvasCardOwnerProps }
    /** A whole page inside a canvas row, keyed by the page key `navigate.openPage` was given. */
    'canvas.page': { kind: 'keyed'; scope: 'session'; owner: CanvasPageOwnerProps }
    /** A strip pinned under the board's toolbar (pending review, say). */
    'canvas.board.strip': { kind: 'list'; scope: 'session'; owner: CanvasGenreOwnerProps }
    /**
     * The 成稿 face, keyed by genre id: a genre that `ownsManuscripts` shows
     * its own text here (the novel's chapters) instead of the manuscript list.
     */
    'canvas.board.manuscripts': { kind: 'keyed'; scope: 'session'; owner: CanvasManuscriptsOwnerProps }
    /**
     * A top-face label on a genre with `faces`, keyed `genreKey(genre, face)`:
     * the label. Missing: the plain label.
     */
    'canvas.board.tab': { kind: 'keyed'; scope: 'session'; owner: CanvasTabLabelOwnerProps }
    /**
     * The count beside a top-face label, keyed like `canvas.board.tab` (the
     * novel's 章节: what waits on the person). The face tabs render it as the
     * tab's badge, outside the label's underline. Missing: no badge.
     */
    'canvas.board.tab.badge': { kind: 'keyed'; scope: 'session'; owner: CanvasTabLabelOwnerProps }
    /** The genre's own top face (with `faces`), keyed `genreKey(genre, faces.view)`. */
    'canvas.board.view': { kind: 'keyed'; scope: 'session'; owner: CanvasGenreOwnerProps }
    /** The card scopes of the 卡板 face, keyed by genre id (see `CanvasScopesOwnerProps`). */
    'canvas.board.scopes': { kind: 'keyed'; scope: 'session'; owner: CanvasScopesOwnerProps }
    /**
     * The 连线 layout on a genre with `faces`, keyed by genre id: a genre whose
     * links are cards of their own (the novel's relations) draws them here.
     * Missing: the canvas's own link board.
     */
    'canvas.board.graph': { kind: 'keyed'; scope: 'session'; owner: CanvasGenreOwnerProps }
    /**
     * What a card's delete question adds, keyed by genre id (the chapters that
     * use it, say). Rendered under the question's own words; nothing = no note.
     */
    'canvas.card.deleteNote': { kind: 'keyed'; scope: 'session'; owner: CanvasCardOwnerProps }
  }
}

/** The child slot declarations the canvas tab registers with. */
export const CANVAS_CHILD_SLOTS = {
  'canvas.card.face': { kind: 'keyed', scope: 'session' },
  'canvas.card.section': { kind: 'list', scope: 'session' },
  'canvas.page': { kind: 'keyed', scope: 'session' },
  'canvas.board.strip': { kind: 'list', scope: 'session' },
  'canvas.board.manuscripts': { kind: 'keyed', scope: 'session' },
  'canvas.board.tab': { kind: 'keyed', scope: 'session' },
  'canvas.board.tab.badge': { kind: 'keyed', scope: 'session' },
  'canvas.board.view': { kind: 'keyed', scope: 'session' },
  'canvas.board.scopes': { kind: 'keyed', scope: 'session' },
  'canvas.board.graph': { kind: 'keyed', scope: 'session' },
  'canvas.card.deleteNote': { kind: 'keyed', scope: 'session' },
} as const

/** The child slot keys. */
export type CanvasChildSlot = keyof typeof CANVAS_CHILD_SLOTS

/** A keyed seat's entry key for one genre's role or page. */
export function genreKey(genreId: string, name: string): string {
  return `${genreId}:${name}`
}
