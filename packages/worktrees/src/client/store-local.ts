/**
 * The local-files browser's transient store: open state, current path, the
 * listing, and the preview result. Deliberately SEPARATE from the worktrees
 * drawer store — the browser is an independent surface (git-agnostic, its own
 * interaction model), and sharing the drawer's state would entangle two
 * unrelated navigation flows. Module level exports the factory only (same
 * identity discipline as the drawer store).
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ListLocalDirectoryResult, LocalImageResult, ReadLocalFileResult } from '../types.ts'

/** The local-files browser's state; fetched results are whole values. */
export interface LocalFilesState {
  /** Whether the browser panel is open. */
  open: boolean
  /** The session this browser is currently serving (for per-session memory). */
  sessionId: string
  /** The directory currently listed (absolute path; null until first fetch). */
  root: string | null
  /** The current listing (null until loaded). */
  listing: ListLocalDirectoryResult | null
  /** The selected entry's absolute path, or null. */
  selectedPath: string | null
  /** The selected entry's preview content (null until a text file is selected). */
  preview: ReadLocalFileResult | null
  /** The selected entry's inline image (null until an image is selected). */
  image: LocalImageResult | null
  /** Whether a fetch is in flight. */
  loading: boolean
  /** Human-readable fetch failure, or null. */
  error: string | null
  /** Bumped by refresh to re-trigger the directory load (same root). */
  rev: number
}

/** Annotation twin of the actions literal below. */
export type LocalFilesActions = {
  open: (draft: LocalFilesState, sessionId: string, start: string) => void
  close: (draft: LocalFilesState) => void
  setRoot: (draft: LocalFilesState, path: string) => void
  setListing: (draft: LocalFilesState, listing: ListLocalDirectoryResult) => void
  select: (draft: LocalFilesState, path: string | null) => void
  setPreview: (draft: LocalFilesState, preview: ReadLocalFileResult) => void
  setImage: (draft: LocalFilesState, image: LocalImageResult) => void
  setLoading: (draft: LocalFilesState, loading: boolean) => void
  setError: (draft: LocalFilesState, error: string | null) => void
  refresh: (draft: LocalFilesState) => void
}

const INITIAL: LocalFilesState = {
  open: false,
  sessionId: '',
  root: null,
  listing: null,
  selectedPath: null,
  preview: null,
  image: null,
  loading: false,
  error: null,
  rev: 0,
}

/**
 * Create the local-files browser store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLocalFilesStore(): EngineStoreHandle<LocalFilesState, LocalFilesActions> {
  return defineStore({
    init: (): LocalFilesState => ({ ...INITIAL }),
    actions: {
      open: (d, sessionId: string, start: string) => {
        d.open = true
        d.sessionId = sessionId
        d.root = start
        d.listing = null
        d.selectedPath = null
        d.preview = null
        d.image = null
        d.error = null
      },
      close: (d) => {
        d.open = false
      },
      setRoot: (d, path: string) => {
        d.root = path
        d.listing = null
        d.selectedPath = null
        d.preview = null
        d.image = null
        d.error = null
      },
      setListing: (d, listing: ListLocalDirectoryResult) => {
        d.listing = listing
        d.loading = false
        d.error = null
      },
      select: (d, path: string | null) => {
        d.selectedPath = path
        d.preview = null
        d.image = null
      },
      setPreview: (d, preview: ReadLocalFileResult) => {
        d.preview = preview
        d.image = null
        d.loading = false
        d.error = null
      },
      setImage: (d, image: LocalImageResult) => {
        d.image = image
        d.preview = null
        d.loading = false
        d.error = null
      },
      setLoading: (d, loading: boolean) => { d.loading = loading },
      setError: (d, error: string | null) => { d.error = error },
      refresh: (d) => { d.rev += 1 },
    },
  })
}
