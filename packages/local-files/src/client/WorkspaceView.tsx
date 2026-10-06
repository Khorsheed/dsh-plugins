/**
 * The file-list view (the right-Sidebar `files` tab's body): a git-agnostic
 * file browser defaulting to the session's workspace. Left file tree (lazy
 * per-level loading) + right detail preview (structured html/markdown/JSON/
 * CSV/image via the shared preview layer). Git-agnostic: browsable dirs are
 * plain local filesystem paths. Per-session memory keeps each session on its
 * own last-browsed root.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

import { IconFolderOpenOutlineMedium, IconProjectAddOutlineMedium, IconRefreshOutlineMedium, IconSearchOutlineMedium, type IconProps } from './icons.tsx'
import type { ListLocalDirectoryResult, SearchLocalDirectoryResult } from '../types.ts'
import {
  ContentPane, basenameOf, dirnameOf, pickFileManager, pickIde,
} from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import { AdaptiveSplit, PanelHeader, PanelRoot, browserOnHost, type PanelAction } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type { WorkspaceViewProps } from './contract.ts'
import { EyeGlyph, FileTree, type FileTreeGroup, type FileTreeItem } from './FileTree.tsx'
import { localRootOf, rememberLocalRoot } from './local-root.ts'
import { previewTranslator, structuredLabels, toPreviewRead } from './preview.ts'
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
 * set has no undo / home / return glyph, and IconFolderCloseMedium read as
 * "closed folder", not "go back". Sized on the official 16px grid: the folder
 * footprint (x 1.7–14.3, y 2.6–13.4) matches the official folder glyphs'
 * near-full-bleed outline, stroke 1.4 to their filled-ring weight.
 */
