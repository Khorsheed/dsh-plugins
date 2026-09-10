/**
 * Composed props contract for the local-files file-browser view. The browser
 * mounts on one seat — the keyed `sidebar.right.pane.tab` — and its props are
 * spelled structurally (the session id plus the `GlobalStandardProps` seat
 * that brings `useSessions`) rather than riding `PropsRuntime`, so no seat
 * owner share leaks into the contract. (The retired `conversation.view` seat
 * handed view-switching props the browser never read — that coupling is why
 * the share went structural.)
 *
 * @module @khorsheed/dsh-local-files/client
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  GlobalStandardProps, InjectFace, PropsLocale, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-local-files/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (useSessions — the
// workspace root's reactive data source, the same read ui-sidebar-files makes).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalFilesRead,
  ReadLocalFileRequest,
} from '../types.ts'
import type { createLocalFilesStore } from './store-local.ts'

/** The localFiles Remote namespace (list + readFile), as mounted by this plugin. */
export type LocalFilesRemote = TypertRemoteNamespaceMap['localFiles']

/** Business face injected into the file-browser view (either seat). */
export interface WorkspaceViewInjected {
  /** List one local directory (git-agnostic browser plane). */
  listDirectory: (request: ListLocalDirectoryRequest) => Promise<RemoteResult<ListLocalDirectoryResult>>
  /** Read one local file for preview (git-agnostic kind-union content plane). */
  readFile: (request: ReadLocalFileRequest) => Promise<RemoteResult<LocalFilesRead>>
  /** Open the host's native directory picker; resolves the chosen path, or null when cancelled. */
  pickWorkspace: () => Promise<string | null>
  hooks: {
    /** open-in-app catalog ids the host probed as installed (null until answered). */
    openInApps: ObservableSnapshot<readonly string[] | null>
  }
  /** Open a directory in the host's file manager (no-op when none resolved). */
  openFolder: (path: string) => void
  /** Open a directory in the host's editor/IDE (no-op when none resolved). */
  openIDE: (path: string) => void
}

/** Full props of the file-browser view. */
export type WorkspaceViewProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createLocalFilesStore>>
  & InjectFace<WorkspaceViewInjected>
  & PropsLocale<'localFiles'>
