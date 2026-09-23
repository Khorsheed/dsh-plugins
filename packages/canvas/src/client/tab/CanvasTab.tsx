/**
 * The canvas tab: the board page of the right-Sidebar dock. The topbar owns the
 * canvas switcher (create/switch/archive/import), the attach chips, and the
 * new-card menu; the page below it is the board.
 *
 * Since stage ⑧ this page has exactly one subject: clicking a card body opens
 * that card in its OWN detail tab (`openCardDetail`), and ＋新卡 opens the
 * canvas's draft tab. There is no drill-down state here — which also means the
 * board's own scroll position and filters survive an edit.
 *
 * State model: the open canvas and board freshness ride the shared selection
 * store (`useSelection`) — gestures write it, the turn watch touches its rev,
 * and the tab re-reads. The tab reports the open canvas to the host
 * (`focusCanvas`) so the MAIN session's canvas tools target it; the wide-mode
 * suggestion fires once per session.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconFolderOpenOutline16, IconPlusOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasTabProps } from '../contract.ts'
import {
  enabledCategories, summarizeBoard,
  type BoardAskAgentRequest, type BoardCardStatus,
  type BoardMutationResult, type CanvasBoard, type CanvasError, type CanvasSummary, type CardCategoryId,
} from '../../types.ts'
import { cardTitleOf } from '../../card-format.ts'
import { COMPOSE_SEND_TEXT } from '../../prompt.ts'
import { categoryLabelMap, categoryLabelOf, kindIconOf } from '../category-label.ts'
import { canvasErrorText } from '../error-text.ts'
import { BoardView, type BoardActions } from '../space/BoardView.tsx'
import { LinkView, type LayoutPatch } from '../space/LinkView.tsx'
import { CanvasSwitcher } from './CanvasSwitcher.tsx'
import css from './CanvasTab.module.css'
// The dropdown panel primitive lives with the board styles (the switcher's
// own module — a copy here was dead CSS and the M3.1 topbar bug's source).
import boardCss from '../space/board.module.css'

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
    t, listCanvases, createCanvas, readBoard, patchCard, addComment,
    archiveCanvas, setCategories: writeCategories, setLayout: writeLayout, openCanvas: showCanvas,
    openCardDetail, openCardDraft, focusCanvas,
    askAgent, chatStatus, openSideChat, suggestWideMode,
    useSelection,
  } = props
  const sessionId = props.sessionId
  const useWorkspaces = props.useWorkspaces ?? useNoWorkspaces
  const selection = useSelection(current => current)
  const openId = selection.canvasId
  const selectionRev = selection.rev
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const readonly = sessionId === undefined

  const [canvases, setCanvases] = useState<readonly CanvasSummary[] | null>(null)
  const [openBoard, setOpenBoard] = useState<{ board: CanvasBoard; version: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | CardCategoryId>('all')
  const [selection_, setCardSelection] = useState<ReadonlySet<string>>(new Set())
  const [newCardMenu, setNewCardMenu] = useState(false)
  const [showArchivedCards, setShowArchivedCards] = useState(false)
  /** Which face of the board this page shows (stage ⑥): edit, or group. */
  const [view, setView] = useState<'board' | 'link'>('board')
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
  const errorText = useCallback((error: CanvasError): string => canvasErrorText(t, error), [t])

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
  // rev says a board changed (this tab, a DETAIL tab, or the agent through the
  // turn watch). The read row is folded back into the list, because a write
  // from another seat moves this canvas's card count without this tab knowing.
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
      const row = summarizeBoard(value.board)
      setCanvases(current => current === null
        ? current
        : current.map(canvas => canvas.id === row.id ? row : canvas))
    })()
    return () => { cancelled = true }
  }, [openId, selectionRev, readBoard, run, errorText])

  /** Switch the open canvas, resetting the board-local UI state with it. */
  const openCanvas = useCallback((id: string) => {
    showCanvas(id)
    setFilter('all')
    setCardSelection(new Set())
    setShowArchivedCards(false)
    // The view is not board state: a new canvas starts on the face you edit.
    setView('board')
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
    // The batch 「改分类」: one patchCard per card, in sequence — each write
    // presents the token the last one returned, so a parallel fan-out would
    // fail its own version guard on every call after the first.
    refileSelected: kind => {
      if (sessionId === undefined || openId === null || selection_.size === 0) return
      const ids = [...selection_]
      setCardSelection(new Set())
      void (async () => {
        let moved = 0
        for (const cardId of ids) {
          const value = await run(() => patchCard(sessionId, { canvasId: openId, cardId, kind }))
          if (value === null) return
          if (!value.ok) {
            showToast(errorText(value.error))
            break
          }
          setOpenBoard({ board: value.board, version: value.version })
          moved += 1
        }
        if (moved > 0) {
          const target = boardRef.current?.board.categories.find(row => row.id === kind)
          showToast(t('toast.cardsMoved', {
            count: String(moved),
            kind: target === undefined ? kind : categoryLabelOf(target, t),
          }))
          void reloadList()
        }
      })()
    },
    // The catalog write (stage ⑤): rename, add and retire are all one verb, and
    // the cards a retirement costs ride the SAME rewrite.
    setCategories: (categories, archiveCardIds) => {
      if (sessionId === undefined || openId === null) return
      if (archiveCardIds.length > 0) {
        const gone = new Set(archiveCardIds)
        setCardSelection(current => {
          const next = new Set([...current].filter(id => !gone.has(id)))
          return next.size === current.size ? current : next
        })
      }
      void mutate(
        () => writeCategories(sessionId, {
          canvasId: openId,
          categories,
          ...(archiveCardIds.length === 0 ? {} : { archiveCardIds }),
        }),
        'toast.catsSaved',
      )
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

  /**
   * One layout write (stage ⑥): the link view commits a gesture as ONE call,
   * because a lane drag moves a dozen cards and a fan-out of per-card patches
   * would both fail its own version guard and show a dozen rewrites. The note
   * is the view's own words, so this path takes text, not a dictionary key.
   */
  const layout = useCallback((patch: LayoutPatch): void => {
    if (sessionId === undefined || openId === null) return
    void (async () => {
      const value = await run(() => writeLayout(sessionId, { canvasId: openId, ...patch }))
      if (value === null) return
      if (!value.ok) {
        showToast(errorText(value.error))
        return
      }
      setOpenBoard({ board: value.board, version: value.version })
    })()
  }, [sessionId, openId, writeLayout, run, showToast, errorText])

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
        {/* The board's two faces (stage ⑥): 卡板 is where a card gets edited,
            连线 is where cards get grouped. Both are the same board, so the
            switch sits beside it and not inside either view. */}
        {openBoard !== null && loadError === null && (
          <span className={css.viewSwitch}>
            <button
              type="button"
              className={css.viewButton}
              data-on={view === 'board' || undefined}
              aria-pressed={view === 'board'}
              onClick={() => { setView('board') }}
            >
              {t('view.board')}
            </button>
            <button
              type="button"
              className={css.viewButton}
              data-on={view === 'link' || undefined}
              aria-pressed={view === 'link'}
              onClick={() => { setView('link') }}
            >
              {t('view.link')}
            </button>
          </span>
        )}
        {readonly && <span className={css.readonlyHint}>{t('space.readonly')}</span>}
        {/* Gated on an OPEN canvas: a new card has nowhere to be saved with
            none, and a silent dead button is worse than an absent one. */}
        {!readonly && openId !== null && (
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
                {(openBoard === null ? [] : enabledCategories(openBoard.board.categories)).map(category => {
                  const KindIcon = kindIconOf(category.id)
                  const label = categoryLabelOf(category, t)
                  return (
                    <button
                      key={category.id}
                      type="button"
                      className={css.backButton}
                      onClick={() => {
                        setNewCardMenu(false)
                        // The draft is a TAB of its own (stage ⑧): one draft
                        // address per canvas, so picking another kind
                        // re-categorizes the open draft instead of seating a
                        // second blank tab.
                        openCardDraft(openId, category.id, label)
                      }}
                    >
                      {KindIcon === undefined
                        ? <span className={css.menuIconSlot} aria-hidden="true" />
                        : <KindIcon size={12} />}
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </span>
        )}
      </header>

      {openBoard !== null && loadError === null ? (
        view === 'link' ? (
          <LinkView
            t={t}
            readonly={readonly}
            board={openBoard.board}
            labels={categoryLabelMap(openBoard.board.categories, t)}
            selection={selection_}
            onToggleSelect={cardId => {
              setCardSelection(current => {
                const next = new Set(current)
                if (next.has(cardId)) next.delete(cardId)
                else next.add(cardId)
                return next
              })
            }}
            onAddSelection={cardIds => {
              setCardSelection(current => {
                const next = new Set(current)
                for (const cardId of cardIds) next.add(cardId)
                return next.size === current.size ? current : next
              })
            }}
            onClearSelection={() => { setCardSelection(new Set()) }}
            onOpenDetail={cardId => {
              if (openId === null) return
              const card = openBoard?.board.cards.find(candidate => candidate.id === cardId)
              openCardDetail(openId, cardId, card === undefined ? cardId : cardTitleOf(card.text))
            }}
            chatAvailable={chatAvailable === true}
            onAsk={(cardIds, text) => { void ask({ lens: 'ask', cardIds: [...cardIds], text }) }}
            onLayout={layout}
            onToast={showToast}
          />
        ) : (
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
              if (openId === null) return
              // The chip's live text travels as params (the host freezes
              // `title` at open time), and it is the SAME rule the prompt
              // shows the agent — the tab and the model never disagree on what
              // a card is called.
              const card = openBoard?.board.cards.find(candidate => candidate.id === cardId)
              openCardDetail(openId, cardId, card === undefined ? cardId : cardTitleOf(card.text))
            }}
            chatAvailable={chatAvailable === true}
            onAsk={lens => { void ask({ lens, cardIds: [...selection_] }) }}
            onCompose={() => { void ask({ lens: 'ask', cardIds: [...selection_], text: COMPOSE_SEND_TEXT }) }}
            onFollowUp={(cardId, commentText) => {
              void ask({ lens: 'ask', cardIds: [cardId], text: t('chat.followupText', { text: commentText }) })
            }}
            actions={actions}
            showArchived={showArchivedCards}
            onToggleArchived={() => { setShowArchivedCards(value => !value) }}
          />
        )
      ) : (
        <div className={css.notice}>
          {loadError ?? (canvases === null ? t('state.loading') : t('space.empty'))}
        </div>
      )}

      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />
      )}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
    </div>
  )
}
