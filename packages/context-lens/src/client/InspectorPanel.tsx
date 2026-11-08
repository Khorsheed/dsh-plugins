import type { SessionTrend } from '../types.ts'
import { Trend } from './Trend.tsx'
import { AgentTabs, ParentLine, ROOM_TAB } from './AgentTabs.tsx'
import { RoomDecisionsView } from './RoomDecisionsView.tsx'
import { continuesText, ExecutionNote, RoomFallbackCard, RoomRecordsNotice, UnattributedNote } from './RoomRecords.tsx'
/** Session/turn/scope navigation; request detail owns its JSON toggle. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelRoot } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type {
  AgentScopeOverview, BackfillInfo, CapturedRequest, ListTurnsResult, TurnListItem, TurnOverview, TurnTiming,
} from '../types.ts'
import { WINDOW_TURNS, fmtSpan, gapShown, isHollowTurn, latestTurnSeq, requestOfLocate, resolveTurnSeq, turnGaps, turnNumber, turnOfLocate, type CompositionFilter, type TurnGap } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import type { RequestInspectorTabParams } from './definition.tsx'
import { foreignLocate, forgetSelection, rememberSelection, takeSelection, type ReadingView } from './member-jump.ts'
import type { RowPlace } from './SegmentBlocks.tsx'
import { locateCallPaging, locateTurnPaging, scrollConversationToBottom, scrollConversationToTurn } from './scroll-sync.ts'
import { SegCtl } from './SegCtl.tsx'
import { TimingView } from './TimingView.tsx'
import { TokenView } from './TokenView.tsx'
import { TurnMenu } from './TurnMenu.tsx'
import css from './InspectorPanel.module.css'

/** The panel's translate face. */
type T = InspectorTabProps['t']

/** The two main views. */
type MainTab = 'token' | 'time'

/** The failure state page — a failed run with 0 requests IS the diagnostic. */
/** A room message's wait, as the round title says it: 「1 分 19 秒」, 「42 秒」. */
export function queuedText(ms: number, t: T): string {
  const total = Math.round(ms / 1000)
  return total >= 60
    ? t('query.queuedMinutes', { m: String(Math.floor(total / 60)), s: String(total % 60) })
    : t('query.queuedSeconds', { s: String(total) })
}

function FailureCard({ scope, t }: { readonly scope: AgentScopeOverview; readonly t: T }) {
  const duration = scope.endedAt === undefined ? '—' : fmtSpan(Math.max(0, scope.endedAt - scope.startedAt))
  return (
    <div className={css.failCard} role="alert">
      <div className={css.failRow}>
        <span className={css.failDot} />
        <b>{t('run.failed')}</b>
        {scope.error !== undefined && <span className={css.failMono}>{scope.error}</span>}
        <span className={css.failMeta}>{t('run.failedMeta', { duration, count: String(scope.requests.length) })}</span>
      </div>
      {scope.requests.length === 0 && (
        <div className={css.failHint}>{t('run.failedHint', { id: `${scope.scopeId.slice(0, 8)}…` })}</div>
      )}
    </div>
  )
}

/** The tab body. */
/** The list's window facts the panel keeps beside its turns. */
const listMetaOf = ({ range, unloaded, total, roomRecords }: ListTurnsResult): Pick<ListTurnsResult, 'range' | 'unloaded' | 'total' | 'roomRecords'> =>
  ({ ...range === undefined ? {} : { range }, ...unloaded === undefined ? {} : { unloaded }, ...total === undefined ? {} : { total }, ...roomRecords === undefined ? {} : { roomRecords } })

