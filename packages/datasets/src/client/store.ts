/**
 * The datasets tab's transient store: the session binding, the dataset list,
 * the per-dataset item records loaded on expand, and the selected file's
 * preview. Module level exports the factory only — a module-level handle
 * would pin the store's identity in the module cache (a de-facto singleton
 * surviving plugin reloads). register() receives the factory (exclusive use:
 * the framework instantiates per entry) and the view derives its PropsStore
 * share from the return type.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { DatasetBinding, DatasetSummary, ItemRecord, ListItemsResult, ReadResult } from '../types.ts'

/** One selected file: a layer file, or a passthrough-zone file (either readable). */
export type DatasetSelection =
  | {
    readonly kind: 'layer'
    readonly dataset: string
    /** Item id, or null for a DATASET-LEVEL (shared) layer file. */
    readonly item: string | null
    readonly layer: string
    /** Layer-relative file path (as the layer's file list reports it). */
    readonly path: string
  }
  | {
    readonly kind: 'passthrough'
    readonly dataset: string
    /** Item id for item.json, or null for a dataset-level passthrough file. */
    readonly item: string | null
    /** Dataset-relative file path (manifest.yml, docs/x.md, items/<item>/item.json). */
    readonly path: string
  }

/** The view's state; fetched results are whole values, null until loaded. */
export interface DatasetsViewState {
  /** The session's current binding (null = unbound), loaded on mount. */
  binding: DatasetBinding | null
  /** Whether the binding fetch has answered at least once. */
  bindingLoaded: boolean
  /** Human-readable notice from a bind/unbind failure, or null. */
  notice: string | null
  /** The bound scope's dataset summaries, or null before the first load. */
  datasets: readonly DatasetSummary[] | null
  /** Whether the dataset list fetch is in flight. */
  listLoading: boolean
  /** Human-readable list-fetch failure, or null when idle. */
  listError: string | null
  /** Bumped by the refresh action to re-trigger binding + list fetches. */
  refreshRev: number
  /** The expanded dataset id, or null when the tree is collapsed. */
  expandedDataset: string | null
  /** Item records per dataset id, loaded when a dataset expands. */
  items: Record<string, readonly ItemRecord[]>
  /** Dataset-level (shared) layer files per dataset id, loaded with its items. */
  sharedLayers: Record<string, Record<string, readonly string[]>>
  /** The passthrough zone per dataset id (never filtered — shown BECAUSE it is unprotected). */
  passthrough: Record<string, readonly string[]>
  /** The selected file's coordinates, or null when nothing is selected. */
  selection: DatasetSelection | null
  /** The selected file's content, or null before one completes. */
  preview: ReadResult | null
  /** Whether a preview read is in flight. */
  previewLoading: boolean
  /** Human-readable preview-fetch failure, or null when idle. */
  previewError: string | null
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type DatasetsViewActions = {
  setBinding: (draft: DatasetsViewState, binding: DatasetBinding | null) => void
  setNotice: (draft: DatasetsViewState, notice: string | null) => void
  refresh: (draft: DatasetsViewState) => void
  setDatasets: (draft: DatasetsViewState, datasets: readonly DatasetSummary[]) => void
  setListLoading: (draft: DatasetsViewState, loading: boolean) => void
  setListError: (draft: DatasetsViewState, error: string | null) => void
  expand: (draft: DatasetsViewState, dataset: string | null) => void
  setDetails: (draft: DatasetsViewState, dataset: string, detail: ListItemsResult) => void
  select: (draft: DatasetsViewState, selection: DatasetSelection) => void
  setPreview: (draft: DatasetsViewState, preview: ReadResult) => void
  setPreviewLoading: (draft: DatasetsViewState, loading: boolean) => void
  setPreviewError: (draft: DatasetsViewState, error: string | null) => void
}

const INITIAL: DatasetsViewState = {
  binding: null,
  bindingLoaded: false,
  notice: null,
  datasets: null,
  listLoading: false,
  listError: null,
  refreshRev: 0,
  expandedDataset: null,
  items: {},
  sharedLayers: {},
  passthrough: {},
  selection: null,
  preview: null,
  previewLoading: false,
  previewError: null,
}

/**
 * Create the datasets view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createDatasetsViewStore(): EngineStoreHandle<DatasetsViewState, DatasetsViewActions> {
  return defineStore({
    init: (): DatasetsViewState => ({ ...INITIAL }),
    actions: {
      setBinding: (d, binding: DatasetBinding | null) => {
        d.binding = binding
        d.bindingLoaded = true
        // A binding change invalidates everything resolved against the old one.
        d.datasets = null
        d.listError = null
        d.expandedDataset = null
        d.items = {}
        d.sharedLayers = {}
        d.passthrough = {}
        d.selection = null
        d.preview = null
        d.previewError = null
      },
      setNotice: (d, notice: string | null) => { d.notice = notice },
      refresh: (d) => { d.refreshRev += 1 },
      setDatasets: (d, datasets: readonly DatasetSummary[]) => {
        d.datasets = datasets
        d.listError = null
      },
      setListLoading: (d, loading: boolean) => { d.listLoading = loading },
      setListError: (d, error: string | null) => { d.listError = error },
      expand: (d, dataset: string | null) => { d.expandedDataset = dataset },
      setDetails: (d, dataset: string, detail: ListItemsResult) => {
        d.items[dataset] = detail.items
        d.sharedLayers[dataset] = detail.datasetLayers
        d.passthrough[dataset] = detail.passthrough
      },
      select: (d, selection: DatasetSelection) => {
        d.selection = selection
        d.preview = null
        d.previewError = null
      },
      setPreview: (d, preview: ReadResult) => {
        d.preview = preview
        d.previewError = null
      },
      setPreviewLoading: (d, loading: boolean) => { d.previewLoading = loading },
      setPreviewError: (d, error: string | null) => { d.previewError = error },
    },
  })
}
