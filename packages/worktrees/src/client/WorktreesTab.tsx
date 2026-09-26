/**
 * The worktrees right-Sidebar tab body (`sidebar.right.pane.tab` under this
 * package's type id): the session's page behind the badge. The header holds
 * the worktree summary and the git action row (refresh, copy branch, show in
 * folder — the host gesture gated on the official open-in-app probe); a mode
 * switcher offers 工作树待提交 / 仓库提交记录 / 仓库文件; the body is a left
 * list-or-tree column and the right detail pane (diff | content). Selecting a
 * file collapses the left tree to a narrow icon rail; clicking the rail
 * restores it.
 *
 * The 工作树待提交 mode lists the CURRENTLY SELECTED worktree's full
 * uncommitted set (worktree dimension, no session scoping — the user call:
 * session-level commit records have no reliable interface). Switching the
 * header's worktree selector re-points the session's active worktree and
 * refreshes, so the list follows the selected worktree.
 *
 * Geometry — width, docking, fullscreen, close — is the right Sidebar's own;
 * this body draws only the page. Open/re-open arrives as navigation params
 * (`{ mode }`), applied on every navigation revision so a repeat badge click
 * re-asserts the requested mode.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconBranchOutlineMedium, IconChevronDownOutlineMedium, IconCopyOutlineMedium, IconFolderOpenOutlineMedium, IconPanelLeftOutlineMedium, IconRefreshOutlineMedium } from './icons.tsx'
import type { ChangedFile, FileDiffRequest, WorktreeInfo } from '../types.ts'
import type { WorktreesTabProps } from './contract.ts'
import type { WorktreesTabParams } from './definition.tsx'
import {
  ContentPane, dirnameOf, pickFileManager, pickIde,
} from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type { PreviewChrome } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import { CommitDetails } from './CommitDetails.tsx'
import { CommitList } from './CommitList.tsx'
import { DiffView } from './DiffView.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { ImagePreview, isImageFile } from './ImagePreview.tsx'
import { Overview, formatCount } from './Overview.tsx'
import {
  absolutePath, isDeleted, previewTranslator, structuredLabels, toPreviewRead,
} from './preview.ts'
import { useTreeWidth } from './sizing.ts'
import css from './WorktreesTab.module.css'

/** localStorage key for the tab's tree-column width preference. */
const TREE_WIDTH_KEY = 'dsh-worktrees-tree-w'

