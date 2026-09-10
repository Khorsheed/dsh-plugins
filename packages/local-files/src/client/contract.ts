/**
 * Composed props contract for the local-files workspace view tab.
 *
 * @module @khorsheed/dsh-local-files/client
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-local-files/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalFilesRead,
  ReadLocalFileRequest,
} from '../types.ts'
import type { createLocalFilesStore } from './store-local.ts'

/** The localFiles Remote namespace (list + readFile), as mounted by this plugin. */
export type LocalFilesRemote = TypertRemoteNamespaceMap['localFiles']

/** Business face injected into the conversation.view workspace entry. */
export interface WorkspaceViewInjected {
  /** List one local directory (git-agnostic browser plane). */
  listDirectory: (request: ListLocalDirectoryRequest) => Promise<RemoteResult<ListLocalDirectoryResult>>
  /** Read one local file for preview (git-agnostic kind-union content plane). */
  readFile: (request: ReadLocalFileRequest) => Promise<RemoteResult<LocalFilesRead>>
  /** Open the host's native directory picker; resolves the chosen path, or null when cancelled. */
  pickWorkspace: () => Promise<string | null>
  /** The session's workspace cwd (its creation `cwd`), or undefined when unknown. */
  sessionCwd: (sessionId: SessionId) => string | undefined
  hooks: {
    /** open-in-app catalog ids the host probed as installed (null until answered). */
    openInApps: ObservableSnapshot<readonly string[] | null>
  }
  /** Open a directory in the host's file manager (no-op when none resolved). */
  openFolder: (path: string) => void
  /** Open a directory in the host's editor/IDE (no-op when none resolved). */
  openIDE: (path: string) => void
}

/** Full props of the workspace view entry. */
export type WorkspaceViewProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createLocalFilesStore>>
  & InjectFace<WorkspaceViewInjected>
  & PropsLocale<'localFiles'>
