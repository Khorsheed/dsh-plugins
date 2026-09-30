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
  BoardAddCommentRequest, BoardArchiveRequest,
  BoardAttachImageOutcome, BoardAttachImageRequest, BoardCreateRequest,
  BoardDeleteCanvasRequest, BoardDeleteCanvasResult, BoardDeleteCardRequest,
  BoardFocusRequest, BoardFocusResult,
  BoardListResult, BoardMutationResult,
  BoardPatchCardRequest, BoardPutCardRequest,
  BoardDecideTypeRequest, BoardReadOutcome, BoardReadRequest, BoardSetCategoriesRequest, BoardSetLayoutRequest,
  BoardSetTypeBriefRequest,
  CardCategoryId,
  CanvasStroke,
  ManuscriptDeleteRequest, ManuscriptExportRequest, ManuscriptExportResult,
  ManuscriptPatchRequest, ManuscriptReadOutcome, ManuscriptReadRequest,
  ManuscriptWriteRequest, ManuscriptWriteResult,
} from '../types.ts'
import type {} from './locales.ts'
import type { CanvasImageRevSource, CanvasImageSrcs } from './images.ts'
import type { CanvasSelectionSource } from './space/selection.ts'

/** The canvas Remote namespace, as mounted by this plugin. */
export type CanvasRemote = TypertRemoteNamespaceMap['canvas']

/**
 * The conversation face both seats share (2026-09-27 review): the canvas talks
 * to the Agent through the session's OWN conversation, not a side chat. A
 * gesture quotes the cards into the main input and leaves the sending to the
 * user; the main session's canvas tools then land what the Agent makes on the
 * focused canvas.
 */
