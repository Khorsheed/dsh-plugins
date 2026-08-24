/**
 * The worktrees drawer (`shell.overlay`): the frame-wide right-side panel
 * behind the badge. Header holds the worktree summary and the git action row
 * (refresh, copy branch, show in folder, open in IDE — the host gestures
 * gated on loopback canOpenPath, the FilePreviewDrawer precedent); a mode
 * switcher offers Changes / Commits / Repository; the body is a left
 * list-or-tree column and the right detail pane (diff | content). Selecting a
 * file collapses the left tree to a narrow icon rail; clicking the rail
 * restores it.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconBranchOutline16, IconCloseOutline16, IconCopyOutline16, IconFolderOpenOutline16,
  IconPanelLeftOutline16, IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangedFile, FileDiffRequest } from '../types.ts'
import type { WorktreesDrawerProps } from './contract.ts'
import { CommitDetails } from './CommitDetails.tsx'
import { CommitList } from './CommitList.tsx'
import { DetailPane, isDeleted } from './DetailPane.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { Overview } from './Overview.tsx'
import css from './Drawer.module.css'

/** Default drawer width (px) — wider than the file-preview drawer because this
 * drawer shows a tree and a detail pane side by side. */
const DEFAULT_WIDTH = 720
/** Narrowest the drag handle allows — below this the two panes are unusable. */
const MIN_WIDTH = 420
/** localStorage key for the user's drawer width preference. */
const WIDTH_KEY = 'dsh-worktrees-drawer-w'
/** Tree column width: the developer-tool default of 320px, draggable 280–380. */
const TREE_DEFAULT_WIDTH = 320
const TREE_MIN_WIDTH = 280
const TREE_MAX_WIDTH = 380
const TREE_WIDTH_KEY = 'dsh-worktrees-tree-w'

/** Clamp a requested tree width into the 280–380 band. */
function clampTreeWidth(width: number): number {
  return Math.max(TREE_MIN_WIDTH, Math.min(width, TREE_MAX_WIDTH))
}

/** Clamp a requested width between the minimum and 92% of the viewport. */
function clampWidth(width: number, viewport: number): number {
  return Math.max(MIN_WIDTH, Math.min(width, Math.round(viewport * 0.92)))
}

