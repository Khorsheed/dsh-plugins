/**
 * The workspace view tab (`conversation.view`): a git-agnostic file browser
 * over the session's workspace. Left file tree (lazy per-level loading) +
 * right detail preview (structured html/markdown/JSON/CSV/image via the shared
 * preview layer). Git-agnostic: browsable dirs are plain local filesystem
 * paths. Per-session memory keeps each session on its own last-browsed root.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  IconFolderOpenOutline16, IconProjectAddOutline16, IconRefreshOutline16, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ListLocalDirectoryResult } from '../types.ts'
import type { WorkspaceViewProps } from './contract.ts'
import { DetailPane } from './DetailPane.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { localRootOf, rememberLocalRoot } from './local-root.ts'
import { basenameOf, dirnameOf } from './language.ts'
import css from './WorkspaceView.module.css'

/** Map a directory listing to FileTree leaves. Hidden (dot-prefixed) entries are
 * dropped when `showHidden` is false. */
function toItems(listing: ListLocalDirectoryResult | null, showHidden: boolean): FileTreeItem[] {
  return (listing?.entries ?? [])
    .filter(entry => showHidden || !entry.name.startsWith('.'))
    .map(entry => entry.isDir
      ? { path: entry.name, isDir: true }
      : { path: entry.name, status: '' })
}

/** The workspace view tab. */
export function WorkspaceView({
  sessionId, useStore, actions, t,
  listDirectory, readFile, pickWorkspace, sessionCwd, isLoopback, useHostDescription, openExternal,
}: WorkspaceViewProps): ReactNode {
  const root = useStore(s => s.root)
  const currentSession = useStore(s => s.sessionId)
  const listing = useStore(s => s.listing)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)
  const canOpenHost = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  // Whether hidden (dot-prefixed) entries are shown; default hides them.
  const [hideHidden, setHideHidden] = useState(true)
  const [treeWidth, setTreeWidth] = useState(300)

  // Bind the view to the session when it changes — restore that session's
  // remembered root, or fall back to the session's workspace cwd.
  useEffect(() => {
    if (sessionId === undefined || currentSession === sessionId) return
    const remembered = localRootOf(sessionId)
    const fallback = sessionCwd(sessionId) ?? ''
    actions.setSession(sessionId, remembered !== '' ? remembered : fallback)
  }, [sessionId, currentSession, actions])

  // Load the root directory's first level whenever the root changes. An empty
  // root means the session has no workspace cwd yet — show the empty state
  // rather than sending the host an invalid path.
  useEffect(() => {
    if (root === null || root === '' || sessionId === undefined) return
    let cancelled = false
    actions.setLoading(true)
    void listDirectory({ path: root }).then(result => {
      if (cancelled) return
      if (result.ok) actions.setListing(result.value)
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [root, rev, sessionId, listDirectory, actions])

  // Load a sub-directory's first level on demand (FileTree lazy expansion).
  const loadChildren = (dirPath: string): Promise<FileTreeItem[]> => {
    return listDirectory({ path: dirPath }).then(result => {
      return result.ok ? toItems(result.value, !hideHidden) : []
    })
  }

  // Preview the selected file: one kind-union read (text/image/binary/...).
  useEffect(() => {
    if (selectedPath === null) return
    let cancelled = false
    actions.setLoading(true)
    void readFile({ path: selectedPath }).then(result => {
      if (cancelled) return
      if (result.ok) actions.setPreview(result.value)
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [selectedPath, readFile, actions])

  const navigate = (path: string): void => {
    actions.setRoot(path)
    if (sessionId !== undefined) rememberLocalRoot(sessionId, path)
  }

  const current = root ?? ''
  const currentParts = current.split('/').filter(part => part !== '')
  const crumbs: { label: string; path: string }[] = current === ''
    ? []
    : currentParts.map((part, index) => ({
      label: part,
      path: current.startsWith('/')
        ? `/${currentParts.slice(0, index + 1).join('/')}`
        : currentParts.slice(0, index + 1).join('/'),
    }))

  const groups: FileTreeGroup[] = [{
    key: 'local',
    title: '',
    count: listing?.entries.length ?? 0,
    items: toItems(listing, !hideHidden),
  }]

  // The tree highlights by its own relative path; the store keeps the selected
  // path absolute (needed to read the file). Strip the current root prefix so
  // the selection matches the rendered row (`selectedPath === node.path`).
  const treeSelectedPath = selectedPath === null || root === null
    ? selectedPath
    : selectedPath === root
      ? null
      : selectedPath.startsWith(`${root}/`)
        ? selectedPath.slice(root.length + 1)
        : selectedPath

  return (
    <div className={css.view} data-conversation-composer-overlay="">
      <div className={css.topbar}>
        <div className={css.crumbs} title={current}>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}/${index}`} className={css.crumbWrap}>
              {index > 0 && <span className={css.crumbSep}>/</span>}
              <button type="button" className={`${css.crumb} ${index === crumbs.length - 1 ? css.crumbCur : ''}`} onClick={() => { navigate(crumb.path) }}>
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        <div className={css.actions}>
          <button type="button" className={css.action} title={t('local.chooseWorkspace')} onClick={() => { void pickWorkspace().then(path => { if (path !== null) navigate(path) }) }}>
            <IconProjectAddOutline16 />
          </button>
          {canOpenHost && root !== null && (
            <button type="button" className={css.action} title={t('local.openFolder')} onClick={() => { openExternal(root) }}>
              <IconFolderOpenOutline16 />
            </button>
          )}
          <button type="button" className={css.action} title={t('local.refreshFiles')} onClick={() => { if (root !== null) actions.refresh() }}>
            <IconRefreshOutline16 />
          </button>
        </div>
      </div>

      <div className={css.body}>
        <div className={css.treeColumn} style={{ width: treeWidth }}>
          {root === null || root === '' ? (
            <div className={css.empty}>{t('tree.noWorkspace')}</div>
          ) : listing === null && error === null ? (
            <div className={css.empty}>{t('state.loading')}</div>
          ) : error !== null ? (
            <div className={css.empty}>{t('state.error', { message: error })}</div>
          ) : (
            <FileTree
              groups={groups}
              selectedPath={treeSelectedPath}
              onSelect={(path: string) => { actions.select(`${root ?? ''}/${path}`) }}
              treeTitle={current === '' ? '' : basenameOf(current)}
              loadChildren={loadChildren}
              rootPath={root ?? ''}
              showHidden={!hideHidden}
              onToggleHidden={() => { setHideHidden(value => !value) }}
              iconActions
              t={t}
            />
          )}
        </div>
        <div
          className={css.treeResize}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('tree.resize')}
          onPointerDown={(event) => {
            const startX = event.clientX
            const startW = treeWidth
            const move = (ev: { clientX: number }) => setTreeWidth(Math.max(220, Math.min(startW + (ev.clientX - startX), 480)))
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
        />
        <div className={css.detailColumn}>
          <DetailPane
            path={selectedPath ?? ''}
            read={preview}
            loading={false}
            error={error}
            displayPath={selectedPath ?? undefined}
            onCopyPath={(p) => writeClipboard(p)}
            canOpenHost={canOpenHost}
            onOpenFolder={(p) => openExternal(dirnameOf(p) || p)}
            onOpenIDE={(p) => openExternal(p)}
            t={t}
          />
        </div>
      </div>
    </div>
  )
}