export interface CanvasTalkInjected {
  /** Whether the session has a conversation input to quote into (every talk entry hides without one). */
  talkAvailable: (sessionId: SessionId) => boolean
  /**
   * Append a block to the session's conversation draft (read-merge-write: the
   * input's `setDraft` replaces the whole draft) and hand it the keyboard.
   * @returns false when the session has no conversation input.
   */
  quoteToConversation: (sessionId: SessionId, block: string) => boolean
  /**
   * Nudge every board reader to re-read. The main session's Agent writes the
   * board through its own tools, which this surface never sees, so the visible
   * tab calls this on a slow beat and the readers skip a board whose version
   * did not move.
   */
  refreshBoards: () => void
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
 * The manuscript face (成稿, the 2026-09-27 decision). A manuscript is an
 * entity beside the cards: its body is read and written on its own, every
 * rewrite presents the version it started from, and it opens in the canvas's
 * own strip row like a card does.
 */
export interface CanvasManuscriptInjected {
  /** Read one manuscript: metadata and body. */
  readManuscript: (request: ManuscriptReadRequest) => Promise<RemoteResult<ManuscriptReadOutcome>>
  /** Create one (no id), or rewrite one from `baseVersion` — a lost race answers `stale`. */
  writeManuscript: (sessionId: SessionId, request: ManuscriptWriteRequest) => Promise<RemoteResult<ManuscriptWriteResult>>
  /** Rename one, or move it between writing and final. */
  patchManuscript: (sessionId: SessionId, request: ManuscriptPatchRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Delete one for good; a landed delete sends its strip row back to the board. */
  deleteManuscript: (sessionId: SessionId, request: ManuscriptDeleteRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Save one into an attached workspace as markdown (「保存到工作区」). */
  exportManuscript: (sessionId: SessionId, request: ManuscriptExportRequest) => Promise<RemoteResult<ManuscriptExportResult>>
  /** Open one manuscript inside its canvas's strip row. */
  openManuscript: (canvasId: string, manuscriptId: string, heading: string) => void
}

/**
 * The card-type face (P1a): a category's type page — the user's brief, the
 * adopted definition, the Agent's pending proposal — and the one answer to it.
 * Designing is the Agent's job: the page only quotes the brief into the
 * conversation, and the Agent drafts through `canvas_propose_type`.
 */
export interface CanvasTypeInjected {
  /** Write one type's brief (markdown and drawings, whole). */
  setTypeBrief: (sessionId: SessionId, request: BoardSetTypeBriefRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Adopt or reject the pending proposal. */
  decideType: (sessionId: SessionId, request: BoardDecideTypeRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Open one category's type page inside its canvas's strip row. */
  openTypePage: (canvasId: string, kind: CardCategoryId, heading: string) => void
  /**
   * Switch to the conversation a revision was proposed in (the revision
   * log's 「对话 ↗」). Session-level only: the host cannot scroll to a
   * message. A no-op where the composition has no ui-workspace.
   */
  openSession: (sessionId: SessionId) => void
}

/**
 * Business face injected into the canvas tab (M3's single seat). The tab is
 * session scope: its mutations name the tab's own session, which resolves
 * the fence mode the host stamps onto the write.
 */
export interface CanvasTabInjected extends CanvasTalkInjected, CanvasImageInjected, CanvasManuscriptInjected, CanvasTypeInjected {
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
   * Open one card inside its canvas's strip row (a board body click, or the
   * detail's ‹ › step): the row is the canvas's, so a card never adds a row.
   * `heading` is the breadcrumb's live label.
   */
  openCardDetail: (canvasId: string, cardId: string, heading: string) => void
  /**
   * Open one canvas's draft (the ＋新卡 menu): one draft per canvas, so the
   * menu re-categorizes the draft that is already open instead of producing a
   * second blank one.
   */
  openCardDraft: (canvasId: string, kind: CardCategoryId, heading: string) => void
  /** Show a strip row that is already open (the strip's own gesture). */
  activateTab: (id: string) => void
  /**
   * Take a canvas row off the strip (the × gesture). The caller gates this: a
   * row standing on a draft with words in it asks before it is dropped, which
   * is why the verb itself is unconditional.
   */
  closeTab: (id: string) => void
  /**
   * Switch the open canvas (the switcher's gesture). A canvas already on the
   * strip comes back where it was left — its board, or the card it stood on.
   */
  openCanvas: (canvasId: string) => void
  /** Go from a card or the draft back to its canvas's board (the breadcrumb). */
  backToBoard: (canvasId: string) => void
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
export interface CanvasDetailInjected extends CanvasTalkInjected, CanvasImageInjected {
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Edit one card: text, its drawing, a status transition, or a question state. */
  patchCard: (sessionId: SessionId, request: BoardPatchCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Comment on one card. */
  addComment: (sessionId: SessionId, request: BoardAddCommentRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Delete one card for good (behind the page's own confirmation). */
  deleteCard: (sessionId: SessionId, request: BoardDeleteCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** 「转为成稿」: start a manuscript from a document card. */
  writeManuscript: CanvasManuscriptInjected['writeManuscript']
  /** Show the manuscript a card was just turned into. */
  openManuscript: CanvasManuscriptInjected['openManuscript']
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
  /** The draft's current drawings by id (the owner's too, reported by `onDrawingsChange`). */
  readonly drawings: Readonly<Record<string, readonly CanvasStroke[]>>
  /** Reports every keystroke, so the owner's dirty flag can gate the discard confirm. */
  onTextChange: (text: string) => void
  /** Reports the drawings after each committed stroke; a draft's ink costs nothing until the save. */
  onDrawingsChange: (drawings: Readonly<Record<string, readonly CanvasStroke[]>>) => void
  /** The first save; resolves true once the card is on the board. */
  onSave: (
    kind: CardCategoryId, text: string, drawings: Readonly<Record<string, readonly CanvasStroke[]>>,
  ) => Promise<boolean>
  /**
   * The draft's ONE exit (Esc, the same gesture the crumb's ‹ fires): the
   * OWNER decides whether to ask first — it holds the draft's content.
   */
  onLeave: () => void
  /** Re-file the draft from its category tag; omitted, the tag only reads. */
  readonly onKind?: ((kind: CardCategoryId, label: string) => void) | undefined
}

/**
 * The detail's breadcrumb (scheme B): the card page sits INSIDE its canvas's
 * strip row, so the way back is here — the back icon and the canvas's name
 * both return to the board — and so is the ‹n/m› step through the board's
 * order. Omitted, the page draws no crumb row (a composition mounting the
 * reader on its own).
 */
export interface CanvasDetailCrumbs {
  /** The canvas's name, the breadcrumb's first stop. */
  readonly canvasTitle: string
  /** The row's heading: what the crumb says before the card has loaded. */
  readonly heading: string
  /**
   * The board's cards under its current filter, in board order. The stepper
   * walks this list; a card outside it (archived, or filtered away) shows no
   * stepper at all.
   */
  readonly siblings: readonly string[]
  /** Back to the board — the owner asks first when a draft would be lost. */
  readonly onBack: () => void
  /** Show a neighbouring card in this same row. */
  readonly onStep: (cardId: string) => void
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
    readonly crumbs?: CanvasDetailCrumbs | undefined
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

/**
 * The injected subset the manuscript page consumes (成稿): the manuscript verbs,
 * the board read (its metadata, source cards and attached workspaces ride the
 * board), and the doors out — a source card, a saved file, the conversation.
 */
export interface CanvasManuscriptViewInjected extends CanvasTalkInjected, CanvasImageInjected, CanvasManuscriptInjected {
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Open a source card inside the canvas's row. */
  openCardDetail: (canvasId: string, cardId: string, heading: string) => void
  /** Open the file a save wrote, in the official document preview. */
  openFile: (sessionId: SessionId, cwd: string | undefined, path: string) => void
  hooks: {
    /** The freshness feed, bound by the slot renderer. */
    selection: CanvasSelectionSource
  }
}

/**
 * Full props of the manuscript page. Like the card reader it is told what to
 * show by the active strip row, and with no session it reads only.
 */
export type CanvasManuscriptViewProps =
  & {
    sessionId: SessionId | undefined
    readonly canvasId: string
    readonly manuscriptId: string
    /** The crumb row (no stepper: manuscripts are not in the board's order). */
    readonly crumbs: CanvasDetailCrumbs
    readonly pathImages?: MarkdownPathImages | undefined
  }
  & InjectFace<CanvasManuscriptViewInjected>
  & PropsLocale<'canvas'>

/**
 * The injected subset the type page consumes (P1a): the type verbs, the board
 * read (the whole type rides its category row), the image arm for the brief's
 * pasted pictures, and the doors out — a sample card, the conversation.
 */
export interface CanvasTypeViewInjected extends CanvasTalkInjected, CanvasImageInjected, CanvasTypeInjected {
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Open a card of this type inside the canvas's row. */
  openCardDetail: (canvasId: string, cardId: string, heading: string) => void
  hooks: {
    /** The freshness feed, bound by the slot renderer. */
    selection: CanvasSelectionSource
  }
}

/** Full props of the type page: which category, told by the active strip row. */
export type CanvasTypeViewProps =
  & {
    sessionId: SessionId | undefined
    readonly canvasId: string
    readonly kind: CardCategoryId
    /** The crumb row (no stepper: a type page is not in the board's order). */
    readonly crumbs: CanvasDetailCrumbs
    readonly pathImages?: MarkdownPathImages | undefined
  }
  & InjectFace<CanvasTypeViewInjected>
  & PropsLocale<'canvas'>
