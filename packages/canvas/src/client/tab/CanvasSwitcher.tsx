/**
 * The canvas switcher: the tab topbar's dropdown for choosing the open
 * canvas — the active rows (open on click, archive on hover), the archived
 * well (restore), the new-canvas form (topic + attach multi-select), and the
 * v1 one-shot import flow (probe → import). It replaces the M1–M2.5 space
 * page's left column (the main-panel route is retired); the dropdown closes
 * on a choice, on Escape, and on outside pointer down.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode,
} from 'react'
import {
  IconArchiveOutline20, IconChevronDownOutline14, IconChevronRightOutline14,
  IconPlusOutline16, IconRefreshOutline14, relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasSummary } from '../../types.ts'
import type {} from '../locales.ts'
import css from '../space/board.module.css'

/** One workspace option the attach pickers list. */
export interface SwitcherWorkspace {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
}

/** The switcher's props: the canvas list plus the tab's mutation callbacks. */
export interface CanvasSwitcherProps {
  readonly t: TranslateNS<'canvas'>
  /** True when no session can fence writes (create/archive/import hide). */
  readonly readonly: boolean
  readonly canvases: readonly CanvasSummary[] | null
  readonly openId: string | null
  readonly workspaces: readonly SwitcherWorkspace[]
  readonly onOpen: (canvasId: string) => void
  readonly onCreate: (title: string, attachedWorkspaces: readonly string[]) => Promise<boolean>
  readonly onArchive: (row: CanvasSummary, archived: boolean) => Promise<void>
  readonly onProbeImport: (dir: string) => Promise<RemoteResult<CanvasListLike>>
  readonly onImport: (dir: string) => Promise<boolean>
}

/** The probe answer's pad listing shape (only the count is read). */
export interface CanvasListLike {
  readonly items: readonly unknown[]
}

/** The row's meta line: card and open-question counts plus a relative time. */
function metaOf(row: CanvasSummary, t: TranslateNS<'canvas'>): string {
  const parts = [t('space.metaCards', { count: String(row.cardCount) })]
  if (row.openQuestions > 0) parts.push(t('space.metaQuestions', { count: String(row.openQuestions) }))
  const at = Date.parse(row.lastActiveAt)
  if (!Number.isNaN(at)) {
    const bucket = relativeTime(at, Date.now())
    parts.push(
      bucket.unit === 'now' ? t('time.now')
        : bucket.unit === 'minutes' ? t('time.minutes', { n: String(bucket.n) })
        : bucket.unit === 'hours' ? t('time.hours', { n: String(bucket.n) })
        : bucket.unit === 'days' ? t('time.days', { n: String(bucket.n) })
        : bucket.unit === 'months' ? t('time.months', { n: String(bucket.n) })
        : t('time.years', { n: String(bucket.n) }),
    )
  }
  return parts.join(' · ')
}

