/**
 * The canvas tab: the surface itself — the strip of open tabs, and the one row
 * the strip is showing.
 *
 * Two rounds of the same complaint landed here. Stage ⑧ had moved a card's
 * detail OUT of this page and into a tab of the HOST dock, which fixed the
 * drill-down (the board kept its scroll and filters while you edited) but put
 * the tabs one chrome layer away from the board they belonged to: the dock said
 * 画布 for all of them and its × could not be intercepted. Round 3's item ⑥
 * asked for the tabs INSIDE the surface, and that is what `TabStrip` is: a row
 * is a canvas's board, one of its cards, or one card's unsaved draft, and the
 * body below is whichever row is showing.
 *
 * So this component is now a router over one store field (`selection.active`)
 * plus the board page it always was. The card body is the SAME reader stage ⑧
 * shipped (`CanvasDetailView`, told which card to show), just mounted here
 * instead of in a dock tab of its own — and it is keyed by row id, because an
 * editor whose text came from the card you looked at last is a corruption, not
 * a saving.
 *
 * State model: the strip, the open canvas and board freshness all ride the
 * shared selection store (`useSelection`), which is why the strip survives a
 * reload and reaches every seat. Gestures write it, the turn watch touches its
 * rev, and the tab re-reads. A draft's words are the one thing NOT in the store
 * — they live here, keyed by row id, so turning to another tab and back keeps
 * them and closing the row is what drops them (after the question). The tab
 * reports the open canvas to the host (`focusCanvas`) so the MAIN session's
 * canvas tools target the canvas you are actually looking at, and the wide-mode
 * suggestion fires once per session.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconFolderOpenOutline16, IconPlusOutline16, Modal, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasTabProps } from '../contract.ts'
import {
  enabledCategories, summarizeBoard,
  type BoardAskAgentRequest, type BoardCardStatus,
  type BoardMutationResult, type CanvasBoard, type CanvasError, type CanvasStroke,
  type CanvasSummary, type CardCategoryId,
} from '../../types.ts'
import { cardTitleOf } from '../../card-format.ts'
import { COMPOSE_SEND_TEXT } from '../../prompt.ts'
import { categoryLabelMap, categoryLabelOf, kindIconOf } from '../category-label.ts'
import { canvasErrorText } from '../error-text.ts'
import { BoardView, type BoardActions } from '../space/BoardView.tsx'
import { LinkView, type LayoutPatch } from '../space/LinkView.tsx'
import type { CanvasTabRow } from '../space/selection.ts'
import { CanvasDetailView } from '../detail/CanvasDetailView.tsx'
import { CanvasSwitcher } from './CanvasSwitcher.tsx'
import { TabStrip, type StripTab } from './TabStrip.tsx'
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

/** One open draft's content, held by the row that owns it. */
interface DraftContent {
  readonly text: string
  readonly draw: readonly CanvasStroke[]
}

/** Whether a draft holds anything worth asking about. */
function dirtyOf(draft: DraftContent | undefined): boolean {
  return draft !== undefined && (draft.text.trim().length > 0 || draft.draw.length > 0)
}

