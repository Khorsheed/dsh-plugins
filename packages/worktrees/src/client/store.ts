/**
 * The worktrees tab's transient store: mode, selection, and the fetched
 * results (whole values, null until loaded). Module level exports the factory
 * only — a module-level handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (the framework instantiates one per session scope) and the tab
 * derives its PropsStore share from the return type. Open/close state is the
 * tab record's own — the right Sidebar owns it, so nothing here tracks it.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  ChangedFile, ChangesResult, CommitInfo, FileDiffResult, LocalImageResult, ReadFileResult, SessionSummary, WorktreeInfo,
} from '../types.ts'

/** The tab's three modes. */
export type DrawerMode = 'worktree' | 'commits' | 'repo'
/** The detail pane's two views. */
export type DetailView = 'diff' | 'content'

/** The tab's state; fetched results are whole values, null until loaded. */
export interface WorktreesState {
  /** The active mode (defaults to the worktree changes view). */
  mode: DrawerMode
  /** The selected file's repo-relative path, or null. */
  selectedPath: string | null
  /** Which change segment the selected file belongs to (null = not a changed file). */
  selectedSegment: 'uncommitted' | 'committed' | 'commit' | null
  /** The detail pane's active view. */
  detailView: DetailView
  /** The selected commit sha (commits mode), or null. */
  selectedCommit: string | null
  /** Whether the left tree is collapsed to the narrow icon rail. */
  treeCollapsed: boolean
  /** The badge/drawer summary, loaded on open. */
  summary: SessionSummary | null
  /** The two change segments (worktree mode). */
  changes: ChangesResult | null
  /** The repository's full file list (repo mode). */
  repoFiles: readonly string[] | null
  /** The branch's own commit log (commits mode). */
  commits: readonly CommitInfo[] | null
  /** The selected commit's files (commits mode). */
  commitFiles: readonly ChangedFile[] | null
  /** The selected commit's message body (commits mode). */
  commitBody: string | null
  /** The repository's worktrees (the switcher dropdown). */
  worktrees: readonly WorktreeInfo[] | null
  /** The session's active worktree path (the switcher highlight), or null. */
  activeWorktreePath: string | null
  /** The selected file's diff (diff view), or null. */
  diff: FileDiffResult | null
  /** The selected file's content (content view), or null. */
  content: ReadFileResult | null
  /** The selected file's inline image (repo browser), or null. */
  repoImage: LocalImageResult | null
  /** Whether a fetch is in flight. */
  loading: boolean
  /** Human-readable fetch failure, or null. */
  error: string | null
  /** Bumped by refresh to re-trigger the mode fetches. */
  rev: number
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type WorktreesActions = {
  setMode: (draft: WorktreesState, mode: DrawerMode) => void
  toggleTree: (draft: WorktreesState) => void
  setTreeCollapsed: (draft: WorktreesState, collapsed: boolean) => void
  select: (draft: WorktreesState, path: string, segment: 'uncommitted' | 'committed' | 'commit' | null) => void
  setDetailView: (draft: WorktreesState, view: DetailView) => void
  selectCommit: (draft: WorktreesState, sha: string | null) => void
  clearSelection: (draft: WorktreesState) => void
  refresh: (draft: WorktreesState) => void
  setLoading: (draft: WorktreesState, loading: boolean) => void
  setError: (draft: WorktreesState, error: string | null) => void
  setSummary: (draft: WorktreesState, summary: SessionSummary) => void
  setChanges: (draft: WorktreesState, changes: ChangesResult) => void
  setRepoFiles: (draft: WorktreesState, files: readonly string[]) => void
  setCommits: (draft: WorktreesState, commits: readonly CommitInfo[]) => void
  setCommitFiles: (draft: WorktreesState, files: readonly ChangedFile[]) => void
  setCommitBody: (draft: WorktreesState, body: string) => void
  setWorktrees: (draft: WorktreesState, worktrees: readonly WorktreeInfo[]) => void
  setActiveWorktreePath: (draft: WorktreesState, path: string | null) => void
  setDiff: (draft: WorktreesState, diff: FileDiffResult) => void
  setContent: (draft: WorktreesState, content: ReadFileResult) => void
  setRepoImage: (draft: WorktreesState, image: LocalImageResult) => void
}

const INITIAL: WorktreesState = {
  mode: 'worktree',
  selectedPath: null,
  selectedSegment: null,
  detailView: 'content',
  selectedCommit: null,
  treeCollapsed: false,
  summary: null,
  changes: null,
  repoFiles: null,
  commits: null,
  commitFiles: null,
  commitBody: null,
  worktrees: null,
  activeWorktreePath: null,
  diff: null,
  content: null,
  repoImage: null,
  loading: false,
  error: null,
  rev: 0,
}

/**
 * Create the worktrees tab store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorktreesStore(): EngineStoreHandle<WorktreesState, WorktreesActions> {
  return defineStore({
    init: (): WorktreesState => ({ ...INITIAL }),
    actions: {
      setMode: (d, mode: DrawerMode) => {
        d.mode = mode
        d.selectedPath = null
        d.selectedSegment = null
        d.selectedCommit = null
        d.diff = null
        d.content = null
        d.repoImage = null
        d.error = null
        d.rev += 1
      },
      toggleTree: (d) => { d.treeCollapsed = !d.treeCollapsed },
      setTreeCollapsed: (d, collapsed: boolean) => { d.treeCollapsed = collapsed },
      select: (d, path: string, segment: 'uncommitted' | 'committed' | 'commit' | null) => {
        d.selectedPath = path
        d.selectedSegment = segment
        d.diff = null
        d.content = null
        d.repoImage = null
        d.error = null
      },
      setDetailView: (d, view: DetailView) => {
        d.detailView = view
        d.diff = null
        d.content = null
        d.repoImage = null
        d.error = null
      },
      selectCommit: (d, sha: string | null) => {
        d.selectedCommit = sha
        d.commitFiles = null
        d.selectedPath = null
        d.selectedSegment = null
        d.diff = null
        d.content = null
        d.repoImage = null
      },
      clearSelection: (d) => {
        d.selectedPath = null
        d.selectedSegment = null
        d.diff = null
        d.content = null
        d.repoImage = null
      },
      refresh: (d) => { d.rev += 1 },
      setLoading: (d, loading: boolean) => { d.loading = loading },
      setError: (d, error: string | null) => { d.error = error },
      setSummary: (d, summary: SessionSummary) => { d.summary = summary },
      setChanges: (d, changes: ChangesResult) => { d.changes = changes },
      setRepoFiles: (d, files: readonly string[]) => { d.repoFiles = files },
      setCommits: (d, commits: readonly CommitInfo[]) => { d.commits = commits },
      setCommitFiles: (d, files: readonly ChangedFile[]) => { d.commitFiles = files },
      setCommitBody: (d, body: string) => { d.commitBody = body },
      setWorktrees: (d, worktrees: readonly WorktreeInfo[]) => { d.worktrees = worktrees },
      setActiveWorktreePath: (d, path: string | null) => { d.activeWorktreePath = path },
      setDiff: (d, diff: FileDiffResult) => { d.diff = diff },
      setContent: (d, content: ReadFileResult) => { d.content = content },
      setRepoImage: (d, image: LocalImageResult) => { d.repoImage = image },
    },
  })
}
