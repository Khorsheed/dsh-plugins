/**
 * The canvas tab: M3's single seat — the right-Sidebar tab in wide mode,
 * drilling between three pages. The topbar owns the canvas switcher
 * (create/switch/archive/import), the attach chips, the [卡板|成稿] view
 * switch, and the new-card menu; the board page is the existing BoardView;
 * the detail page drills in on a body click (back bar returns); the draft
 * page is the user's own `draft.md` with the v1 editor's invariants.
 *
 * State model: the open canvas, the drilled card, and board freshness all
 * ride the shared selection store (`useSelection`) — gestures write it, the
 * turn watch touches its rev, and the tab re-reads. The tab reports the open
 * canvas to the host (`focusCanvas`) so the MAIN session's canvas tools
 * target it; the wide-mode suggestion fires once per session.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from 'react'
import {
  IconChevronLeftOutline14, IconFolderOpenOutline16, IconPlusOutline16,
  IconCodeOutline16, IconDatabaseOutline16, IconLinkOutline14, IconListPenOutline16,
  IconQuestionOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasTabProps } from '../contract.ts'
import {
  BOARD_CARD_KINDS, summarizeBoard,
  type BoardAskAgentRequest, type BoardCardKind, type BoardCardStatus,
  type BoardMutationResult, type CanvasBoard, type CanvasError, type CanvasSummary,
} from '../../types.ts'
import { CanvasDetailView } from '../detail/CanvasDetailView.tsx'
import { BoardView, type BoardActions } from '../space/BoardView.tsx'
import { CanvasSwitcher } from './CanvasSwitcher.tsx'
import { DraftView } from './DraftView.tsx'
import css from './CanvasTab.module.css'

/** How long a transient toast stays up. */
const TOAST_MS = 2200

/** The tab's two top-level pages (the detail is a drill inside board). */
type TabPage = 'board' | 'draft'

/** The kind icon set for the new-card menu (the board's own vocabulary). */
const KIND_ICONS = {
  fragment: IconListPenOutline16,
  question: IconQuestionOutline14,
  grounding: IconDatabaseOutline16,
  reference: IconLinkOutline14,
  document: IconCodeOutline16,
} as const

/** The last path segment, separators from either platform (display only). */
function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(segment => segment.length > 0)
  return parts[parts.length - 1] ?? path
}

/** Fallback for the workspaces hook a minimal composition may not provide. */
const useNoWorkspaces = ((selector: (snapshot: { items: readonly [] }) => unknown) =>
  selector({ items: [] })) as unknown as CanvasTabProps['useWorkspaces']

