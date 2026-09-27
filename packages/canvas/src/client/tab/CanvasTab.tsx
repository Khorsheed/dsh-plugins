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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconArchiveOutlineMedium, IconFolderOpenOutlineMedium, IconPlusOutlineMedium, IconTrashOutlineMedium } from '../icons.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasTabProps } from '../contract.ts'
import {
  enabledCategories, summarizeBoard,
  type BoardCardStatus,
  type BoardLink, type BoardMutationResult, type CanvasBoard, type CanvasError, type CanvasStroke,
  type CanvasSummary, type CardCategoryId,
} from '../../types.ts'
import { cardTitleOf } from '../../card-format.ts'
import { categoryLabelMap, categoryLabelOf, kindIconOf } from '../category-label.ts'
import { canvasErrorText } from '../error-text.ts'
import { BoardView, shownCardsOf, type BoardActions } from '../space/BoardView.tsx'
import { LinkView, type LayoutPatch } from '../space/LinkView.tsx'
import { cardTabId, draftTabId } from '../space/selection.ts'
import { CanvasDetailView } from '../detail/CanvasDetailView.tsx'
import { CanvasSwitcher } from './CanvasSwitcher.tsx'
import { TabStrip, type StripTab } from './TabStrip.tsx'
import { basenameOf, messageOf } from '../text.ts'
import { useDismiss } from '../use-dismiss.ts'
import { cardsQuoteOf, commentQuoteOf } from '../quote.ts'
import { MoreMenu } from '../more-menu.tsx'
import { ConfirmDelete, type DeleteAsk } from '../confirm-delete.tsx'
import css from './CanvasTab.module.css'
// The dropdown panel primitive lives with the board styles (the switcher's
// own module — a copy here was dead CSS and the M3.1 topbar bug's source).
import boardCss from '../space/board.module.css'

/** Fallback for the workspaces hook a minimal composition may not provide. */
const useNoWorkspaces = ((selector: (snapshot: { items: readonly [] }) => unknown) =>
  selector({ items: [] })) as unknown as CanvasTabProps['useWorkspaces']

/** How often an in-view tab re-reads the open board (the main session's writes are unannounced). */
const BOARD_POLL_MS = 4000

/** One open draft's content, held by the row that owns it. */
interface DraftContent {
  readonly text: string
  readonly draw: readonly CanvasStroke[]
}

/** Whether a draft holds anything worth asking about. */
function dirtyOf(draft: DraftContent | undefined): boolean {
  return draft !== undefined && (draft.text.trim().length > 0 || draft.draw.length > 0)
}

/** One canvas's board view, as it was when the user last left it. */
interface BoardViewMemory {
  readonly filter: 'all' | CardCategoryId
  readonly picked: ReadonlySet<string>
  /** Which face of the board (stage ⑥): edit, or group. */
  readonly face: 'board' | 'link'
  readonly showArchived: boolean
  /** The wire picked on the 连线 face. */
  readonly wire: BoardLink | null
}

/** A canvas nobody has looked at yet: every card, the edit face, nothing picked. */
const FRESH_VIEW: BoardViewMemory = {
  filter: 'all', picked: new Set(), face: 'board', showArchived: false, wire: null,
}

/** Leaving a draft that holds words: × closes the canvas row, ‹ goes back to its board. */
interface DiscardAsk {
  readonly rowId: string
  readonly canvasId: string
  readonly then: 'close' | 'back'
}