function IconFolderReturnMedium({ size = 16, className }: IconProps) {
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

/**
 * The breadcrumb segments of a folder. With `home`, a macOS/Linux home prefix
 * folds into one `~` segment that still navigates to the home folder — the
 * compact header's trail, where `Users / name` would spend the row on noise.
 * @param path - an absolute (or root-relative) directory path.
 * @param home - fold the home prefix into `~`.
 * @returns one `{ label, path }` per segment, the last being `path` itself.
 */
export function crumbsOf(path: string, home = false): { label: string; path: string }[] {
  if (path === '') return []
  const parts = path.split('/').filter(part => part !== '')
  const crumbs = parts.map((part, index) => ({
    label: part,
    path: path.startsWith('/') ? `/${parts.slice(0, index + 1).join('/')}` : parts.slice(0, index + 1).join('/'),
  }))
  const homeMatch = home ? /^\/(?:Users|home)\/[^/]+(?=\/|$)/.exec(path) : null
  return homeMatch ? [{ label: '~', path: homeMatch[0] }, ...crumbs.slice(2)] : crumbs
}

/** The workspace view tab. */
export function WorkspaceView({
  sessionId, useStore, useSessions, actions, t,
  listDirectory, readFile, searchFiles, pickWorkspace, useOpenInApps, openFolder, openIDE,
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
  // Off-host (a phone through the tunnel, say) every host-launching gesture
  // would fire on a machine the viewer is not at: the open-in-app probe
  // already publishes no apps there, and the native directory picker would
  // open its dialog on the host's screen — gate all of them here as well.
  const onHost = browserOnHost()
  const canOpenFolder = onHost && openInApps !== null && pickFileManager(openInApps) !== undefined
  const canOpenIDE = onHost && openInApps !== null && pickIde(openInApps) !== undefined

  // Whether hidden (dot-prefixed) entries are shown; default hides them.
  const [hideHidden, setHideHidden] = useState(true)
  const [treeWidth, setTreeWidth] = useState(300)
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => { setDetailOpen(false) }, [sessionId, root])
  // Stable: the split memoizes its back context on this identity.
  const closeDetail = useCallback(() => { setDetailOpen(false) }, [])

  // Filename search: the view owns the query and the last answer; the tree
  // renders the chrome. A root/session switch drops any in-flight search.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchLocalDirectoryResult | null>(null)
  const searchSeq = useRef(0)
  const searchActive = searchOpen && searchQuery.trim() !== ''
  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResult(null)
  }, [sessionId, root])

  // Debounced name search over the current root. The seq guard drops answers
  // that land after the query moved on; rev/hideHidden re-run an open search
  // (refresh, or the hidden toggle changing what may match).
  useEffect(() => {
    if (!searchActive || root === null || root === '') {
      setSearchResult(null)
      return
    }
    const seq = ++searchSeq.current
    const timer = window.setTimeout(() => {
      void searchFiles({ path: root, query: searchQuery.trim(), includeHidden: !hideHidden }).then(result => {
        if (searchSeq.current !== seq) return
        setSearchResult(result.ok ? result.value : null)
      })
    }, 200)
    return () => { window.clearTimeout(timer) }
  }, [searchActive, searchQuery, root, hideHidden, rev, searchFiles])

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

  // The pane's reload gesture re-reads the selected file through the same
  // Remote. Unlike a fresh selection the old read is NOT cleared first — the
  // panel keeps showing it while the re-read is in flight, and a failure keeps
  // it too, reporting through the shared error slot like any other failed
  // read. An answer that lands after the selection moved is dropped.
  const selectedPathRef = useRef(selectedPath)
  selectedPathRef.current = selectedPath
  const reloadPreview = (): Promise<void> => {
    const path = selectedPath
    if (path === null) return Promise.resolve()
    return readFile({ path }).then(result => {
      if (selectedPathRef.current !== path) return
      if (result.ok) actions.setPreview(result.value)
      else actions.setError(result.error.message)
    })
  }

  const navigate = (path: string): void => {
    actions.setRoot(path)
    if (sessionId !== undefined) rememberLocalRoot(sessionId, path)
  }

  const current = root ?? ''

  // Memoized: FileTree seeds search-mode expansion off the groups' identity,
  // so an unmemoized array literal would re-seed (clobbering the user's
  // folds) on every unrelated render.
  const groups: FileTreeGroup[] = useMemo(() => searchActive
    ? [{
      key: 'search',
      title: '',
      count: searchResult?.entries.length ?? 0,
      // Hits arrive root-relative and pre-joined with '/' — the trie rebuilds
      // the ancestor chain, and nameMatch drives which rows start open.
      items: (searchResult?.entries ?? []).map(entry => entry.isDir
        ? { path: entry.path, isDir: true, nameMatch: entry.nameMatch }
        : { path: entry.path, status: '', nameMatch: entry.nameMatch }),
    }]
    : [{
      key: 'local',
      title: '',
      count: listing?.entries.length ?? 0,
      items: toItems(listing, !hideHidden),
    }], [searchActive, searchResult, listing, hideHidden])

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

  const canReturn = workspaceRoot !== undefined && workspaceRoot !== '' && root !== null && root !== workspaceRoot
  const chooseWorkspace = (): void => { void pickWorkspace().then(path => { if (path !== null) navigate(path) }) }
  const toggleSearch = (): void => {
    setSearchOpen(value => !value)
    setSearchQuery('')
    setSearchResult(null)
  }
  // The workspace gestures, shared by both header shapes.
  const workspaceActions: PanelAction[] = [
    ...(onHost ? [{ id: 'choose', label: t('local.chooseWorkspace'), icon: <IconProjectAddOutlineMedium />, onSelect: chooseWorkspace }] : []),
    ...(canReturn ? [{ id: 'return', label: t('local.backToWorkspace'), icon: <IconFolderReturnMedium />, onSelect: () => { navigate(workspaceRoot) } }] : []),
    ...(canOpenFolder && root !== null ? [{ id: 'folder', label: t('local.openFolder'), icon: <IconFolderOpenOutlineMedium />, onSelect: () => { openFolder(root) } }] : []),
    { id: 'refresh', label: t('local.refreshFiles'), icon: <IconRefreshOutlineMedium />, onSelect: () => { if (root !== null) actions.refresh() } },
  ]
  // Compact: one header for the whole list — a tappable trail (home folded to
  // `~`) climbs to any ancestor, search inline, everything else (the tree
  // header's hidden-files toggle included) in ⋯; the workspace actions keep
  // their wide order. Off-host the host-only gestures are gone, leaving
  // search, refresh and the hidden-files toggle: all three are pinned so no ⋯
  // holds them (an occasional "back to workspace" is the only menu row left).
  const hiddenToggle: PanelAction = { id: 'hidden', label: hideHidden ? t('local.showHiddenFiles') : t('local.hideHiddenFiles'), icon: <EyeGlyph open={!hideHidden} />, onSelect: () => { setHideHidden(value => !value) } }
  const compactActions: PanelAction[] = [
    ...(root !== null && root !== '' ? [{ id: 'search', label: searchOpen ? t('tree.closeSearch') : t('tree.search'), icon: <IconSearchOutlineMedium />, pinned: true, pressed: searchOpen, onSelect: toggleSearch }] : []),
    ...(onHost ? workspaceActions : workspaceActions.map(action => action.id === 'refresh' ? { ...action, pinned: true } : action)),
    onHost ? hiddenToggle : { ...hiddenToggle, pinned: true },
  ]
  // A trail wider than the compact header scrolls; keep "where you are" (its
  // end) in view whenever the folder changes.
  const trailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const trail = trailRef.current
    if (trail) trail.scrollLeft = trail.scrollWidth
  }, [current])
  const crumbTrail = (compact: boolean) => {
    const crumbs = crumbsOf(current, compact)
    return <div ref={compact ? trailRef : undefined} className={compact ? `${css.crumbs} ${css.crumbsCompact}` : css.crumbs} title={current}>
      {crumbs.map((crumb, index) => (
        <span key={crumb.path} className={css.crumbWrap}>
          {index > 0 && <span className={css.crumbSep}>/</span>}
          {index === crumbs.length - 1 ? (
            // The current segment is where you ARE — a span, not a button:
            // no hover/focus state may paint a pill behind it; the current
            // position reads through weight and color only.
            <span className={css.crumbCur}>{crumb.label}</span>
          ) : (
            <button type="button" className={css.crumb} onClick={() => { navigate(crumb.path) }}>
              {crumb.label}
            </button>
          )}
        </span>
      ))}
    </div>
  }

  return (
    <PanelRoot className={css.view}>{compact => <>
      {compact
        // A compact panel showing a file spends no row on the list's header:
        // the preview's own title bar carries the back control.
        ? !detailOpen && (
          <PanelHeader
            className={css.topbar}
            title={current === '' ? t('local.noRoot') : crumbTrail(true)}
            actions={compactActions}
            moreLabel={t('action.more')}
          />
        )
        : <PanelHeader className={css.topbar} title={crumbTrail(false)} actions={workspaceActions} moreLabel={t('action.more')} />}

      <AdaptiveSplit backInDetail masterWidth={treeWidth} detailOpen={detailOpen} onBack={closeDetail} backLabel={t('detail.back')}
        master={<>
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
              onSelect={(path: string) => { actions.select(`${root ?? ''}/${path}`); setDetailOpen(true) }}
              treeTitle={current === '' ? '' : basenameOf(current)}
              loadChildren={loadChildren}
              rootPath={root ?? ''}
              showHidden={!hideHidden}
              onToggleHidden={() => { setHideHidden(value => !value) }}
              iconActions
              headerless={compact}
              searchOpen={searchOpen}
              onToggleSearch={toggleSearch}
              searchQuery={searchQuery}
              onSearchQuery={setSearchQuery}
              searching={searchActive && searchResult === null}
              searchTruncated={searchActive && searchResult?.truncated === true}
              t={t}
            />
          )}
        </>}
        divider={<div
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
        />}
        detail={
          <ContentPane
            path={selectedPath ?? ''}
            sessionId={currentSession}
            read={toPreviewRead(preview)}
            loading={selectedPath !== null && preview === null && error === null}
            error={error}
            displayPath={selectedPath ?? undefined}
            // The open route accepts directories only, so both gestures receive
            // the selected file's parent directory.
            {...(selectedPath === null
              ? {}
              : {
                onCopyPath: () => writeClipboard(selectedPath),
                onReload: reloadPreview,
                chrome: {
                  ...(canOpenFolder ? { openFolder: () => { openFolder(dirnameOf(selectedPath) || selectedPath) } } : {}),
                  ...(canOpenIDE ? { openIDE: () => { openIDE(dirnameOf(selectedPath) || selectedPath) } } : {}),
                },
              })}
            labels={structuredLabels(t)}
            t={previewTranslator(t)}
          />
        }
      />
    </>}</PanelRoot>
  )
}
