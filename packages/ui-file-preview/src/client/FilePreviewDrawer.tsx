/** Root-overlay drawer: inline preview of a file clicked from the chat, no
 * tab switch. Content only — the file view tab remains the browse surface. */

import { useEffect } from 'react'
import {
  IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreviewDrawerProps } from './contract.ts'
import { useCopyPathFeedback } from './copy-path.ts'
import { FilePreviewPane } from './FilePreviewPane.tsx'
import css from './FilePreviewDrawer.module.css'

/**
 * The link-click drawer, registered into the frame-wide `shell.overlay` list
 * slot (root scope). It renders nothing while closed; when a chat file link
 * routes `openPath`, it shows that file's last change and current content in
 * place, leaving the conversation view untouched.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function FilePreviewDrawer(props: FilePreviewDrawerProps) {
  const { useSessions, useStore, listFiles, readFile, isLoopback, openExternal, revealFolder, copyPath, t } = props
  const { useHostDescription } = props
  const actions = props.actions
  const open = useStore(s => s.open)
  const list = useStore(s => s.list)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const previewLoading = useStore(s => s.previewLoading)
  const previewError = useStore(s => s.previewError)
  const current = useSessions(s => s.current)
  // Clipboard writes work in any browser context, so the copy gesture is
  // never gated; only the host-open gestures (folder / IDE) need a desktop.
  const { copied, onCopy } = useCopyPathFeedback(copyPath, selectedPath)
  // Host open gestures (folder / IDE) exist only when this deployment can
  // hand a path to a native desktop — same gate the official row uses.
  const canOpenExternal = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  // While open, mark the document so the drawer's own CSS can push the
  // conversation (scroll body + composer seat) left by the drawer width —
  // the drawer is an overlay, so the chat would otherwise sit underneath it.
  useEffect(() => {
    if (open) {
      document.documentElement.dataset.filePreviewDrawerOpen = ''
    } else {
      delete document.documentElement.dataset.filePreviewDrawerOpen
    }
  }, [open])

  // Fetch the list while open (the diff tab needs the entry's lastDiff).
  useEffect(() => {
    if (!open || current === undefined) return
    let cancelled = false
    void listFiles(current).then((result) => {
      if (cancelled) return
      if (result.ok) actions.setList(result.value)
    })
    return () => { cancelled = true }
  }, [open, current, actions, listFiles])

  // Fetch the selected file's content; a stale request is dropped when the
  // selection moves or the drawer closes.
  useEffect(() => {
    if (!open || current === undefined || selectedPath === null) return
    let cancelled = false
    actions.setPreviewLoading(true)
    actions.setPreviewError(null)
    void readFile(current, selectedPath).then((result) => {
      if (cancelled) return
      actions.setPreviewLoading(false)
      if (result.ok) actions.setPreview(result.value)
      else actions.setPreviewError(result.error.message)
    })
    return () => { cancelled = true }
  }, [open, current, selectedPath, actions, readFile])

  if (!open) return null

  const selectedEntry = selectedPath === null ? undefined : list?.find(entry => entry.path === selectedPath)

  return (
    <div className={css.drawer} role="dialog" aria-label={t('drawer.title')}>
      <header className={css.header}>
        <div className={css.title}>{t('drawer.title')}</div>
        <div className={css.headerActions}>
          {selectedPath !== null && (
            <button
              type="button" className={css.action} onClick={onCopy}
              title={copied ? t('drawer.copied') : t('drawer.copyPath')}
              aria-label={copied ? t('drawer.copied') : t('drawer.copyPath')}
            >
              {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
              {copied ? t('drawer.copied') : t('drawer.copyPath')}
            </button>
          )}
          {canOpenExternal && selectedPath !== null && (
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
          <button
            type="button" className={css.close} onClick={() => { actions.close() }}
            title={t('drawer.close')} aria-label={t('drawer.close')}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>
      <div className={css.body}>
        {previewLoading && <div className={css.empty}>{t('drawer.loading')}</div>}
        {!previewLoading && previewError !== null && <div className={css.empty}>{t('drawer.kind.error')}</div>}
        {!previewLoading && previewError === null && selectedPath !== null && preview !== null && (
          <FilePreviewPane key={selectedPath} entry={selectedEntry} read={preview} t={t} />
        )}
        {!previewLoading && previewError === null && selectedPath === null && (
          <div className={css.empty}>{t('drawer.previewEmpty')}</div>
        )}
      </div>
    </div>
  )
}