/** The canvas tab: the strip plus the row it is showing. */
export function CanvasTab(props: CanvasTabProps): ReactNode {
  const {
    t, listCanvases, createCanvas, readBoard, putCard, patchCard, addComment,
    archiveCanvas, deleteCanvas, deleteCard, setCategories: writeCategories, setLayout: writeLayout, openCanvas: showCanvas,
    openCardDetail, openCardDraft, backToBoard, activateTab, closeTab, focusCanvas,
    talkAvailable, quoteToConversation, refreshBoards, suggestWideMode, images, useImageRev,
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
  /**
   * Each canvas's board view, kept per canvas (scheme B): going into a card
   * and coming back — or turning to another canvas and back — returns the
   * filter, the picked cards, the face and the picked wire as they were.
   */
  const [views, setViews] = useState<Readonly<Record<string, BoardViewMemory>>>({})
  const [newCardMenu, setNewCardMenu] = useState(false)
  /** The one banner; `undo` makes it offer 撤销 (archiving is one click to take back). */
  const [toast, setToast] = useState<{ text: string; seq: number; undo?: () => void } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  /** Every open draft's content, by row id (turning tabs must not lose words). */
  const [drafts, setDrafts] = useState<Readonly<Record<string, DraftContent>>>({})
  /** The discard question: the canvas whose draft is waiting on an answer, and what leaving meant. */
  const [discardAsk, setDiscardAsk] = useState<DiscardAsk | null>(null)
  /** The delete question: the canvas or card waiting on an answer. */
  const [deleteAsk, setDeleteAsk] = useState<DeleteAsk | null>(null)

  const toastSeqRef = useRef(0)
  const newCardRef = useRef<HTMLSpanElement | null>(null)
  useDismiss(newCardRef, newCardMenu, () => { setNewCardMenu(false) })
  const openIdRef = useRef(openId)
  openIdRef.current = openId

  /* ----------------------------------------------------- per-canvas views */

  const view_ = (openId === null ? undefined : views[openId]) ?? FRESH_VIEW
  const { filter, picked: selection_, face: view, showArchived: showArchivedCards, wire } = view_
  /** Change the open canvas's view memory, keeping what the patch leaves alone. */
  const patchView = useCallback((patch: (was: BoardViewMemory) => Partial<BoardViewMemory>) => {
    const id = openIdRef.current
    if (id === null) return
    setViews(all => {
      const was = all[id] ?? FRESH_VIEW
      return { ...all, [id]: { ...was, ...patch(was) } }
    })
  }, [])
  const setFilter = useCallback((next: 'all' | CardCategoryId) => { patchView(() => ({ filter: next })) }, [patchView])
  const setCardSelection = useCallback((
    next: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>),
  ) => {
    patchView(was => ({ picked: typeof next === 'function' ? next(was.picked) : next }))
  }, [patchView])
  const setView = useCallback((face: 'board' | 'link') => { patchView(() => ({ face })) }, [patchView])
  const toggleShowArchived = useCallback(() => { patchView(was => ({ showArchived: !was.showArchived })) }, [patchView])
  const setWire = useCallback((next: BoardLink | null) => { patchView(() => ({ wire: next })) }, [patchView])

  /**
   * Scroll memory, per canvas and face. Each scroller of the board marks itself
   * `data-canvas-scroll`; the root records its offsets as they move, and the
   * board puts them back whenever it shows again — after a card, after another
   * canvas, or after its board finished loading.
   */
  const scrollsRef = useRef(new Map<string, { top: number; left: number }>())
  const onScrollCapture = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.hasAttribute('data-canvas-scroll')) return
    if (openIdRef.current === null) return
    scrollsRef.current.set(`${openIdRef.current}:${target.dataset.canvasScroll ?? ''}`, {
      top: target.scrollTop, left: target.scrollLeft,
    })
  }, [])
  const rootRef = useRef<HTMLDivElement | null>(null)
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
  const showToast = useCallback((text: string, undo?: () => void) => {
    toastSeqRef.current += 1
    setToast({ text, seq: toastSeqRef.current, ...(undo === undefined ? {} : { undo }) })
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

  /** Every row is a canvas now (scheme B), so every row reads as its title. */
  const stripRows = useMemo<readonly StripTab[]>(
    () => selection.tabs.map(row => ({
      id: row.id,
      label: canvases?.find(canvas => canvas.id === row.canvasId)?.title ?? '—',
    })),
    [selection.tabs, canvases],
  )

  /** Forget one canvas's draft words (they were saved, or given up). */
  const dropDraft = useCallback((canvasId: string) => {
    setDrafts(current => {
      const id = draftTabId(canvasId)
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  /** Carry out a leave the user already agreed to. */
  const leave = useCallback((ask: DiscardAsk) => {
    dropDraft(ask.canvasId)
    if (ask.then === 'close') closeTab(ask.rowId)
    else backToBoard(ask.canvasId)
  }, [dropDraft, closeTab, backToBoard])

  /**
   * Leave a canvas row's current place — its × takes the row off the strip,
   * the crumb's ‹ goes back to its board. Either asks once, and only when the
   * row stands on a draft that holds something: a board or a card costs one
   * click to come back to, an unsaved draft costs words.
   */
  const leaveRow = useCallback((rowId: string, then: DiscardAsk['then']) => {
    const row = selection.tabs.find(candidate => candidate.id === rowId)
    if (row === undefined) return
    const ask: DiscardAsk = { rowId, canvasId: row.canvasId, then }
    if (row.at.kind === 'draft' && dirtyOf(drafts[draftTabId(row.canvasId)])) {
      setDiscardAsk(ask)
      return
    }
    leave(ask)
  }, [selection.tabs, drafts, leave])
  const closeRow = useCallback((rowId: string) => { leaveRow(rowId, 'close') }, [leaveRow])

  /** Report one keystroke of a draft, keeping the half that did not change. */
  const setDraftText = useCallback((id: string, text: string) => {
    setDrafts(current => ({ ...current, [id]: { text, draw: current[id]?.draw ?? [] } }))
  }, [])

  const setDraftDraw = useCallback((id: string, draw: readonly CanvasStroke[]) => {
    setDrafts(current => ({ ...current, [id]: { text: current[id]?.text ?? '', draw } }))
  }, [])

  /**
   * The first save. The card lands on its board and the writer goes back there
   * with it: the canvas row steps back to its board and shows what just
   * arrived. The toast lives at the tab's root, so it survives the page it
   * reports on.
   */
  const saveDraft = useCallback(async (
    canvasId: string, kind: CardCategoryId, text: string, draw: readonly CanvasStroke[],
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
    dropDraft(canvasId)
    showToast(t('toast.cardAdded'))
    backToBoard(canvasId)
    return true
  }, [sessionId, putCard, showToast, t, dropDraft, backToBoard])

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

  // The main session's agent writes into the same boards through its canvas
  // tools, and nothing announces those writes to this surface — so while the
  // page is in view, re-read the open board every few seconds (the read effect
  // below keeps the board it has when the version has not moved).
  useEffect(() => {
    if (openId === null) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshBoards()
    }, BOARD_POLL_MS)
    return () => { clearInterval(timer) }
  }, [openId, refreshBoards])

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
      // An unchanged version is the same board: keep the object, so a poll
      // that found nothing new re-renders nothing.
      setOpenBoard(current => current !== null && current.board.id === value.board.id && current.version === value.version
        ? current
        : { board: value.board, version: value.version })
      const row = summarizeBoard(value.board)
      setCanvases(current => current === null
        ? current
        : current.map(canvas => canvas.id === row.id ? row : canvas))
    })()
    return () => { cancelled = true }
  }, [openId, selectionRev, readBoard, run, errorText])

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
    undo?: () => void,
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
    showToast(t(toastKey, toastParams), undo)
    return true
  }, [run, reloadList, showToast, errorText, t])

  /** Take a batch archive back: one kept-write per card, in sequence (each
   *  write presents the token the last one returned). */
  const restoreCards = useCallback((canvasId: string, cardIds: readonly string[]) => {
    if (sessionId === undefined) return
    void (async () => {
      let restored = 0
      for (const cardId of cardIds) {
        const value = await run(() => patchCard(sessionId, { canvasId, cardId, status: 'kept' as BoardCardStatus }))
        if (value === null) return
        if (!value.ok) {
          showToast(errorText(value.error))
          break
        }
        if (value.board.id === openIdRef.current) setOpenBoard({ board: value.board, version: value.version })
        restored += 1
      }
      if (restored > 0) {
        showToast(t('toast.cardsRestored', { count: String(restored) }))
        void reloadList()
      }
    })()
  }, [sessionId, run, patchCard, showToast, errorText, t, reloadList])

  /** The board gestures the view can ask for (editing lives in the card body). */
  const actions: BoardActions = {
    setCardStatus: (cardId, status) => {
      if (sessionId === undefined || openId === null) return
      const card = boardRef.current?.board.cards.find(candidate => candidate.id === cardId)
      const toastKey: Parameters<typeof t>[0] = status === 'archived'
        ? (card?.status === 'proposed' ? 'toast.rejected' : 'toast.cardArchived')
        : (card?.status === 'proposed' ? 'toast.accepted' : 'toast.cardRestored')
      // Archiving a KEPT card offers 撤销; rejecting a proposal does not — its
      // undo would have to un-count the rejection the stats already took.
      const canvasId = openId
      const undo = status === 'archived' && card?.status === 'kept'
        ? () => { void mutate(() => patchCard(sessionId, { canvasId, cardId, status: 'kept' }), 'toast.cardRestored') }
        : undefined
      void mutate(() => patchCard(sessionId, { canvasId: openId, cardId, status }), toastKey, undefined, undo)
      if (status === 'archived') {
        setCardSelection(current => {
          if (!current.has(cardId)) return current
          const next = new Set(current)
          next.delete(cardId)
          return next
        })
      }
    },
    deleteCard: cardId => {
      if (sessionId === undefined || openId === null) return
      setDeleteAsk({ kind: 'card', canvasId: openId, cardId })
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
          const done = ids.slice(0, archived)
          showToast(t('toast.cardsArchived', { count: String(archived) }), () => { restoreCards(openId, done) })
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
      archived
        ? () => { void mutate(() => archiveCanvas(sessionId, { canvasId: row.id, archived: false }), 'toast.canvasRestored', { title: row.title }) }
        : undefined,
    )
  }, [sessionId, archiveCanvas, mutate])

  /**
   * The confirmed delete. A card delete is an ordinary board mutation (the
   * fresh board comes back); a canvas delete leaves no board, so the page
   * clears what it held and the list reloads without it.
   */
  const confirmDelete = useCallback((ask: DeleteAsk) => {
    setDeleteAsk(null)
    if (sessionId === undefined) return
    if (ask.kind === 'card') {
      setCardSelection(current => {
        if (!current.has(ask.cardId)) return current
        const next = new Set(current)
        next.delete(ask.cardId)
        return next
      })
      void mutate(() => deleteCard(sessionId, { canvasId: ask.canvasId, cardId: ask.cardId }), 'toast.cardDeleted')
      return
    }
    void (async () => {
      const value = await run(() => deleteCanvas(sessionId, { canvasId: ask.canvasId }))
      if (value === null) return
      if (!value.ok) {
        showToast(errorText(value.error))
        return
      }
      if (boardRef.current?.board.id === ask.canvasId) setOpenBoard(null)
      setCanvases(current => current?.filter(row => row.id !== ask.canvasId) ?? current)
      showToast(t('toast.canvasDeleted', { title: ask.title }))
      void reloadList()
    })()
  }, [sessionId, mutate, deleteCard, deleteCanvas, run, showToast, errorText, t, reloadList])

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

  /* ------------------------------------------------------------- talk flow */

  // The Agent gestures quote into the session's own input (the 2026-09-27
  // review): the words land in front of the user, who adds a question and
  // sends — no side chat, no preset lens.
  const canTalk = sessionId !== undefined && talkAvailable(sessionId)

  const quote = useCallback((block: string) => {
    if (sessionId === undefined) return
    showToast(quoteToConversation(sessionId, block) ? t('talk.quoted') : t('talk.unavailable'))
  }, [sessionId, quoteToConversation, showToast, t])

  /** Quote cards in board order; `then` is appended after them (开始写作's instruction). */
  const talk = useCallback((cardIds: Iterable<string>, then?: string) => {
    if (openBoard === null) return
    const board = openBoard.board
    const wanted = new Set(cardIds)
    const labels = categoryLabelMap(board.categories, t)
    const cards = board.cards
      .filter(card => wanted.has(card.id))
      .map(card => ({ card, kindLabel: labels.get(card.kind) ?? card.kind }))
    if (cards.length === 0) return
    const block = cardsQuoteOf(t, cards, board.title)
    quote(then === undefined ? block : `${block}\n\n${then}`)
  }, [openBoard, quote, t])

  const followUp = useCallback((cardId: string, commentText: string) => {
    const card = openBoard?.board.cards.find(row => row.id === cardId)
    if (openBoard === null || card === undefined) return
    quote(commentQuoteOf(t, commentText, card, openBoard.board.title))
  }, [openBoard, quote, t])

  /* -------------------------------------------------------------- rendering */

  const onBoard = activeRow?.at.kind === 'board'
  const loadedId = openBoard?.board.id ?? null
  // Put the board's scrollers back where this canvas and face left them (0 for
  // a first visit: the scroller's DOM is shared across canvases).
  useLayoutEffect(() => {
    if (!onBoard || openId === null || loadedId !== openId) return
    for (const node of rootRef.current?.querySelectorAll<HTMLElement>('[data-canvas-scroll]') ?? []) {
      const at = scrollsRef.current.get(`${openId}:${node.dataset.canvasScroll ?? ''}`)
      node.scrollTop = at?.top ?? 0
      node.scrollLeft = at?.left ?? 0
    }
  }, [onBoard, openId, loadedId, view])

  /** Open one card of the open canvas, named the same way the prompt names it. */
  const openCard = useCallback((cardId: string) => {
    if (openId === null) return
    const card = boardRef.current?.board.cards.find(candidate => candidate.id === cardId)
    openCardDetail(openId, cardId, card === undefined ? cardId : cardTitleOf(card.text))
  }, [openId, openCardDetail])

  const openTitle = activeRow === undefined
    ? ''
    : (canvases?.find(canvas => canvas.id === activeRow.canvasId)?.title ?? '—')
  // An archived canvas is read-only on this surface: its banner carries 恢复.
  const archivedRow = openBoard !== null && openBoard.board.archivedAt !== null
    ? summarizeBoard(openBoard.board)
    : null
  const boardReadonly = readonly || archivedRow !== null
  const openCount = activeRow === undefined || openBoard === null
    ? null
    : summarizeBoard(openBoard.board).cardCount

  return (
    <div className={css.root} ref={rootRef} onScrollCapture={onScrollCapture}>
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
      ) : activeRow.at.kind !== 'board' ? (
        // A card, or the canvas's draft, inside the canvas's own row. The crumb
        // row is the way back, and the stepper walks the board's current order
        // (its filter, archived cards aside) without going back first. Keyed
        // per card and per draft: two pages must never share an editor's DOM.
        <CanvasDetailView
          {...props}
          key={activeRow.at.kind === 'card'
            ? cardTabId(activeRow.canvasId, activeRow.at.cardId)
            : draftTabId(activeRow.canvasId)}
          sessionId={sessionId}
          canvasId={activeRow.canvasId}
          cardId={activeRow.at.kind === 'card' ? activeRow.at.cardId : null}
          pathImages={pathImages}
          crumbs={{
            canvasTitle: openTitle,
            heading: activeRow.at.heading,
            siblings: openBoard === null || openBoard.board.id !== activeRow.canvasId
              ? []
              : shownCardsOf(openBoard.board, filter).map(card => card.id),
            onBack: () => { leaveRow(activeRow.id, 'back') },
            onStep: openCard,
          }}
          create={activeRow.at.kind === 'draft' ? {
            kind: activeRow.at.catKind,
            text: drafts[draftTabId(activeRow.canvasId)]?.text ?? '',
            draw: drafts[draftTabId(activeRow.canvasId)]?.draw ?? [],
            onTextChange: text => { setDraftText(draftTabId(activeRow.canvasId), text) },
            onDrawChange: draw => { setDraftDraw(draftTabId(activeRow.canvasId), draw) },
            onSave: (kind, text, draw) => saveDraft(activeRow.canvasId, kind, text, draw),
            onLeave: () => { leaveRow(activeRow.id, 'back') },
            onKind: (kind, label) => { openCardDraft(activeRow.canvasId, kind, label) },
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
            {!boardReadonly && openId !== null && (
              <span className={css.newCardWrap} ref={newCardRef}>
                <button
                  type="button"
                  className={css.actionButton}
                  aria-expanded={newCardMenu}
                  onClick={() => { setNewCardMenu(open => !open) }}
                >
                  <IconPlusOutlineMedium size={12} />
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
                <IconFolderOpenOutlineMedium size={12} />
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
            {/* The canvas's own ⋯: archive is the everyday way to put it away
                (with 撤销); delete is the one door with no way back, so it is
                last, marked, and behind a confirmation. An archived canvas
                carries both of its gestures on its banner instead. */}
            {!boardReadonly && openBoard !== null && loadError === null && (
              <MoreMenu
                label={t('canvas.more')}
                className={css.moreButton}
                items={[
                  { id: 'archive', label: t('action.archiveCanvas'), icon: <IconArchiveOutlineMedium size={13} /> },
                  { id: 'delete', label: t('action.deleteCanvas'), icon: <IconTrashOutlineMedium size={13} />, danger: true },
                ]}
                onSelect={id => {
                  const row = summarizeBoard(openBoard.board)
                  if (id === 'archive') void setCanvasArchived(row, true)
                  else setDeleteAsk({ kind: 'canvas', canvasId: row.id, title: row.title })
                }}
              />
            )}
          </header>
          {archivedRow !== null && (
            <div className={css.archivedBanner} role="status">
              <IconArchiveOutlineMedium size={13} />
              <span>{t('space.archivedBanner')}</span>
              <span className={css.spacer} />
              {!readonly && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setDeleteAsk({ kind: 'canvas', canvasId: archivedRow.id, title: archivedRow.title }) }}
                  >
                    {t('action.deleteForever')}
                  </Button>
                  <Button size="sm" onClick={() => { void setCanvasArchived(archivedRow, false) }}>
                    {t('action.restore')}
                  </Button>
                </>
              )}
            </div>
          )}

          {openBoard !== null && loadError === null ? (
            view === 'link' ? (
              <LinkView
                t={t}
                readonly={boardReadonly}
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
                onOpenDetail={openCard}
                wire={wire}
                onWire={setWire}
                talkAvailable={canTalk}
                onTalk={cardIds => { talk(cardIds) }}
                onWrite={cardIds => { talk(cardIds, t('talk.writeText')) }}
                onLayout={layout}
                onToast={showToast}
              />
            ) : (
              <BoardView
                t={t}
                readonly={boardReadonly}
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
                onOpenDetail={openCard}
                talkAvailable={canTalk}
                onTalk={() => { talk(selection_) }}
                onWrite={() => { talk(selection_, t('talk.writeText')) }}
                onFollowUp={followUp}
                actions={actions}
                showArchived={showArchivedCards}
                onToggleArchived={toggleShowArchived}
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
        <Toast
          key={toast.seq}
          text={toast.text}
          // Long enough to reach for the undo; a plain notice keeps the default.
          {...(toast.undo === undefined ? {} : {
            holdMs: 6000,
            actions: [{
              label: t('toast.undo'),
              onClick: () => { const undo = toast.undo; setToast(null); undo?.() },
            }],
          })}
          onDone={() => { setToast(null) }}
        />
      )}
      {fatal !== null && (
        <div className={css.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>
      )}
      <ConfirmDelete
        t={t}
        ask={deleteAsk}
        onCancel={() => { setDeleteAsk(null) }}
        onConfirm={confirmDelete}
      />
      <Modal
        open={discardAsk !== null}
        onClose={() => { setDiscardAsk(null) }}
        title={t('confirm.discardTitle')}
        closeLabel={t('confirm.close')}
        description={discardBodyOf(discardAsk === null ? undefined : drafts[draftTabId(discardAsk.canvasId)], t)}
        footer={
          <>
            <Button size="sm" onClick={() => { setDiscardAsk(null) }}>
              {t('confirm.keepEditing')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (discardAsk !== null) leave(discardAsk)
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
