/**
 * The canvas space page: the root-scoped `main` panel — the canvas list
 * column (create / switch / archive / v1 import) beside the current board.
 *
 * Root scope owns no session: workspace context arrives through the standard
 * `useWorkspaces` hook, and the fence for a mutation rides the CURRENTLY
 * SELECTED session (`useSessions(s => s.current)`) — the host re-roots that
 * session's mode at the deployment state dir. With no session selected the
 * page is read-only: the board shows, every mutating control stays hidden.
 *
 * Both standard hooks are read with a constant fallback: `provideRoot` is a
 * roster, so a composition without ui-session / ui-workspace hands no prop at
 * all (the renderer materializes provided sources only), and the space must
 * still boot there — list and board reads need neither hook.
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
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasSpacePageProps } from '../contract.ts'
import {
  summarizeBoard,
  type BoardCardKind, type BoardCardStatus, type BoardMutationResult,
  type CanvasBoard, type CanvasError, type CanvasSummary,
} from '../../types.ts'
import { BoardView, type BoardActions } from './BoardView.tsx'
import css from './CanvasSpacePage.module.css'

/** How long a transient toast stays up. */
const TOAST_MS = 2200

/** Locale keys the page's mutation toasts use. */
type CanvasKey = Parameters<CanvasSpacePageProps['t']>[0]

/** Fallbacks for the two standard hooks a minimal composition may not provide. */
const useNoSessions = ((selector: (snapshot: { current: undefined }) => unknown) =>
  selector({ current: undefined })) as unknown as CanvasSpacePageProps['useSessions']
const useNoWorkspaces = ((selector: (snapshot: { items: readonly [] }) => unknown) =>
  selector({ items: [] })) as unknown as CanvasSpacePageProps['useWorkspaces']

