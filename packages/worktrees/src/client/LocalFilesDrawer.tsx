/**
 * The local-files browser (`shell.overlay`): an INDEPENDENT surface from the
 * worktrees drawer, but reusing the drawer's skeleton (overlay / aside /
 * left-tree + right-preview columns), the FileTree (lazy per-level loading),
 * and the DetailPane (content preview) — the same design tokens and same
 * code, not a parallel style. The root directory is selected in the top bar
 * (workspace switcher + native directory picker); the tree shows that root's
 * contents (dir and file rows expand/collapse like the repository tree).
 * Git-agnostic: browsable dirs are plain local filesystem paths. State is
 * session-scoped (bound to the calling session).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconFolderOpen16, IconFolderOpenOutline16,
  IconRefreshOutline16, IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ListLocalDirectoryResult } from '../types.ts'
import type { LocalFilesDrawerProps } from './contract.ts'
import { DetailPane } from './DetailPane.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { ImagePreview, isImageFile } from './ImagePreview.tsx'
import { useDrawerWidth } from './Drawer.tsx'
import css from './Drawer.module.css'

/** Default browser width (px) — matches the drawer. */
const DEFAULT_WIDTH = 720
/** Narrowest the drag handle allows. */
const MIN_WIDTH = 420
/** localStorage key for the browser's width preference (distinct from the drawer). */
const WIDTH_KEY = 'dsh-worktrees-local-files-w'

/** localStorage key for the remembered last directory. */
const ROOT_KEY = 'dsh-worktrees-local-files-root'

/** Read the remembered last directory ('' when unset/unreadable). */
function rememberedRoot(): string {
  try { return localStorage.getItem(ROOT_KEY) ?? '' } catch { return '' }
}

/** Persist the last directory (best-effort). */
function rememberRoot(path: string): void {
  try { localStorage.setItem(ROOT_KEY, path) } catch { /* non-fatal */ }
}

/** Map a directory listing to FileTree leaves (an entry's name is a one-segment
 * path; a dir keeps `isDir` so the tree renders it expandable while its
 * children are lazily fetched). */
function toItems(listing: ListLocalDirectoryResult | null): FileTreeItem[] {
  return (listing?.entries ?? []).map(entry => entry.isDir
    ? { path: entry.name, isDir: true }
    : { path: entry.name, status: '' })
}

