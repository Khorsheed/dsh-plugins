/**
 * The file-preview right-Sidebar tab body: the session's touched files as one
 * full-height list.
 *
 * Content preview is deliberately NOT here: clicking an in-workspace file
 * hands it to the official document tab through the tab's
 * `actions.openResource('dsh-resource://file/session/<id>/<path>')` — the S1
 * seam that landed at host 0.1.5-rc.1. The per-write change history lives in
 * the document tab itself as a switchable renderer (see FileHistoryBody). A
 * bash-captured artifact outside the workspace has no address the `file`
 * resource can resolve, so its row only selects, marked with an
 * outside-workspace hint. Navigation params
 * (`openTab('file-preview', { params: { path } })`, the turn card's
 * outside-workspace gesture) select the path on arrival.
 *
 * Each row carries hover actions in the old drawer's semantics: copy path
 * always; open-in-folder (reveal, with the official open-in-app route as the
 * parent-folder fallback) and open-in-IDE (file-exact, through the host
 * Remote) when the once-per-page apps probe found a handler.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import {
  FileTypeIcon, IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconFolderOpenOutline16,
  IconGlobeOutline14, IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreviewEntry } from '@khorsheed/dsh-file-preview/types'
import type { FilePreviewTabProps, FilePreviewTabInjected } from './contract.ts'
import { useCopyPathFeedback } from './copy-path.ts'
import { pickFileManager, pickIde } from './open-in-app.ts'
import { basename, highlightMatch, isWithinWorkspace, matchesQuery, parentPath, relativeToCwd, sortByLatest } from './path-utils.ts'
import css from './FilePreviewTab.module.css'

/** The gestures one row offers, cut from the injected face plus the probe snapshot. */
interface RowActionsProps {
  readonly path: string
  readonly apps: readonly string[] | null
  readonly copyPath: FilePreviewTabInjected['copyPath']
  readonly revealFolder: FilePreviewTabInjected['revealFolder']
  readonly openInIde: FilePreviewTabInjected['openInIde']
  readonly t: FilePreviewTabProps['t']
}

/** One row's hover actions: copy always; folder/IDE behind the probed catalog. */
function RowActions({ path, apps, copyPath, revealFolder, openInIde, t }: RowActionsProps): ReactNode {
  const { copied, onCopy } = useCopyPathFeedback(copyPath, path)
  const fileManager = apps === null ? undefined : pickFileManager(apps)
  const ide = apps === null ? undefined : pickIde(apps)
  return (
    <span className={css.rowActions}>
      <button
        type="button"
        className={css.rowAction}
        title={copied ? t('row.copied') : t('row.copyPath')}
        aria-label={copied ? t('row.copied') : t('row.copyPath')}
        onClick={(event) => { event.stopPropagation(); onCopy() }}
      >
        {copied ? <IconCheckOutline16 size={12} /> : <IconCopyOutline16 size={12} />}
      </button>
      {fileManager !== undefined && (
        <button
          type="button"
          className={css.rowAction}
          title={t('row.openFolder')}
          aria-label={t('row.openFolder')}
          onClick={(event) => { event.stopPropagation(); revealFolder(path) }}
        >
          <IconFolderOpenOutline16 size={12} />
        </button>
      )}
      {ide !== undefined && (
        <button
          type="button"
          className={css.rowAction}
          title={t('row.openIde')}
          aria-label={t('row.openIde')}
          onClick={(event) => { event.stopPropagation(); openInIde(path) }}
        >
          <IconCodeOutline16 size={12} />
        </button>
      )}
    </span>
  )
}

/**
 * The file-preview tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function FilePreviewTab(props: FilePreviewTabProps): ReactNode {
  const {
    useTabInfo, sessionId, useSessions, useStore, actions, listFiles,
    copyPath, revealFolder, openInIde, loadOpenInApps, t,
  } = props
  const { useOpenInApps } = props
  const { tab } = useTabInfo()
  const { signal, actions: tabActions, navigation } = tab
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

  // A navigation carrying params (the turn card's outside-workspace gesture)
  // selects its path; the revision bumps on every navigation, so a repeat
  // open of the same page re-applies the selection.
  const revision = navigation.revision
  const navPath = navigation.params?.path
  useEffect(() => {
    if (revision !== 0 && navPath !== undefined) actions.select(tab.id, navPath)
  }, [revision, navPath, tab.id, actions])

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
        <button
          type="button"
          aria-label={t('list.refresh')}
          title={t('list.refresh')}
          onClick={() => { actions.refreshList() }}
        >
          <IconRefreshOutline16 />
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
          const selected = entry.path === selectedPath
          const name = basename(entry.path)
          const parts = searching ? highlightMatch(name, search.trim()) : null
          const within = isWithinWorkspace(cwd, entry.path)
          return (
            <div key={entry.path} className={css.rowWrap}>
              <button
                type="button"
                className={selected ? `${css.row} ${css.rowSelected}` : css.row}
                title={within ? entry.path : `${entry.path} — ${t('list.outsideWorkspace')}`}
                onClick={() => {
                  actions.select(tab.id, entry.path)
                  // In-workspace files hand their content preview to the
                  // official document tab; outside-workspace paths have no
                  // addressable resource, so the click only selects.
                  if (within) tabActions.openResource(fileAddressFor(sessionId, cwd, entry.path))
                }}
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
                  {!within && <IconGlobeOutline14 className={css.rowOutside} size={12} />}
                </span>
                <span className={css.rowDir}>{relativeToCwd(parentPath(entry.path), cwd)}</span>
                <span className={css.rowStep}>{t('history.step', { turn: entry.turn, step: entry.step })}</span>
              </button>
              <RowActions
                path={entry.path}
                apps={apps}
                copyPath={copyPath}
                revealFolder={revealFolder}
                openInIde={openInIde}
                t={t}
              />
            </div>
          )
        })}
      </nav>
    </div>
  )
}
