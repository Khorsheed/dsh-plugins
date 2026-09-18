/**
 * Composed props contract for the canvas tab (M3's single seat): the
 * right-Sidebar tab body in wide mode, drilling between the board, the card
 * detail, and the draft view. The tab is session scope — its mutations fence
 * through the tab's own session — and the open canvas/card/freshness state
 * crosses gestures through the shared store exposed as `hooks.selection`
 * (the slot runtime binds it into the `useSelection` prop).
 *
 * @module @khorsheed/dsh-canvas/client
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
  BoardChatStatusResult, BoardCreateRequest, BoardFocusRequest, BoardFocusResult,
  BoardListResult, BoardMutationResult,
  BoardPatchCardRequest, BoardPutCardRequest, BoardReadDraftOutcome, BoardReadDraftRequest,
  BoardReadOutcome, BoardReadRequest, BoardWriteDraftRequest, BoardWriteDraftResult,
} from '../types.ts'
import type {} from './locales.ts'
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
 * Business face injected into the canvas tab (M3's single seat). The tab is
 * session scope: its mutations name the tab's own session, which resolves
 * the fence mode the host stamps onto the write.
 */
export interface CanvasTabInjected extends CanvasChatInjected {
  /** List every canvas the deployment holds (archived included). */
  listCanvases: () => Promise<RemoteResult<BoardListResult>>
  /** Create one canvas (a topic, optionally with workspaces attached). */
  createCanvas: (sessionId: SessionId, request: BoardCreateRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Add one user card (createdBy user, straight to kept). */
  putCard: (sessionId: SessionId, request: BoardPutCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Edit one card: text, a status transition, or a question-state transition. */
  patchCard: (sessionId: SessionId, request: BoardPatchCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Comment on one card. */
  addComment: (sessionId: SessionId, request: BoardAddCommentRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Archive a canvas from the switcher, or restore it (never a delete). */
  archiveCanvas: (sessionId: SessionId, request: BoardArchiveRequest) => Promise<RemoteResult<BoardMutationResult>>
  /**
   * Open a file attachment in the official document preview
   * (`ctx.sidebarRight.openResource` over a `dsh-resource://file` address);
   * a host without the right Sidebar degrades to a no-op.
   */
  openFile: (sessionId: SessionId, cwd: string | undefined, path: string) => void
  /**
   * Open one card in the detail page (a board body click): the shared store
   * is written and the tab drills in.
   */
  selectCard: (canvasId: string, cardId: string) => void
  /** Switch the open canvas (the switcher's gesture; the drilled card clears). */
  openCanvas: (canvasId: string) => void
  /** Leave the detail page (the drill's back): keeps the open canvas. */
  clearCard: () => void
  /**
   * Report the canvas this session's tab has open (the main-session tools'
   * target); called on mount and on every switch.
   */
  focusCanvas: (sessionId: SessionId, request: BoardFocusRequest) => Promise<RemoteResult<BoardFocusResult>>
  /** Read the canvas's draft (an absent draft reads as empty with a null token). */
  readDraft: (request: BoardReadDraftRequest) => Promise<RemoteResult<BoardReadDraftOutcome>>
  /** Write the canvas's draft (null token creates; else version-guarded). */
  writeDraft: (sessionId: SessionId, request: BoardWriteDraftRequest) => Promise<RemoteResult<BoardWriteDraftResult>>
  /**
   * The one-shot layout suggestion, fired once per session when the tab
   * first shows: collapse the session list (M3.1 — the fullscreen suggestion
   * is gone: the host's fullscreen hides the right panel's resize handle, so
   * it can never be the default). The user's own controls own the layout
   * from then on (never re-forced).
   */
  suggestWideMode: (sessionId: SessionId) => void
  hooks: {
    /** The selection/freshness feed (open canvas, open card, board rev), bound by the slot renderer. */
    selection: CanvasSelectionSource
  }
}

/** Full props of the canvas tab body. */
export type CanvasTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & GlobalStandardProps
  & InjectFace<CanvasTabInjected>
  & PropsLocale<'canvas'>

/**
 * The detail page's injected subset (the drill-in reader): everything the
 * card-detail component consumes. A structural subset of the tab face, so
 * the tab passes its own members down.
 */
export interface CanvasDetailInjected extends CanvasChatInjected {
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Edit one card: text, a status transition, or a question-state transition. */
  patchCard: (sessionId: SessionId, request: BoardPatchCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Comment on one card. */
  addComment: (sessionId: SessionId, request: BoardAddCommentRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Open a file attachment in the official document preview. */
  openFile: (sessionId: SessionId, cwd: string | undefined, path: string) => void
  hooks: {
    /** The selection/freshness feed, bound by the slot renderer. */
    selection: CanvasSelectionSource
  }
}

/**
 * Full props of the card-detail reader. `sessionId` is optional: with none
 * the reader renders read-only (no edits, no comments, no asks).
 */
export type CanvasDetailProps =
  & { sessionId: SessionId | undefined }
  & GlobalStandardProps
  & InjectFace<CanvasDetailInjected>
  & PropsLocale<'canvas'>