/** The canvas tab: the strip plus the row it is showing. */
export function CanvasTab(props: CanvasTabProps): ReactNode {
  const {
    t, listCanvases, createCanvas, readBoard, putCard, patchCard, addComment,
    archiveCanvas, setCategories: writeCategories, setLayout: writeLayout, openCanvas: showCanvas,
    openCardDetail, openCardDraft, activateTab, closeTab, focusCanvas,
    askAgent, chatStatus, openSideChat, suggestWideMode, images, useImageRev,
    useSelection,
  } = props
  const sessionId = props.sessionId
  const useWorkspaces = props.useWorkspaces ?? useNoWorkspaces
  const selection = useSelection(current => current)
  const openId = selection.canvasId
  const selectionRev = selection.rev
  const activeRow = selection.tabs.find(row => row.id === selection.active)
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
  /** Every open draft's content, by row id (turning tabs must not lose words). */
  const [drafts, setDrafts] = useState<Readonly<Record<string, DraftContent>>>({})
  /** The discard question: the row whose × is waiting on an answer. */
  const [discardAsk, setDiscardAsk] = useState<string | null>(null)

  const toastSeqRef = useRef(0)
  const openIdRef = useRef(openId)
  openIdRef.current = openId
  const boardRef = useRef(openBoard)
  boardRef.current = openBoard
  /** The first-run auto-open is a convenience, so it happens at most once. */
  const autoOpenedRef = useRef(false)

  // One image subscription for the surface (§10.3): a read landing gives the
  // renderer a FRESH vocabulary object, which is what re-runs its memoized pass.
  const imageRev = useImageRev(current => current)
  const pathImages = useMemo(() => images.vocabulary(), [images, imageRev])

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

  /* ------------------------------------------------------------- the strip */

  /** What one row reads as: a canvas's title, or the heading its subject carries. */
  const labelOf = useCallback((row: CanvasTabRow): string => {
    if (row.kind !== 'board') return row.heading
    return canvases?.find(canvas => canvas.id === row.canvasId)?.title ?? '—'
  }, [canvases])

  const stripRows = useMemo<readonly StripTab[]>(
    () => selection.tabs.map(row => ({ id: row.id, kind: row.kind, label: labelOf(row) })),
    [selection.tabs, labelOf],
  )

  /**
   * Take a row off the strip — asking once, and only when it is a draft that
   * holds something. A board row's close costs one click in the ＋ menu and a
   * card row's costs nothing, so neither is a question; an unsaved draft's
   * costs words, which is exactly what stage ⑧ could not gate (the dock's own ×
   * closes by tab id and offers no interception — this × is ours).
   */
  const closeRow = useCallback((id: string) => {
    const row = selection.tabs.find(candidate => candidate.id === id)
    if (row !== undefined && row.kind === 'draft' && dirtyOf(drafts[id])) {
      setDiscardAsk(id)
      return
    }
    closeTab(id)
  }, [selection.tabs, drafts, closeTab])

  /** Report one keystroke of a draft, keeping the half that did not change. */
  const setDraftText = useCallback((id: string, text: string) => {
    setDrafts(current => ({ ...current, [id]: { text, draw: current[id]?.draw ?? [] } }))
  }, [])

  const setDraftDraw = useCallback((id: string, draw: readonly CanvasStroke[]) => {
    setDrafts(current => ({ ...current, [id]: { text: current[id]?.text ?? '', draw } }))
  }, [])

  /**
   * The first save. The row STAYS and comes back empty: it is where cards get
   * filed, and closing it on a save would take the confirmation toast with it.
   */
  const saveDraft = useCallback(async (
    id: string, canvasId: string, kind: CardCategoryId, text: string, draw: readonly CanvasStroke[],
  ): Promise<boolean> => {
    if (sessionId === undefined) return false
    const trimmed = text.trim()
    if (trimmed.length === 0 && draw.length === 0) return false
    const result = await putCard(sessionId, {
      canvasId, kind, text: trimmed,
      ...(draw.length === 0 ? {} : { draw }),
    })
    if (!result.ok) {
      showToast(result.error.message)
      return false
    }
    if (!result.value.ok) {
      showToast(canvasErrorText(t, result.value.error))
      return false
    }
    setDrafts(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    showToast(t('toast.cardAdded'))
    return true
  }, [sessionId, putCard, showToast, t])

  /* ---------------------------------------------------------------- wide mode */

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

  // Put a board on the strip when there is nothing to show yet (a fresh session,
  // or a stash that held nothing) — once, because after the user closes every
  // row by hand, re-opening one would be an argument.
  useEffect(() => {
    if (autoOpenedRef.current || canvases === null || canvases.length === 0) return
    autoOpenedRef.current = true
    if (selection.tabs.length > 0) return
    const first = canvases.find(canvas => canvas.archivedAt === null) ?? canvases[0]
    if (first !== undefined) showCanvas(first.id)
  }, [canvases, selection.tabs.length, showCanvas])

  // Report the open canvas to the host (the main-session tools' target). The
  // store derives it from the SHOWING row, so a card tab points the tools at
  // the canvas that card belongs to.
  useEffect(() => {
    if (sessionId === undefined || openId === null) return
    void focusCanvas(sessionId, { canvasId: openId })
  }, [sessionId, openId, focusCanvas])

  // Load the open canvas's board: on a switch, and again whenever the shared
  // rev says a board changed (this surface, or the agent through the turn
  // watch). The read row is folded back into the list, because a write from
  // another seat moves this canvas's card count without this tab knowing — and
  // the strip's board rows read that count too.
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

  /**
   * Board-local view state belongs to ONE canvas at a time: turning to another
   * canvas's board starts on the face you edit, with no stale filter or
   * selection carried over. A card of the same canvas does not trip this — the
   * derived `openId` does not move, which is what keeps a board's scroll and
   * filters alive across an edit (stage ⑧'s one win, kept).
   */
  useEffect(() => {
    setFilter('all')
    setCardSelection(new Set())
    setShowArchivedCards(false)
    setView('board')
  }, [openId])

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

  /** The board gestures the view can ask for (editing lives in the card body). */
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
    showCanvas(value.board.id)
    setOpenBoard({ board: value.board, version: value.version })
    return true
  }, [sessionId, createCanvas, run, showToast, errorText, t, showCanvas])

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

  const openTitle = activeRow === undefined
    ? ''
    : (canvases?.find(canvas => canvas.id === activeRow.canvasId)?.title ?? '—')
  const openCount = activeRow === undefined || openBoard === null
    ? null
    : summarizeBoard(openBoard.board).cardCount

  return (
    <div className={css.root}>
      <TabStrip
        t={t}
        rows={stripRows}
        active={selection.active}
        onSelect={activateTab}
        onClose={closeRow}
        tail={(
          <CanvasSwitcher
            t={t}
            readonly={readonly}
            canvases={canvases}
            openId={openId}
            workspaces={workspaces}
            onOpen={showCanvas}
            onCreate={submitCreate}
            onArchive={setCanvasArchived}
          />
        )}
      />

      {activeRow === undefined ? (
        // Three different silences. The list is not in yet; the account has no
        // canvas at all; or the user closed every row by hand and the ＋ that
        // ends the argument is right above. Telling only the third one from the
        // other two is how a loading screen claimed 还没有画布.
        <div className={css.notice}>
          {canvases === null ? t('state.loading')
            : canvases.length === 0 ? t('space.empty')
            : t('strip.none')}
        </div>
      ) : activeRow.kind !== 'board' ? (
        // A card, or a draft. The reader is the one stage ⑧ shipped — told
        // which card, holding nothing of the board's — and keyed by row id:
        // two rows of one surface must never share an editor's DOM value.
        <CanvasDetailView
          {...props}
          key={activeRow.id}
          sessionId={sessionId}
          canvasId={activeRow.canvasId}
          cardId={activeRow.kind === 'card' ? activeRow.cardId : null}
          pathImages={pathImages}
          create={activeRow.kind === 'draft' ? {
            kind: activeRow.catKind,
            text: drafts[activeRow.id]?.text ?? '',
            draw: drafts[activeRow.id]?.draw ?? [],
            onTextChange: text => { setDraftText(activeRow.id, text) },
            onDrawChange: draw => { setDraftDraw(activeRow.id, draw) },
            onSave: (kind, text, draw) => saveDraft(activeRow.id, activeRow.canvasId, kind, text, draw),
            onLeave: () => { closeRow(activeRow.id) },
          } : undefined}
        />
      ) : (
        <>
          {/* The board row's own header: its name and counts, the ＋新卡 menu,
              what is attached to it, and which face of it to look at. The NAME
              is no longer a door — the strip above is where you move between
              canvases now — so it is text, not a pill. */}
          <header className={css.topbar}>
            <span className={css.boardTitle} title={openTitle}>{openTitle}</span>
            {openCount !== null && (
              <span className={css.boardCount}>{t('space.metaCards', { count: String(openCount) })}</span>
            )}
            {/* Gated on an OPEN canvas: a new card has nowhere to be saved with
                none, and a silent dead button is worse than an absent one.
                It sits beside the canvas's NAME because it acts on that canvas:
                pinned to the far end of the row, on a wide dock it lands a
                thousand pixels from the thing it adds to, and the first question
                a newcomer asks here is exactly this one. */}
            {!readonly && openId !== null && (
              <span className={css.newCardWrap}>
                <button
                  type="button"
                  className={css.actionButton}
                  aria-expanded={newCardMenu}
                  onClick={() => { setNewCardMenu(open => !open) }}
                >
                  <IconPlusOutline16 size={12} />
                  {t('board.newCard')}
                </button>
                {newCardMenu && (
                  <div className={boardCss.switcherMenu} style={{ width: 160, left: 0, right: 'auto', padding: 4 }}>
                    {(openBoard === null ? [] : enabledCategories(openBoard.board.categories)).map(category => {
                      const KindIcon = kindIconOf(category.id)
                      const label = categoryLabelOf(category, t)
                      return (
                        <button
                          key={category.id}
                          type="button"
                          className={css.menuRow}
                          onClick={() => {
                            setNewCardMenu(false)
                            // The draft is a row of the strip: one draft row per
                            // canvas, so picking another kind re-categorizes the
                            // draft that is open instead of seating a second one.
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
                  // The heading travels on the row, and it is the SAME rule the
                  // prompt shows the agent — the tab and the model never
                  // disagree on what a card is called.
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
              {/* A row is on the strip, so a canvas IS designated — the only
                  question left is whether its board has come back. The
                  "还没有画布" claim is answered one branch up, where an empty
                  account has no row to open at all. */}
              {loadError ?? t('state.loading')}
            </div>
          )}
        </>
      )}

      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />
      )}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
      <Modal
        open={discardAsk !== null}
        onClose={() => { setDiscardAsk(null) }}
        title={t('confirm.discardTitle')}
        closeLabel={t('confirm.close')}
        description={discardBodyOf(drafts[discardAsk ?? ''], t)}
        footer={
          <>
            <Button size="sm" onClick={() => { setDiscardAsk(null) }}>
              {t('confirm.keepEditing')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (discardAsk !== null) closeTab(discardAsk)
                setDiscardAsk(null)
              }}
            >
              {t('confirm.discard')}
            </Button>
          </>
        }
      />
    </div>
  )
}

/** The discard question names what is actually in danger: words, ink, or both. */
function discardBodyOf(draft: DraftContent | undefined, t: CanvasTabProps['t']): string {
  const words = draft?.text.trim().length ?? 0
  const strokes = String(draft?.draw.length ?? 0)
  return words === 0
    ? t('confirm.discardBodyInk', { strokes })
    : (draft?.draw.length ?? 0) > 0
      ? t('confirm.discardBodyBoth', { count: String(words), strokes })
      : t('confirm.discardBody', { count: String(words) })
}
