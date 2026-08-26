/**
 * The local-files browser (`shell.overlay`): an INDEPENDENT surface from the
 * worktrees drawer — a git-agnostic file manager (browse any absolute local
 * directory, preview files, open in folder/IDE), deliberately NOT a tab of
 * the drawer. It reuses the drawer's design tokens and code-glyph language
 * (CodeBlock preview, folder/file glyphs, compact rows) without sharing its
 * state: the browser remembers its own last directory and has its own
 * interaction model (path bar + directory listing, not a git change tree).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CodeBlock, IconChevronLeftOutline14, IconCloseOutline16, IconFolderOpen16,
  IconFolderOpenOutline16, IconRefreshOutline16, IconChevronDownOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocalFileEntry } from '../types.ts'
import type { LocalFilesDrawerProps } from './contract.ts'
import { languageFor } from './language.ts'
import css from './LocalFilesDrawer.module.css'

/** localStorage key for the remembered last directory. */
const ROOT_KEY = 'dsh-worktrees-local-files-root'

/** Read the remembered last directory ('' when unset/unreadable). */
function rememberedRoot(): string {
  try {
    return localStorage.getItem(ROOT_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Persist the last directory (best-effort). */
function rememberRoot(path: string): void {
  try { localStorage.setItem(ROOT_KEY, path) } catch { /* non-fatal */ }
}

/** Format a byte size compactly (B / KB / MB / GB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Split an absolute path into crumb segments (root included). */
function crumbsOf(path: string): string[] {
  const parts = path.split('/').filter(part => part !== '')
  if (path.startsWith('/')) return ['/', ...parts]
  return parts
}

/** The local-files browser. */
export function LocalFilesDrawer({
  useStore, actions, t,
  listLocalDirectory, readLocalFile, workspacesList, isLoopback, useHostDescription, openExternal,
}: LocalFilesDrawerProps): ReactNode {
  const open = useStore(s => s.open)
  const root = useStore(s => s.root)
  const listing = useStore(s => s.listing)
  const selectedPath = useStore(s => s.selectedPath)
  const preview = useStore(s => s.preview)
  const error = useStore(s => s.error)
  const canOpenHost = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  const [pathDraft, setPathDraft] = useState<string>('')
  const [editingPath, setEditingPath] = useState(false)
  const [wsOpen, setWsOpen] = useState(false)
  const wsRef = useRef<HTMLDivElement | null>(null)

  const workspaces = useMemo(() => workspacesList(), [workspacesList])

  // Load the directory whenever the root changes.
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

  // Preview the selected file.
  useEffect(() => {
    if (!open || selectedPath === null) return
    let cancelled = false
    actions.setLoading(true)
    void readLocalFile({ path: selectedPath }).then(result => {
      if (cancelled) return
      if (result.ok) actions.setPreview(result.value)
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [open, selectedPath, readLocalFile, actions])

  // Close the workspace switcher on an outside mousedown.
  useEffect(() => {
    if (!wsOpen) return
    const onDown = (event: MouseEvent): void => {
      if (wsRef.current !== null && !wsRef.current.contains(event.target as Node)) setWsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [wsOpen])

  // Escape closes the panel (or the workspace switcher first).
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (editingPath) { setEditingPath(false); return }
      if (wsOpen) { setWsOpen(false); return }
      actions.close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, editingPath, wsOpen, actions])

  if (!open) return null

  // The directory currently listed (or the remembered start).
  const current = root ?? rememberedRoot() ?? ''
  const crumbs = current === '' ? [] : crumbsOf(current)

  const navigate = (path: string): void => {
    actions.setRoot(path)
    rememberRoot(path)
  }

  const openDir = (entry: LocalFileEntry): void => {
    if (!entry.isDir || root === null) return
    navigate(`${root}/${entry.name}`)
  }

  const openFile = (entry: LocalFileEntry): void => {
    if (entry.isDir || root === null) return
    actions.select(`${root}/${entry.name}`)
  }

  const submitPath = (): void => {
    const target = pathDraft.trim()
    if (target !== '') navigate(target)
    setEditingPath(false)
  }

  const onSelectWorkspace = (path: string): void => {
    navigate(path)
    setWsOpen(false)
  }

  const dirs = (listing?.entries ?? []).filter(entry => entry.isDir)
  const files = (listing?.entries ?? []).filter(entry => !entry.isDir)

  const previewBody = ((): ReactNode => {
    if (selectedPath === null) {
      return <div className={css.previewPlaceholder}>{t('local.noSelection')}</div>
    }
    if (error !== null) return <div className={css.previewPlaceholder}>{t('state.error', { message: error })}</div>
    if (preview === null) return <div className={css.previewPlaceholder}>{t('state.loading')}</div>
    if (preview.content === null) {
      return (
        <div className={css.previewPlaceholder}>
          <div className={css.placeholderIcon}><IconFolderOpenOutline16 /></div>
          <div>{t('local.binary')}</div>
          {!preview.complete && <div className={css.placeholderMeta}>{t('local.tooLarge')}</div>}
        </div>
      )
    }
    return (
      <div className={css.codeWrap}>
        <CodeBlock className={css.code} code={preview.content} lang={languageFor(selectedPath)} />
        {!preview.complete && <div className={css.truncated}>{t('local.tooLarge')}</div>}
      </div>
    )
  })()

  return (
    <div className={css.overlay}>
      <aside className={css.panel} role="dialog" aria-label={t('local.browse')}>
        <div className={css.header}>
          <div className={css.topRow}>
            {/* Workspace switcher */}
            <div className={css.wsWrap} ref={wsRef}>
              <button type="button" className={css.wsButton} onClick={() => { setWsOpen(v => !v) }}>
                <IconFolderOpen16 />
                <span className={css.wsLabel}>{t('local.workspace')}</span>
                <IconChevronDownOutline14 className={css.wsCaret} />
              </button>
              {wsOpen && (
                <div className={css.wsPopover} role="listbox">
                  {workspaces.length === 0
                    ? <div className={css.wsEmpty}>{t('local.empty')}</div>
                    : workspaces.map(workspace => (
                      <button
                        key={workspace.id}
                        type="button"
                        role="option"
                        className={css.wsRow}
                        onClick={() => { onSelectWorkspace(workspace.path) }}
                      >
                        <span className={css.wsRowTitle}>{workspace.title}</span>
                        <span className={css.wsRowPath}>{workspace.path}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {/* Path bar */}
            <div className={css.pathBar} title={current}>
              {crumbs.map((crumb, index) => (
                <span key={`${crumb}/${index}`} className={css.crumbWrap}>
                  {index > 0 && <span className={css.crumbSep}>/</span>}
                  {editingPath
                    ? (
                      <input
                        className={css.pathInput}
                        value={pathDraft}
                        autoFocus
                        onChange={event => { setPathDraft(event.target.value) }}
                        onKeyDown={event => {
                          if (event.key === 'Enter') submitPath()
                          if (event.key === 'Escape') setEditingPath(false)
                        }}
                        placeholder={t('local.pathPlaceholder')}
                      />
                    )
                    : (
                      <button type="button" className={css.crumb} onClick={() => {
                        const target = index === 0 ? crumb : current.split('/').slice(0, index + 1).join('/')
                        navigate(target)
                      }}>
                        {crumb}
                      </button>
                    )}
                </span>
              ))}
              {!editingPath && (
                <button type="button" className={css.pathEdit} title={t('local.pathPlaceholder')} onClick={() => {
                  setPathDraft(current)
                  setEditingPath(true)
                }}>
                  ✎
                </button>
              )}
            </div>
            <div className={css.actions}>
              <button type="button" className={css.action} title={t('action.refresh')} onClick={() => { if (root !== null) actions.setRoot(root) }}>
                <IconRefreshOutline16 />
              </button>
              <button type="button" className={css.action} title={t('action.close')} onClick={() => { actions.close() }}>
                <IconCloseOutline16 />
              </button>
            </div>
          </div>
        </div>
        <div className={css.body}>
          <div className={css.treeColumn}>
            {listing === null && error === null && <div className={css.treeEmpty}>{t('local.loadingDir')}</div>}
            {error !== null && <div className={css.treeEmpty}>{t('state.error', { message: error })}</div>}
            {listing !== null && error === null && (
              <>
                <div className={css.treeHead}>{current}</div>
                <div className={css.treeList}>
                  {dirs.length === 0 && files.length === 0 && <div className={css.treeEmpty}>{t('local.empty')}</div>}
                  {dirs.map(entry => (
                    <button
                      key={`d/${entry.name}`}
                      type="button"
                      className={css.row}
                      onClick={() => { openDir(entry) }}
                    >
                      <IconFolderOpen16 className={css.rowIcon} />
                      <span className={css.rowName}>{entry.name}</span>
                      <span className={css.rowMeta}>{entry.mtime !== null ? relative(entry.mtime) : ''}</span>
                    </button>
                  ))}
                  {files.map(entry => {
                    const selected = selectedPath === `${root}/${entry.name}`
                    return (
                      <button
                        key={`f/${entry.name}`}
                        type="button"
                        className={`${css.row} ${selected ? css.rowSelected : ''}`}
                        onClick={() => { openFile(entry) }}
                      >
                        <FileGlyph className={css.rowIcon} />
                        <span className={css.rowName}>{entry.name}</span>
                        <span className={css.rowMeta}>{entry.size !== null ? formatBytes(entry.size) : ''}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <div className={css.previewColumn}>
            <div className={css.previewHead}>
              <IconChevronLeftOutline14 />
              <span className={css.previewTitle}>{selectedPath ?? ''}</span>
              {canOpenHost && selectedPath !== null && (
                <button type="button" className={css.openButton} title={t('local.openFolder')} onClick={() => { openExternal(selectedPath) }}>
                  {t('local.openFolder')}
                </button>
              )}
            </div>
            <div className={css.previewBody}>{previewBody}</div>
          </div>
        </div>
      </aside>
    </div>
  )
}

/** Relative time for a directory mtime (compact form). */
function relative(seconds: number, now = Date.now()): string {
  if (seconds <= 0) return ''
  const delta = Math.max(0, Math.floor(now / 1000) - seconds)
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)}d`
  return `${Math.floor(delta / (86400 * 30))}mo`
}

/** A neutral document glyph (same folded-corner paper as the drawer's tree). */
function FileGlyph({ className }: { className: string | undefined }): ReactNode {
  return (
    <svg className={className ?? ""} width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
      <path d="M9 1.5V5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
    </svg>
  )
}