/** The canvas switcher dropdown. */
export function CanvasSwitcher({
  t, readonly, canvases, openId, workspaces, onOpen, onCreate, onArchive, onProbeImport, onImport,
}: CanvasSwitcherProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [attachPicks, setAttachPicks] = useState<ReadonlySet<string>>(new Set())
  const [showArchived, setShowArchived] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDir, setImportDir] = useState('')
  const [importProbe, setImportProbe] = useState<{ dir: string; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside pointer down.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open])

  const current = canvases?.find(canvas => canvas.id === openId)
  const active = canvases?.filter(canvas => canvas.archivedAt === null) ?? []
  const archivedRows = canvases?.filter(canvas => canvas.archivedAt !== null) ?? []

  const submitCreate = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const title = newTitle.trim()
    if (title.length === 0) {
      setError(t('toast.needTitle'))
      return
    }
    setBusy(true)
    try {
      const okCreated = await onCreate(title, [...attachPicks])
      if (okCreated) {
        setCreating(false)
        setNewTitle('')
        setAttachPicks(new Set())
        setOpen(false)
        setError(null)
      }
    } finally {
      setBusy(false)
    }
  }, [newTitle, attachPicks, onCreate, t])

  const probeImport = useCallback(async (dir: string) => {
    setImportDir(dir)
    setImportProbe(null)
    if (dir === '') return
    const result = await onProbeImport(dir)
    if (result.ok) setImportProbe({ dir, count: result.value.items.length })
  }, [onProbeImport])

  const submitImport = useCallback(async () => {
    if (importProbe === null || importProbe.count === 0) return
    setBusy(true)
    try {
      const okImported = await onImport(importProbe.dir)
      if (okImported) {
        setImporting(false)
        setImportDir('')
        setImportProbe(null)
        setOpen(false)
      }
    } finally {
      setBusy(false)
    }
  }, [importProbe, onImport])

  return (
    <div className={css.switcher} ref={rootRef}>
      <button
        type="button"
        className={css.topic}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        {current?.title ?? t('switcher.pick')}
        <IconChevronDownOutline14 size={12} />
      </button>

      {open && (
        <div className={css.switcherMenu}>
          <div className={css.listHead}>
            <span className={css.listTitle}>{t('space.title')}</span>
            <button
              type="button"
              className={css.newButton}
              disabled={readonly}
              title={readonly ? t('space.readonly') : undefined}
              onClick={() => {
                setCreating(value => !value)
                setNewTitle('')
                setAttachPicks(new Set())
                setError(null)
              }}
            >
              <IconPlusOutline16 size={12} />
              {t('space.new')}
            </button>
          </div>

          {creating && (
            <form className={css.form} onSubmit={event => { void submitCreate(event) }}>
              <input
                className={css.input}
                autoFocus
                value={newTitle}
                placeholder={t('space.newPlaceholder')}
                onChange={event => { setNewTitle(event.target.value) }}
                onKeyDown={event => { if (event.key === 'Escape') setCreating(false) }}
              />
              <span className={css.formLabel}>{t('space.newAttach')}</span>
              {workspaces.length === 0 ? (
                <span className={css.importNote}>{t('space.noWorkspace')}</span>
              ) : (
                <div className={css.attachList}>
                  {workspaces.map(workspace => (
                    <label key={workspace.workspaceId} className={css.attachItem} title={workspace.path}>
                      <input
                        type="checkbox"
                        checked={attachPicks.has(workspace.path)}
                        onChange={event => {
                          setAttachPicks(current => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(workspace.path)
                            else next.delete(workspace.path)
                            return next
                          })
                        }}
                      />
                      {workspace.title}
                    </label>
                  ))}
                </div>
              )}
              {error !== null && <span className={css.importNote}>{error}</span>}
              <div className={css.formActions}>
                <button type="submit" className={css.primaryButton} disabled={busy}>{t('space.create')}</button>
                <button type="button" className={css.ghostButton} onClick={() => { setCreating(false) }}>
                  {t('space.cancel')}
                </button>
              </div>
            </form>
          )}

          <div className={css.listBody}>
            {canvases === null ? (
              <div className={css.empty}>{t('state.loading')}</div>
            ) : active.length === 0 && archivedRows.length === 0 ? (
              <div className={css.empty}>
                {t('space.empty')}
                <br />
                {t('space.emptyHint')}
              </div>
            ) : (
              active.map(row => (
                <div
                  key={row.id}
                  className={css.canvasRow}
                  data-active={row.id === openId || undefined}
                  onClick={() => {
                    onOpen(row.id)
                    setOpen(false)
                  }}
                >
                  <span className={css.canvasRowTitle}>{row.title}</span>
                  <span className={css.canvasRowMeta}>{metaOf(row, t)}</span>
                  {!readonly && (
                    <button
                      type="button"
                      className={css.rowAction}
                      title={t('action.archive')}
                      aria-label={t('action.archive')}
                      onClick={event => { event.stopPropagation(); void onArchive(row, true) }}
                    >
                      <IconArchiveOutline20 size={13} />
                    </button>
                  )}
                </div>
              ))
            )}

            {archivedRows.length > 0 && (
              <div>
                <button
                  type="button"
                  className={css.archiveHeader}
                  aria-expanded={showArchived}
                  onClick={() => { setShowArchived(value => !value) }}
                >
                  {showArchived ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
                  {t('space.archived', { count: String(archivedRows.length) })}
                </button>
                {showArchived && archivedRows.map(row => (
                  <div
                    key={row.id}
                    className={css.canvasRow}
                    data-active={row.id === openId || undefined}
                    onClick={() => {
                      onOpen(row.id)
                      setOpen(false)
                    }}
                  >
                    <span className={css.canvasRowTitle}>{row.title}</span>
                    <span className={css.canvasRowMeta}>{metaOf(row, t)}</span>
                    {!readonly && (
                      <button
                        type="button"
                        className={css.rowAction}
                        title={t('action.restore')}
                        aria-label={t('action.restore')}
                        onClick={event => { event.stopPropagation(); void onArchive(row, false) }}
                      >
                        <IconRefreshOutline14 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className={css.importBox}>
              <button
                type="button"
                className={css.archiveHeader}
                style={{ width: '100%', margin: 0, padding: '6px 0' }}
                aria-expanded={importing}
                onClick={() => {
                  setImporting(value => !value)
                  setImportDir('')
                  setImportProbe(null)
                }}
              >
                {importing ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
                {t('import.toggle')}
              </button>
              {importing && (
                <div className={css.form} style={{ margin: '6px 0 0' }}>
                  {workspaces.length === 0 ? (
                    <span className={css.importNote}>{t('space.noWorkspace')}</span>
                  ) : (
                    <select
                      className={css.input}
                      value={importDir}
                      onChange={event => { void probeImport(event.target.value) }}
                    >
                      <option value="">{t('import.pick')}</option>
                      {workspaces.map(workspace => (
                        <option key={workspace.workspaceId} value={workspace.path}>{workspace.title}</option>
                      ))}
                    </select>
                  )}
                  {importProbe !== null && (
                    importProbe.count === 0 ? (
                      <span className={css.importNote}>{t('import.none')}</span>
                    ) : (
                      <>
                        <span className={css.importNote}>{t('import.found', { count: String(importProbe.count) })}</span>
                        <button
                          type="button"
                          className={css.primaryButton}
                          disabled={readonly || busy}
                          title={readonly ? t('space.readonly') : undefined}
                          onClick={() => { void submitImport() }}
                        >
                          {t('import.go')}
                        </button>
                      </>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