/** True when a promise rejection or remote failure carries a usable message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The canvas space page. */
export function CanvasSpacePage(props: CanvasSpacePageProps): ReactNode {
  const {
    t, listCanvases, createCanvas, readBoard, putCard, patchCard, addComment,
    archiveCanvas, importV1, probeV1Pad,
  } = props
  const useSessions = props.useSessions ?? useNoSessions
  const useWorkspaces = props.useWorkspaces ?? useNoWorkspaces
  const sessionId = useSessions(sessions => sessions.current)
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const readonly = sessionId === undefined

  const [canvases, setCanvases] = useState<readonly CanvasSummary[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openBoard, setOpenBoard] = useState<{ board: CanvasBoard; version: string } | null>(null)
  const [filter, setFilter] = useState<'all' | BoardCardKind>('all')
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftKind, setDraftKind] = useState<BoardCardKind | null>(null)
  const [showArchivedList, setShowArchivedList] = useState(false)
  const [showArchivedCards, setShowArchivedCards] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [attachPicks, setAttachPicks] = useState<ReadonlySet<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importDir, setImportDir] = useState('')
  const [importProbe, setImportProbe] = useState<{ dir: string; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  const toastTimerRef = useRef<number | null>(null)
  const boardRef = useRef(openBoard)
  boardRef.current = openBoard
  const openIdRef = useRef(openId)
  openIdRef.current = openId

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => { setToast(null) }, TOAST_MS)
  }, [])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  /** Localized copy for one shared error code. */
  const errorText = useCallback((error: CanvasError): string => {
    switch (error) {
      case 'exists': return t('error.exists')
      case 'stale': return t('error.stale')
      case 'missing': return t('error.missing')
      case 'invalid-name': return t('error.invalidName')
      case 'denied': return t('error.denied')
      default: return t('error.io')
    }
  }, [t])

  /** Unwrap the transport envelope, reporting a failure instead of throwing. */
  const run = useCallback(async <T,>(call: () => Promise<RemoteResult<T>>): Promise<T | null> => {
    try {
      const result = await call()
      if (result.ok) return result.value
      setFatal(result.error.message)
      return null
    } catch (error) {
      setFatal(messageOf(error))
      return null
    }
  }, [])

  /* ---------------------------------------------------------------- loading */

  const reloadList = useCallback(async () => {
    const value = await run(() => listCanvases())
    if (value !== null) setCanvases(value.items)
  }, [listCanvases, run])

  useEffect(() => { void reloadList() }, [reloadList])

  // Open the most recently active canvas once the list is known.
  useEffect(() => {
    if (openId !== null || canvases === null || canvases.length === 0) return
    const first = canvases.find(canvas => canvas.archivedAt === null) ?? canvases[0]
    if (first !== undefined) setOpenId(first.id)
  }, [canvases, openId])

  // Load the open canvas's board; it re-reads only on a switch (mutations
  // return the fresh board themselves).
  useEffect(() => {
    if (openId === null) {
      setOpenBoard(null)
      return
    }
    let cancelled = false
    void (async () => {
      const value = await run(() => readBoard({ canvasId: openId }))
      if (cancelled || value === null) return
      if (!value.ok) {
        setOpenBoard(null)
        showToast(errorText(value.error))
        return
      }
      setOpenBoard({ board: value.board, version: value.version })
    })()
    return () => { cancelled = true }
  }, [openId, readBoard, run, showToast, errorText])

  /** Switch the open canvas, resetting the board-local UI state with it. */
  const openCanvas = useCallback((id: string) => {
    setOpenId(id)
    setFilter('all')
    setSelection(new Set())
    setEditingId(null)
    setDraftKind(null)
    setShowArchivedCards(false)
  }, [])

  /* ------------------------------------------------------------- mutations */

  /**
   * Run one board mutation: the service answers the fresh board, so the page
   * applies it in place when it IS the open canvas (a row-level archive of
   * another canvas only refreshes the list); the list reloads either way.
   */
  const mutate = useCallback(async (
    call: () => Promise<RemoteResult<BoardMutationResult>>,
    toastKey: CanvasKey,
    toastParams?: Record<string, string>,
  ): Promise<boolean> => {
    const value = await run(call)
    if (value === null) return false
    if (!value.ok) {
      showToast(errorText(value.error))
      return false
    }
    if (value.board.id === openIdRef.current) {
      setOpenBoard({ board: value.board, version: value.version })
    }
    void reloadList()
    showToast(t(toastKey, toastParams))
    return true
  }, [run, reloadList, showToast, errorText, t])

  /** The board gestures the view can ask for. */
  const actions: BoardActions = {
    submitDraft: text => {
      if (sessionId === undefined || openId === null || draftKind === null) return
      void mutate(() => putCard(sessionId, { canvasId: openId, kind: draftKind, text }), 'toast.cardAdded')
    },
    saveCard: (cardId, text) => {
      if (sessionId === undefined || openId === null) return
      void mutate(() => patchCard(sessionId, { canvasId: openId, cardId, text }), 'toast.cardSaved')
    },
    setCardStatus: (cardId, status) => {
      if (sessionId === undefined || openId === null) return
      const card = boardRef.current?.board.cards.find(candidate => candidate.id === cardId)
      const toastKey: CanvasKey = status === 'archived'
        ? (card?.status === 'proposed' ? 'toast.rejected' : 'toast.cardArchived')
        : (card?.status === 'proposed' ? 'toast.accepted' : 'toast.cardRestored')
      void mutate(() => patchCard(sessionId, { canvasId: openId, cardId, status }), toastKey)
      if (status === 'archived') {
        setSelection(current => {
          if (!current.has(cardId)) return current
          const next = new Set(current)
          next.delete(cardId)
          return next
        })
        if (editingId === cardId) setEditingId(null)
      }
    },
    markAnswered: cardId => {
      if (sessionId === undefined || openId === null) return
      void mutate(() => patchCard(sessionId, { canvasId: openId, cardId, question: { state: 'answered' } }), 'toast.answered')
    },
    comment: (cardId, text) => {
      if (sessionId === undefined || openId === null) return
      void mutate(() => addComment(sessionId, { canvasId: openId, cardId, text }), 'toast.commented')
    },
    archiveSelected: () => {
      if (sessionId === undefined || openId === null || selection.size === 0) return
      const ids = [...selection]
      setSelection(new Set())
      void (async () => {
        let archived = 0
        for (const cardId of ids) {
          const value = await run(() => patchCard(sessionId, { canvasId: openId, cardId, status: 'archived' as BoardCardStatus }))
          if (value === null) return
          if (!value.ok) {
            showToast(errorText(value.error))
            break
          }
          setOpenBoard({ board: value.board, version: value.version })
          archived += 1
        }
        if (archived > 0) {
          showToast(t('toast.cardsArchived', { count: String(archived) }))
          void reloadList()
        }
      })()
    },
  }

  /* --------------------------------------------------------- canvas gestures */

  const submitCreate = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (sessionId === undefined || busy) return
    const title = newTitle.trim()
    if (title.length === 0) {
      showToast(t('toast.needTitle'))
      return
    }
    setBusy(true)
    try {
      const value = await run(() => createCanvas(sessionId, { title, attachedWorkspaces: [...attachPicks] }))
      if (value === null) return
      if (!value.ok) {
        showToast(errorText(value.error))
        return
      }
      setCreating(false)
      setNewTitle('')
      setAttachPicks(new Set())
      showToast(t('toast.canvasCreated', { title: value.board.title }))
      setCanvases(current => [summarizeBoard(value.board), ...(current ?? [])])
      openCanvas(value.board.id)
      setOpenBoard({ board: value.board, version: value.version })
    } finally {
      setBusy(false)
    }
  }, [sessionId, busy, newTitle, attachPicks, createCanvas, run, showToast, errorText, t, openCanvas])

  const setCanvasArchived = useCallback(async (row: CanvasSummary, archived: boolean) => {
    if (sessionId === undefined) return
    await mutate(
      () => archiveCanvas(sessionId, { canvasId: row.id, archived }),
      archived ? 'toast.canvasArchived' : 'toast.canvasRestored',
      { title: row.title },
    )
  }, [sessionId, archiveCanvas, mutate])

  const probeImport = useCallback(async (dir: string) => {
    setImportDir(dir)
    setImportProbe(null)
    if (dir === '') return
    const value = await run(() => probeV1Pad({ dir }))
    if (value === null) return
    setImportProbe({ dir, count: value.items.length })
  }, [probeV1Pad, run])

  const submitImport = useCallback(async () => {
    if (sessionId === undefined || importProbe === null || importProbe.count === 0) return
    setBusy(true)
    try {
      const value = await run(() => importV1(sessionId, { dir: importProbe.dir }))
      if (value === null) return
      if (!value.ok) {
        showToast(errorText(value.error))
        return
      }
      showToast(t('import.done', { count: String(value.imported), title: value.board.title }))
      setImporting(false)
      setImportDir('')
      setImportProbe(null)
      setCanvases(current => [summarizeBoard(value.board), ...(current ?? [])])
      openCanvas(value.board.id)
      setOpenBoard({ board: value.board, version: value.version })
    } finally {
      setBusy(false)
    }
  }, [sessionId, importProbe, importV1, run, showToast, errorText, t, openCanvas])

  /* -------------------------------------------------------------- rendering */

  const active = canvases?.filter(canvas => canvas.archivedAt === null) ?? []
  const archivedRows = canvases?.filter(canvas => canvas.archivedAt !== null) ?? []

  return (
    <div className={css.root}>
      <aside className={css.list}>
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
            }}
          >
            <IconPlusOutline16 size={12} />
            {t('space.new')}
          </button>
        </div>

        <div className={css.listBody}>
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
              <div className={css.formActions}>
                <button type="submit" className={css.primaryButton}>{t('space.create')}</button>
                <button type="button" className={css.ghostButton} onClick={() => { setCreating(false) }}>
                  {t('space.cancel')}
                </button>
              </div>
            </form>
          )}

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
                onClick={() => { openCanvas(row.id) }}
              >
                <span className={css.canvasRowTitle}>{row.title}</span>
                <span className={css.canvasRowMeta}>{metaOf(row, t)}</span>
                {!readonly && (
                  <button
                    type="button"
                    className={css.rowAction}
                    title={t('action.archive')}
                    aria-label={t('action.archive')}
                    onClick={event => { event.stopPropagation(); void setCanvasArchived(row, true) }}
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
                aria-expanded={showArchivedList}
                onClick={() => { setShowArchivedList(value => !value) }}
              >
                {showArchivedList ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
                {t('space.archived', { count: String(archivedRows.length) })}
              </button>
              {showArchivedList && archivedRows.map(row => (
                <div
                  key={row.id}
                  className={css.canvasRow}
                  data-active={row.id === openId || undefined}
                  onClick={() => { openCanvas(row.id) }}
                >
                  <span className={css.canvasRowTitle}>{row.title}</span>
                  <span className={css.canvasRowMeta}>{metaOf(row, t)}</span>
                  {!readonly && (
                    <button
                      type="button"
                      className={css.rowAction}
                      title={t('action.restore')}
                      aria-label={t('action.restore')}
                      onClick={event => { event.stopPropagation(); void setCanvasArchived(row, false) }}
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
      </aside>

      {openBoard !== null && openId !== null && openBoard.board.id === openId ? (
        <BoardView
          t={t}
          readonly={readonly}
          board={openBoard.board}
          filter={filter}
          onFilter={setFilter}
          selection={selection}
          onToggleSelect={cardId => {
            setSelection(current => {
              const next = new Set(current)
              if (next.has(cardId)) next.delete(cardId)
              else next.add(cardId)
              return next
            })
          }}
          onClearSelection={() => { setSelection(new Set()) }}
          editingId={editingId}
          onEditingChange={setEditingId}
          draftKind={draftKind}
          onDraftKindChange={setDraftKind}
          actions={actions}
          showArchived={showArchivedCards}
          onToggleArchived={() => { setShowArchivedCards(value => !value) }}
        />
      ) : (
        <section className={css.main}>
          <div className={css.notice}>
            {canvases === null || openId !== null ? t('state.loading') : t('space.empty')}
          </div>
        </section>
      )}

      {toast !== null && <div className={css.toast}>{toast}</div>}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}

/** The row's meta line: card and open-question counts plus a relative time. */
function metaOf(row: CanvasSummary, t: CanvasSpacePageProps['t']): string {
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
