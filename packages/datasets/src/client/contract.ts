/** Composed props contract for the datasets session tab. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + the datasets namespace).
import type {} from '@khorsheed/dsh-datasets/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  DatasetBinding, DatasetOverview, ImportItemInput, ItemBrief, ListDatasetsResult, ListItemsResult,
  PreviewRepoResult, ReadPassthroughRequest, ReadQuery, ReadResult, ScaffoldDatasetInput,
  ScaffoldItemInput, SkeletonResult, ValidateResult,
} from '../types.ts'
import type { createDatasetsViewStore } from './store.ts'

/**
 * Host facts the view reads, probed per host line by the browser half: rc
 * hosts expose the full description (`home`, `canOpenPath`); 0.1.2's opening
 * frame carries `home` only (`canOpenPath` became an RPC probe, so the
 * external-open affordances degrade to hidden there).
 */
export interface HostFacts {
  readonly home?: string
  readonly canOpenPath?: boolean
}

/** Observable host-facts source (the slot hook's subscription shape). */
export interface HostDescriptionSource {
  getSnapshot(): HostFacts | undefined
  subscribe(listener: () => void): () => void
}

/** The datasets Remote namespace (binding/bind/unbind/list/show/read), as mounted by this plugin. */
export type DatasetsRemote = TypertRemoteNamespaceMap['datasets']

/**
 * One evaluation run that answered one item, as the «作答记录» area renders it.
 *
 * Structurally mirrored from eval's own `EvalItemRunRow` rather than imported:
 * a plugin never imports a sibling package (the independence check enforces
 * it, and the browser bundle must not grow eval's type program). The eval side
 * owns the shape; this is the slice the tab reads, and a field eval adds
 * simply does not show here.
 */
export interface ItemRunRow {
  runId: string
  /** The plan's file stem, falling back to the run id. */
  name: string
  startedAt: number | null
  commit: string | null
  cells: Array<{
    missionId: string
    condition: string | null
    rep: number | null
    state: string
    bucket: string
    /** ns → how many verdicts that namespace carries for this cell. */
    verdicts: Record<string, number>
  }>
}

/** The «作答记录» answer: the runs, plus eval's own honest degrades. */
export interface ItemRunsView {
  runs: ItemRunRow[]
  /** One sentence each, from eval — shown verbatim rather than summarized. */
  notes: string[]
}

/** One experiment that uses a dataset — the list page's «用于的实验» cell. */
export interface DatasetExperimentRow {
  id: string
  name: string
  status: string
  /** The dataset set this experiment's snapshot names; null when it names none. */
  datasetId: string | null
}

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
  /** The list page in one RPC: repo, commit, and one row per dataset. */
  overview: (sessionId: SessionId) => Promise<RemoteResult<DatasetOverview>>
  /** One item's «选手将看到» and «可判性» (one RPC). */
  itemBrief: (sessionId: SessionId, dataset: string, item: string) => Promise<RemoteResult<ItemBrief>>
  /** Validate one dataset (the detail page's button). */
  validateDataset: (sessionId: SessionId, dataset: string) => Promise<RemoteResult<ValidateResult>>
  /** «新建题集»: write a dataset skeleton into the working tree. */
  scaffoldDataset: (sessionId: SessionId, input: ScaffoldDatasetInput) => Promise<RemoteResult<SkeletonResult>>
  /** «题目骨架»: write one item's placeholders into the working tree. */
  scaffoldItem: (sessionId: SessionId, input: ScaffoldItemInput) => Promise<RemoteResult<SkeletonResult>>
  /** «导入题目»: copy an existing item directory in verbatim. */
  importItem: (sessionId: SessionId, input: ImportItemInput) => Promise<RemoteResult<SkeletonResult>>
  /**
   * The «作答记录» projection, or null when this instance carries no eval
   * plugin — the section hides rather than showing an empty promise. Probed at
   * CALL time, not at mount: the two plugins mount their Remotes independently
   * and neither may assume it loaded second.
   */
  itemRuns: (sessionId: SessionId, dataset: string, item: string) => Promise<ItemRunsView | null>
  /** The «用于的实验» projection, or null when no eval plugin is mounted. */
  datasetExperiments: (sessionId: SessionId) => Promise<DatasetExperimentRow[] | null>
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
