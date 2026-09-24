/**
 * The `file-artifacts` right-Sidebar page body — **rc.1 line only** (registered
 * from the document-pane fiber; the 0.1.5 line keeps the full file-preview
 * page with its in-tab detail view). A thin LIST SHELL: the session's
 * written/edited files (the host `filePreview.list` fold, the same source the
 * retired page read), latest activity first, with the name filter and the
 * refresh gesture carried over. A row click opens the file through the
 * injected official route (`sidebarRight.openResource` on its canonical file
 * address) — the official document tab renders it (this plugin's content
 * renderer is its default body; the change history is the dropdown's sibling
 * renderer), so one file is one tab and the shell never draws content itself.
 * Outside-workspace rows keep their globe marker; they open too (the content
 * renderer reads them through this plugin's Remote).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FileTypeIcon, IconGlobeOutlineMedium, IconRefreshOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreviewEntry } from '@khorsheed/dsh-file-preview/types'
import type { FileArtifactsTabProps } from './contract.ts'
import { basename, highlightMatch, isWithinWorkspace, matchesQuery, parentPath, relativeToCwd, sortByLatest } from './path-utils.ts'
import css from './FilePreviewTab.module.css'

/**
 * Render the session's products as a flat open-only list.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function FileArtifactsTab(props: FileArtifactsTabProps): ReactNode {
  const { sessionId, useSessions, useStore, actions, listFiles, openArtifact, t } = props
  const { tab } = props.useTabInfo()
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const list = useStore(s => s.list)
  const listLoading = useStore(s => s.listLoading)
  const listError = useStore(s => s.listError)
  const listRequestRev = useStore(s => s.listRequestRev)
  // Component-private view state: the name-filter search term.
  const [search, setSearch] = useState('')

  // Fetch the list on mount and on refresh; the whole value replaces the
  // previous list. A stale answer (tab closed mid-flight) is dropped on the
  // occurrence's abort signal.
  const { signal } = tab
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
      <nav className={css.list} aria-label={t('guide.title')}>
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
              title={entry.path}
              onClick={() => { openArtifact(entry.path) }}
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
