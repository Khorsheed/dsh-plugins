/**
 * The worktrees right-Sidebar tab body (`sidebar.right.pane.tab` under this
 * package's type id): the session's changes / commits / repository page
 * behind the badge. The header holds the worktree summary and the git action
 * row (refresh, copy branch, show in folder — the host gesture gated on the
 * official open-in-app probe); a mode switcher offers Changes / Commits /
 * Repository; the body is a left list-or-tree column and the right detail
 * pane (diff | content). Selecting a file collapses the left tree to a
 * narrow icon rail; clicking the rail restores it.
 *
 * Geometry — width, docking, fullscreen, close — is the right Sidebar's own;
 * this body draws only the page. Open/re-open arrives as navigation params
 * (`{ mode }`), applied on every navigation revision so a repeat badge click
 * re-asserts the requested mode.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconBranchOutline16, IconChevronDownOutline14, IconCopyOutline16, IconFolderOpenOutline16,
  IconPanelLeftOutline16, IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangedFile, FileDiffRequest, WorktreeInfo } from '../types.ts'
import type { WorktreesTabProps } from './contract.ts'
import type { WorktreesTabParams } from './definition.tsx'
import { CommitDetails } from './CommitDetails.tsx'
import { CommitList } from './CommitList.tsx'
import { DetailPane, isDeleted } from './DetailPane.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { isImageFile } from './ImagePreview.tsx'
import { pickFileManager } from './open-in-app.ts'
import { Overview, formatCount } from './Overview.tsx'
import { useTreeWidth } from './sizing.ts'
import css from './Drawer.module.css'

/** localStorage key for the tab's tree-column width preference. */
const TREE_WIDTH_KEY = 'dsh-worktrees-tree-w'

