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
    'canvas.board.manuscripts': { kind: 'keyed'; scope: 'session'; owner: CanvasGenreOwnerProps }
  }
}

/** The child slot declarations the canvas tab registers with. */
export const CANVAS_CHILD_SLOTS = {
  'canvas.card.face': { kind: 'keyed', scope: 'session' },
  'canvas.card.section': { kind: 'list', scope: 'session' },
  'canvas.page': { kind: 'keyed', scope: 'session' },
  'canvas.board.strip': { kind: 'list', scope: 'session' },
  'canvas.board.manuscripts': { kind: 'keyed', scope: 'session' },
} as const

/** The child slot keys. */
export type CanvasChildSlot = keyof typeof CANVAS_CHILD_SLOTS

/** A keyed seat's entry key for one genre's role or page. */
export function genreKey(genreId: string, name: string): string {
  return `${genreId}:${name}`
}
