/** Conversation view tab: the session's touched files (list) with inline preview. */

import { useEffect, useMemo, useState } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import {
  IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreviewViewProps } from './contract.ts'
import { useCopyPathFeedback } from './copy-path.ts'
import { FilePreviewPane } from './FilePreviewPane.tsx'
import { basename, highlightMatch, matchesQuery, parentPath, relativeToCwd, sortByLatest } from './path-utils.ts'
import css from './FilePreviewView.module.css'

/**
 * The file-preview conversation view (the 'file-preview' tab beside chat and
 * trajectory). It fetches the session's touched-file list (latest activity
 * first) and previews the selected file's content and last change through the
 * injected Remote callbacks. The list shows the session's products only
 * (written/edited files — the same vocabulary as the chat area's produced
 * files), latest activity first, with a name filter. The root opts into the
 * composer-overlay layout (the trajectory precedent) so the two panes scroll
 * independently instead of moving the whole conversation.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function FilePreviewView(props: FilePreviewViewProps) {
  const {
    sessionId, useSessions, useStore, listFiles, readFile,
    isLoopback, openExternal, revealFolder, copyPath, t,
  } = props
  const { useHostDescription } = props
  const actions = props.actions
  const list = useStore(s => s.list)
  const listLoading = useStore(s => s.listLoading)
  const listError = useStore(s => s.listError)
  const listRequestRev = useStore(s => s.listRequestRev)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const previewLoading = useStore(s => s.previewLoading)
  const previewError = useStore(s => s.previewError)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  // The preview header shows the selected file's host-resolved absolute path
  // (the same spelling copy/open/reveal act on), so the path is visible at a
  // glance, with the gesture buttons on the right — the drawer header's layout.
  const displayPath = selectedPath === null ? undefined : resolveWorkspacePath(cwd, selectedPath)
  // Clipboard writes work in any browser context, so the copy gesture is
  // never gated; only the host-open gestures (folder / IDE) need a desktop —
  // same gate the drawer and the official row use.
  const { copied, onCopy } = useCopyPathFeedback(copyPath, selectedPath)
  const canOpenExternal = isLoopback && useHostDescription(description => description?.canOpenPath === true)
  // Component-private view state: the name-filter search term.
  const [search, setSearch] = useState('')
  // Latest activity first: the fold keeps first-seen order. The list shows
  // the session's products only — written/edited files, matching the chat
  // area's 产物 vocabulary; reads never appear. A non-empty search narrows
  // to paths containing the term.
  const ordered = useMemo(() => {
    if (list === null) return null
    const products = sortByLatest(list).filter(entry => entry.op !== 'read')
    const query = search.trim()
    return query.length === 0 ? products : products.filter(entry => matchesQuery(entry.path, query))
  }, [list, search])
  const searching = search.trim().length > 0

  // Fetch the list on mount (each tab activation refetches) and on refresh;
  // the whole value replaces the previous list.
  useEffect(() => {
    let cancelled = false
    actions.setListLoading(true)
    actions.setListError(null)
    void listFiles(sessionId).then((result) => {
      if (cancelled) return
      actions.setListLoading(false)
      if (result.ok) actions.setList(result.value)
      else actions.setListError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, listRequestRev, actions, listFiles])

  // Fetch the selected file's current content; a stale request is dropped by
  // the effect cleanup when the selection moves.
  useEffect(() => {
    if (selectedPath === null) return
    let cancelled = false
    actions.setPreviewLoading(true)
    actions.setPreviewError(null)
    void readFile(sessionId, selectedPath).then((result) => {
      if (cancelled) return
      actions.setPreviewLoading(false)
      if (result.ok) actions.setPreview(result.value)
      else actions.setPreviewError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, selectedPath, actions, readFile])

  const selectedEntry = selectedPath === null ? undefined : list?.find(entry => entry.path === selectedPath)

  return (
    <div className={css.view} data-conversation-composer-overlay="">
      <div className={css.side}>
        <div className={css.filterRow}>
          <input
            type="search"
            className={css.search}
            placeholder={t('view.search.placeholder')}
            value={search}
            onChange={(event) => { setSearch(event.target.value) }}
            aria-label={t('view.search.placeholder')}
          />
        </div>
        <nav className={css.list} aria-label={t('open')}>
          {listLoading && list === null && <div className={css.empty}>{t('drawer.loading')}</div>}
          {!listLoading && listError !== null && list === null && (
            <div className={css.empty}>{t('drawer.listError')}</div>
          )}
          {!listLoading && listError === null && list !== null && ordered !== null && ordered.length === 0 && (
            <div className={css.empty}>{searching ? t('view.search.noMatch') : t('drawer.empty')}</div>
          )}
          {ordered?.map((entry) => {
            const selected = entry.path === selectedPath
            const name = basename(entry.path)
            const parts = searching ? highlightMatch(name, search.trim()) : null
            return (
              <button
                key={entry.path}
                type="button"
                className={selected ? `${css.row} ${css.rowSelected}` : css.row}
                onClick={() => { actions.select(entry.path) }}
              >
                <span className={css.rowName}>
                  {parts === null
                    ? name
                    : (
                      <>
                        {parts[0]}
                        <mark className={css.match}>{parts[1]}</mark>
                        {parts[2]}
                      </>
                    )}
                </span>
                <span className={css.rowDir}>{relativeToCwd(parentPath(entry.path), cwd)}</span>
                <span className={css.rowStep}>{t('drawer.step', { turn: entry.turn, step: entry.step })}</span>
              </button>
            )
          })}
        </nav>
      </div>
      <section className={css.preview}>
        {selectedPath !== null && (
          <div className={css.previewHeader}>
            <div className={css.previewPath} title={displayPath}>{displayPath}</div>
            <div className={css.previewActions}>
              <button
                type="button" className={css.action} onClick={onCopy}
                title={copied ? t('drawer.copied') : t('drawer.copyPath')}
                aria-label={copied ? t('drawer.copied') : t('drawer.copyPath')}
              >
                {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
                {copied ? t('drawer.copied') : t('drawer.copyPath')}
              </button>
              {canOpenExternal && (
                <>
                  <button
                    type="button" className={css.action} onClick={() => { revealFolder(selectedPath) }}
                    title={t('drawer.openFolder')} aria-label={t('drawer.openFolder')}
                  >
                    <IconFolderOpenOutline16 size={14} />
                    {t('drawer.action.folder')}
                  </button>
                  <button
                    type="button" className={css.action} onClick={() => { openExternal(selectedPath) }}
                    title={t('drawer.openIde')} aria-label={t('drawer.openIde')}
                  >
                    <IconCodeOutline16 size={14} />
                    {t('drawer.action.ide')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {previewLoading && <div className={css.empty}>{t('drawer.loading')}</div>}
        {!previewLoading && previewError !== null && <div className={css.empty}>{t('drawer.kind.error')}</div>}
        {!previewLoading && previewError === null && selectedPath !== null && preview !== null && (
          <FilePreviewPane key={selectedPath} entry={selectedEntry} read={preview} t={t} />
        )}
        {!previewLoading && previewError === null && selectedPath === null && (
          <div className={css.empty}>{t('drawer.previewEmpty')}</div>
        )}
      </section>
    </div>
  )
}