/** The worktrees tab body. */
export function WorktreesTab({
  sessionId, useTabInfo, useStore, actions, t,
  fetchSummary, fetchChanges, fetchRepoFiles, fetchCommitLog, fetchCommitFiles,
  fetchWorktrees, switchWorktree, directAgent, bumpVersion,
  fetchFileDiff, fetchReadFile, fetchReadFileAtCommit, fetchReadRepoImage, useOpenInApp, openExternal, copyBranch,
}: WorktreesTabProps): ReactNode {
  const { tab } = useTabInfo()
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
  const commitBody = useStore(s => s.commitBody)
  const worktrees = useStore(s => s.worktrees)
  const activeWorktreePath = useStore(s => s.activeWorktreePath)
  const diff = useStore(s => s.diff)
  const content = useStore(s => s.content)
  const repoImage = useStore(s => s.repoImage)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)
  // The open-in-app probe feed: null until the host answered — the gesture
  // stays hidden until the probe confirms a file manager (hidden = degrade).
  const openInAppApps = useOpenInApp(apps => apps)
  const folderApp = openInAppApps === null ? undefined : pickFileManager(openInAppApps)

  const [copied, setCopied] = useState(false)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const worktreeRef = useRef<HTMLDivElement | null>(null)
  const {
    width: treeWidth,
    onPointerDown: onTreeDown,
    onPointerMove: onTreeMove,
    onPointerUp: onTreeUp,
  } = useTreeWidth(TREE_WIDTH_KEY)

  // A navigation carrying params (the badge's branch capsule) applies its
  // mode; the revision bumps on every navigation, so a repeat open of the
  // page re-asserts the requested mode.
  const revision = tab.navigation.revision
  const navMode = (tab.navigation.params as WorktreesTabParams | undefined)?.mode
  useEffect(() => {
    if (revision !== 0 && navMode !== undefined && navMode !== mode) actions.setMode(navMode)
  }, [revision, navMode, mode, actions])

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
      const uncommitted = (changes?.uncommitted ?? []).map(file => ({
        path: file.path, status: file.status, additions: file.additions, deletions: file.deletions,
      }))
      const committed = (changes?.committed ?? []).map(file => ({
        path: file.path, status: file.status, additions: file.additions, deletions: file.deletions,
      }))
      // Two groups (未提交 / 已提交) instead of one merged list, so it is clear
      // which changes are uncommitted (vs HEAD) and which are the branch's own
      // commits on top of base.
      return [
        { key: 'uncommitted', title: t('group.uncommitted'), count: uncommitted.length, items: uncommitted },
        { key: 'committed', title: t('group.committed'), count: committed.length, items: committed },
      ]
    }
    if (mode === 'repo') {
      const items: FileTreeItem[] = (repoFiles ?? []).map(path => ({ path, status: '' }))
      return [{ key: 'repo', title: '', count: items.length, items }]
    }
    return []
  }, [mode, changes, repoFiles, t])

  // Summary on mount / refresh.
  useEffect(() => {
    let cancelled = false
    void fetchSummary(sessionId).then(result => {
      if (cancelled || tab.signal.aborted) return
      if (result.ok) { actions.setSummary(result.value); actions.setError(null) }
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [rev, sessionId, fetchSummary, actions, tab.signal])

  // Eager count data: the commit log and repo file list are fetched on mount /
  // refresh (cheap git reads) so every switcher tab shows its count up front,
  // not only after that mode was entered.
  useEffect(() => {
    let cancelled = false
    void fetchCommitLog(sessionId).then(result => {
      if (!cancelled && !tab.signal.aborted && result.ok) actions.setCommits(result.value)
    })
    void fetchRepoFiles(sessionId).then(result => {
      if (!cancelled && !tab.signal.aborted && result.ok) actions.setRepoFiles(result.value)
    })
    return () => { cancelled = true }
  }, [rev, sessionId, fetchCommitLog, fetchRepoFiles, actions, tab.signal])

  // Mode data on mount / mode switch / refresh.
  useEffect(() => {
    let cancelled = false
    actions.setLoading(true)
    const fetch = mode === 'worktree'
      ? fetchChanges(sessionId).then(r => { if (!cancelled && !tab.signal.aborted && r.ok) actions.setChanges(r.value) })
      : mode === 'repo'
        ? fetchRepoFiles(sessionId).then(r => { if (!cancelled && !tab.signal.aborted && r.ok) actions.setRepoFiles(r.value) })
        : fetchCommitLog(sessionId).then(r => { if (!cancelled && !tab.signal.aborted && r.ok) actions.setCommits(r.value) })
    void fetch
      .catch(() => { /* remote errors already fail closed per-call */ })
      .finally(() => { if (!cancelled) actions.setLoading(false) })
    return () => { cancelled = true }
  }, [rev, mode, sessionId, fetchChanges, fetchRepoFiles, fetchCommitLog, actions, tab.signal])

  // Selected commit's files.
  useEffect(() => {
    if (mode !== 'commits' || selectedCommit === null) return
    let cancelled = false
    void fetchCommitFiles(sessionId, selectedCommit).then(result => {
      if (!cancelled && !tab.signal.aborted && result.ok) {
        actions.setCommitFiles(result.value.files)
        actions.setCommitBody(result.value.body)
      }
    })
    return () => { cancelled = true }
  }, [mode, selectedCommit, sessionId, fetchCommitFiles, actions, tab.signal])

  // Selected file detail (diff / content).
  useEffect(() => {
    if (selectedPath === null) return
    let cancelled = false
    if (detailView === 'diff' && selectedSegment !== null) {
      const request: FileDiffRequest = selectedSegment === 'commit'
        ? { path: selectedPath, segment: 'commit', commit: selectedCommit ?? '' }
        : { path: selectedPath, segment: selectedSegment }
      void fetchFileDiff(sessionId, request).then(result => {
        if (!cancelled && !tab.signal.aborted && result.ok) actions.setDiff(result.value)
      })
    } else if (detailView === 'content') {
      // The commits mode's content view reads the file as it was at the
      // selected commit; the other segments read the working-tree content.
      // An image (non-commit segment) is read as an inline image instead of
      // text, so it renders rather than showing garbage.
      if (selectedSegment !== 'commit' && isImageFile(selectedPath)) {
        void fetchReadRepoImage(sessionId, { path: selectedPath }).then(result => {
          if (cancelled || tab.signal.aborted) return
          if (result.ok) actions.setRepoImage(result.value)
          else actions.setError(result.error.message)
        })
      } else {
        const fetch = selectedSegment === 'commit'
          ? fetchReadFileAtCommit(sessionId, { path: selectedPath, commit: selectedCommit ?? '' })
          : fetchReadFile(sessionId, { path: selectedPath })
        void fetch.then(result => {
          if (cancelled || tab.signal.aborted) return
          if (result.ok) actions.setContent(result.value)
          else actions.setError(result.error.message)
        })
      }
    }
    return () => { cancelled = true }
  }, [selectedPath, selectedSegment, detailView, selectedCommit, sessionId, fetchFileDiff, fetchReadFile, fetchReadFileAtCommit, fetchReadRepoImage, actions, tab.signal])

  // Repository mode: default to previewing the first file so the detail
  // column never opens onto an empty surface.
  useEffect(() => {
    if (mode !== 'repo' || selectedPath !== null) return
    const files = repoFiles
    if (files === null || files.length === 0) return
    actions.select(files[0] ?? '', null)
    actions.setDetailView('content')
  }, [mode, repoFiles, selectedPath, actions])

  // Per-mode counts for the compact switcher labels.
  const counts = useMemo(() => ({
    worktree: changes === null ? null : changes.uncommitted.length + changes.committed.length,
    commits: commits === null ? null : commits.length,
    repo: repoFiles === null ? null : repoFiles.length,
  }), [changes, commits, repoFiles])

  // In the commits mode default to the newest commit so the right pane opens
  // onto a detail view rather than an empty surface.
  useEffect(() => {
    if (mode !== 'commits' || selectedCommit !== null) return
    const latest = commits?.[0]
    if (latest !== undefined) actions.selectCommit(latest.sha)
  }, [mode, commits, selectedCommit, actions])

  // Close the worktree dropdown on an outside mousedown (the dropdown owns
  // its own dismissal).
  useEffect(() => {
    if (!worktreeOpen) return
    const onDown = (event: MouseEvent): void => {
      if (worktreeRef.current !== null && !worktreeRef.current.contains(event.target as Node)) setWorktreeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [worktreeOpen])

  // The worktree the "让 Agent 在此工作" footer targets: the currently
  // highlighted one (the session's active worktree, or main when unset).
  // Declared before the early return so the hook count is stable.
  const directTarget = useMemo<WorktreeInfo | null>(() => {
    const list = worktrees ?? []
    if (list.length === 0) return null
    return list.find(worktree => (activeWorktreePath === null ? worktree.isMain : worktree.path === activeWorktreePath))
      ?? list[0] ?? null
  }, [worktrees, activeWorktreePath])

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

  // Toggle the worktree dropdown, lazily fetching the repo's worktrees.
  const onToggleWorktrees = (): void => {
    if (worktreeOpen) { setWorktreeOpen(false); return }
    setWorktreeOpen(true)
    void fetchWorktrees(sessionId).then(result => {
      if (result.ok) actions.setWorktrees(result.value)
    })
  }

  // Switch the session's active worktree; the badge then follows it because
  // remote.cwd(agent) prefers activeWorktreeOf(agent.id).
  const onSwitchWorktree = (path: string): void => {
    void switchWorktree(sessionId, path).then(result => {
      if (result.ok) {
        actions.setActiveWorktreePath(result.value.path)
        bumpVersion()
        setWorktreeOpen(false)
        actions.refresh()
      }
    })
  }

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
          ? <CommitList
            commits={commits}
            selectedCommit={selectedCommit}
            collapsed={treeCollapsed}
            onToggleCollapse={() => { actions.toggleTree() }}
            onSelectCommit={actions.selectCommit}
            t={t}
          />
          : <FileTree
            groups={groups}
            selectedPath={selectedPath}
            onSelect={onSelectFile}
            treeTitle={mode === 'repo'
              ? t('mode.repo')
              : t('tree.changedFilesTitle')}
            collapsed={treeCollapsed}
            onToggleCollapse={() => { actions.toggleTree() }}
            t={t}
          />}
      </div>
    )
  })()

  const modeLabel = mode === 'worktree' ? t('mode.worktree') : mode === 'commits' ? t('mode.commits') : t('mode.repo')

  return (
    <div className={css.tabRoot} role="region" aria-label={modeLabel}>
      <div className={css.header}>
        <div className={css.summary}>
          <div className={css.branchRow}>
            <button
              type="button"
              className={css.branchButton}
              aria-expanded={worktreeOpen}
              aria-haspopup="listbox"
              aria-label={t('wt.pickWorktree')}
              title={t('wt.pickWorktree')}
              onClick={onToggleWorktrees}
            >
              <IconBranchOutline16 />
              <span className={css.branchText}>{summary?.branch ?? t('summary.detached')}</span>
              {summary !== null && summary.isMain && summary.branch !== 'main' && <span className={css.mainTag}>main</span>}
              <IconChevronDownOutline14 className={css.branchChevron} />
            </button>
            {activeWorktreePath !== null && directTarget !== null && (
              <button
                type="button"
                className={css.directButton}
                title={t('wt.direct')}
                onClick={() => {
                  void directAgent(sessionId, directTarget.path, directTarget.branch).catch(() => { /* degrade */ })
                }}
              >
                <IconBranchOutline16 />
                {t('wt.direct')}
              </button>
            )}
            {worktreeOpen && (
              <div className={css.worktreePopover} ref={worktreeRef} role="listbox">
                {(worktrees ?? []).length === 0
                  ? <div className={css.worktreeEmpty}>{t('wt.noWorktrees')}</div>
                  : <>{ (worktrees ?? []).map(worktree => {
                    const active = activeWorktreePath === null
                      ? worktree.isMain
                      : worktree.path === activeWorktreePath
                    return (
                      <button
                        key={worktree.path}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`${css.worktreeRow} ${active ? css.worktreeRowActive : ''}`}
                        onClick={() => { onSwitchWorktree(worktree.path) }}
                      >
                        <span className={css.worktreePath}>{worktree.branch ?? worktree.path}</span>
                        <span className={css.worktreeMeta}>
                          {worktree.isMain ? 'main' : ''}
                          {worktree.dirty > 0 ? ` · ${worktree.dirty}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </>}
              </div>
            )}
          </div>
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
          {folderApp !== undefined && worktreePath !== '' && (
            <button type="button" className={css.action} title={t('action.openFolder')} onClick={() => { openExternal(folderApp, worktreePath) }}>
              <IconFolderOpenOutline16 />
            </button>
          )}
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
              {count !== null && <span className={css.switchCount}>{formatCount(count)}</span>}
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
          {mode === 'commits' && selectedCommit !== null ? (
            (() => {
              const commit = commits?.find(candidate => candidate.sha === selectedCommit)
              if (commit === undefined) return <Overview summary={summary} changes={changes} repoMode={false} t={t} />
              return (
                <CommitDetails
                  commit={commit}
                  files={commitFiles ?? []}
                  body={commitBody}
                  selectedPath={selectedPath}
                  diff={diff}
                  content={content}
                  detailView={detailView}
                  hasDiff={selectedSegment === 'commit'}
                  onSelectFile={onSelectFile}
                  onViewChange={actions.setDetailView}
                  onBack={() => { actions.clearSelection() }}
                  copySha={(sha) => copyBranch(sha)}
                  openFolder={folderApp === undefined || worktreePath === ''
                    ? undefined
                    : () => { openExternal(folderApp, worktreePath) }}
                  t={t}
                />
              )
            })()
          ) : selectedPath !== null ? (
            <DetailPane
              path={selectedPath}
              hasDiff={hasDiff}
              untracked={untracked}
              deleted={isDeleted(selectedFile)}
              detailView={detailView}
              diff={diff}
              content={content}
              image={repoImage}
              loading={loading}
              error={error}
              onViewChange={actions.setDetailView}
              onCopy={(text) => copyBranch(text)}
              t={t}
            />
          ) : (
            <Overview summary={summary} changes={changes} repoMode={mode === 'repo'} repoCount={repoFiles?.length ?? 0} t={t} />
          )}
        </div>
      </div>
    </div>
  )
}
