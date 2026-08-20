/**
 * The missions tab's transient store: the five-bucket queue payload, the
 * bucket chips and run-scope filter, and the selected row's detail. Module
 * level exports the factory only — a module-level handle would pin the
 * store's identity in the module cache (a de-facto singleton surviving
 * plugin reloads).
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { MissionDetail, MissionQueueResult } from '../types.ts'
import type { Bucket } from '../types.ts'

/** The run scope: the caller's session (default), every run, or one named run. */
export type RunScope = 'session' | 'all' | string

/** The selected table row (run + mission). */
export interface MissionSelection {
  readonly runId: string
  readonly missionId: string
}

/** The view's state; fetched results are whole values, null until loaded. */
export interface MissionsViewState {
  /** The active bucket chips (empty = all five). */
  buckets: readonly Bucket[]
  /** The run scope filter. */
  scope: RunScope
  /** The queue payload, or null before the first load. */
  queue: MissionQueueResult | null
  /** Whether a queue fetch is in flight. */
  loading: boolean
  /** Human-readable queue-fetch failure, or null when idle. */
  error: string | null
  /** Bumped by the refresh action to re-trigger the queue fetch. */
  refreshRev: number
  /** The selected row, or null. */
  selection: MissionSelection | null
  /** The selected mission's detail, or null before one completes. */
  detail: MissionDetail | null
  /** Whether a detail fetch is in flight. */
  detailLoading: boolean
  /** Human-readable detail-fetch failure, or null. */
  detailError: string | null
  /** One-shot notice line (retry/releasable/export outcomes), or null. */
  notice: string | null
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type MissionsViewActions = {
  toggleBucket: (draft: MissionsViewState, bucket: Bucket) => void
  setScope: (draft: MissionsViewState, scope: RunScope) => void
  setQueue: (draft: MissionsViewState, queue: MissionQueueResult) => void
  setLoading: (draft: MissionsViewState, loading: boolean) => void
  setError: (draft: MissionsViewState, error: string | null) => void
  refresh: (draft: MissionsViewState) => void
  select: (draft: MissionsViewState, selection: MissionSelection | null) => void
  setDetail: (draft: MissionsViewState, detail: MissionDetail) => void
  setDetailLoading: (draft: MissionsViewState, loading: boolean) => void
  setDetailError: (draft: MissionsViewState, error: string | null) => void
  setNotice: (draft: MissionsViewState, notice: string | null) => void
}

const INITIAL: MissionsViewState = {
  buckets: [],
  scope: 'session',
  queue: null,
  loading: false,
  error: null,
  refreshRev: 0,
  selection: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  notice: null,
}

/**
 * Create the missions view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createMissionsViewStore(): EngineStoreHandle<MissionsViewState, MissionsViewActions> {
  return defineStore({
    init: (): MissionsViewState => ({ ...INITIAL }),
    actions: {
      toggleBucket: (d, bucket: Bucket) => {
        d.buckets = d.buckets.includes(bucket)
          ? d.buckets.filter(b => b !== bucket)
          : [...d.buckets, bucket]
      },
      setScope: (d, scope: RunScope) => { d.scope = scope },
      setQueue: (d, queue: MissionQueueResult) => {
        d.queue = queue
        d.error = null
      },
      setLoading: (d, loading: boolean) => { d.loading = loading },
      setError: (d, error: string | null) => { d.error = error },
      refresh: (d) => { d.refreshRev += 1 },
      select: (d, selection: MissionSelection | null) => {
        d.selection = selection
        d.detail = null
        d.detailError = null
      },
      setDetail: (d, detail: MissionDetail) => {
        d.detail = detail
        d.detailError = null
      },
      setDetailLoading: (d, loading: boolean) => { d.detailLoading = loading },
      setDetailError: (d, error: string | null) => { d.detailError = error },
      setNotice: (d, notice: string | null) => { d.notice = notice },
    },
  })
}
