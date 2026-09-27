/**
 * The canvas switcher: the dropdown behind the ＋ at the end of the tab strip.
 * One hierarchy, no redundant headers: the active rows (open on click, archive
 * on hover), the archived well (collapsed, restore), then a bottom "+ 新画布"
 * row that unfolds the inline create form (topic input + attach multi-select +
 * create/cancel).
 *
 * It used to hang off the canvas NAME in the topbar, which was the only way to
 * reach another canvas; the strip now carries one row per open canvas, so this
 * panel's job is putting rows ON the strip and the archive housekeeping. Its
 * trigger is a ＋ (the canvas names are on the strip, not here) and the panel
 * opens leftwards, so it cannot hang past the strip's right edge.
 *
 * The dropdown floats above the row (absolute — its styles live in `../space/
 * board.module.css`, the module this file imports; a copy elsewhere would be
 * dead CSS) and closes on a choice, on Escape, and on outside pointer down.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useRef, useState, type FormEvent, type ReactNode,
} from 'react'
import { IconArchiveOutlineMedium, IconChevronDownOutlineMedium, IconChevronRightOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium } from '../icons.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CanvasSummary } from '../../types.ts'
import type {} from '../locales.ts'
import { agoOf } from '../text.ts'
import { useDismiss } from '../use-dismiss.ts'
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
  /** True when no session can fence writes (create/archive hide). */
  readonly readonly: boolean
  readonly canvases: readonly CanvasSummary[] | null
  readonly openId: string | null
  readonly workspaces: readonly SwitcherWorkspace[]
  readonly onOpen: (canvasId: string) => void
  readonly onCreate: (title: string, attachedWorkspaces: readonly string[]) => Promise<boolean>
  readonly onArchive: (row: CanvasSummary, archived: boolean) => Promise<void>
}

/** The row's meta line: card and open-question counts plus a relative time. */
function metaOf(row: CanvasSummary, t: TranslateNS<'canvas'>): string {
  const parts = [t('space.metaCards', { count: String(row.cardCount) })]
  if (row.openQuestions > 0) parts.push(t('space.metaQuestions', { count: String(row.openQuestions) }))
  const at = Date.parse(row.lastActiveAt)
  if (!Number.isNaN(at)) parts.push(agoOf(at, t))
  return parts.join(' · ')
}

/** The canvas switcher dropdown. */
export function CanvasSwitcher({
  t, readonly, canvases, openId, workspaces, onOpen, onCreate, onArchive,
}: CanvasSwitcherProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [attachPicks, setAttachPicks] = useState<ReadonlySet<string>>(new Set())
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Escape and an outside pointer down both close it (the shared rule). The
  // create form's own Escape still folds just the form: it stops there.
  useDismiss(rootRef, open, () => { setOpen(false) })

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

  return (
    <div className={css.switcher} ref={rootRef}>
      <button
        type="button"
        className={css.switchTrigger}
        title={t('strip.canvases')}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconPlusOutlineMedium size={12} />
        {t('strip.canvases')}
      </button>

      {open && (
        <div className={css.switcherMenu} style={{ left: 'auto', right: 0 }}>
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
                      <IconArchiveOutlineMedium size={13} />
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
                  {showArchived ? <IconChevronDownOutlineMedium size={12} /> : <IconChevronRightOutlineMedium size={12} />}
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
                        <IconRefreshOutlineMedium size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {!readonly && (
            creating ? (
              <form className={css.form} onSubmit={event => { void submitCreate(event) }}>
                <input
                  className={css.input}
                  autoFocus
                  value={newTitle}
                  placeholder={t('space.newPlaceholder')}
                  onChange={event => { setNewTitle(event.target.value) }}
                  onKeyDown={event => {
                    if (event.key !== 'Escape') return
                    event.stopPropagation()
                    setCreating(false)
                  }}
                />
                <span className={css.formLabel}>{t('space.newAttach')}</span>
                {workspaces.length === 0 ? (
                  <span className={css.formNote}>{t('space.noWorkspace')}</span>
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
                {error !== null && <span className={css.formNote}>{error}</span>}
                <div className={css.formActions}>
                  <button type="submit" className={css.primaryButton} disabled={busy}>{t('space.create')}</button>
                  <button type="button" className={css.ghostButton} onClick={() => { setCreating(false) }}>
                    {t('space.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className={css.newCanvasRow}
                onClick={() => {
                  setCreating(true)
                  setNewTitle('')
                  setAttachPicks(new Set())
                  setError(null)
                }}
              >
                <IconPlusOutlineMedium size={12} />
                {t('space.new')}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
