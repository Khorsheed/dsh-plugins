/** Composed props contracts for the file-preview view and link-click drawer. */

import type { FilePreviewList, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-file-preview/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { createFilePreviewStore } from './file-preview-store.ts'

/** The filePreview Remote namespace (list + read), as mounted by this plugin. */
export type FilePreviewRemote = TypertRemoteNamespaceMap['filePreview']

/** Business face injected into the conversation.view file entry. */
export interface FilePreviewViewInjected {
  /** Fetch one session's touched-file list (one RPC). */
  listFiles: (sessionId: SessionId) => Promise<RemoteResult<FilePreviewList>>
  /** Fetch one file's current content (one RPC, host-capped). */
  readFile: (sessionId: SessionId, path: string) => Promise<RemoteResult<FilePreviewRead>>
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
  /** Open one path with the host OS default application (the "Open in IDE" gesture). */
  openExternal: (path: string) => void
  /** Reveal one path in the host file manager, opening its folder and selecting the file (the "Show in folder" gesture; falls back to opening the parent folder when the host cannot select). */
  revealFolder: (path: string) => void
  /** Copy one path's host-resolved absolute spelling to the clipboard; resolves true only when the host accepted the write. */
  copyPath: (path: string) => Promise<boolean>
}

/** Full props of the file view entry (runtime + store + injected + locale shares). */
export type FilePreviewViewProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createFilePreviewStore>>
  & InjectFace<FilePreviewViewInjected>
  & PropsLocale<'filePreview'>

/** Business face injected into the root overlay link-click drawer entry. */
export interface FilePreviewDrawerInjected {
  /** Fetch one session's touched-file list (one RPC; supplies the diff). */
  listFiles: (sessionId: SessionId) => Promise<RemoteResult<FilePreviewList>>
  /** Fetch one file's current content (one RPC, host-capped). */
  readFile: (sessionId: SessionId, path: string) => Promise<RemoteResult<FilePreviewRead>>
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
  /** Open one path with the host OS default application (the "Open in IDE" gesture). */
  openExternal: (path: string) => void
  /** Reveal one path in the host file manager, opening its folder and selecting the file (the "Show in folder" gesture; falls back to opening the parent folder when the host cannot select). */
  revealFolder: (path: string) => void
  /** Copy one path's host-resolved absolute spelling to the clipboard; resolves true only when the host accepted the write. */
  copyPath: (path: string) => Promise<boolean>
}

/** Full props of the link-click drawer entry (runtime + store + injected + locale shares). */
export type FilePreviewDrawerProps =
  & PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createFilePreviewStore>>
  & InjectFace<FilePreviewDrawerInjected>
  & PropsLocale<'filePreview'>
