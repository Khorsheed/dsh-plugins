/**
 * The file-list view (the right-Sidebar `files` tab's body): a git-agnostic
 * file browser defaulting to the session's workspace. Left file tree (lazy
 * per-level loading) + right detail preview (structured html/markdown/JSON/
 * CSV/image via the shared preview layer). Git-agnostic: browsable dirs are
 * plain local filesystem paths. Per-session memory keeps each session on its
 * own last-browsed root.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  IconFolderOpenOutline16, IconProjectAddOutline16, IconRefreshOutline16, writeClipboard,
  type IconProps,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ListLocalDirectoryResult } from '../types.ts'
import type { WorkspaceViewProps } from './contract.ts'
import { DetailPane } from './DetailPane.tsx'
import { FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { localRootOf, rememberLocalRoot } from './local-root.ts'
import { basenameOf, dirnameOf } from './language.ts'
import { pickFileManager, pickIde } from './open-in-app.ts'
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

/**
 * The back-to-original-workspace glyph: a closed folder with a return arrow.
 * Self-drawn (the BranchGlyph / ProductsGlyph precedent) — the official icon
 * set has no undo / home / return glyph, and IconFolderClose16 read as
 * "closed folder", not "go back". Sized on the official 16px grid: the folder
 * footprint (x 1.7–14.3, y 2.6–13.4) matches the official folder glyphs'
 * near-full-bleed outline, stroke 1.4 to their filled-ring weight.
 */
function IconFolderReturn16({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.7 3.8a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1 .5l1.1 1.3h6.7a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H2.9a1.2 1.2 0 0 1-1.2-1.2V3.8z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M11.6 6.9v2.1a1.6 1.6 0 0 1-1.6 1.6H7.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M8.7 9.3 7.2 10.6l1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The workspace view tab. */
export function WorkspaceView({
  sessionId, useStore, useSessions, actions, t,
  listDirectory, readFile, pickWorkspace, useOpenInApps, openFolder, openIDE,
}: WorkspaceViewProps): ReactNode {
  const root = useStore(s => s.root)
  const currentSession = useStore(s => s.sessionId)
  const listing = useStore(s => s.listing)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)
  // The session's workspace root, reactively (the same read the official
  // sidebar files tree makes); undefined until the session row loads.
  const workspaceRoot = useSessions(sessions =>
    sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd)
  // The open-in-app probe publishes null until the host answered; both
  // gestures hide until their catalog id resolved (and on hosts without
  // open-in-app, forever).
  const openInApps = useOpenInApps(apps => apps)
  const canOpenFolder = openInApps !== null && pickFileManager(openInApps) !== undefined
  const canOpenIDE = openInApps !== null && pickIde(openInApps) !== undefined

  // Whether hidden (dot-prefixed) entries are shown; default hides them.
  const [hideHidden, setHideHidden] = useState(true)
  const [treeWidth, setTreeWidth] = useState(300)

  // Bind the view to the session: a remembered root (the operator's manual
  // choice) always wins; otherwise the session's workspace root is the
  // default. The workspace row can load after the first render, so a root
  // that locked in empty fills in when the row arrives — never overwriting a
  // remembered or manually chosen root.
  useEffect(() => {
    if (sessionId === undefined) return
    if (currentSession !== sessionId) {
      const remembered = localRootOf(sessionId)
      actions.setSession(sessionId, remembered !== '' ? remembered : (workspaceRoot ?? ''))
      return
    }
    if ((root ?? '') === '' && localRootOf(sessionId) === '' && workspaceRoot !== undefined && workspaceRoot !== '') {
      actions.setRoot(workspaceRoot)
    }
  }, [sessionId, currentSession, root, workspaceRoot, actions])

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
    <div className={css.view}>
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
          {workspaceRoot !== undefined && workspaceRoot !== '' && root !== null && root !== workspaceRoot && (
            <button type="button" className={css.action} title={t('local.backToWorkspace')} onClick={() => { navigate(workspaceRoot) }}>
              <IconFolderReturn16 />
            </button>
          )}
          {canOpenFolder && root !== null && (
            <button type="button" className={css.action} title={t('local.openFolder')} onClick={() => { openFolder(root) }}>
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
            sessionId={currentSession}
            read={preview}
            loading={false}
            error={error}
            displayPath={selectedPath ?? undefined}
            onCopyPath={(p) => writeClipboard(p)}
            canOpenHost={canOpenFolder || canOpenIDE}
            // The open route accepts directories only, so both file gestures
            // open the selected file's parent directory.
            onOpenFolder={canOpenFolder ? (p) => openFolder(dirnameOf(p) || p) : undefined}
            onOpenIDE={canOpenIDE ? (p) => openIDE(dirnameOf(p) || p) : undefined}
            t={t}
          />
        </div>
      </div>
    </div>
  )
}
