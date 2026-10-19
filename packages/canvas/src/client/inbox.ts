/**
 * The canvas's inbox: how ANOTHER plugin puts a card on a canvas the user
 * chose (the reader's 「同步到画布」), and the quote menu's 「存为画布卡片」.
 *
 * Both are the user's own gesture, so the card lands kept (`putCard`, the
 * ＋新卡 path) — never as a proposal waiting for ✓. It lands as a 灵感
 * (`fragment`) card unless the caller names another category; a canvas that
 * retired 灵感 (a genre canvas folds the empty built-ins away) answers
 * `needs-kind` with the categories it does take, and the caller asks.
 *
 * Provided as `ctx.canvasInbox`; consumers probe it and hide their gesture
 * when it is absent. The shape is the contract — consumers mirror it
 * structurally rather than importing this package.
 *
 * @module @khorsheed/dsh-canvas/client/inbox
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BoardCardSource, BoardListResult, BoardMutationResult, BoardPutCardRequest, BoardReadOutcome, BoardCategory } from '../types.ts'

/** One canvas a card can go to. */
export interface CanvasInboxCanvas {
  readonly id: string
  readonly title: string
  readonly cardCount: number
}

/** One category a card can be filed under. */
export interface CanvasInboxKind {
  readonly id: string
  readonly label: string
}

/** What adding a card answers. */
export type CanvasInboxOutcome =
  | { readonly ok: true; readonly cardId: string }
  | { readonly ok: false; readonly error: 'needs-kind'; readonly kinds: readonly CanvasInboxKind[] }
  | { readonly ok: false; readonly error: string }

/** The inbox face other plugins probe for. */
export interface CanvasInboxService {
  /** The canvas the canvas tab shows now, when it shows one. */
  current(): string | null
  /** The canvases a card can go to (archived ones excluded), most recently active first. */
  listCanvases(): Promise<CanvasInboxCanvas[]>
  /** Put one kept card on a canvas. */
  addCard(sessionId: SessionId, request: { canvasId: string; text: string; kind?: string; source?: BoardCardSource }): Promise<CanvasInboxOutcome>
  /** Open the canvas tab on one card. */
  openCard(canvasId: string, cardId: string): void
}

/** The remote verbs the inbox needs. */
export interface CanvasInboxRemote {
  listCanvases(): Promise<RemoteResult<BoardListResult>>
  readBoard(request: { canvasId: string }): Promise<RemoteResult<BoardReadOutcome>>
  putCard(sessionId: SessionId, request: BoardPutCardRequest): Promise<RemoteResult<BoardMutationResult>>
}

/** The category a card lands under when the caller names none. */
export const INBOX_DEFAULT_KIND = 'fragment'

/**
 * Build the inbox over the canvas Remote.
 *
 * @param remote - the Remote (read lazily: a composition may mount it late).
 * @param label - a category's display name.
 * @param current - the canvas the tab shows.
 * @param open - open the tab on one card.
 */
export function createCanvasInbox(
  remote: () => CanvasInboxRemote,
  label: (category: BoardCategory) => string,
  current: () => string | null,
  open: (canvasId: string, cardId: string) => void,
): CanvasInboxService {
  return {
    current,
    listCanvases: async () => {
      const listed = await remote().listCanvases()
      if (!listed.ok) return []
      return [...listed.value.items]
        .filter(item => item.archivedAt === null)
        .sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt))
        .map(item => ({ id: item.id, title: item.title, cardCount: item.cardCount }))
    },
    addCard: async (sessionId, request) => {
      const read = await remote().readBoard({ canvasId: request.canvasId })
      if (!read.ok) return { ok: false, error: read.error.message }
      if (!read.value.ok) return { ok: false, error: read.value.error }
      const enabled = read.value.board.categories.filter(category => category.enabled)
      const wanted = request.kind ?? INBOX_DEFAULT_KIND
      const category = enabled.find(item => item.id === wanted)
      if (category === undefined) {
        return { ok: false, error: 'needs-kind', kinds: enabled.map(item => ({ id: item.id, label: label(item) })) }
      }
      const put = await remote().putCard(sessionId, {
        canvasId: request.canvasId,
        kind: category.id,
        text: request.text,
        ...(request.source === undefined ? {} : { source: request.source }),
      })
      if (!put.ok) return { ok: false, error: put.error.message }
      if (!put.value.ok) return { ok: false, error: put.value.error }
      const card = put.value.board.cards[put.value.board.cards.length - 1]
      return card === undefined ? { ok: false, error: 'io' } : { ok: true, cardId: card.id }
    },
    openCard: open,
  }
}
