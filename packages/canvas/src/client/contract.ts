/**
 * Composed props contract for the canvas space's two seats. The board page
 * mounts on the keyed root `main` seat (root scope, no session binding —
 * workspace context arrives through the standard `useWorkspaces` hook and the
 * fence for its mutations rides the currently selected session); the
 * card-detail reader mounts the keyed `sidebar.right.pane.tab` seat (session
 * scope — its mutations ride the tab's own session). Both keep their own
 * React state; the board↔detail selection crosses them through the shared
 * store exposed as `hooks.selection` (the slot runtime binds it into the
 * `useSelection` prop).
 *
 * @module @khorsheed/dsh-canvas/client
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GlobalStandardProps, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-canvas/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (useSessions — the
// workspace root's reactive data source, the same read ui-sidebar-files makes).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ui-workspace's GlobalStandardProps merge (useWorkspaces —
// the registered workspaces feed the space page's attach pickers read).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls ui-layout's SlotMap merge (the root 'main' seat) and its
// GlobalStandardProps merge (usePanelInfo).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.panellist').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  BoardAddCommentRequest, BoardArchiveRequest, BoardAskAgentOutcome, BoardAskAgentRequest,
  BoardChatStatusResult, BoardCreateRequest, BoardImportResult,
  BoardImportV1Request, BoardListResult, BoardMutationResult, BoardPatchCardRequest,
  BoardPutCardRequest, BoardReadOutcome, BoardReadRequest,
  CanvasListRequest, CanvasListResult,
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
 * Business face injected into the canvas space page (v2). The page is root
 * scope — there is no session of its own, so the mutating calls name the
 * CURRENTLY SELECTED session: the host re-roots that session's fence mode at
 * the deployment state dir (the board can never live inside a workspace).
 */
export interface CanvasSpaceInjected extends CanvasChatInjected {
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
  /** Archive a canvas from the space list, or restore it (never a delete). */
  archiveCanvas: (sessionId: SessionId, request: BoardArchiveRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Import one workspace's v1 pad as a new canvas (read-only). */
  importV1: (sessionId: SessionId, request: BoardImportV1Request) => Promise<RemoteResult<BoardImportResult>>
  /** One workspace's v1 pad listing (the import flow's probe and count). */
  probeV1Pad: (request: CanvasListRequest) => Promise<RemoteResult<CanvasListResult>>
  /**
   * Open a file attachment in the official document preview (shared with the
   * detail face; inside the space the right Sidebar never renders, so this is
   * a silent no-op there by construction — RightbarRoot's contract).
   */
  openFile: (sessionId: SessionId, cwd: string | undefined, path: string) => void
  /**
   * Open one card in the in-space detail pane (a board body click): the
   * shared store is written, and the page expands the pane on selection.
   */
  selectCard: (canvasId: string, cardId: string) => void
  hooks: {
    /** The board↔detail selection feed, bound by the slot renderer. */
    selection: CanvasSelectionSource
  }
}

/** Full props of the canvas space page. */
export type CanvasSpacePageProps =
  & GlobalStandardProps
  & InjectFace<CanvasSpaceInjected>
  & PropsLocale<'canvas'>

/**
 * Business face injected into the card-detail reader (the right-Sidebar tab
 * after M1.5). The tab is session scope: its mutations name the tab's own
 * session, which resolves the fence mode the host stamps onto the write.
 */
export interface CanvasDetailInjected extends CanvasChatInjected {
  /** Read one board with the freshness token a later mutation must present. */
  readBoard: (request: BoardReadRequest) => Promise<RemoteResult<BoardReadOutcome>>
  /** Edit one card: text, a status transition, or a question-state transition. */
  patchCard: (sessionId: SessionId, request: BoardPatchCardRequest) => Promise<RemoteResult<BoardMutationResult>>
  /** Comment on one card. */
  addComment: (sessionId: SessionId, request: BoardAddCommentRequest) => Promise<RemoteResult<BoardMutationResult>>
  /**
   * Open a file attachment in the official document preview
   * (`ctx.sidebarRight.openResource` over a `dsh-resource://file` address);
   * a host without the right Sidebar degrades to a no-op.
   */
  openFile: (sessionId: SessionId, cwd: string | undefined, path: string) => void
  hooks: {
    /** The board↔detail selection feed, bound by the slot renderer. */
    selection: CanvasSelectionSource
  }
}

/**
 * Full props of the card-detail reader. `sessionId` is optional: the
 * right-Sidebar seat always supplies one, while the in-space pane (root
 * scope) passes the currently selected session — possibly none, in which
 * case the reader renders read-only (no edits, no comments, no asks).
 */
export type CanvasDetailProps =
  & { sessionId: SessionId | undefined }
  & GlobalStandardProps
  & InjectFace<CanvasDetailInjected>
  & PropsLocale<'canvas'>
