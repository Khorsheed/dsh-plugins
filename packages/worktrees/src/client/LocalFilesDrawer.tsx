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
import { useEffect, useState, type ReactNode } from 'react'
import {
  IconFolderOpenOutline16, IconProjectAddOutline16,
  IconRefreshOutline16, IconCloseOutline16, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ListLocalDirectoryResult } from '../types.ts'
import type { LocalFilesDrawerProps } from './contract.ts'
import { DetailPane } from './DetailPane.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { ImagePreview, isImageFile } from './ImagePreview.tsx'
import { basenameOf } from './language.ts'
import { useDrawerWidth, useTreeWidth } from './Drawer.tsx'
import css from './Drawer.module.css'

/** Default browser width (px) — matches the drawer. */
const DEFAULT_WIDTH = 720
/** Narrowest the drag handle allows. */
const MIN_WIDTH = 420
/** localStorage key for the browser's width preference (distinct from the drawer). */
const WIDTH_KEY = 'dsh-worktrees-local-files-w'
/** localStorage key for the browser's tree-column width. */
const TREE_WIDTH_KEY = 'dsh-worktrees-local-files-tree-w'

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
 * children are lazily fetched). Hidden (dot-prefixed) entries are dropped when
 * `showHidden` is false. */
function toItems(listing: ListLocalDirectoryResult | null, showHidden: boolean): FileTreeItem[] {
  return (listing?.entries ?? [])
    .filter(entry => showHidden || !entry.name.startsWith('.'))
    .map(entry => entry.isDir
      ? { path: entry.name, isDir: true }
      : { path: entry.name, status: '' })
}

/** The local-files browser. */
export function LocalFilesDrawer({
  useStore, actions, t,
  listLocalDirectory, readLocalFile, readLocalImage, pickWorkspace, isLoopback, useHostDescription, openExternal,
}: LocalFilesDrawerProps): ReactNode {
  const open = useStore(s => s.open)
  const root = useStore(s => s.root)
  const listing = useStore(s => s.listing)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const image = useStore(s => s.image)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)
  const canOpenHost = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  const {
    width: drawerWidth,
    onPointerDown: onResizePointerDown,
    onPointerMove: onResizePointerMove,
    onPointerUp: onResizePointerUp,
  } = useDrawerWidth(WIDTH_KEY, DEFAULT_WIDTH, MIN_WIDTH)

  const {
    width: treeWidth,
    onPointerDown: onTreeDown,
    onPointerMove: onTreeMove,
    onPointerUp: onTreeUp,
  } = useTreeWidth(TREE_WIDTH_KEY)

  // Whether hidden (dot-prefixed) entries are shown; default hides them.
  const [hideHidden, setHideHidden] = useState(true)

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
  }, [open, root, rev, listLocalDirectory, actions])

  // Load a sub-directory's first level on demand (FileTree lazy expansion).
  const loadChildren = (dirPath: string): Promise<FileTreeItem[]> => {
    return listLocalDirectory({ path: dirPath }).then(result => {
      return result.ok ? toItems(result.value, !hideHidden) : []
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

  if (!open) return null

  const current = root ?? rememberedRoot() ?? ''

  // Breadcrumb: split the current path into clickable segments. The first
  // segment is the repository/workspace root (basename), the rest are the
  // intermediate dirs; the last one is the current dir (highlighted).
  const currentParts = current.split('/').filter(part => part !== '')
  const crumbs: { label: string; path: string }[] = current === ''
    ? []
    : currentParts.map((part, index) => ({
      label: index === 0 && current.startsWith('/') ? part : part,
      path: current.startsWith('/')
        ? `/${currentParts.slice(0, index + 1).join('/')}`
        : currentParts.slice(0, index + 1).join('/'),
    }))

  const navigate = (path: string): void => {
    actions.setRoot(path)
    rememberRoot(path)
  }

  const groups: FileTreeGroup[] = [{
    key: 'local',
    title: '',
    count: listing?.entries.length ?? 0,
    items: toItems(listing, !hideHidden),
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
        {/* Top bar: breadcrumb path (left) + workspace/open/refresh/close (right). */}
        <div className={`${css.header} ${css.browserHeader}`}>
          <div className={css.browserCrumbs} title={current}>
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
            <button type="button" className={css.browserAction} title={t('local.chooseWorkspace')} onClick={() => { void pickWorkspace().then(path => { if (path !== null) navigate(path) }) }}>
              <IconProjectAddOutline16 />
            </button>
            {canOpenHost && root !== null && (
              <button type="button" className={css.browserAction} title={t('local.openFolder')} onClick={() => { openExternal(root) }}>
                <IconFolderOpenOutline16 />
              </button>
            )}
            <button type="button" className={css.browserAction} title={t('local.refreshFiles')} onClick={() => { if (root !== null) actions.refresh() }}>
              <IconRefreshOutline16 />
            </button>
            <button type="button" className={css.browserAction} title={t('action.close')} onClick={() => { actions.close() }}>
              <IconCloseOutline16 />
            </button>
          </div>
        </div>

        <div className={css.body}>
          <div className={css.treeColumn} style={{ width: treeWidth }}>
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
            onPointerDown={onTreeDown}
            onPointerMove={onTreeMove}
            onPointerUp={onTreeUp}
            onPointerCancel={onTreeUp}
          />
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
                  onCopy={(text) => writeClipboard(text)}
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
