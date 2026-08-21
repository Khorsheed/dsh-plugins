/** Root-overlay drawer: inline preview of a file clicked from the chat, no
 * tab switch. Content only — the file view tab remains the browse surface. */

import { useEffect, useRef, useState } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreviewDrawerProps } from './contract.ts'
import { useCopyPathFeedback } from './copy-path.ts'
import { FilePreviewPane } from './FilePreviewPane.tsx'
import css from './FilePreviewDrawer.module.css'

/** Default drawer width (px), matching the pre-resize CSS. */
const DEFAULT_WIDTH = 520
const MIN_WIDTH = 280
/** localStorage key for the user's drawer width preference. */
const WIDTH_KEY = 'dsh-file-preview-drawer-w'

function clampWidth(width: number, viewport: number): number {
  return Math.max(MIN_WIDTH, Math.min(width, Math.round(viewport * 0.85)))
}

/**
 * The link-click drawer, registered into the frame-wide `shell.overlay` list
 * slot (root scope). It renders nothing while closed; when a chat file link
 * routes `openPath`, it shows that file's last change and current content in
 * place, leaving the conversation view untouched. The left-edge handle drags
 * the width (persisted locally); the conversation push tracks the same
 * document-level CSS variable the drawer width uses.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function FilePreviewDrawer(props: FilePreviewDrawerProps) {
  const { useSessions, useStore, listFiles, readFile, isLoopback, openExternal, revealFolder, copyPath, t } = props
  const { useHostDescription } = props
  const actions = props.actions
  const open = useStore(s => s.open)
  const pinned = useStore(s => s.pinned)
  const list = useStore(s => s.list)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const previewLoading = useStore(s => s.previewLoading)
  const previewError = useStore(s => s.previewError)
  const current = useSessions(s => s.current)
  // The header shows the selected file's host-resolved absolute path (the
  // same spelling copy/open/reveal act on), so the path is visible at a
  // glance; the generic title remains the no-selection fallback.
  const currentCwd = useSessions(s => s.current === undefined ? undefined : s.byId[s.current]?.cwd)
  const displayPath = selectedPath === null ? undefined : resolveWorkspacePath(currentCwd, selectedPath)
  // Clipboard writes work in any browser context, so the copy gesture is
  // never gated; only the host-open gestures (folder / IDE) need a desktop.
  const { copied, onCopy } = useCopyPathFeedback(copyPath, selectedPath)
  // Host open gestures (folder / IDE) exist only when this deployment can
  // hand a path to a native desktop — same gate the official row uses.
  const canOpenExternal = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  // Resizable width: a local preference persisted under WIDTH_KEY; while open
  // the drawer and the conversation push both read the same document-level
  // CSS variable, so a drag re-flows chat in lockstep.
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY))
      return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH
    } catch {
      return DEFAULT_WIDTH
    }
  })
  const drag = useRef<{ startX: number; startW: number } | null>(null)
  useEffect(() => {
    if (!open) return
    document.documentElement.style.setProperty('--dsh-file-preview-drawer-w', `${drawerWidth}px`)
    return () => { document.documentElement.style.removeProperty('--dsh-file-preview-drawer-w') }
  }, [open, drawerWidth])
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(drawerWidth)) } catch { /* quota/private-mode: non-fatal */ }
  }, [drawerWidth])
  const onResizePointerDown = (event: { clientX: number; pointerId: number; currentTarget: HTMLElement }): void => {
    drag.current = { startX: event.clientX, startW: drawerWidth }
    // Capture so fast drags keep delivering moves even off the 8px handle.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onResizePointerMove = (event: { clientX: number }): void => {
    if (drag.current === null) return
    // Left edge: dragging left grows the drawer.
    setDrawerWidth(clampWidth(drag.current.startW + (drag.current.startX - event.clientX), window.innerWidth))
  }
  const onResizePointerUp = (): void => { drag.current = null }

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

  // Switching sessions closes the drawer by default (the drawer previews one
  // session's files); the pin button opts into staying put across the switch.
  const prevCurrent = useRef(current)
  useEffect(() => {
    if (prevCurrent.current !== current && open && !pinned) {
      actions.close()
    }
    prevCurrent.current = current
  }, [current, open, pinned, actions])

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
      <header className={css.header}>
        <div className={css.title} title={displayPath}>{displayPath ?? t('drawer.title')}</div>
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
            type="button"
            className={pinned ? `${css.pin} ${css.pinActive}` : css.pin}
            onClick={() => { actions.setPinned(!pinned) }}
            title={pinned ? t('drawer.unpin') : t('drawer.pin')}
            aria-label={pinned ? t('drawer.unpin') : t('drawer.pin')}
            aria-pressed={pinned}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path
                d="M9.6 2.4 L13.6 6.4 L11.1 7.4 L8.7 9.8 L9.2 13.2 L8.2 14.2 L4.6 10.6 L2.2 13 L2.6 11.6 L6.6 8.6 L5.6 6.1 L7.6 4.1 Z"
                fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
              />
            </svg>
          </button>
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
