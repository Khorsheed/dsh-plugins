/**
 * The file-preview right-Sidebar tab body: the session's touched files as a
 * full-height list, navigating IN-TAB to a detail view on row click.
 *
 * The detail view is the SHARED content pane (@khorsheed/dsh-client-ui-content-preview)
 * with this plugin's adapter (preview.ts): the pane owns the title/path rows,
 * the copy-path / show-in-folder / open-in-IDE (split, app-listed) gestures,
 * the content⇄change-history switch, the sandboxed HTML tiers, content search
 * and the markdown/JSON/CSV renderings; this file supplies the read, the IDE
 * choices and the 改动记录 body (the shared DiffHistory). Being our own view it
 * works for outside-workspace files too (reveal/openExternal take absolute
 * paths, and the host `read` resolves them) — they are no longer list-only
 * rows. Mentions still open in the official document tab (the quick preview
 * path); the 「改动记录」 renderer registration there is unaffected.
 *
 * Navigation params (`openTab('file-preview', { params: { path } })`, the
 * turn card's outside-workspace gesture) select the path on arrival — which
 * lands directly on the detail view.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { parseFileAddress, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import {
  FileTypeIcon, IconGlobeOutlineMedium, IconRefreshOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ContentPane, type PreviewView,
} from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type { FilePreviewEntry, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { FilePreviewTabProps, FilePreviewTabInjected } from './contract.ts'
import { DiffHistory } from './DiffHistory.tsx'
import { listIdes, pickFileManager } from './open-in-app.ts'
import { previewTranslator, structuredLabels, toPreviewRead } from './preview.ts'
import { basename, highlightMatch, isWithinWorkspace, matchesQuery, parentPath, relativeToCwd, sortByLatest } from './path-utils.ts'
import css from './FilePreviewTab.module.css'

/** One detail view: header (back + breadcrumb + actions) over the preview pane. */
function DetailView(props: {
  readonly sessionId: SessionId
  readonly path: string
  readonly entry: FilePreviewEntry | undefined
  readonly cwd: string | undefined
  readonly apps: readonly string[] | null
  readonly readFile: FilePreviewTabInjected['readFile']
  readonly copyPath: FilePreviewTabInjected['copyPath']
  readonly revealFolder: FilePreviewTabInjected['revealFolder']
  readonly openInIde: FilePreviewTabInjected['openInIde']
  readonly onBack: () => void
  readonly t: FilePreviewTabProps['t']
}): ReactNode {
  const { sessionId, path, entry, cwd, apps, readFile, copyPath, revealFolder, openInIde, onBack, t } = props
  const [read, setRead] = useState<FilePreviewRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The content⇄change-history view is the caller's state (the kernel only
  // renders the switch); a new selection starts on the content.
  const [view, setView] = useState<PreviewView>('content')
  const fileManager = apps === null ? undefined : pickFileManager(apps)
  const ides = apps === null ? [] : listIdes(apps)
  const [ideChoice, setIdeChoice] = useState<string | undefined>(ides[0]?.id)
  const currentIde = ides.find(entry => entry.id === ideChoice) ?? ides[0]
  useEffect(() => { setView('content') }, [path])
  // The header shows the host-resolved absolute spelling (the same one the
  // copy/open gestures act on) as a segmented breadcrumb: directory segments
  // dimmed with ' / ' between them (the official files header's reading), the
  // file name solid. Long segments ellipsize individually; the name never
  // truncates.
  const displayPath = resolveWorkspacePath(cwd, path)
  const showTabs = entry !== undefined && entry.diffs.length > 0

  // Fetch the current content for the content tab; a stale answer (selection
  // moved) is dropped by the effect cleanup.
  useEffect(() => {
    let cancelled = false
    setRead(null)
    setError(null)
    void readFile(sessionId, path).then((result) => {
      if (cancelled) return
      if (result.ok) setRead(result.value)
      else setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, path, readFile])

  return (
    <div className={css.detail}>
      <ContentPane
        key={path}
        path={path}
        sessionId={sessionId}
        read={read === null ? null : toPreviewRead(read)}
        loading={read === null && error === null}
        error={error}
        displayPath={displayPath}
        onBack={onBack}
        onCopyPath={() => copyPath(path)}
        chrome={{
          ...(fileManager === undefined ? {} : { openFolder: () => { revealFolder(path) } }),
          ...(currentIde === undefined
            ? {}
            : {
              openIDE: () => { openInIde(path, currentIde.id) },
              ideChoices: ides.map(ide => ({ id: ide.id, label: ide.label })),
              onIdeChoice: (id: string) => { setIdeChoice(id); openInIde(path, id) },
            }),
        }}
        {...(showTabs ? { diffView: <DiffHistory entry={entry} t={t} />, view, onViewChange: setView } : {})}
        labels={structuredLabels(t)}
        t={previewTranslator(t)}
      />
    </div>
  )
}

/**
 * The file-preview tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function FilePreviewTab(props: FilePreviewTabProps): ReactNode {
  const {
    useTabInfo, sessionId, useSessions, useStore, actions, listFiles, readFile,
    copyPath, revealFolder, openInIde, loadOpenInApps, t,
  } = props
  const { useOpenInApps } = props
  const { tab } = useTabInfo()
  const { signal, navigation } = tab
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const apps = useOpenInApps(value => value)
  const list = useStore(s => s.list)
  const listLoading = useStore(s => s.listLoading)
  const listError = useStore(s => s.listError)
  const listRequestRev = useStore(s => s.listRequestRev)
  const selectedPath = useStore(s => s.selected[tab.id] ?? null)
  // Component-private view state: the name-filter search term.
  const [search, setSearch] = useState('')

  // Fetch the list on mount and on refresh; the whole value replaces the
  // previous list. A stale answer (tab closed mid-flight) is dropped on the
  // occurrence's abort signal.
  useEffect(() => {
    let cancelled = false
    actions.setListLoading(true)
    actions.setListError(null)
    void listFiles(sessionId).then((result) => {
      if (cancelled || signal.aborted) return
      actions.setListLoading(false)
      if (result.ok) actions.setList(result.value)
      else actions.setListError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, listRequestRev, actions, listFiles, signal])

  // The gestures' availability rides the once-per-page probe; start it with
  // the first mounted body.
  useEffect(() => { loadOpenInApps() }, [loadOpenInApps])

  // A navigation selects its path: `params.path` (the turn card's
  // outside-workspace gesture), or the claimed address's path (every
  // openResource route — the official card, the file tree, mentions). The
  // revision bumps on every navigation, so a repeat open re-applies it.
  const revision = navigation.revision
  const navPath = navigation.params?.path
  const navAddress = navigation.address
  // Applied once per navigation revision: the list arriving later must NOT
  // re-apply (a refresh would yank the user out of the list they backed into).
  const appliedRevision = useRef(0)
  useEffect(() => {
    if (revision === 0 || appliedRevision.current === revision) return
    const path = navPath ?? (() => {
      const parsed = navAddress === undefined ? undefined : parseFileAddress(navAddress)
      return parsed?.scope === 'session' ? parsed.path : undefined
    })()
    if (path === undefined) return
    appliedRevision.current = revision
    // Select the fold's own spelling when the list knows the file (the store
    // keys entries by their recorded display path), else the address's.
    const known = list?.find(entry => resolveWorkspacePath(cwd, entry.path) === resolveWorkspacePath(cwd, path))
    actions.select(tab.id, known?.path ?? path)
  }, [revision, navPath, navAddress, list, cwd, tab.id, actions])

  // Latest activity first: the fold keeps first-seen order. The list shows
  // the session's products only — written/edited files, matching the chat
  // area's 产物 vocabulary; reads never appear. A non-empty search narrows
  // to paths containing the term.
  const ordered = useMemo(() => {
    if (list === null) return null
    const products = sortByLatest(list).filter((entry: FilePreviewEntry) => entry.op !== 'read')
    const query = search.trim()
    return query.length === 0 ? products : products.filter(entry => matchesQuery(entry.path, query))
  }, [list, search])
  const searching = search.trim().length > 0

  if (selectedPath !== null) {
    return (
      <div className={css.root}>
        <DetailView
          sessionId={sessionId}
          path={selectedPath}
          entry={list?.find(entry => entry.path === selectedPath)}
          cwd={cwd}
          apps={apps}
          readFile={readFile}
          copyPath={copyPath}
          revealFolder={revealFolder}
          openInIde={openInIde}
          onBack={() => { actions.deselect(tab.id) }}
          t={t}
        />
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.filterRow}>
        <input
          type="search"
          className={css.search}
          placeholder={t('view.search.placeholder')}
          value={search}
          onChange={(event) => { setSearch(event.target.value) }}
          aria-label={t('view.search.placeholder')}
        />
        {/* Borderless icon-only reload, the ui-sidebar-files header tool shape. */}
        <button
          type="button"
          className={css.tool}
          aria-label={t('list.refresh')}
          title={t('list.refresh')}
          onClick={() => { actions.refreshList() }}
        >
          <IconRefreshOutlineMedium />
        </button>
      </div>
      <nav className={css.list} aria-label={t('open')}>
        {listLoading && list === null && <div className={css.empty}>{t('list.loading')}</div>}
        {!listLoading && listError !== null && list === null && (
          <div className={css.empty}>{t('list.error')}</div>
        )}
        {!listLoading && listError === null && list !== null && ordered !== null && ordered.length === 0 && (
          <div className={css.empty}>{searching ? t('view.search.noMatch') : t('list.empty')}</div>
        )}
        {ordered?.map((entry) => {
          const name = basename(entry.path)
          const parts = searching ? highlightMatch(name, search.trim()) : null
          const within = isWithinWorkspace(cwd, entry.path)
          return (
            <button
              key={entry.path}
              type="button"
              className={css.row}
              title={within ? entry.path : `${entry.path} — ${t('list.outsideWorkspace')}`}
              onClick={() => { actions.select(tab.id, entry.path) }}
            >
              <span className={css.rowName}>
                <FileTypeIcon path={entry.path} size={14} />
                {parts === null
                  ? name
                  : (
                    <>
                      {parts[0]}
                      <mark className={css.match}>{parts[1]}</mark>
                      {parts[2]}
                    </>
                  )}
                {!within && <IconGlobeOutlineMedium className={css.rowOutside} size={12} />}
              </span>
              <span className={css.rowDir}>{relativeToCwd(parentPath(entry.path), cwd)}</span>
              <span className={css.rowStep}>{t('history.step', { turn: entry.turn, step: entry.step })}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
