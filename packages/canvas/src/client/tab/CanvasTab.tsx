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
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import {
  IconChevronLeftOutline14, IconFolderOpenOutline16, IconPlusOutline16,
  IconCodeOutline16, IconDatabaseOutline16, IconLinkOutline14, IconListPenOutline16,
  IconQuestionOutline14, Button, Modal, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasTabProps } from '../contract.ts'
import {
  BOARD_CARD_KINDS, summarizeBoard,
  type BoardAskAgentRequest, type BoardCardKind, type BoardCardStatus,
  type BoardMutationResult, type CanvasBoard, type CanvasError,
  type CanvasStroke, type CanvasSummary,
} from '../../types.ts'
import { CanvasDetailView } from '../detail/CanvasDetailView.tsx'
import { BoardView, type BoardActions } from '../space/BoardView.tsx'
import { CanvasSwitcher } from './CanvasSwitcher.tsx'
import { DraftView } from './DraftView.tsx'
import css from './CanvasTab.module.css'
// The dropdown panel primitive lives with the board styles (the switcher's
// own module — a copy here was dead CSS and the M3.1 topbar bug's source).
import boardCss from '../space/board.module.css'

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
    archiveCanvas, selectCard, openCanvas: showCanvas, clearCard, focusCanvas,
    readDraft, writeDraft, askAgent, chatStatus, openSideChat, suggestWideMode,
    images, useImageRev, useSelection,
  } = props
  const sessionId = props.sessionId
  const useWorkspaces = props.useWorkspaces ?? useNoWorkspaces
  const selection = useSelection(current => current)
  // One image subscription for the whole tab (§10.3): a read landing gives the
  // renderer a FRESH vocabulary object, which is what re-runs its memoized
  // pass — and the HTML body rebuilds on the same repaint. Every markdown
  // surface in the tab therefore shows a pasted image at once.
  const imageRev = useImageRev(current => current)
  const pathImages = useMemo(() => images.vocabulary(), [images, imageRev])
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
  /**
   * The new-card draft (v2.2 ②, §11.6 item 5): the topbar's ＋新卡 picks a
   * kind and the DETAIL page carries the draft — the content lives HERE so
   * the exit gesture can ask about it. Nothing touches the disk until the
   * first save, so leaving mid-way is invisible on the board (`ctx.fs`
   * archives, never deletes, so a card written early would be a card to
   * clean up).
   */
  const [newCard, setNewCard] = useState<{
    readonly kind: BoardCardKind
    readonly text: string
    readonly draw: readonly CanvasStroke[]
  } | null>(null)
  /** The discard confirm: set by the exit gesture while the draft has content. */
  const [discardAsk, setDiscardAsk] = useState(false)
  const [newCardMenu, setNewCardMenu] = useState(false)
  const [showArchivedCards, setShowArchivedCards] = useState(false)
  const [chatAvailable, setChatAvailable] = useState<boolean | null>(null)
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  const toastSeqRef = useRef(0)
  const openIdRef = useRef(openId)
  openIdRef.current = openId
  const boardRef = useRef(openBoard)
  boardRef.current = openBoard

  // The host's Toast owns its own timer and reports back here (v2.2: the
  // package's hand-rolled banner div is gone — same job, host's tokens).
  const showToast = useCallback((text: string) => {
    toastSeqRef.current += 1
    setToast({ text, seq: toastSeqRef.current })
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

  // The one-shot layout suggestion fires once per session (the face dedupes):
  // the user's own controls own the layout from then on.
  const wideFiredRef = useRef(false)
  useEffect(() => {
    if (wideFiredRef.current || sessionId === undefined) return
    wideFiredRef.current = true
    suggestWideMode(sessionId)
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
    setNewCard(null)
    setDiscardAsk(false)
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

  /** The board gestures the view can ask for (editing lives in the detail). */
  const actions: BoardActions = {
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

  /* --------------------------------------------------------- card creation */

  /**
   * The draft's first save (v2.2 ②): the ONLY write this flow makes — until
   * here the card exists in memory alone. Words or ink qualify: a drawing is
   * the card's content, not a card missing its caption (§11.4).
   */
  const saveNewCard = useCallback(async (
    kind: BoardCardKind, text: string, draw: readonly CanvasStroke[],
  ): Promise<boolean> => {
    if (sessionId === undefined || openId === null) return false
    const trimmed = text.trim()
    if (trimmed.length === 0 && draw.length === 0) return false
    const saved = await mutate(
      () => putCard(sessionId, {
        canvasId: openId, kind, text: trimmed, ...(draw.length === 0 ? {} : { draw }),
      }),
      'toast.cardAdded',
    )
    if (saved) setNewCard(null)
    return saved
  }, [sessionId, openId, putCard, mutate])

  /**
   * Leave the draft (§11.6 item 5): the back bar and the tab's × are ONE
   * exit, and it asks exactly once — only when the draft holds something,
   * written or drawn. An empty draft leaves silently; a saved card never comes
   * through here (whether a saved card with unclosed edits should also ask is
   * 11.8 ⑥, undecided, and that one is a `patchCard` question anyway).
   */
  const leaveCreate = useCallback(() => {
    if (newCard !== null && (newCard.text.trim().length > 0 || newCard.draw.length > 0)) {
      setDiscardAsk(true)
      return
    }
    setNewCard(null)
  }, [newCard])

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

  const drilled = detailCardId !== null || newCard !== null

  // The discard question names what is actually in danger: words, ink, or both.
  const draftWords = newCard?.text.trim().length ?? 0
  const draftStrokes = String(newCard?.draw.length ?? 0)
  const discardBody = draftWords === 0
    ? t('confirm.discardBodyInk', { strokes: draftStrokes })
    : newCard !== null && newCard.draw.length > 0
      ? t('confirm.discardBodyBoth', { count: String(draftWords), strokes: draftStrokes })
      : t('confirm.discardBody', { count: String(draftWords) })

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
            {/* Gated on an OPEN canvas: the draft has nowhere to be saved with
                none, and a silent dead button is worse than an absent one. */}
            {page === 'board' && !readonly && openId !== null && (
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
                  <div className={boardCss.switcherMenu} style={{ width: 160, left: 'auto', right: 0 }}>
                    {BOARD_CARD_KINDS.map(kind => {
                      const KindIcon = KIND_ICONS[kind]
                      return (
                        <button
                          key={kind}
                          type="button"
                          className={css.backButton}
                          onClick={() => {
                            setNewCardMenu(false)
                            setNewCard({ kind, text: '', draw: [] })
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
            <button
              type="button"
              className={css.backButton}
              onClick={() => { if (newCard !== null) leaveCreate(); else clearCard() }}
            >
              <IconChevronLeftOutline14 size={13} />
              {t('detail.back')}
            </button>
          </div>
          <CanvasDetailView
            {...props}
            sessionId={sessionId}
            pathImages={pathImages}
            create={newCard === null ? undefined : {
              kind: newCard.kind,
              text: newCard.text,
              draw: newCard.draw,
              onTextChange: text => { setNewCard(current => current === null ? current : { ...current, text }) },
              onDrawChange: draw => { setNewCard(current => current === null ? current : { ...current, draw }) },
              onSave: saveNewCard,
              onLeave: leaveCreate,
            }}
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
            pathImages={pathImages}
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
          actions={actions}
          showArchived={showArchivedCards}
          onToggleArchived={() => { setShowArchivedCards(value => !value) }}
        />
      ) : (
        <div className={css.notice}>
          {loadError ?? (canvases === null ? t('state.loading') : t('space.empty'))}
        </div>
      )}

      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />
      )}
      <Modal
        open={discardAsk}
        onClose={() => { setDiscardAsk(false) }}
        title={t('confirm.discardTitle')}
        closeLabel={t('confirm.close')}
        description={discardBody}
        footer={
          <>
            <Button size="sm" onClick={() => { setDiscardAsk(false) }}>
              {t('confirm.keepEditing')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => { setDiscardAsk(false); setNewCard(null) }}
            >
              {t('confirm.discard')}
            </Button>
          </>
        }
      />
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}
