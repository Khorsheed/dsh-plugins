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
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconBranchOutline16, IconCloseOutline16, IconCopyOutline16, IconFolderOpenOutline16,
  IconPanelLeftOutline16, IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangedFile, FileDiffRequest } from '../types.ts'
import type { WorktreesDrawerProps } from './contract.ts'
import { CommitList } from './CommitList.tsx'
import { DetailPane, isDeleted } from './DetailPane.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import css from './Drawer.module.css'

/** Drawer width cap relative to the viewport. */
const WIDTH_RATIO = 0.85

/** Top-level segments of a path list (for the collapsed rail). */
function topLevelSegments(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const path of paths) {
    const first = path.split('/')[0]
    if (first !== undefined && first !== '') seen.add(first)
  }
  return [...seen].sort()
}

/** The drawer. */
export function WorktreesDrawer({
  useStore, actions, useSessions, t,
  fetchSummary, fetchChanges, fetchRepoFiles, fetchCommitLog, fetchCommitFiles,
  fetchFileDiff, fetchReadFile, isLoopback, useHostDescription, openExternal, copyBranch,
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
      const groupsList: FileTreeGroup[] = []
      const uncommitted: FileTreeItem[] = (changes?.uncommitted ?? []).map(file => ({
        path: file.path, status: file.status, additions: file.additions, deletions: file.deletions,
      }))
      const committed: FileTreeItem[] = (changes?.committed ?? []).map(file => ({
        path: file.path, status: file.status, additions: file.additions, deletions: file.deletions,
      }))
      if (uncommitted.length > 0) {
        groupsList.push({ key: 'uncommitted', title: t('group.uncommitted'), count: uncommitted.length, items: uncommitted })
      }
      if (committed.length > 0) {
        groupsList.push({ key: 'committed', title: t('group.committed'), count: committed.length, items: committed })
      }
      return groupsList
    }
    if (mode === 'repo') {
      const items: FileTreeItem[] = (repoFiles ?? []).map(path => ({ path, status: '' }))
      return [{ key: 'repo', title: '', count: items.length, items }]
    }
    return []
  }, [mode, changes, repoFiles, t])

  const railSegments = useMemo(() => {
    if (mode === 'worktree') {
      return topLevelSegments([
        ...(changes?.uncommitted ?? []).map(file => file.path),
        ...(changes?.committed ?? []).map(file => file.path),
      ])
    }
    if (mode === 'repo') return topLevelSegments(repoFiles ?? [])
    return []
  }, [mode, changes, repoFiles])

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
    } else if (detailView === 'content' && selectedSegment !== 'commit') {
      void fetchReadFile(sessionId, { path: selectedPath }).then(result => {
        if (cancelled) return
        if (result.ok) actions.setContent(result.value)
        else actions.setError(result.error.message)
      })
    }
    return () => { cancelled = true }
  }, [open, selectedPath, selectedSegment, detailView, selectedCommit, sessionId, fetchFileDiff, fetchReadFile, actions])

  if (!open) return null

  const onSelectFile = (path: string): void => {
    let segment: 'uncommitted' | 'committed' | 'commit' | null = null
    if (mode === 'worktree') {
      if ((changes?.uncommitted ?? []).some(file => file.path === path)) segment = 'uncommitted'
      else if ((changes?.committed ?? []).some(file => file.path === path)) segment = 'committed'
    } else if (mode === 'commits') {
      segment = 'commit'
    } else if ((changes?.uncommitted ?? []).some(file => file.path === path)) {
      segment = 'uncommitted'
    }
    actions.select(path, segment)
    if (mode !== 'commits') actions.setTreeCollapsed(true)
  }

  const worktreePath = summary?.repo ?? ''

  const leftColumn = ((): ReactNode => {
    if (treeCollapsed && mode !== 'commits') {
      return (
        <div className={css.rail} title={t('tree.expand')} onClick={() => { actions.setTreeCollapsed(false) }}>
          {railSegments.map(segment => (
            <span key={segment} className={css.railIcon} title={segment}>{segment.slice(0, 1).toUpperCase()}</span>
          ))}
        </div>
      )
    }
    return (
      <div className={css.treeColumn}>
        <div className={css.treeHeader}>
          <button
            type="button"
            className={css.collapseButton}
            title={t('tree.expand')}
            onClick={() => { actions.setTreeCollapsed(true) }}
          >
            <IconPanelLeftOutline16 />
          </button>
        </div>
        {mode === 'commits'
          ? <CommitList
            commits={commits}
            selectedCommit={selectedCommit}
            commitFiles={commitFiles}
            onSelectCommit={actions.selectCommit}
            onSelectFile={onSelectFile}
            t={t}
          />
          : <FileTree
            groups={groups}
            selectedPath={selectedPath}
            onSelect={onSelectFile}
            t={t}
          />}
      </div>
    )
  })()

  const modeLabel = mode === 'worktree' ? t('mode.worktree') : mode === 'commits' ? t('mode.commits') : t('mode.repo')

  return (
    <div className={css.overlay}>
      <div className={css.backdrop} onClick={() => { actions.close() }} aria-hidden="true" />
      <aside
        className={css.drawer}
        style={{ width: `min(${WIDTH_RATIO * 100}vw, 680px)` }}
        role="dialog"
        aria-label={modeLabel}
      >
        <div className={css.header}>
          <div className={css.summary}>
            <span className={css.summaryBranch}>
              <IconBranchOutline16 />
              {summary?.branch ?? t('summary.detached')}
              {summary !== null && summary.isMain && <span className={css.mainTag}>main</span>}
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
          {(['worktree', 'commits', 'repo'] as const).map(modeKey => (
            <button
              key={modeKey}
              type="button"
              className={`${css.switch} ${mode === modeKey ? css.switchActive : ''}`}
              onClick={() => { actions.setMode(modeKey) }}
            >
              {modeKey === 'worktree' ? t('mode.worktree') : modeKey === 'commits' ? t('mode.commits') : t('mode.repo')}
            </button>
          ))}
        </div>
        <div className={css.body}>
          {leftColumn}
          <div className={css.detailColumn}>
            <DetailPane
              path={selectedPath ?? ''}
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
          </div>
        </div>
      </aside>
    </div>
  )
}
