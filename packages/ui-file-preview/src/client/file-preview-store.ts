/**
 * The drawer's transient store: open state, the selected path, and the
 * fetched list/preview results. Module level exports the factory only — a
 * module-level handle would pin the store's identity in the module cache (a
 * de-facto singleton surviving plugin reloads). register() receives the
 * factory (exclusive use: the framework instantiates per entry), the drawer
 * derives its PropsStore share from the return type, and the panel controller
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { FilePreviewEntry, FilePreviewList, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'

/** The view's state; fetched results are whole values, null until loaded. */
export interface FilePreviewState {
  /** Whether the file view is open (the tab is always mounted while active). */
  open: boolean
  /** Whether the drawer survives a session switch. Off by default — switching
   * sessions closes the drawer; the pin button opts into staying put. */
  pinned: boolean
  /** The selected file's display path, or null when nothing is selected. */
  selectedPath: string | null
  /** The latest fetched file list, or null before the first successful load. */
  list: readonly FilePreviewEntry[] | null
  /** Seq watermark of the loaded list (drives the refresh badge). */
  listAsOfSeq: number
  /** Bumped by the refresh action to re-trigger the list fetch. */
  listRequestRev: number
  /** Whether a list fetch is in flight. */
  listLoading: boolean
  /** Human-readable list-fetch failure, or null when idle. */
  listError: string | null
  /** The latest fetched preview, or null before one completes. */
  preview: FilePreviewRead | null
  /** Whether a preview read is in flight. */
  previewLoading: boolean
  /** Human-readable preview-fetch failure, or null when idle. */
  previewError: string | null
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type FilePreviewActions = {
  open: (draft: FilePreviewState) => void
  close: (draft: FilePreviewState) => void
  toggle: (draft: FilePreviewState) => void
  setPinned: (draft: FilePreviewState, pinned: boolean) => void
  select: (draft: FilePreviewState, path: string) => void
  openPath: (draft: FilePreviewState, path: string) => void
  refreshList: (draft: FilePreviewState) => void
  setList: (draft: FilePreviewState, list: FilePreviewList) => void
  setListLoading: (draft: FilePreviewState, loading: boolean) => void
  setListError: (draft: FilePreviewState, error: string | null) => void
  setPreview: (draft: FilePreviewState, read: FilePreviewRead) => void
  setPreviewLoading: (draft: FilePreviewState, loading: boolean) => void
  setPreviewError: (draft: FilePreviewState, error: string | null) => void
}

const INITIAL: FilePreviewState = {
  open: false,
  pinned: false,
  selectedPath: null,
  list: null,
  listAsOfSeq: -1,
  listRequestRev: 0,
  listLoading: false,
  listError: null,
  preview: null,
  previewLoading: false,
  previewError: null,
}

/**
 * Create the file-preview view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFilePreviewStore(): EngineStoreHandle<FilePreviewState, FilePreviewActions> {
  return defineStore({
    init: (): FilePreviewState => ({ ...INITIAL }),
    actions: {
      open: (d) => { d.open = true },
      close: (d) => { d.open = false },
      toggle: (d) => { d.open = !d.open },
      setPinned: (d, pinned: boolean) => { d.pinned = pinned },
      select: (d, path: string) => {
        d.selectedPath = path
        d.preview = null
        d.previewError = null
      },
      openPath: (d, path: string) => {
        d.open = true
        d.selectedPath = path
        d.preview = null
        d.previewError = null
      },
      refreshList: (d) => { d.listRequestRev += 1 },
      setList: (d, list: FilePreviewList) => {
        d.list = list.entries
        d.listAsOfSeq = list.asOfSeq
        d.listError = null
      },
      setListLoading: (d, loading: boolean) => { d.listLoading = loading },
      setListError: (d, error: string | null) => { d.listError = error },
      setPreview: (d, read: FilePreviewRead) => {
        d.preview = read
        d.previewError = null
      },
      setPreviewLoading: (d, loading: boolean) => { d.previewLoading = loading },
      setPreviewError: (d, error: string | null) => { d.previewError = error },
    },
  })
}
