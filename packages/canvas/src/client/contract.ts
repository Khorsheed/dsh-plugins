/**
 * Composed props contract for the canvas surface's seats. The `canvas` page owns
 * the tab strip (round 3, item ⑥): a row is a canvas's board, one of its cards,
 * or one card's unsaved draft, and the card body is `CanvasDetailView` mounted
 * in that same page rather than in a tab of the HOST dock (stage ⑧'s shape,
 * retired). The seat is session scope — its mutations fence through the tab's
 * own session — and the strip plus board freshness ride the shared store
 * exposed as `hooks.selection` (the slot runtime binds it into the
 * `useSelection` prop).
 *
 * @module @khorsheed/dsh-canvas/client
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-canvas/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ui-workspace's GlobalStandardProps merge (useWorkspaces —
// the registered workspaces feed the switcher's attach pickers read).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the right-Sidebar SlotMap seat ('sidebar.right.pane.tab')
// and the tab-params map this package merges into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls ui-layout's ILayout (the wide-mode suggestion's face).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  BoardAddCommentRequest, BoardArchiveRequest, BoardAskAgentOutcome, BoardAskAgentRequest,
  BoardAttachImageOutcome, BoardAttachImageRequest, BoardChatStatusResult, BoardCreateRequest,
  BoardDeleteCanvasRequest, BoardDeleteCanvasResult, BoardDeleteCardRequest,
  BoardFocusRequest, BoardFocusResult,
  BoardListResult, BoardMutationResult,
  BoardPatchCardRequest, BoardPutCardRequest,
  BoardReadOutcome, BoardReadRequest, BoardSetCategoriesRequest, BoardSetLayoutRequest,
  CardCategoryId,
  CanvasStroke,
} from '../types.ts'
import type {} from './locales.ts'
import type { CanvasImageRevSource, CanvasImageSrcs } from './images.ts'
import type { CanvasSelectionSource } from './space/selection.ts'

/** The canvas Remote namespace, as mounted by this plugin. */
export type CanvasRemote = TypertRemoteNamespaceMap['canvas']

/**
 * The chat-seam face both seats share (M2): ask through the probed side-chat
 * service, probe its availability (every chat entry hides when absent), and
 * activate the side-chat tab on the primed context.
 */
export interface CanvasChatInjected {
  /** Prime the canvas's chat context (and send when there is a text to send). */
  askAgent: (sessionId: SessionId, request: BoardAskAgentRequest) => Promise<RemoteResult<BoardAskAgentOutcome>>
  /** Whether a sideChat-shaped service answered the host's probe. */
  chatStatus: () => Promise<RemoteResult<BoardChatStatusResult>>
  /**
   * Activate the side-chat tab on one context through the official right-
   * Sidebar navigation (its params mirrored structurally — the package is
   * never imported); degrades to a no-op without a mounted session/sidebar.
   */
  openSideChat: (contextKey: string) => void
}

/**
 * The image seam both seats share (§10.3). Pixels go to the host's attachment
 * store and never into card text; what a card keeps is the pointer, and
 * `images` is the one cache that reads those bytes back for display. It is
 * shared by every seat, so a pointer read for one render is already paid for
 * by the next.
 */
export interface CanvasImageInjected {
  /** Commit one pasted image's bytes; the answer is the pointer to write into the card. */
  attachImage: (request: BoardAttachImageRequest) => Promise<RemoteResult<BoardAttachImageOutcome>>
  /** The pointer cache: `resolve` answers the renderers synchronously, `cardHtml` inlines an HTML card's sources. */
  images: CanvasImageSrcs
}

/**
 * Business face injected into the canvas tab (M3's single seat). The tab is
 * session scope: its mutations name the tab's own session, which resolves
 * the fence mode the host stamps onto the write.
 */