/** True when a promise rejection or remote failure carries a usable message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The canvas tab. */
export function CanvasTab(props: CanvasTabProps): ReactNode {
  const {
    t, listCanvases, createCanvas, readBoard, putCard, patchCard, addComment,
    archiveCanvas, importV1, probeV1Pad, selectCard, openCanvas: showCanvas, clearCard, focusCanvas,
    readDraft, writeDraft, askAgent, chatStatus, openSideChat, suggestWideMode,
    useSelection,
  } = props
  const sessionId = props.sessionId
  const useWorkspaces = props.useWorkspaces ?? useNoWorkspaces
  const selection = useSelection(current => current)
  const openId = selection.canvasId
  const detailCardId = selection.cardId
  const selectionRev = selection.rev
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const readonly = sessionId === undefined

  const [page, setPage] = useState<TabPage>('board')
  const [canvases, setCanvases] = useState<readonly CanvasSummary[] | null>(null)
  const [openBoard, setOpenBoard] = useState<{ board: CanvasBoard; version: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | BoardCardKind>('all')
  const [selection_, setCardSelection] = useState<ReadonlySet<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftKind, setDraftKind] = useState<BoardCardKind | null>(null)
  const [newCardMenu, setNewCardMenu] = useState(false)
  const [showArchivedCards, setShowArchivedCards] = useState(false)
  const [chatAvailable, setChatAvailable] = useState<boolean | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  const toastTimerRef = useRef<number | null>(null)
  const openIdRef = useRef(openId)
  openIdRef.current = openId
  const boardRef = useRef(openBoard)
  boardRef.current = openBoard

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

  /* ------------------------------------------------------------- wide mode */

  // The wide-mode suggestion fires once per session (the face dedupes): the
  // user's own controls own the layout from then on.
  const wideFiredRef = useRef(false)
  const tabInfo = props.useTabInfo()
  useEffect(() => {
    if (wideFiredRef.current || sessionId === undefined) return
    wideFiredRef.current = true
    suggestWideMode(sessionId, tabInfo.sidebar.fullscreen)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a one-shot suggestion on mount
  }, [sessionId, suggestWideMode])

  /* ---------------------------------------------------------------- loading */

  const reloadList = useCallback(async () => {
    const value = await run(() => listCanvases())
    if (value !== null) setCanvases(value.items)
  }, [listCanvases, run])

  useEffect(() => { void reloadList() }, [reloadList])

  // Probe the chat seam once per mount (entries hide when side-chat is absent).
  useEffect(() => {
    if (readonly) return
    let cancelled = false
    void (async () => {
      const value = await run(() => chatStatus())
      if (cancelled || value === null) return
      setChatAvailable(value.available)
    })()
    return () => { cancelled = true }
  }, [readonly, chatStatus, run])

  // Open the most recently active canvas once the list is known (and nothing
  // was opened before in this session's store).
  useEffect(() => {
    if (openId !== null || canvases === null || canvases.length === 0) return
    const first = canvases.find(canvas => canvas.archivedAt === null) ?? canvases[0]
    if (first !== undefined) showCanvas(first.id)
  }, [canvases, openId, showCanvas])

  // Report the open canvas to the host (the main-session tools' target).
  useEffect(() => {
    if (sessionId === undefined || openId === null) return
    void focusCanvas(sessionId, { canvasId: openId })
  }, [sessionId, openId, focusCanvas])

  // Load the open canvas's board: on a switch, and again whenever the shared
  // rev says a board changed (either seat's mutation, the turn watch).
  useEffect(() => {
    if (openId === null) {
      setOpenBoard(null)
      return
    }
    const canvasId = openId
    let cancelled = false
    void (async () => {
      const value = await run(() => readBoard({ canvasId }))
      if (cancelled || value === null) return
      if (!value.ok) {
        setOpenBoard(null)
        setLoadError(errorText(value.error))
        return
      }
      setLoadError(null)
      setOpenBoard({ board: value.board, version: value.version })
    })()
    return () => { cancelled = true }
  }, [openId, selectionRev, readBoard, run, errorText])

  /** Switch the open canvas, resetting the board-local UI state with it. */
  const openCanvas = useCallback((id: string) => {
    showCanvas(id)
    setFilter('all')
    setCardSelection(new Set())
    setEditingId(null)
    setDraftKind(null)
    setShowArchivedCards(false)
    setPage('board')
  }, [showCanvas])

  /* ------------------------------------------------------------- mutations */

  /**
   * Run one board mutation: the service answers the fresh board, so the tab
   * applies it in place when it IS the open canvas; the list reloads either
   * way (the switcher's counters move with it).
   */
  const mutate = useCallback(async (
    call: () => Promise<RemoteResult<BoardMutationResult>>,
    toastKey: Parameters<typeof t>[0],
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
      const toastKey: Parameters<typeof t>[0] = status === 'archived'
        ? (card?.status === 'proposed' ? 'toast.rejected' : 'toast.cardArchived')
        : (card?.status === 'proposed' ? 'toast.accepted' : 'toast.cardRestored')
      void mutate(() => patchCard(sessionId, { canvasId: openId, cardId, status }), toastKey)
      if (status === 'archived') {
        setCardSelection(current => {
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
      if (sessionId === undefined || openId === null || selection_.size === 0) return
      const ids = [...selection_]
      setCardSelection(new Set())
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

  const submitCreate = useCallback(async (title: string, attachedWorkspaces: readonly string[]): Promise<boolean> => {
    if (sessionId === undefined) return false
    const value = await run(() => createCanvas(sessionId, { title, attachedWorkspaces }))
    if (value === null) return false
    if (!value.ok) {
      showToast(errorText(value.error))
      return false
    }
    showToast(t('toast.canvasCreated', { title: value.board.title }))
    setCanvases(current => [summarizeBoard(value.board), ...(current ?? [])])
    openCanvas(value.board.id)
    setOpenBoard({ board: value.board, version: value.version })
    return true
  }, [sessionId, createCanvas, run, showToast, errorText, t, openCanvas])

  const setCanvasArchived = useCallback(async (row: CanvasSummary, archived: boolean) => {
    if (sessionId === undefined) return
    await mutate(
      () => archiveCanvas(sessionId, { canvasId: row.id, archived }),
      archived ? 'toast.canvasArchived' : 'toast.canvasRestored',
      { title: row.title },
    )
  }, [sessionId, archiveCanvas, mutate])

  const submitImport = useCallback(async (dir: string): Promise<boolean> => {
    if (sessionId === undefined) return false
    const value = await run(() => importV1(sessionId, { dir }))
    if (value === null) return false
    if (!value.ok) {
      showToast(errorText(value.error))
      return false
    }
    showToast(t('import.done', { count: String(value.imported), title: value.board.title }))
    setCanvases(current => [summarizeBoard(value.board), ...(current ?? [])])
    openCanvas(value.board.id)
    setOpenBoard({ board: value.board, version: value.version })
    return true
  }, [sessionId, importV1, run, showToast, errorText, t, openCanvas])

  /* -------------------------------------------------------------- ask flow */

  const ask = useCallback(async (request: Omit<BoardAskAgentRequest, 'canvasId'>) => {
    if (sessionId === undefined || openId === null) return
    const value = await run(() => askAgent(sessionId, { canvasId: openId, ...request }))
    if (value === null) return
    if (!value.ok) {
      if (value.error === 'unavailable') {
        setChatAvailable(false)
        showToast(t('chat.unavailable'))
        return
      }
      showToast(t('chat.askFailed', { message: errorText(value.error) }))
      return
    }
    openSideChat(value.contextKey)
  }, [sessionId, openId, askAgent, openSideChat, run, showToast, errorText, t])

  /* -------------------------------------------------------------- rendering */

  const drilled = detailCardId !== null

  return (
    <div className={css.root}>
      <header className={css.topbar}>
        <CanvasSwitcher
          t={t}
          readonly={readonly}
          canvases={canvases}
          openId={openId}
          workspaces={workspaces}
          onOpen={openCanvas}
          onCreate={submitCreate}
          onArchive={setCanvasArchived}
          onProbeImport={dir => probeV1Pad({ dir })}
          onImport={submitImport}
        />
        {openBoard?.board.attachedWorkspaces.map(workspace => (
          <span key={workspace} className={css.attachChip} title={workspace}>
            <IconFolderOpenOutline16 size={12} />
            <b>{basenameOf(workspace)}</b>
          </span>
        ))}
        <span className={css.spacer} />
        {readonly && <span className={css.readonlyHint}>{t('space.readonly')}</span>}
        {!drilled && (
          <>
            <span className={css.seg} role="group">
              {(['board', 'draft'] as const).map(candidate => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={page === candidate}
                  onClick={() => { setPage(candidate) }}
                >
                  {candidate === 'board' ? t('view.board') : t('view.draft')}
                </button>
              ))}
            </span>
            {page === 'board' && !readonly && (
              <span className={css.newCardWrap}>
                <button
                  type="button"
                  className={css.backButton}
                  aria-expanded={newCardMenu}
                  onClick={() => { setNewCardMenu(open => !open) }}
                >
                  <IconPlusOutline16 size={12} />
                  {t('board.newCard')}
                </button>
                {newCardMenu && (
                  <div className={css.switcherMenu} style={{ width: 160, left: 'auto', right: 0 }}>
                    {BOARD_CARD_KINDS.map(kind => {
                      const KindIcon = KIND_ICONS[kind]
                      return (
                        <button
                          key={kind}
                          type="button"
                          className={css.backButton}
                          onClick={() => {
                            setNewCardMenu(false)
                            setDraftKind(kind)
                            setPage('board')
                          }}
                        >
                          <KindIcon size={12} />
                          {t(`kind.${kind}`)}
                        </button>
                      )
                    })}
                  </div>
                )}
              </span>
            )}
          </>
        )}
      </header>

      {drilled ? (
        <>
          <div className={css.backBar}>
            <button type="button" className={css.backButton} onClick={() => { clearCard() }}>
              <IconChevronLeftOutline14 size={13} />
              {t('detail.back')}
            </button>
          </div>
          <CanvasDetailView
            {...props}
            sessionId={sessionId}
          />
        </>
      ) : page === 'draft' ? (
        openId === null ? (
          <div className={css.notice}>{t('space.empty')}</div>
        ) : (
          <DraftView
            t={t}
            sessionId={sessionId}
            canvasId={openId}
            rev={selectionRev}
            readDraft={readDraft}
            writeDraft={writeDraft}
            onFatal={setFatal}
          />
        )
      ) : openBoard !== null && loadError === null ? (
        <BoardView
          t={t}
          readonly={readonly}
          board={openBoard.board}
          filter={filter}
          onFilter={setFilter}
          selection={selection_}
          onToggleSelect={cardId => {
            setCardSelection(current => {
              const next = new Set(current)
              if (next.has(cardId)) next.delete(cardId)
              else next.add(cardId)
              return next
            })
          }}
          onClearSelection={() => { setCardSelection(new Set()) }}
          onOpenDetail={cardId => {
            if (openId !== null) selectCard(openId, cardId)
          }}
          chatAvailable={chatAvailable === true}
          onAsk={lens => { void ask({ lens, cardIds: [...selection_] }) }}
          onFollowUp={(cardId, commentText) => {
            void ask({ lens: 'ask', cardIds: [cardId], text: t('chat.followupText', { text: commentText }) })
          }}
          editingId={editingId}
          onEditingChange={setEditingId}
          draftKind={draftKind}
          onDraftKindChange={setDraftKind}
          actions={actions}
          showArchived={showArchivedCards}
          onToggleArchived={() => { setShowArchivedCards(value => !value) }}
        />
      ) : (
        <div className={css.notice}>
          {loadError ?? (canvases === null ? t('state.loading') : t('space.empty'))}
        </div>
      )}

      {toast !== null && <div className={css.toast}>{toast}</div>}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}