/** The worktrees tab body. */
export function WorktreesTab({
  sessionId, useTabInfo, useStore, actions, t,
  fetchSummary, fetchChanges, fetchRepoFiles, fetchCommitLog, fetchCommitFiles,
  fetchWorktrees, switchWorktree, directAgent, bumpVersion,
  fetchFileDiff, fetchReadFile, fetchReadFileAtCommit, fetchReadRepoImage, useOpenInApp, openExternal,
  copyBranch, copyText,
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
  const ideApp = openInAppApps === null ? undefined : pickIde(openInAppApps)

  /**
   * One file's host-open gestures. The host route takes directories, so both
   * gestures target the file's parent directory; each is present only when the
   * probe resolved a backing app, so the pane never renders a dead button.
   */
  const paneChrome = (path: string): PreviewChrome => {
    const absolute = absolutePath(worktreePath, path)
    const dir = dirnameOf(absolute) || absolute
    return {
      ...(folderApp === undefined ? {} : { openFolder: () => { openExternal(folderApp, dir) } }),
      ...(ideApp === undefined ? {} : { openIDE: () => { openExternal(ideApp, dir) } }),
    }
  }

  // Any tab-side refresh invalidates the header badge too, so the capsule never
  // lags the pane. `rev` ticks on the refresh button, a mode switch, a worktree
  // switch and every navigation revision; bumpVersion is held in a ref because
  // the injected face hands out a fresh closure per render and this effect must
  // not depend on its identity.
  const bumpVersionRef = useRef(bumpVersion)
  bumpVersionRef.current = bumpVersion
  useEffect(() => { bumpVersionRef.current() }, [rev])

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
  // page re-asserts the requested mode. Applied ONCE per revision: keying the
  // effect off the mode as well would re-fire after the user's own mode
  // switch and snap the tab back to the navigated mode (the 6aae716
  // regression).
  const revision = tab.navigation.revision
  const navMode = (tab.navigation.params as WorktreesTabParams | undefined)?.mode
  const lastNavRevision = useRef(0)
  useEffect(() => {
    if (revision === 0 || revision === lastNavRevision.current) return
    lastNavRevision.current = revision
    if (navMode !== undefined && navMode !== mode) actions.setMode(navMode)
  }, [revision, navMode, mode, actions])

  // 工作树待提交: the selected worktree's full uncommitted set (the Remote
  // computes it against the session's active worktree; the switcher repoints
  // and refreshes, so this follows the selected worktree).
  const pending: readonly ChangedFile[] = changes?.uncommitted ?? []

  // Resolve the selected file's metadata for the detail pane.
  const selectedFile: ChangedFile | undefined = useMemo(() => {
    if (selectedPath === null) return undefined
    if (mode === 'worktree') {
      return pending.find(file => file.path === selectedPath)
    }
    if (mode === 'commits') {
      return commitFiles?.find(file => file.path === selectedPath)
    }
    return undefined
  }, [mode, selectedPath, pending, commitFiles])

  const untracked = selectedFile?.status === '??'

  const groups = useMemo<FileTreeGroup[]>(() => {
    if (mode === 'worktree') {
      // One group — the selected worktree's pending (uncommitted) changes.
      const items = pending.map(file => ({
        path: file.path, status: file.status, additions: file.additions, deletions: file.deletions,
      }))
      return [{ key: 'pending', title: '', count: items.length, items }]
    }
    if (mode === 'repo') {
      const items: FileTreeItem[] = (repoFiles ?? []).map(path => ({ path, status: '' }))
      return [{ key: 'repo', title: '', count: items.length, items }]
    }
    return []
  }, [mode, pending, repoFiles, t])

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

  // Selected file detail (diff / content), shared by the selection effect and
  // the pane's reload gesture. `dropped` is the caller's staleness guard; the
  // detail key guards a reload answer landing after the selection moved on. A
  // reload deliberately does NOT clear the old read first: the panel keeps
  // showing it in flight, and a failed re-read keeps it in state, reporting
  // through the shared error slot like any other failed read.
  const detailKeyRef = useRef('')
  detailKeyRef.current = `${selectedPath ?? ''} ${selectedSegment ?? ''} ${detailView} ${selectedCommit ?? ''}`
  const fetchDetail = (dropped: () => boolean): Promise<void> => {
    if (selectedPath === null) return Promise.resolve()
    const key = detailKeyRef.current
    const stale = (): boolean => dropped() || tab.signal.aborted || detailKeyRef.current !== key
    if (detailView === 'diff' && selectedSegment !== null) {
      const request: FileDiffRequest = selectedSegment === 'commit'
        ? { path: selectedPath, segment: 'commit', commit: selectedCommit ?? '' }
        : { path: selectedPath, segment: selectedSegment }
      return fetchFileDiff(sessionId, request).then(result => {
        if (!stale() && result.ok) actions.setDiff(result.value)
      })
    }
    if (detailView !== 'content') return Promise.resolve()
    // The commits mode's content view reads the file as it was at the selected
    // commit; the other segments read the working-tree content. An image
    // (non-commit segment) is read as an inline image instead of text, so it
    // renders rather than showing garbage.
    if (selectedSegment !== 'commit' && isImageFile(selectedPath)) {
      return fetchReadRepoImage(sessionId, { path: selectedPath }).then(result => {
        if (stale()) return
        if (result.ok) { actions.setRepoImage(result.value); actions.setError(null) }
        else actions.setError(result.error.message)
      })
    }
    const fetch = selectedSegment === 'commit'
      ? fetchReadFileAtCommit(sessionId, { path: selectedPath, commit: selectedCommit ?? '' })
      : fetchReadFile(sessionId, { path: selectedPath })
    return fetch.then(result => {
      if (stale()) return
      if (result.ok) { actions.setContent(result.value); actions.setError(null) }
      else actions.setError(result.error.message)
    })
  }

  // Selected file detail (diff / content).
  useEffect(() => {
    if (selectedPath === null) return
    let cancelled = false
    void fetchDetail(() => cancelled)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchDetail is the same closure over exactly these values
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
    worktree: changes === null ? null : pending.length,
    commits: commits === null ? null : commits.length,
    repo: repoFiles === null ? null : repoFiles.length,
  }), [changes, pending, commits, repoFiles])

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
    const untracked = pending.find(file => file.path === path)?.status === '??'
    if (mode === 'worktree') {
      if (pending.some(file => file.path === path)) segment = 'uncommitted'
    } else if (mode === 'commits') {
      segment = 'commit'
    } else if (pending.some(file => file.path === path)) {
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
        setWorktreeOpen(false)
        // The refresh ticks `rev`, whose effect pushes the version bump to the
        // badge — no separate bump here (a double bump would double the read).
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
            <IconPanelLeftOutlineMedium />
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
              <IconBranchOutlineMedium />
              <span className={css.branchText}>{summary?.branch ?? t('summary.detached')}</span>
              {summary !== null && summary.isMain && summary.branch !== 'main' && <span className={css.mainTag}>main</span>}
              <IconChevronDownOutlineMedium className={css.branchChevron} />
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
                <IconBranchOutlineMedium />
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
            <IconRefreshOutlineMedium />
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
            <IconCopyOutlineMedium />
            {copied && <span className={css.copied}>{t('action.copyBranch')}</span>}
          </button>
          {folderApp !== undefined && worktreePath !== '' && (
            <button type="button" className={css.action} title={t('action.openFolder')} onClick={() => { openExternal(folderApp, worktreePath) }}>
              <IconFolderOpenOutlineMedium />
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
              if (commit === undefined) return <Overview summary={summary} changes={changes === null ? null : { uncommitted: pending, committed: [] }} repoMode={false} t={t} />
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
                  repoRoot={worktreePath}
                  paneChrome={paneChrome}
                  labels={structuredLabels(t)}
                  t={t}
                />
              )
            })()
          ) : selectedPath !== null ? (
            <ContentPane
              path={selectedPath}
              read={toPreviewRead({
                path: selectedPath,
                deleted: isDeleted(selectedFile),
                untracked,
                error,
                content,
                image: repoImage,
              })}
              loading={loading}
              error={error}
              displayPath={absolutePath(worktreePath, selectedPath)}
              onCopyPath={() => copyText(absolutePath(worktreePath, selectedPath))}
              onReload={() => fetchDetail(() => false)}
              chrome={paneChrome(selectedPath)}
              labels={structuredLabels(t)}
              t={previewTranslator(t)}
              {...(diff === null ? {} : { diffView: <DiffView diff={diff.diff} t={t} /> })}
              view={detailView}
              onViewChange={actions.setDetailView}
              {...(repoImage === null || repoImage === undefined
                ? {}
                : { imageView: <ImagePreview path={selectedPath} src={repoImage.dataUrl} /> })}
              {...(untracked ? { notice: t('detail.untrackedNote') } : {})}
            />
          ) : (
            <Overview summary={summary} changes={changes === null ? null : { uncommitted: pending, committed: [] }} repoMode={mode === 'repo'} repoCount={repoFiles?.length ?? 0} t={t} />
          )}
        </div>
      </div>
    </div>
  )
}
