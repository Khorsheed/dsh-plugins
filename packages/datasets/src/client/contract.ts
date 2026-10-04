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
  DatasetOverview, ImportBindingsResult, ItemBrief, ListDatasetsResult, ListItemsResult, OrganizingSetup,
  Proposal, ProposalReview, ReadPassthroughRequest, ReadQuery, ReadResult, RegisterInput, RegisterPreview,
  RegistryEntry, RegistryRow, ReviewFiles, ReviewHead, ReviewItem, UpdateInput, ValidateResult,
} from '../types.ts'
import type { OrganizeOutcome } from './organize.ts'
import type { createDatasetsViewStore } from './store.ts'

/**
 * Host facts the view reads, probed per host line by the browser half: rc
 * hosts expose the full description (`home`, `canOpenPath`); 0.1.2's opening
 * frame carries `home` only (`canOpenPath` became the
 * `session.canOpenWorkspacePath` RPC probe, which the browser half asks and
 * folds in; until it answers, the native-picker buttons stay hidden).
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

/** The datasets Remote namespace (registry verbs + per-registration reads), as mounted by this plugin. */
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
  /** The experiment behind the row (several runs may share one); null on a legacy run. */
  experimentId: string | null
  /** The registration id the snapshot names; null on an old run that recorded only a path. */
  registry: string | null
  /** The pinned commit — one «版本» in the 用在哪些实验 count; null when never recorded. */
  commit: string | null
}

/**
 * Business face injected into the conversation.view datasets entry.
 *
 * Registry verbs are the human's (register / edit / remove / import); every
 * read and write after them names ONE registration by its id (`repo`) — the
 * tab is a view of the deployment's registry, not of a session binding.
 */
export interface DatasetsViewInjected {
  /** Every registration with its tracked branch's tip and sets (one RPC). */
  fetchRegistry: (sessionId: SessionId) => Promise<RemoteResult<RegistryRow[]>>
  /** The register form's live verdict for one candidate path (one RPC). */
  previewRepo: (sessionId: SessionId, path: string, trackedRef?: string) => Promise<RemoteResult<RegisterPreview>>
  /** Register a repository (the form's confirm). */
  register: (sessionId: SessionId, input: RegisterInput) => Promise<RemoteResult<RegistryEntry>>
  /** Edit a registration (tracked branch, per-set layers, authoring checkout). */
  updateRegistration: (sessionId: SessionId, input: UpdateInput) => Promise<RemoteResult<RegistryEntry>>
  /** Remove a registration (the repository itself is untouched). */
  unregister: (sessionId: SessionId, id: string) => Promise<RemoteResult<boolean>>
  /** «从旧绑定登记»: fold the legacy session bindings into registrations. */
  importBindings: (sessionId: SessionId) => Promise<RemoteResult<ImportBindingsResult>>
  /** List one registration's datasets, or one dataset's items (one RPC). */
  listDatasets: (sessionId: SessionId, repo: string, dataset?: string) => Promise<RemoteResult<ListDatasetsResult | ListItemsResult>>
  /** Read one file of one item layer, from the git object (one RPC). */
  readFile: (sessionId: SessionId, repo: string, query: ReadQuery) => Promise<RemoteResult<ReadResult>>
  /** Read one dataset-relative passthrough-zone file (operator channel, one RPC). */
  readPassthroughFile: (sessionId: SessionId, repo: string, query: ReadPassthroughRequest) => Promise<RemoteResult<ReadResult>>
  /** One registration's rows at its tracked branch, in one RPC. */
  overview: (sessionId: SessionId, repo: string) => Promise<RemoteResult<DatasetOverview>>
  /** One item's «选手将看到» and «可判性» (one RPC). */
  itemBrief: (sessionId: SessionId, repo: string, dataset: string, item: string) => Promise<RemoteResult<ItemBrief>>
  /** Validate one dataset (the detail page's button). */
  validateDataset: (sessionId: SessionId, repo: string, dataset: string) => Promise<RemoteResult<ValidateResult>>
  // ── T90: the organizing hand-off and the registration review ──────────
  /** The 题集整理 preset and the datasets home (decision C). */
  organizingSetup: (sessionId: SessionId) => Promise<RemoteResult<OrganizingSetup>>
  /** Proposals waiting for a person (the 「等你确认登记」 banner). */
  proposals: (sessionId: SessionId) => Promise<RemoteResult<Proposal[]>>
  /** One proposal's review. */
  proposalReview: (sessionId: SessionId, id: string) => Promise<RemoteResult<ProposalReview>>
  /** T96 · the review's first screen (head + four fact cards); optional so older doubles still type. */
  proposalHead?: (sessionId: SessionId, id: string) => Promise<RemoteResult<ReviewHead>>
  /** 「逐条对照」: one item beside its source record. */
  reviewItem: (sessionId: SessionId, id: string, set: string, item: string) => Promise<RemoteResult<ReviewItem>>
  /** 「完整清单」. */
  reviewFiles: (sessionId: SessionId, id: string) => Promise<RemoteResult<ReviewFiles>>
  /** 「确认登记」 from a proposal — the only proposal → registry path (decision A). */
  confirmProposal: (
    sessionId: SessionId, id: string, registryId: string, sets: Record<string, { layers: string[] }>,
  ) => Promise<RemoteResult<RegistryEntry>>
  /** 「退回给 Agent」: mark it returned (the proposal names its organizing session). */
  returnProposal: (sessionId: SessionId, id: string, note: string) => Promise<RemoteResult<Proposal>>
  /** A registration's version held by the update gate, or nothing when none waits. */
  pendingReview: (sessionId: SessionId, repo: string) => Promise<RemoteResult<ProposalReview | undefined | null>>
  /** Confirm a held version. */
  confirmPending: (
    sessionId: SessionId, repo: string, commit: string, sets: Record<string, { layers: string[] }>,
  ) => Promise<RemoteResult<RegistryEntry>>
  /**
   * Open a NEW 「题集整理」 session (in the current session's workspace, on
   * the organizing preset when this host lists it, titled `title`) and write
   * `text` into its chat box without sending; the clipboard when there is no
   * chat box to write into.
   */
  startOrganizing: (sessionId: SessionId, title: string, text: string, preset: string) => Promise<OrganizeOutcome>
  /** Open an existing session and write `text` into its chat box (the same degrade chain). */
  draftInSession: (target: string, text: string) => Promise<OrganizeOutcome>
  /**
   * The «作答记录» projection, or null when this instance carries no eval
   * plugin — the section hides rather than showing an empty promise. Probed at
   * CALL time, not at mount: the two plugins mount their Remotes independently
   * and neither may assume it loaded second.
   */
  itemRuns: (sessionId: SessionId, dataset: string, item: string) => Promise<ItemRunsView | null>
  /** The «用于的实验» projection, or null when no eval plugin is mounted. */
  datasetExperiments: (sessionId: SessionId) => Promise<DatasetExperimentRow[] | null>
  /**
   * T96 · requests the 「核对并登记」 card on the propose tool row leaves for
   * this tab: take (and clear) one for this session, be told when one lands.
   * Optional: a double without it simply never opens a review on its own.
   */
  reviewFocus?: {
    take: (sessionId: SessionId) => string | null
    subscribe: (listener: () => void) => () => void
  }
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
