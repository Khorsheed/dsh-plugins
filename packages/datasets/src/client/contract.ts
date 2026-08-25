/** Composed props contract for the datasets session tab. */

import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + the datasets namespace).
import type {} from '@khorsheed/dsh-datasets/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  DatasetBinding, ListDatasetsResult, ListItemsResult, PreviewRepoResult, ReadPassthroughRequest,
  ReadQuery, ReadResult,
} from '../types.ts'
import type { createDatasetsViewStore } from './store.ts'

/** The datasets Remote namespace (binding/bind/unbind/list/show/read), as mounted by this plugin. */
export type DatasetsRemote = TypertRemoteNamespaceMap['datasets']

/** Business face injected into the conversation.view datasets entry. */
export interface DatasetsViewInjected {
  /** Fetch the session's current binding (one RPC; null = unbound). */
  fetchBinding: (sessionId: SessionId) => Promise<RemoteResult<DatasetBinding | null>>
  /** Record a binding for the session (the bind form's submit). */
  bindSession: (sessionId: SessionId, binding: DatasetBinding) => Promise<RemoteResult<DatasetBinding>>
  /** Clear the session's binding. */
  unbindSession: (sessionId: SessionId) => Promise<RemoteResult<DatasetBinding | null>>
  /** Preview a candidate repository before binding (one RPC; NOT whitelist-filtered). */
  previewRepo: (sessionId: SessionId, path: string) => Promise<RemoteResult<PreviewRepoResult>>
  /** List the bound scope's datasets, or one dataset's items (one RPC). */
  listDatasets: (sessionId: SessionId, dataset?: string) => Promise<RemoteResult<ListDatasetsResult | ListItemsResult>>
  /** Read one file of one item layer, from the git object (one RPC). */
  readFile: (sessionId: SessionId, query: ReadQuery) => Promise<RemoteResult<ReadResult>>
  /** Read one dataset-relative passthrough-zone file (operator channel, one RPC). */
  readPassthroughFile: (sessionId: SessionId, query: ReadPassthroughRequest) => Promise<RemoteResult<ReadResult>>
  /** Whether the browser itself is connected over loopback (native gestures gate). */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
  /** Open the host's native directory chooser (the same wire call the official
   * directory-picker flow drives); resolves null when the operator cancels. */
  pickDirectory: () => Promise<string | null>
}

/** Full props of the datasets view entry (runtime + store + injected + locale shares). */
export type DatasetsViewProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createDatasetsViewStore>>
  & InjectFace<DatasetsViewInjected>
  & PropsLocale<'datasets'>