export interface CanvasTabInjected extends CanvasChatInjected, CanvasImageInjected {
  /** List every canvas the deployment holds (archived included). */
  listCanvases: () => Promise<RemoteResult<BoardListResult>>
  /** Create one canvas (a topic, optionally with workspaces attached). */
  createCanvas: (sessionId: SessionId, request: BoardCreateRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Add one user card (createdBy user, straight to kept). */
  putCard: (sessionId: SessionId, request: BoardPutCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Edit one card: text, its drawing, a status transition, or a question state. */
  patchCard: (sessionId: SessionId, request: BoardPatchCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Comment on one card. */
  addComment: (sessionId: SessionId, request: BoardAddCommentRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Archive a canvas from the switcher, or restore it (the reversible half). */
  archiveCanvas: (sessionId: SessionId, request: BoardArchiveRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Delete one canvas for good; a landed delete also drops its strip rows. */
  deleteCanvas: (sessionId: SessionId, request: BoardDeleteCanvasRequest) => Promise<RemoteResult<BoardDeleteCanvasResult>>
  /** Delete one card for good (and its lines); a landed delete drops its strip row. */
  deleteCard: (sessionId: SessionId, request: BoardDeleteCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /**
   * Write this canvas's category catalog (stage ⑤): the whole desired list, in
   * strip order. `archiveCardIds` rides the same write so retiring a category
   * that still holds cards cannot leave a retired chip over live cards.
   */
  setCategories: (sessionId: SessionId, request: BoardSetCategoriesRequest) => Promise<RemoteResult<BoardMutationResult>>
  /**
   * Write this canvas's layout (stage ⑥): the places, lanes and lines a gesture
   * changed. One verb because dragging a lane moves the cards parked in it, and
   * a follow-up write that lost the version race would leave them behind.
   */
  setLayout: (sessionId: SessionId, request: BoardSetLayoutRequest) => Promise<RemoteResult<BoardMutationResult>>
  /**
   * Open a file attachment in the official document preview
   * (`ctx.sidebarRight.openResource` over a `dsh-resource://file` address);
   * a host without the right Sidebar degrades to a no-op.
   */
  openFile: (sessionId: SessionId, cwd: string | undefined, path: string) => void
  /**
   * Open one card in its own strip row (a board body click): the row id is the
   * card's, so clicking it twice focuses the row already showing it and two
   * cards are two rows of one strip. `heading` is the row's live label.
   */
  openCardDetail: (canvasId: string, cardId: string, heading: string) => void
  /**
   * Open one canvas's draft row (the ＋新卡 menu): one draft row per canvas, so
   * the menu re-categorizes the draft that is already open instead of producing
   * a second blank one.
   */
  openCardDraft: (canvasId: string, kind: CardCategoryId, heading: string) => void
  /** Show a strip row that is already open (the strip's own gesture). */
  activateTab: (id: string) => void
  /**
   * Take a strip row off (the × gesture). The caller gates this: a draft with
   * words in it asks before it is dropped, which is why the verb itself is
   * unconditional.
   */
  closeTab: (id: string) => void
  /** Switch the open canvas (the switcher's gesture). */
  openCanvas: (canvasId: string) => void
  /**
   * Report the canvas this session's tab has open (the main-session tools'
   * target); called on mount and on every switch.
   */
  focusCanvas: (sessionId: SessionId, request: BoardFocusRequest) => Promise<RemoteResult<BoardFocusResult>>
  /**
   * The one-shot layout suggestion, fired once per session when the tab
   * first shows: collapse the session list (M3.1 — the fullscreen suggestion
   * is gone: the host's fullscreen hides the right panel's resize handle, so
   * it can never be the default). The user's own controls own the layout
   * from then on (never re-forced).
   */
  suggestWideMode: (sessionId: SessionId) => void
  hooks: {
    /** The freshness feed (open canvas, board rev), bound by the slot renderer. */
    selection: CanvasSelectionSource
    /**
     * The image cache's read-landed feed, bound as `useImageRev`. The board
     * page subscribes and hands the same feed down to the card body it renders
     * in the active row — one subscription for the surface, not one per view.
     */
    imageRev: CanvasImageRevSource
  }
}

/** Full props of the canvas tab body. */
export type CanvasTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & GlobalStandardProps
  & InjectFace<CanvasTabInjected>
  & PropsLocale<'canvas'>

/**
 * The canvas tab's chip. It gets the strip's own store and nothing else: a
 * dock title is a label, and giving a label the mutating face is how a chip
 * ends up with business logic.
 */
export type CanvasTabTitleProps =
  PropsRuntime<'sidebar.right.pane.tab.title'>
  & GlobalStandardProps
  & InjectFace<{ hooks: { selection: CanvasSelectionSource } }>

/**
 * The injected subset the detail reader consumes: everything the card-detail
 * component touches. A structural subset of the tab face — both seats are
 * handed that one face, and this is what says which members the reader may use.
 */
export interface CanvasDetailInjected extends CanvasChatInjected, CanvasImageInjected {
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Edit one card: text, its drawing, a status transition, or a question state. */
  patchCard: (sessionId: SessionId, request: BoardPatchCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Comment on one card. */
  addComment: (sessionId: SessionId, request: BoardAddCommentRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Delete one card for good (behind the page's own confirmation). */
  deleteCard: (sessionId: SessionId, request: BoardDeleteCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Open a file attachment in the official document preview. */
  openFile: (sessionId: SessionId, cwd: string | undefined, path: string) => void
  hooks: {
    /** The selection/freshness feed, bound by the slot renderer. */
    selection: CanvasSelectionSource
  }
}

/**
 * The new-card draft the detail page carries (v2.2 ②, §11.6): the detail is
 * the ONLY card editor, so ＋新卡 opens that same page in draft form. The
 * content belongs to the STRIP (the page owns it, keyed by the draft row's id)
 * — not to the store, whose stash survives a reload while unsaved words do not
 * — so the page can ask about them when its own × closes the row, and nothing
 * reaches the disk until `onSave`.
 */
export interface CanvasDetailCreate {
  /** The category picked in the ＋新卡 menu (a catalog id, stage ⑤). */
  readonly kind: CardCategoryId
  /** The draft's current text (the owner's, reported by `onTextChange`). */
  readonly text: string
  /** The draft's current drawing (the owner's too, reported by `onDrawChange`). */
  readonly draw: readonly CanvasStroke[]
  /** Reports every keystroke, so the owner's dirty flag can gate the discard confirm. */
  onTextChange: (text: string) => void
  /** Reports a committed stroke list; a draft's ink costs nothing until the save. */
  onDrawChange: (draw: readonly CanvasStroke[]) => void
  /** The first save; resolves true once the card is on the board. */
  onSave: (kind: CardCategoryId, text: string, draw: readonly CanvasStroke[]) => Promise<boolean>
  /**
   * The draft's ONE exit (Esc, the same gesture the back bar fires): the
   * OWNER decides whether to ask first — it holds the draft's content.
   */
  onLeave: () => void
}

/**
 * Full props of the card-detail reader. The reader is told which card to show
 * (`canvasId`/`cardId` come from the active strip row) and only subscribes to
 * the shared store for freshness — the board's selection is not its subject.
 * `sessionId` is optional: with none the reader renders read-only (no edits, no
 * comments, no asks). `create` switches the page from reading a card to
 * drafting a new one.
 */
export type CanvasDetailProps =
  & {
    sessionId: SessionId | undefined
    /** The canvas whose board to read; `null` says nothing was ever opened. */
    readonly canvasId: string | null
    /** The card to show; `null` is the draft (`create`) or the empty notice. */
    readonly cardId: string | null
    readonly create?: CanvasDetailCreate | undefined
    /**
     * The tab's bound image vocabulary (fresh identity whenever a read has
     * landed). Optional: a host without the attachment store renders text
     * cards exactly as before, and a pointer stays inert alt text.
     */
    readonly pathImages?: MarkdownPathImages | undefined
  }
  & GlobalStandardProps
  & InjectFace<CanvasDetailInjected>
  & PropsLocale<'canvas'>