/** The local-files browser. */
export function LocalFilesDrawer({
  useStore, actions, t,
  listLocalDirectory, readLocalFile, readLocalImage, listWorkspaces, pickWorkspace, isLoopback, useHostDescription, openExternal,
}: LocalFilesDrawerProps): ReactNode {
  const open = useStore(s => s.open)
  const root = useStore(s => s.root)
  const listing = useStore(s => s.listing)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const image = useStore(s => s.image)
  const error = useStore(s => s.error)
  const canOpenHost = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  const {
    width: drawerWidth,
    onPointerDown: onResizePointerDown,
    onPointerMove: onResizePointerMove,
    onPointerUp: onResizePointerUp,
  } = useDrawerWidth(WIDTH_KEY, DEFAULT_WIDTH, MIN_WIDTH)

  const [wsOpen, setWsOpen] = useState(false)
  const wsRef = useRef<HTMLDivElement | null>(null)
  const workspaces = useMemo(() => listWorkspaces(), [listWorkspaces])

  // Load the root directory's first level whenever the root changes.
  useEffect(() => {
    if (!open || root === null) return
    let cancelled = false
    actions.setLoading(true)
    void listLocalDirectory({ path: root }).then(result => {
      if (cancelled) return
      if (result.ok) actions.setListing(result.value)
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [open, root, listLocalDirectory, actions])

  // Load a sub-directory's first level on demand (FileTree lazy expansion).
  const loadChildren = (dirPath: string): Promise<FileTreeItem[]> => {
    return listLocalDirectory({ path: dirPath }).then(result => {
      return result.ok ? toItems(result.value) : []
    })
  }

  // Preview the selected file: images via readLocalImage, text via readLocalFile.
  useEffect(() => {
    if (!open || selectedPath === null) return
    let cancelled = false
    actions.setLoading(true)
    if (isImageFile(selectedPath)) {
      void readLocalImage({ path: selectedPath }).then(result => {
        if (cancelled) return
        if (result.ok) actions.setImage(result.value)
        else actions.setError(result.error.message)
      })
    } else {
      void readLocalFile({ path: selectedPath }).then(result => {
        if (cancelled) return
        if (result.ok) actions.setPreview(result.value)
        else actions.setError(result.error.message)
      })
    }
    return () => { cancelled = true }
  }, [open, selectedPath, readLocalImage, readLocalFile, actions])

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') actions.close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, actions])

  // Close the workspace switcher on an outside mousedown.
  useEffect(() => {
    if (!wsOpen) return
    const onDown = (event: MouseEvent): void => {
      if (wsRef.current !== null && !wsRef.current.contains(event.target as Node)) setWsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [wsOpen])

  if (!open) return null

  const current = root ?? rememberedRoot() ?? ''

  const navigate = (path: string): void => {
    actions.setRoot(path)
    rememberRoot(path)
  }

  const groups: FileTreeGroup[] = [{
    key: 'local',
    title: '',
    count: listing?.entries.length ?? 0,
    items: toItems(listing),
  }]

  return (
    <div className={css.overlay}>
      <aside className={css.drawer} style={{ width: drawerWidth }} role="dialog" aria-label={t('local.browse')}>
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
        {/* Top bar: workspace switcher + directory picker + current path. */}
        <div className={css.header}>
          <div className={css.summary}>
            <div className={css.branchRow}>
              <div className={css.wsWrap} ref={wsRef}>
                <button type="button" className={css.directButton} title={t('local.workspace')} onClick={() => { setWsOpen(v => !v) }}>
                  <IconFolderOpen16 />
                  <span>{t('local.workspace')}</span>
                  <IconChevronDownOutline14 className={css.branchChevron} />
                </button>
                {wsOpen && (
                  <div className={css.worktreePopover} role="listbox">
                    {workspaces.length === 0
                      ? <div className={css.worktreeEmpty}>{t('local.noWorkspaces')}</div>
                      : workspaces.map(workspace => (
                        <button
                          key={workspace.id}
                          type="button"
                          role="option"
                          className={css.worktreeRow}
                          onClick={() => { navigate(workspace.path); setWsOpen(false) }}
                        >
                          <span className={css.worktreePath}>{workspace.title}</span>
                          <span className={css.worktreeMeta}>{workspace.path}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              <button type="button" className={css.directButton} title={t('local.pickFolder')} onClick={() => { void pickWorkspace().then(path => { if (path !== null) navigate(path) }) }}>
                {t('local.pickFolder')}
              </button>
              <span className={css.summaryMeta} title={current}>{current || t('local.noRoot')}</span>
            </div>
          </div>
          <div className={css.actions}>
            {canOpenHost && selectedPath !== null && (
              <button type="button" className={css.action} title={t('local.openFolder')} onClick={() => { openExternal(selectedPath) }}>
                <IconFolderOpenOutline16 />
              </button>
            )}
            <button type="button" className={css.action} title={t('action.refresh')} onClick={() => { if (root !== null) actions.setRoot(root) }}>
              <IconRefreshOutline16 />
            </button>
            <button type="button" className={css.action} title={t('action.close')} onClick={() => { actions.close() }}>
              <IconCloseOutline16 />
            </button>
          </div>
        </div>

        <div className={css.body}>
          <div className={css.treeColumn}>
            {listing === null && error === null ? (
              <div className={css.treeEmpty}>{t('state.loading')}</div>
            ) : error !== null ? (
              <div className={css.treeEmpty}>{t('state.error', { message: error })}</div>
            ) : (
              <FileTree
                groups={groups}
                selectedPath={selectedPath}
                onSelect={(path: string) => {
                  // A selected file uses its absolute path; prefix the root.
                  actions.select(`${root ?? ''}/${path}`)
                }}
                treeTitle={current}
                loadChildren={loadChildren}
                rootPath={root ?? ''}
                t={t}
              />
            )}
          </div>
          <div className={css.detailColumn}>
            {image !== null && selectedPath !== null
              ? <ImagePreview path={selectedPath} src={image.dataUrl} />
              : (
                <DetailPane
                  path={selectedPath ?? ''}
                  hasDiff={false}
                  untracked={false}
                  deleted={false}
                  detailView="content"
                  diff={null}
                  content={preview === null ? null : { content: preview.content ?? '' }}
                  loading={false}
                  error={error}
                  onViewChange={() => { /* content-only */ }}
                  embedded={false}
                  t={t}
                />
              )}
          </div>
        </div>
      </aside>
    </div>
  )
}