/** The drawer. */
export function WorktreesDrawer({
  useStore, actions, useSessions, t,
  fetchSummary, fetchChanges, fetchRepoFiles, fetchCommitLog, fetchCommitFiles,
  fetchFileDiff, fetchReadFile, fetchReadFileAtCommit, isLoopback, useHostDescription, openExternal, copyBranch,
}: WorktreesDrawerProps): ReactNode {
  const open = useStore(s => s.open)
  const mode = useStore(s => s.mode)
  const selectedPath = useStore(s => s.selectedPath)
  const selectedSegment = useStore(s => s.selectedSegment)
  const detailView = useStore(s => s.detailView)
  const selectedCommit = useStore(s => s.selectedCommit)
  const treeCollapsed = useStore(s => s.treeCollapsed)
  const summary = useStore(s => s.summary)
  const changes = useStore(s => s.changes)
  const repoFiles = useStore(s => s.repoFiles)
  const commits = useStore(s => s.commits)
  const commitFiles = useStore(s => s.commitFiles)
  const diff = useStore(s => s.diff)
  const content = useStore(s => s.content)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)
  const sessionId = useSessions(s => s.current)
  const canOpenHost = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  const [copied, setCopied] = useState(false)
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(TREE_WIDTH_KEY))
      return Number.isFinite(saved) && saved >= TREE_MIN_WIDTH ? saved : TREE_DEFAULT_WIDTH
    } catch {
      return TREE_DEFAULT_WIDTH
    }
  })
  const treeDrag = useRef<{ startX: number; startW: number } | null>(null)
  useEffect(() => {
    try { localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth)) } catch { /* non-fatal */ }
  }, [treeWidth])
  const onTreeDown = (event: { clientX: number; pointerId: number; currentTarget: HTMLElement }): void => {
    treeDrag.current = { startX: event.clientX, startW: treeWidth }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onTreeMove = (event: { clientX: number }): void => {
    if (treeDrag.current === null) return
    // Right edge of the tree column: dragging right widens it.
    setTreeWidth(clampTreeWidth(treeDrag.current.startW + (event.clientX - treeDrag.current.startX)))
  }
  const onTreeUp = (): void => { treeDrag.current = null }
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY))
      return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH
    } catch {
      return DEFAULT_WIDTH
    }
  })
  const drag = useRef<{ startX: number; startW: number } | null>(null)
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(drawerWidth)) } catch { /* quota/private-mode: non-fatal */ }
  }, [drawerWidth])
  const onResizePointerDown = (event: { clientX: number; pointerId: number; currentTarget: HTMLElement }): void => {
    drag.current = { startX: event.clientX, startW: drawerWidth }
    // Capture so fast drags keep delivering moves even off the 8px handle.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onResizePointerMove = (event: { clientX: number }): void => {
    if (drag.current === null) return
    // Left edge: dragging left grows the drawer.
    setDrawerWidth(clampWidth(drag.current.startW + (drag.current.startX - event.clientX), window.innerWidth))
  }
  const onResizePointerUp = (): void => { drag.current = null }

  // Resolve the selected file's metadata for the detail pane.
  const selectedFile: ChangedFile | undefined = useMemo(() => {
    if (selectedPath === null) return undefined
    if (mode === 'worktree') {
      return changes?.uncommitted.find(file => file.path === selectedPath)
        ?? changes?.committed.find(file => file.path === selectedPath)
    }
    if (mode === 'commits') {
      return commitFiles?.find(file => file.path === selectedPath)
    }
    return undefined
  }, [mode, selectedPath, changes, commitFiles])

  const hasDiff = selectedSegment !== null && !(selectedFile?.status === '??')
  const untracked = selectedFile?.status === '??'

  const groups = useMemo<FileTreeGroup[]>(() => {
    if (mode === 'worktree') {
      const items: FileTreeItem[] = [
        ...(changes?.uncommitted ?? []),
        ...(changes?.committed ?? []),
      ].map(file => ({ path: file.path, status: file.status, additions: file.additions, deletions: file.deletions }))
      return [{ key: 'all-changes', title: '', count: items.length, items }]
    }
    if (mode === 'repo') {
      const items: FileTreeItem[] = (repoFiles ?? []).map(path => ({ path, status: '' }))
      return [{ key: 'repo', title: '', count: items.length, items }]
    }
    return []
  }, [mode, changes, repoFiles, t])

  // Summary on open / refresh.
  useEffect(() => {
    if (!open || sessionId === undefined) return
    let cancelled = false
    void fetchSummary(sessionId).then(result => {
      if (cancelled) return
      if (result.ok) { actions.setSummary(result.value); actions.setError(null) }
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [open, rev, sessionId, fetchSummary, actions])

  // Eager count data: the commit log and repo file list are fetched on open /
  // refresh (cheap git reads) so every switcher tab shows its count up front,
  // not only after that mode was entered.
  useEffect(() => {
    if (!open || sessionId === undefined) return
    let cancelled = false
    void fetchCommitLog(sessionId).then(result => {
      if (!cancelled && result.ok) actions.setCommits(result.value)
    })
    void fetchRepoFiles(sessionId).then(result => {
      if (!cancelled && result.ok) actions.setRepoFiles(result.value)
    })
    return () => { cancelled = true }
  }, [open, rev, sessionId, fetchCommitLog, fetchRepoFiles, actions])

  // Mode data on open / mode switch / refresh.
  useEffect(() => {
    if (!open || sessionId === undefined) return
    let cancelled = false
    actions.setLoading(true)
    const fetch = mode === 'worktree'
      ? fetchChanges(sessionId).then(r => { if (!cancelled && r.ok) actions.setChanges(r.value) })
      : mode === 'repo'
        ? fetchRepoFiles(sessionId).then(r => { if (!cancelled && r.ok) actions.setRepoFiles(r.value) })
        : fetchCommitLog(sessionId).then(r => { if (!cancelled && r.ok) actions.setCommits(r.value) })
    void fetch
      .catch(() => { /* remote errors already fail closed per-call */ })
      .finally(() => { if (!cancelled) actions.setLoading(false) })
    return () => { cancelled = true }
  }, [open, rev, mode, sessionId, fetchChanges, fetchRepoFiles, fetchCommitLog, actions])

  // Selected commit's files.
  useEffect(() => {
    if (!open || sessionId === undefined || mode !== 'commits' || selectedCommit === null) return
    let cancelled = false
    void fetchCommitFiles(sessionId, selectedCommit).then(result => {
      if (!cancelled && result.ok) actions.setCommitFiles(result.value.files)
    })
    return () => { cancelled = true }
  }, [open, mode, selectedCommit, sessionId, fetchCommitFiles, actions])

  // Selected file detail (diff / content).
  useEffect(() => {
    if (!open || sessionId === undefined || selectedPath === null) return
    let cancelled = false
    if (detailView === 'diff' && selectedSegment !== null) {
      const request: FileDiffRequest = selectedSegment === 'commit'
        ? { path: selectedPath, segment: 'commit', commit: selectedCommit ?? '' }
        : { path: selectedPath, segment: selectedSegment }
      void fetchFileDiff(sessionId, request).then(result => { if (!cancelled && result.ok) actions.setDiff(result.value) })
    } else if (detailView === 'content') {
      // The commits mode's content view reads the file as it was at the
      // selected commit; the other segments read the working-tree content.
      const fetch = selectedSegment === 'commit'
        ? fetchReadFileAtCommit(sessionId, { path: selectedPath, commit: selectedCommit ?? '' })
        : fetchReadFile(sessionId, { path: selectedPath })
      void fetch.then(result => {
        if (cancelled) return
        if (result.ok) actions.setContent(result.value)
        else actions.setError(result.error.message)
      })
    }
    return () => { cancelled = true }
  }, [open, selectedPath, selectedSegment, detailView, selectedCommit, sessionId, fetchFileDiff, fetchReadFile, fetchReadFileAtCommit, actions])

  // Repository mode: default to previewing the first file so the detail
  // column never opens onto an empty surface.
  useEffect(() => {
    if (!open || mode !== 'repo' || selectedPath !== null) return
    const files = repoFiles
    if (files === null || files.length === 0) return
    actions.select(files[0] ?? '', null)
    actions.setDetailView('content')
  }, [open, mode, repoFiles, selectedPath, actions])

  // Per-mode counts for the compact switcher labels.
  const counts = useMemo(() => ({
    worktree: changes === null ? null : changes.uncommitted.length + changes.committed.length,
    commits: commits === null ? null : commits.length,
    repo: repoFiles === null ? null : repoFiles.length,
  }), [changes, commits, repoFiles])

  // Escape closes the drawer (the layer outside the drawer is click-through,
  // matching file-preview — no dim mask, the ✕ / Esc own the close).
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') actions.close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, actions])

  if (!open) return null

  const onSelectFile = (path: string): void => {
    let segment: 'uncommitted' | 'committed' | 'commit' | null = null
    const untracked = (changes?.uncommitted ?? []).find(file => file.path === path)?.status === '??'
    if (mode === 'worktree') {
      if ((changes?.uncommitted ?? []).some(file => file.path === path)) segment = 'uncommitted'
      else if ((changes?.committed ?? []).some(file => file.path === path)) segment = 'committed'
    } else if (mode === 'commits') {
      segment = 'commit'
    } else if ((changes?.uncommitted ?? []).some(file => file.path === path)) {
      segment = 'uncommitted'
    }
    actions.select(path, segment)
    // In a changes context lead with the diff; only untracked/repo-browse
    // files have no diff and fall back to the content view.
    actions.setDetailView(segment !== null && !untracked ? 'diff' : 'content')
  }

  const worktreePath = summary?.repo ?? ''

  const leftColumn = ((): ReactNode => {
    if (treeCollapsed) {
      return (
        <div className={css.rail} title={t('tree.expand')}>
          <button
            type="button"
            className={css.collapseButton}
            title={t('tree.expand')}
            onClick={() => { actions.toggleTree() }}
          >
            <IconPanelLeftOutline16 />
          </button>
        </div>
      )
    }
    return (
      <div className={css.treeColumn} style={{ width: treeWidth }}>
        {mode === 'commits'
          ? (
            <>
              <div className={css.commitsHeader}>
                <span className={css.treeTitle}>{t('mode.commits')}</span>
                <button
                  type="button"
                  className={css.collapseButton}
                  title={treeCollapsed ? t('tree.expand') : t('tree.collapse')}
                  onClick={() => { actions.toggleTree() }}
                >
                  <IconPanelLeftOutline16 />
                </button>
              </div>
              <CommitList
                commits={commits}
                selectedCommit={selectedCommit}
                commitFiles={commitFiles}
                onSelectCommit={actions.selectCommit}
                onSelectFile={onSelectFile}
                baseRef={summary?.baseRef ?? 'main'}
                t={t}
              />
            </>
          )
          : <FileTree
            groups={groups}
            selectedPath={selectedPath}
            onSelect={onSelectFile}
            treeTitle={mode === 'repo'
              ? t('mode.repo')
              : t('tree.changedFiles', { count: String(changes === null ? 0 : changes.uncommitted.length + changes.committed.length) })}
            collapsed={treeCollapsed}
            onToggleCollapse={() => { actions.toggleTree() }}
            t={t}
          />}
      </div>
    )
  })()

  const modeLabel = mode === 'worktree' ? t('mode.worktree') : mode === 'commits' ? t('mode.commits') : t('mode.repo')

  return (
    <div className={css.overlay}>
      <aside
        className={css.drawer}
        style={{ width: drawerWidth }}
        role="dialog"
        aria-label={modeLabel}
      >
        <div
          className={css.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('drawer.resize')}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        />
        <div className={css.header}>
          <div className={css.summary}>
            <span className={css.summaryBranch}>
              <IconBranchOutline16 />
              {summary?.branch ?? t('summary.detached')}
              {summary !== null && summary.isMain && summary.branch !== 'main' && <span className={css.mainTag}>main</span>}
            </span>
            <span className={css.summaryMeta}>
              {summary?.repoName ?? ''} · @{summary?.head ?? ''}
              {summary !== null && ` · ↑${summary.ahead} ↓${summary.behind} · ${summary.dirty} dirty`}
            </span>
          </div>
          <div className={css.actions}>
            <button type="button" className={css.action} title={t('action.refresh')} onClick={() => { actions.refresh() }}>
              <IconRefreshOutline16 />
            </button>
            <button
              type="button"
              className={css.action}
              title={t('action.copyBranch')}
              disabled={summary?.branch === null || summary?.branch === undefined}
              onClick={() => {
                if (summary?.branch === undefined || summary.branch === null) return
                void copyBranch(summary.branch).then(ok => {
                  if (ok) {
                    setCopied(true)
                    window.setTimeout(() => { setCopied(false) }, 1200)
                  }
                })
              }}
            >
              <IconCopyOutline16 />
              {copied && <span className={css.copied}>{t('action.copyBranch')}</span>}
            </button>
            {canOpenHost && (
              <button type="button" className={css.action} title={t('action.openFolder')} onClick={() => { openExternal(worktreePath) }}>
                <IconFolderOpenOutline16 />
              </button>
            )}
            <button type="button" className={css.action} title={t('action.close')} onClick={() => { actions.close() }}>
              <IconCloseOutline16 />
            </button>
          </div>
        </div>
        <div className={css.switcher}>
          {(['worktree', 'commits', 'repo'] as const).map(modeKey => {
            const label = modeKey === 'worktree' ? t('mode.worktree') : modeKey === 'commits' ? t('mode.commits') : t('mode.repo')
            const count = counts[modeKey]
            return (
              <button
                key={modeKey}
                type="button"
                className={`${css.switch} ${mode === modeKey ? css.switchActive : ''}`}
                onClick={() => { actions.setMode(modeKey) }}
              >
                {label}
                {count !== null && <span className={css.switchCount}>{count}</span>}
              </button>
            )
          })}
        </div>
        <div className={css.body}>
          {leftColumn}
          <div
            className={css.treeResize}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('tree.resize')}
            onPointerDown={onTreeDown}
            onPointerMove={onTreeMove}
            onPointerUp={onTreeUp}
            onPointerCancel={onTreeUp}
          />
          <div className={css.detailColumn}>
            {selectedPath !== null ? (
              <DetailPane
                path={selectedPath}
                hasDiff={hasDiff}
                untracked={untracked}
                deleted={isDeleted(selectedFile)}
                detailView={detailView}
                diff={diff}
                content={content}
                loading={loading}
                error={error}
                onViewChange={actions.setDetailView}
                t={t}
              />
            ) : mode === 'commits' && selectedCommit !== null
              ? (() => {
                const commit = commits?.find(candidate => candidate.sha === selectedCommit)
                return commit === undefined
                  ? <Overview summary={summary} changes={changes} repoMode={false} t={t} />
                  : <CommitDetails commit={commit} files={commitFiles} onSelectFile={onSelectFile} t={t} />
              })()
              : <Overview summary={summary} changes={changes} repoMode={mode === 'repo'} t={t} />}
          </div>
        </div>
      </aside>
    </div>
  )
}
