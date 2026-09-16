/**
 * Composed props contract for the canvas view. The view mounts on one seat —
 * the keyed `sidebar.right.pane.tab` — and its props are spelled structurally
 * (the session id plus the `GlobalStandardProps` seat that brings
 * `useSessions`) rather than riding `PropsRuntime`, so no seat owner share
 * leaks into the contract.
 *
 * The view keeps its own React state rather than a slot store: everything it
 * shows is either derived from the host (the pad listing, the item body) or
 * re-derivable on mount, and the editor's unsaved buffer is auto-saved anyway.
 *
 * The canvas SPACE page (v2) mounts the same way on the keyed root `main`
 * seat: root scope, no session binding — workspace context arrives through
 * the standard `useWorkspaces` hook and the fence for its mutations rides
 * the currently selected session (`useSessions`).
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
  BoardAddCommentRequest, BoardArchiveRequest, BoardCreateRequest, BoardImportResult,
  BoardImportV1Request, BoardListResult, BoardMutationResult, BoardPatchCardRequest,
  BoardPutCardRequest, BoardReadOutcome, BoardReadRequest,
  CanvasArchiveRequest, CanvasArchiveResult, CanvasCreateRequest,
  CanvasListRequest, CanvasListResult, CanvasReadOutcome, CanvasReadRequest,
  CanvasWriteRequest, CanvasWriteResult,
} from '../types.ts'
import type {} from './locales.ts'

/** The canvas Remote namespace, as mounted by this plugin. */
export type CanvasRemote = TypertRemoteNamespaceMap['canvas']

/**
 * Business face injected into the canvas view. The mutating calls name their
 * session first because the host resolves that session's file policy and
 * workspace boundary onto the write; the reads need neither.
 */
export interface CanvasViewInjected {
  /** List one workspace's pad (active items + archive set). */
  list: (request: CanvasListRequest) => Promise<RemoteResult<CanvasListResult>>
  /** Read one item's text with the freshness token a later write must present. */
  read: (request: CanvasReadRequest) => Promise<RemoteResult<CanvasReadOutcome>>
  /** Create one item; an existing title is refused rather than overwritten. */
  create: (sessionId: SessionId, request: CanvasCreateRequest) => Promise<RemoteResult<CanvasWriteResult>>
  /** Overwrite one item under the version guard from the last read. */
  write: (sessionId: SessionId, request: CanvasWriteRequest) => Promise<RemoteResult<CanvasWriteResult>>
  /** Hide one item from the list, or restore it — the file is never touched. */
  setArchived: (sessionId: SessionId, request: CanvasArchiveRequest) => Promise<RemoteResult<CanvasArchiveResult>>
}

/** Full props of the canvas view. */
export type CanvasViewProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & InjectFace<CanvasViewInjected>
  & PropsLocale<'canvas'>

/**
 * Business face injected into the canvas space page (v2). The page is root
 * scope — there is no session of its own, so the mutating calls name the
 * CURRENTLY SELECTED session: the host re-roots that session's fence mode at
 * the deployment state dir (the board can never live inside a workspace).
 */
export interface CanvasSpaceInjected {
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
}

/** Full props of the canvas space page. */
export type CanvasSpacePageProps =
  & GlobalStandardProps
  & InjectFace<CanvasSpaceInjected>
  & PropsLocale<'canvas'>