export function InspectorPanel({
  sessionId: ownSessionId, useTabInfo, t,
  listTurns, loadTurns, loadThrough, getTurn, getRequest, getTurnTiming, getSessionTrend, openInMemberSession, openMemberAt,
}: InspectorTabProps): ReactNode {
  const { tab } = useTabInfo()
  // The place this panel kept when it sent the reader to a member's session
  // (the panel unmounts with its session's Sidebar): restored once on remount.
  const [restored] = useState(() => takeSelection(ownSessionId, tab.navigation.revision,
    foreignLocate(tab.navigation.params as RequestInspectorTabParams | undefined, ownSessionId)))
  // A navigation may point the panel at another session (a room member's
  // child session); the next navigation without one returns to the own session.
  const [viewed, setViewed] = useState<string | null>(restored?.viewed ?? null)
  const sessionId = (viewed ?? ownSessionId) as typeof ownSessionId
  /** The message whose turn the next turn list should select (from a navigation). */
  const pendingMessage = useRef<string | undefined>(undefined)
  /** The room decision whose turn the next turn list should select (from a navigation). */
  const pendingDecision = useRef<string | undefined>(undefined)
  /** The moment whose turn the next turn list should select (a room round handed over its member run's start). */
  const pendingTime = useRef<number | undefined>(undefined)
  /** The selected room decision on the 房间 tab. */
  const [decisionId, setDecisionId] = useState<string | null>(null)
  const [trend, setTrend] = useState<SessionTrend | null>(null)
  /** The latest conversation jump; an older one still waiting for history gives up. */
  const jumpToken = useRef(0)
  /** Bumped when the loaded window moves, so the session map refetches. */
  const [trendKey, setTrendKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    setTrend(null)
    if (getSessionTrend) void getSessionTrend(sessionId).then(r => { if (!cancelled && r.ok) setTrend(r.value) }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, getSessionTrend, tab.navigation.revision, trendKey])
  const [turns, setTurns] = useState<readonly TurnListItem[] | null>(null)
  const [backfill, setBackfill] = useState<BackfillInfo | null>(null)
  const [parent, setParent] = useState<ListTurnsResult['parent'] | null>(null)
  const [listMeta, setListMeta] = useState<Pick<ListTurnsResult, 'range' | 'unloaded' | 'total' | 'roomRecords'>>({})
  const range = listMeta.range
  const [turnSeq, setTurnSeq] = useState<number | null>(restored?.turnSeq ?? null)
  const [overview, setOverview] = useState<TurnOverview | null>(null)
  const [timing, setTiming] = useState<TurnTiming | null>(null)
  const [request, setRequest] = useState<CapturedRequest | null>(null)
  const [mainTab, setMainTab] = useState<MainTab>(restored?.mainTab ?? 'token')
  const [filterCat, setFilterCat] = useState<CompositionFilter>(restored?.view?.filterCat ?? null)
  /**
   * A row to open once its request is on screen: the kept place's open row on
   * the way back, or the row a room's lens handed over with a call. `request`
   * names the request it belongs to (seq here, start time across sessions).
   */
  const [focus, setFocus] = useState<(RowPlace & { token: number; request: { seq?: number; startedAt?: number } }) | null>(() =>
    restored?.view?.focus === undefined ? null
      : { ...restored.view.focus, token: 1, request: restored.selectedSeq === null ? {} : { seq: restored.selectedSeq } })
  /** The kept detail scroll offset, applied once the request is back (when no row is focused). */
  const pendingDetailScroll = useRef<number | undefined>(restored?.view?.focus === undefined ? restored?.view?.detailScroll : undefined)
  /** The row the reader has open now (kept with the place). */
  const openRow = useRef<RowPlace | null>(null)
  const onFocusChange = useCallback((place: RowPlace | null) => { openRow.current = place }, [])
  const bodyRef = useRef<HTMLDivElement>(null)
  /** How the reader is reading the selected request right now. */
  const readingView = (): ReadingView => {
    const detail = bodyRef.current?.querySelector('[data-lens-detail]')
    return {
      filterCat,
      ...openRow.current === null ? {} : { focus: { layer: openRow.current.layer, position: openRow.current.position } },
      ...detail === null || detail === undefined ? {} : { detailScroll: detail.scrollTop },
    }
  }
  const [requestTrail, setRequestTrail] = useState<{ turnSeq: number; scopeId: string; seq: number }[]>([])
  const [scopeId, setScopeId] = useState<string>(restored?.scopeId ?? 'main')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(restored?.selectedSeq ?? null)
  const [error, setError] = useState<string | null>(null)
  const [turnMissing, setTurnMissing] = useState(false)
  /** Bump to re-run the pull (the error state's retry). */
  const [reloadKey, setReloadKey] = useState(0)
  /** The selected turn's fetched request details (seq → capture). */
  const detailCache = useRef(new Map<number, CapturedRequest>())

  /** Retry a failed load: back to the loading state, re-run the pull. */
  const onRetry = (): void => {
    setError(null)
    setRequestTrail([])
    setTurns(null)
    setOverview(null)
    setReloadKey(key => key + 1)
  }

  // Navigation params apply once per revision (a repeat open re-navigates the
  // one tab): the turn action's { turnSeq } selects that turn and scroll-syncs
  // the conversation to it.
  const revision = tab.navigation.revision
  const navParams = tab.navigation.params as RequestInspectorTabParams | undefined
  const navTurnSeq = navParams?.turnSeq
  // The kept place stays until the reader leaves it (a second mount on the way back gets it too).
  useEffect(() => {
    if (restored === undefined) return
    if (turnSeq === restored.turnSeq && scopeId === restored.scopeId && selectedSeq === restored.selectedSeq
      && viewed === restored.viewed && mainTab === restored.mainTab) return
    forgetSelection(ownSessionId)
  }, [restored, turnSeq, scopeId, selectedSeq, viewed, mainTab, ownSessionId])
  // A restored place already reflects every navigation up to its revision; re-applying them would undo it.
  const lastNavRevision = useRef(restored === undefined ? 0 : revision)
  /** The call a navigation asked to show; consumed once the turn list arrives. */
  const pendingLocate = useRef<RequestInspectorTabParams['locateCall']>(undefined)
  /** The request a handed-over call came with: selected once its turn's overview is in. */
  const pendingRequest = useRef<NonNullable<RequestInspectorTabParams['locateCall']>['request']>(undefined)
  /** A located call waiting for the panel's turn list to be in state (the jump reads it). */
  const [locateRequest, setLocateRequest] = useState<RequestInspectorTabParams['locateCall']>(undefined)
  useEffect(() => {
    if (revision === 0 || revision === lastNavRevision.current) return
    lastNavRevision.current = revision
    // A call handed to another session's lens: not this panel's navigation.
    if (foreignLocate(navParams, ownSessionId)) return
    const target = navParams?.sessionId
    setViewed(target === undefined || target === ownSessionId ? null : target)
    pendingMessage.current = navParams?.messageId
    pendingDecision.current = navParams?.roomDecision
    pendingLocate.current = navParams?.locateCall
    if (navParams?.locateCall !== undefined) {
      setTurnSeq(null)
      setScopeId('main')
      setSelectedSeq(null)
      // Read the handed-over request the way the room's lens was reading it.
      const view = navParams.locateCall.view
      setFilterCat(view?.filterCat ?? null)
      const startedAt = navParams.locateCall.request?.startedAt
      setFocus(view?.focus === undefined ? null
        : { ...view.focus, token: revision + 1, request: startedAt === undefined ? {} : { startedAt } })
      setMainTab('token')
    }
    if (navParams?.roomDecision !== undefined) {
      setTurnSeq(null)
      setScopeId(ROOM_TAB)
      setDecisionId(navParams.roomDecision)
    }
    pendingTime.current = navParams?.locateTime?.at
    if (navParams?.locateTime !== undefined) {
      setTurnSeq(null)
      setScopeId('main')
      setSelectedSeq(null)
      setFilterCat(null)
      setMainTab('token')
    }
    if (navParams?.messageId !== undefined) {
      setTurnSeq(null)
      setScopeId('main')
      setSelectedSeq(null)
      setFilterCat(null)
      setMainTab('token')
    }
    if (navTurnSeq === undefined) return
    setTurnSeq(navTurnSeq)
    setScopeId('main')
    setSelectedSeq(null)
    setFilterCat(null)
    setMainTab('token')
    // Real turns key on the host's turn number, so a positive seq scrolls even
    // before the turn list resolves; pseudo-turns (negative) never scroll.
    if (navTurnSeq > 0 && navParams?.sessionId === undefined) scrollConversationToTurn(navTurnSeq)
  }, [revision, navTurnSeq, navParams, ownSessionId])

  // The session's turn list, on mount (pull-based: refetch = reopen or retry).
  useEffect(() => {
    let cancelled = false
    setError(null)
    void listTurns(sessionId).then(result => {
      if (cancelled || tab.signal.aborted) return
      if (!result.ok) {
        setError(result.error.message)
        setTurns([])
        return
      }
      setTurns(result.value.turns)
      setBackfill(result.value.backfill)
      setParent(result.value.parent ?? null)
      setListMeta(listMetaOf(result.value))
      const decided = pendingDecision.current === undefined ? undefined
        : result.value.turns.find(turn => turn.roomDecisionIds?.includes(pendingDecision.current!) === true)?.turnSeq
      pendingDecision.current = undefined
      const locate = pendingLocate.current
      pendingLocate.current = undefined
      const located = turnOfLocate(result.value.turns, locate)
      pendingRequest.current = locate?.request
      if (locate !== undefined) setLocateRequest(locate)
      const at = pendingTime.current
      pendingTime.current = undefined
      const timed = at === undefined ? undefined : turnOfLocate(result.value.turns, { request: { startedAt: at } })
      if (timed !== undefined) syncScrollToTurn(timed, result.value.turns)
      const asked = decided ?? located ?? timed ?? (pendingMessage.current === undefined ? undefined : resolveTurnSeq(result.value.turns, pendingMessage.current))
      pendingMessage.current = undefined
      setTurnSeq(previous => asked !== undefined
        ? asked
        : previous !== null && result.value.turns.some(turn => turn.turnSeq === previous)
          ? previous
          : latestTurnSeq(result.value.turns) ?? null)
    }).catch((cause: unknown) => {
      // A call that rejects (e.g. the gateway's arity gate, a disconnected
      // carrier) is the same load failure as a refusal: the error state, not
      // a spinner that never resolves.
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [sessionId, listTurns, tab.signal, reloadKey, revision])

  // The selected turn's scope/request overview.
  useEffect(() => {
    if (turnSeq === null) {
      setOverview(null)
      return
    }
    let cancelled = false
    const seq = turnSeq
    detailCache.current.clear()
    setTurnMissing(false)
    void getTurn(sessionId, seq).then(result => {
      if (cancelled || tab.signal.aborted) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (result.value === undefined) {
        // The turn left the capture's ring buffer (eviction) between the list
        // and this read — an honest empty state, not a spinner forever.
        setTurnMissing(true)
        setOverview(null)
        return
      }
      setOverview(result.value)
      setTiming(null)
      setRequest(null)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [sessionId, turnSeq, getTurn, tab.signal])

  const scopes = overview?.scopes ?? []
  const scope = scopes.find(candidate => candidate.scopeId === scopeId)
    ?? scopes.find(candidate => candidate.kind === 'main')
    ?? scopes[0]
  const effectiveScope = scope
  const scopeRequests = effectiveScope?.requests ?? []
  useEffect(() => {
    const wanted = pendingRequest.current
    if (wanted === undefined || scopeRequests.length === 0) return
    pendingRequest.current = undefined
    const match = requestOfLocate(scopeRequests, wanted)
    if (match !== undefined) setSelectedSeq(match.seq)
  }, [scopeRequests])
  const selectedItem = scopeRequests.find(candidate => candidate.seq === selectedSeq) ?? scopeRequests[0]
  const selectedRequestSeq = selectedItem?.seq ?? null
  const selectedIndex = selectedRequestSeq === null
    ? -1
    : scopeRequests.findIndex(candidate => candidate.seq === selectedRequestSeq)

  // The 新增 provenance label's N: the previous request in the SAME scope.
  // Scopes are continuous across turns, so the scope's first request of a turn
  // looks back to the previous REAL turn's last request in that scope — a lazy
  // fetch, only while the selection needs it.
  const previousRealTurnSeq = ((): number | undefined => {
    if (turns === null || turnSeq === null) return undefined
    const index = turns.findIndex(candidate => candidate.turnSeq === turnSeq)
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = turns[i]
      if (candidate !== undefined && candidate.hostTurn !== undefined) return candidate.turnSeq
    }
    return undefined
  })()
  const needsPreviousTurn = selectedIndex === 0 && previousRealTurnSeq !== undefined
  const [previousTurn, setPreviousTurn] = useState<TurnOverview | null>(null)
  useEffect(() => {
    if (!needsPreviousTurn || previousRealTurnSeq === undefined) {
      if (previousTurn !== null) setPreviousTurn(null)
      return
    }
    let cancelled = false
    const seq = previousRealTurnSeq
    void getTurn(sessionId, seq).then(result => {
      if (cancelled || tab.signal.aborted) return
      if (result.ok) setPreviousTurn(result.value ?? null)
    }).catch(() => { /* the provenance label simply stays absent */ })
    return () => { cancelled = true }
    // previousTurn is the effect's own sink — depending on it would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, needsPreviousTurn, previousRealTurnSeq, getTurn, tab.signal])

  const previousResponseNumber = ((): number | null => {
    if (selectedItem?.responseSummary.kind === 'compaction') return null
    if (selectedIndex > 0) return scopeRequests.slice(0, selectedIndex).filter(r => r.responseSummary.kind !== 'compaction').at(-1)?.requestNumber ?? null
    if (selectedIndex === 0 && effectiveScope !== undefined && previousTurn !== null) {
      const previousScope = previousTurn.scopes.find(candidate => candidate.scopeId === effectiveScope.scopeId)
      return previousScope?.requests.filter(r => r.responseSummary.kind !== 'compaction').at(-1)?.requestNumber ?? null
    }
    return null
  })()

  // The selected request's full capture (cached per turn).
  useEffect(() => {
    if (selectedRequestSeq === null) {
      setRequest(null)
      return
    }
    const cached = detailCache.current.get(selectedRequestSeq)
    if (cached !== undefined) {
      setRequest(cached)
      return
    }
    setRequest(null)
    let cancelled = false
    const seq = selectedRequestSeq
    void getRequest(sessionId, seq).then(result => {
      if (cancelled || tab.signal.aborted) return
      // The panel never sends a scope filter, so a refusal cannot arrive;
      // the narrow is for the wire type only.
      if (result.ok && result.value !== undefined && !('refused' in result.value)) {
        detailCache.current.set(seq, result.value)
        setRequest(result.value)
      } else if (!result.ok) {
        setError(result.error.message)
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [sessionId, selectedRequestSeq, getRequest, tab.signal])

  // The timing tab's whole-turn aggregation.
  useEffect(() => {
    if (mainTab !== 'time' || turnSeq === null) return
    let cancelled = false
    const seq = turnSeq
    void getTurnTiming(sessionId, seq).then(result => {
      if (cancelled || tab.signal.aborted) return
      if (result.ok) setTiming(result.value ?? null)
      else setError(result.error.message)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [sessionId, turnSeq, mainTab, getTurnTiming, tab.signal])

  const turn = turns?.find(candidate => candidate.turnSeq === turnSeq)

  /** The shared per-turn selection reset (no scrolling — the caller picks the anchor). */
  const selectTurnState = (next: number): void => {
    setTurnSeq(next)
    setScopeId('main')
    setSelectedSeq(null)
    setFilterCat(null)
    setOverview(null)
    setRequest(null)
    setTiming(null)
  }

  /** Scroll the conversation to one selected turn (real turns and room rounds; other pseudo-turns never scroll). */
  const syncScrollToTurn = (seq: number, list: readonly TurnListItem[] | null = turns): void => {
    const target = list?.find(candidate => candidate.turnSeq === seq)
    // A room round has no host turn: it lands on the human's own message row.
    const messageId = target?.room?.messageId
    // Real turns key on the host's turn number (M5), so a positive seq is the
    // anchor even before the list resolves (the navigation-params path).
    const hostTurn = messageId !== undefined ? undefined : target?.hostTurn ?? (seq > 0 ? seq : undefined)
    if (messageId === undefined && hostTurn === undefined) return
    const jump = ++jumpToken.current
    void locateTurnPaging({
      messageId,
      hostTurn,
      startSeq: target?.startSeq,
      loadThrough: loadThrough === undefined ? undefined : start => loadThrough(sessionId, start),
      alive: () => jump === jumpToken.current,
    })
  }

  /**
   * Show one tool call in the conversation on the left: its own row (unfolded
   * when its step group is folded); a call not rendered yet pages history back
   * to its turn first; failing that, its turn. `hostTurn` is the call's host
   * turn when known (main-scope rows carry it), else the selected turn.
   */
  const locateCall = (callId: string, hostTurn: number | undefined): void => {
    const jump = ++jumpToken.current
    const fallbackTurn = hostTurn ?? turn?.hostTurn
    const listed = fallbackTurn === undefined ? undefined : turns?.find(candidate => candidate.hostTurn === fallbackTurn)
    void locateCallPaging({
      callId,
      startSeq: listed?.startSeq,
      fallbackTurn,
      loadThrough: loadThrough === undefined ? undefined : seq => loadThrough(sessionId, seq),
      alive: () => jump === jumpToken.current,
    })
  }
  // A call lives in this conversation when the scope is the main agent or a
  // child it delegated by a tool call (nested under that call); a room
  // member's calls live in the member's own session.
  const callsInConversation = viewed === null && effectiveScope !== undefined
    && (effectiveScope.kind === 'main' || (effectiveScope.delegatedBy !== undefined && effectiveScope.cliSubagent === undefined))
  // A navigation's call (handed over from a room's lens): shown once the turn list is in state.
  useEffect(() => {
    if (locateRequest === undefined || turns === null) return
    setLocateRequest(undefined)
    locateCall(locateRequest.callId, locateRequest.hostTurn)
    // locateCall is a render-scoped closure over `turns`; the effect re-runs on what it needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateRequest, turns])
  /**
   * A room member's own session, when this scope is one: a member run of a
   * room round, keyed by its child session id (a run whose child is unknown
   * keys as `room:<seq>:<member>` and has no session to open). Its calls are
   * shown there, not in this conversation.
   */
  // A member CLI's own subagent is its own session too, in a room round or the member's own lens.
  const memberSession = viewed === null && (turn?.room !== undefined || effectiveScope?.cliSubagent !== undefined) && effectiveScope !== undefined
    && effectiveScope.kind === 'subagent' && !effectiveScope.scopeId.includes(':')
    ? effectiveScope.scopeId : undefined
  /** Keep this panel's place, then send the reader to the member's session, on the call. */
  const locateInMember = memberSession === undefined || openInMemberSession === undefined ? undefined
    : (callId: string, sourceTurn: number | undefined): void => {
      const view = readingView()
      rememberSelection(ownSessionId, { revision, viewed, turnSeq, scopeId, selectedSeq, mainTab, view })
      const request = selectedItem === undefined ? undefined
        : { startedAt: selectedItem.startedAt, ...selectedItem.requestNumber === undefined ? {} : { requestNumber: selectedItem.requestNumber } }
      openInMemberSession(memberSession, {
        callId,
        ...sourceTurn === undefined ? {} : { hostTurn: sourceTurn },
        ...request === undefined ? {} : { request },
        view: { filterCat: view.filterCat, ...view.focus === undefined ? {} : { focus: view.focus } },
      })
    }

  /** The pending focus, only for the request it belongs to (another request loading first must not take it). */
  const focusHere = focus !== null && request !== null
    && (focus.request.seq === undefined || focus.request.seq === request.seq)
    && (focus.request.startedAt === undefined || focus.request.startedAt === request.startedAt)
    ? { layer: focus.layer, position: focus.position, token: focus.token } : undefined
  // The kept scroll offset (no open row to bring into view): once the request is back on screen.
  useEffect(() => {
    const offset = pendingDetailScroll.current
    if (offset === undefined || request === null) return
    pendingDetailScroll.current = undefined
    const apply = (): void => {
      const detail = bodyRef.current?.querySelector('[data-lens-detail]')
      if (detail) detail.scrollTop = offset
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply)
    else apply()
  }, [request])

  const onSelectTurn = (next: number): void => {
    if (next === turnSeq) return
    selectTurnState(next)
    syncScrollToTurn(next)
  }

  /** The latest REAL turn or room round — the 最新 button's target (pseudo-turns have no conversation anchor). */
  const realTurns = (turns ?? []).filter(candidate => candidate.hostTurn !== undefined || candidate.room !== undefined)
  const latestRealTurn = realTurns.findLast(candidate => !isHollowTurn(candidate)) ?? realTurns.at(-1)
  const latestMainTurn = (turns ?? []).filter(candidate => candidate.hostTurn !== undefined).at(-1)
  const gaps = turnGaps(listMeta, turns ?? [])
  const latestUnloaded = range !== undefined && latestMainTurn?.hostTurn !== undefined && range.last > latestMainTurn.hostTurn

  /** Move the loaded window (latest when `end` is null), then select `select` or the newest loaded turn. */
  const loadWindow = (end: number | null, select?: number): void => {
    if (!loadTurns) return
    void loadTurns(sessionId, end).then(result => {
      if (!result.ok) { setError(result.error.message); return }
      setTurns(result.value.turns)
      setBackfill(result.value.backfill)
      setListMeta(listMetaOf(result.value))
      setTrendKey(key => key + 1)
      const target = select !== undefined && result.value.turns.some(turn => turn.turnSeq === select) ? select : latestTurnSeq(result.value.turns)
      if (target !== undefined) { selectTurnState(target); syncScrollToTurn(target, result.value.turns) }
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }
  /** A run of unloaded turns: older runs load the 30 ending at its end, newer runs the 30 starting at its start. */
  const onLoadGap = (gap: TurnGap): void => {
    const firstLoaded = Math.min(...(turns ?? []).map(turn => turn.hostTurn ?? Number.POSITIVE_INFINITY))
    if (gap.to < firstLoaded) loadWindow(gap.to, gap.to)
    else loadWindow(Math.min(gap.from + WINDOW_TURNS - 1, range?.last ?? gap.to), gap.from)
  }
  const onLatest = (): void => {
    if (latestUnloaded) { loadWindow(null); scrollConversationToBottom(); return }
    if (latestRealTurn === undefined) return
    if (turnSeq !== latestRealTurn.turnSeq) selectTurnState(latestRealTurn.turnSeq)
    scrollConversationToBottom()
  }
  /** The unloaded run right next to a turn, in the session's turn numbering. */
  const adjacentGap = (turn: TurnListItem | undefined, delta: -1 | 1): TurnGap | undefined => {
    const n = turn === undefined ? undefined : turnNumber(turn)
    return n === undefined ? undefined : gaps.find(g => delta < 0 ? gapShown(g).to === n - 1 : gapShown(g).from === n + 1)
  }
  /** Step one turn; at the loaded window's edge, load the adjacent window and keep going. */
  const onStep = (delta: -1 | 1): void => {
    const list = turns ?? []
    const i = list.findIndex(v => v.turnSeq === turnSeq)
    const next = list[i + delta]
    const gap = adjacentGap(list[i], delta)
    if (gap !== undefined) onLoadGap(gap)
    else if (next) onSelectTurn(next.turnSeq)
  }
  const stepIndex = (turns ?? []).findIndex(v => v.turnSeq === turnSeq)
  const canStep = (delta: -1 | 1): boolean => {
    if (adjacentGap((turns ?? [])[stepIndex], delta) !== undefined) return true
    return stepIndex >= 0 && stepIndex + delta >= 0 && stepIndex + delta < (turns ?? []).length
  }

  const onSelectScope = (next: string): void => {
    // On the room tab the effective scope falls back to the main agent, so
    // compare with the tab actually shown, or the main tab could never be re-picked.
    if (next === (scopeId === ROOM_TAB ? ROOM_TAB : effectiveScope?.scopeId)) return
    setScopeId(next)
    setSelectedSeq(null)
    setFilterCat(null)
  }

  const onMainTab = (next: MainTab): void => {
    setMainTab(next)
  }

  /** A timing tab call row's click-through: the token tab, that scope, that request. */
  const onOpenRequest = (seq: number, targetScopeId: string): void => {
    setMainTab('token')
    setScopeId(targetScopeId)
    setSelectedSeq(seq)
    setFilterCat(null)
  }


  // A load failure (refusal, disconnect, a call rejected before any network
  // traffic) is an explicit state with a retry — loading shows only while no
  // error exists.
  const errorBody = error === null ? undefined : (
    <div className={css.stateNote} role="alert">
      {t('state.error', { message: error })}
      <button type="button" className={css.retry} onClick={onRetry}>{t('state.retry')}</button>
    </div>
  )

  let body: ReactNode
  if (turns === null) {
    body = errorBody ?? <div className={css.stateNote} role="status">{t('state.loading')}</div>
  } else if (errorBody !== undefined && (turns.length === 0 || overview === null)) {
    // A failed verb (listTurns or getTurn) outranks the empty states.
    body = errorBody
  } else if (turns.length === 0) {
    body = backfill?.state === 'broken'
      // The log exists but refused to decode: a note, not an error page.
      ? <div className={css.stateNote} role="status">{t('state.logBroken', { reason: backfill.reason ?? '' })}</div>
      : <div className={css.stateNote} role="status">{t('state.noTurns')}</div>
  } else if (turnMissing) {
    body = <div className={css.stateNote} role="status">{t('state.turnMissing')}</div>
  } else if (overview === null) {
    body = <div className={css.stateNote} role="status">{t('state.loading')}</div>
  } else if ((scopeId === ROOM_TAB || (effectiveScope === undefined && turn?.roomUnattributed === true)) && (overview.roomDecisions?.length ?? 0) > 0) {
    body = (
      <div className={css.bodyFill}>
        <RoomDecisionsView decisions={overview.roomDecisions!} selectedId={decisionId} onSelect={setDecisionId} t={t} />
      </div>
    )
  } else if (overview.roomFallback !== undefined && effectiveScope === undefined) {
    // A round with no records: no room-dimension view, a door into each member's own lens at that time.
    body = (
      <div className={css.scrollBody}>
        <RoomFallbackCard
          members={overview.roomFallback.members}
          repeatTitle={listMeta.roomRecords !== 'none'}
          onOpen={openMemberAt === undefined ? undefined : member => {
            rememberSelection(ownSessionId, { revision, viewed, turnSeq, scopeId, selectedSeq, mainTab, view: readingView() })
            openMemberAt(member.sessionId!, member.startedAt)
          }}
          t={t}
        />
      </div>
    )
  } else if (effectiveScope === undefined) {
    body = <div className={css.stateNote} role="status">{t('state.emptyScope')}</div>
  } else if (effectiveScope.requests.length === 0 && effectiveScope.status !== 'failed') {
    body = <div className={css.stateNote} role="status">{t('state.noRequests')}</div>
  } else if (effectiveScope.status === 'failed' && effectiveScope.requests.length === 0) {
    body = (
      <div className={css.scrollBody}>
        <FailureCard scope={effectiveScope} t={t} />
      </div>
    )
  } else if (mainTab === 'token') {
    body = (
      <div className={css.bodyFill}>
        {effectiveScope.status === 'failed' && <FailureCard scope={effectiveScope} t={t} />}
        <TokenView
          onOpenRequest={link => {
            if (turnSeq !== null && selectedRequestSeq !== null) setRequestTrail(previous => [...previous, { turnSeq, scopeId: effectiveScope.scopeId, seq: selectedRequestSeq }])
            setTurnSeq(link.turnSeq); onOpenRequest(link.seq, link.scopeId)
          }}
          onReturn={requestTrail.length === 0 ? undefined : () => {
            const target = requestTrail.at(-1)!
            setRequestTrail(previous => previous.slice(0, -1)); setTurnSeq(target.turnSeq); onOpenRequest(target.seq, target.scopeId)
          }}
          scope={effectiveScope}
          onOpenScope={onSelectScope}
          selectedSeq={selectedRequestSeq}
          request={request}
          filterCat={filterCat}
          previousResponseNumber={previousResponseNumber}
          onSelect={seq => { setSelectedSeq(seq); setFilterCat(null); setFocus(null) }}
          focus={focusHere}
          onFocusApplied={token => setFocus(current => current?.token === token ? null : current)}
          onFocusChange={onFocusChange}
          onToggleFilter={category => { setFilterCat(previous => previous === category ? null : category) }}
          onLocateCall={callsInConversation ? (callId, sourceTurn) => locateCall(callId, effectiveScope?.kind === 'main' ? sourceTurn : undefined) : locateInMember}
          locateInMember={!callsInConversation && locateInMember !== undefined}
          t={t}
        />
      </div>
    )
  } else {
    body = (
      <div className={css.bodyFill}>
        {effectiveScope.status === 'failed' && <FailureCard scope={effectiveScope} t={t} />}
        <TimingView
          timing={timing}
          scopes={scopes}
          filterScopeId={effectiveScope.scopeId}
          filterIsSubagent={effectiveScope.kind === 'subagent'}
          config={effectiveScope.config}
          onSelectScope={onSelectScope}
          onOpenRequest={onOpenRequest}
          t={t}
        />
      </div>
    )
  }

  return (
    <PanelRoot className={css.root} role="region" aria-label={t('tab.title')}>
      <div className={css.head}>
        <div className={css.r1}>
          <span className={css.title}>{t('tab.title')}</span>
          <div className={css.stepper}>
            <button type="button" aria-label={t('lens.previous')} disabled={!canStep(-1)} onClick={() => onStep(-1)}>‹</button>
            <TurnMenu turns={turns ?? []} turnSeq={turnSeq} onSelect={onSelectTurn} gaps={loadTurns ? gaps : []} lastTurn={listMeta.total ?? range?.last} onLoad={onLoadGap} t={t} />
            <button type="button" aria-label={t('lens.next')} disabled={!canStep(1)} onClick={() => onStep(1)}>›</button>
          </div>
          {latestRealTurn && (turnSeq !== latestRealTurn.turnSeq || (latestUnloaded && loadTurns)) && <button type="button" className={css.latestText} aria-label={t('turn.latest')} onClick={onLatest}>{t('lens.latest')}</button>}
          <div className={css.headTabs}>
            <SegCtl
              mini
              label={t('tab.title')}
              options={[
                { id: 'token' as const, label: t('view.token') },
                { id: 'time' as const, label: t('view.time') },
              ]}
              value={mainTab}
              onChange={onMainTab}
            />
          </div>
        </div>
        {parent && <ParentLine parent={parent} t={t} />}
        {/* The trend is the session map: always the main conversation, it picks the turn. */}
        {trend && <Trend data={trend} turnSeq={turnSeq} selectedSeq={effectiveScope?.kind === 'main' ? selectedRequestSeq : null} scopeId="main" scopeLabel={t('scope.mainName')} gaps={loadTurns ? gaps : []} onLoadGap={onLoadGap} t={t} onSelect={(next, seq, targetScope) => {
          // On the timing view the map picks the turn and stays there; on the request view it opens the request.
          onSelectTurn(next)
          if (next === turnSeq) syncScrollToTurn(next)
          if (mainTab !== 'time') onOpenRequest(seq, targetScope)
        }} />}
        {turn !== undefined && (turn.query !== '' || turn.trigger !== undefined || turn.continues !== undefined) && <div className={css.query}>
          {turnNumber(turn) !== undefined && <span className={css.queryTurn}>{t('query.turn', { turn: String(turnNumber(turn)) })}</span>}
          {turn.room !== undefined && <code className={css.querySource}>{t('query.room')}{turn.room.targets.length > 0 ? ` → ${turn.room.targets.join('、')}` : ''}</code>}
          {/* The message waited behind the member's previous round (room-timeline-order H1). */}
          {turn.room?.queuedMs !== undefined && <span className={css.queryQueued}>{t('query.queued', { duration: queuedText(turn.room.queuedMs, t) })}</span>}
          {turn.query === '' && turn.trigger !== undefined && <code className={css.querySource}>{turn.trigger.source}</code>}
          {/* A round the member's CLI opened itself: why it ran; where the task started is the tabs row's jump. */}
          {turn.query === '' && turn.trigger === undefined && turn.continues !== undefined
            ? <b>{continuesText(turn.continues.taskStatus, t)}</b>
            : <b title={turn.query !== '' ? turn.query : turn.trigger?.text}>{turn.hostTurn === undefined && turn.query === 'compaction' ? t('compaction.title') : turn.query !== '' ? turn.query : turn.trigger!.text}</b>}
        </div>}
        {turn?.roomUnattributed === true && <div className={css.query}><b>{t('room.unattributed')}</b></div>}
        {turn?.roomUnattributed === true && <UnattributedNote t={t} />}
        {/* No round of this room has records: said once, here, not on every round. */}
        {listMeta.roomRecords === 'none' && turn?.room !== undefined && <RoomRecordsNotice t={t} />}
        {/* Below it, the selected turn's participants: nothing that did not take part. */}
        {(scopes.length > 0 || (overview?.roomDecisions?.length ?? 0) > 0) && (
          <AgentTabs
            scopes={scopes}
            roomCount={overview?.roomDecisions?.length}
            value={scopeId === ROOM_TAB && (overview?.roomDecisions?.length ?? 0) > 0 ? ROOM_TAB : effectiveScope?.scopeId ?? 'main'}
            onSelect={onSelectScope}
            onOpenRequest={link => { setTurnSeq(link.turnSeq); onOpenRequest(link.seq, link.scopeId) }}
            t={t}
          />
        )}
        {/* A recorded room run: what its execution recorded about itself. */}
        {scopeId !== ROOM_TAB && effectiveScope?.execution !== undefined && <ExecutionNote execution={effectiveScope.execution} t={t} />}
        {scopeId !== ROOM_TAB && effectiveScope?.executions?.map(execution => <ExecutionNote key={execution.executionId} execution={execution} t={t} />)}
      </div>
      <div className={css.body} ref={bodyRef}>{body}</div>
    </PanelRoot>
  )
}
