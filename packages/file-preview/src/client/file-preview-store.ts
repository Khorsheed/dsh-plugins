/**
 * The file-preview tab's store: the session's touched-file list (one fetch,
 * shared by every tab of this kind in the session) and each tab's selected
 * path. Module level exports the factory only — a module-level handle would
 * pin the store's identity in the module cache (a de-facto singleton
 * surviving plugin reloads). register() receives the factory (exclusive use:
 * the framework mints one instance per session), and the body derives its
 * PropsStore share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { FilePreviewEntry, FilePreviewList } from '../types.ts'

/** The tab body's state; fetched results are whole values, null until loaded. */
export interface FilePreviewState {
  /** The latest fetched file list, or null before the first successful load. */
  list: readonly FilePreviewEntry[] | null
  /** Seq watermark of the loaded list. */
  listAsOfSeq: number
  /** Bumped by the refresh action to re-trigger the list fetch. */
  listRequestRev: number
  /** Whether a list fetch is in flight. */
  listLoading: boolean
  /** Human-readable list-fetch failure, or null when idle. */
  listError: string | null
  /** Each tab's selected path (tabs of this kind in one session select independently). */
  selected: Record<string, string>
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type FilePreviewActions = {
  select: (draft: FilePreviewState, tabId: TabId, path: string) => void
  deselect: (draft: FilePreviewState, tabId: TabId) => void
  refreshList: (draft: FilePreviewState) => void
  setList: (draft: FilePreviewState, list: FilePreviewList) => void
  setListLoading: (draft: FilePreviewState, loading: boolean) => void
  setListError: (draft: FilePreviewState, error: string | null) => void
}

const INITIAL: FilePreviewState = {
  list: null,
  listAsOfSeq: -1,
  listRequestRev: 0,
  listLoading: false,
  listError: null,
  selected: {},
}

/**
 * Create the file-preview tab store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFilePreviewStore(): EngineStoreHandle<FilePreviewState, FilePreviewActions> {
  return defineStore({
    init: (): FilePreviewState => ({ ...INITIAL, selected: {} }),
    actions: {
      /**
       * Select one file in one tab (its change history renders below the list).
       * @param d - draft state.
       * @param tabId - the selecting tab.
       * @param path - the recorded display path.
       */
      select: (d, tabId: TabId, path: string) => { d.selected[tabId] = path },
      /**
       * Clear one tab's selection (the detail view's back gesture).
       * @param d - draft state.
       * @param tabId - the tab going back to the list.
       */
      deselect: (d, tabId: TabId) => { delete d.selected[tabId] },
      /** Re-trigger the list fetch. @param d - draft state. */
      refreshList: (d) => { d.listRequestRev += 1 },
      /**
       * Record a fetched list.
       * @param d - draft state.
       * @param list - the Remote's whole response.
       */
      setList: (d, list: FilePreviewList) => {
        d.list = list.entries
        d.listAsOfSeq = list.asOfSeq
        d.listError = null
      },
      /** @param d - draft state. @param loading - whether a fetch is in flight. */
      setListLoading: (d, loading: boolean) => { d.listLoading = loading },
      /** @param d - draft state. @param error - the failure to show, or null. */
      setListError: (d, error: string | null) => { d.listError = error },
    },
  })
}
