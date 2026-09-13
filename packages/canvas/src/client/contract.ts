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
import type {
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
