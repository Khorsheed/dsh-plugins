/** Composed props contracts for the file-preview right-Sidebar tab and the turn card. */

import type { FilePreviewList, FilePreviewTurnFile } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-file-preview/remote'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.turnTail').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls ui-session's SessionStandardProps merge (sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ctx.sidebarRight/ctx.sidebarRightTabs service merges, the
// right-Sidebar SlotMap seats ('sidebar.right.pane.tab'), and the tab types.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { createFilePreviewStore } from './file-preview-store.ts'

/** The filePreview Remote namespace (list + read + turnFiles), as mounted by this plugin. */
export type FilePreviewRemote = TypertRemoteNamespaceMap['filePreview']

/** Business face injected into the right-Sidebar tab body. */
export interface FilePreviewTabInjected {
  /** Fetch one session's touched-file list (one RPC; supplies the diff history). */
  listFiles: (sessionId: SessionId) => Promise<RemoteResult<FilePreviewList>>
}

/** Full props of the tab body entry (runtime + store + injected + locale shares). */
export type FilePreviewTabProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createFilePreviewStore>>
  & InjectFace<FilePreviewTabInjected>
  & PropsLocale<'filePreview'>

/** Business face injected into the conversation.chat.turnTail mutation card. */
export interface FilePreviewTurnRowInjected {
  /** Resolve one session's files for one turn through the session-level cache. */
  turnFiles: (sessionId: SessionId, turn: number) => Promise<readonly FilePreviewTurnFile[]>
  /**
   * Open the file-preview page tab with one path selected — the click target
   * for outside-workspace paths, which no `dsh-resource://file/...` address can
   * name (in-workspace paths go through the owner's `openFile` instead).
   */
  openOutsideWorkspace: (sessionId: SessionId, path: string) => void
}

/** Full props of the turn mutation card (owner + injected + locale shares). */
export type FilePreviewTurnRowProps =
  & PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<FilePreviewTurnRowInjected>
  & PropsLocale<'filePreview'>
