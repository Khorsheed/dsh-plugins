import type { SessionTrend } from '../types.ts'
import { Trend } from './Trend.tsx'
import { AgentTabs, ParentLine } from './AgentTabs.tsx'
/** Session/turn/scope navigation; request detail owns its JSON toggle. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelRoot } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type {
  AgentScopeOverview, BackfillInfo, CapturedRequest, ListTurnsResult, TurnListItem, TurnOverview, TurnTiming,
} from '../types.ts'
import { WINDOW_TURNS, fmtSpan, gapShown, latestTurnSeq, resolveTurnSeq, turnGaps, turnNumber, type CompositionFilter, type TurnGap } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import type { RequestInspectorTabParams } from './definition.tsx'
import { hasTurnAnchor, scrollConversationToBottom, scrollConversationToTurn } from './scroll-sync.ts'
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
const listMetaOf = ({ range, unloaded, total }: ListTurnsResult): Pick<ListTurnsResult, 'range' | 'unloaded' | 'total'> =>
  ({ ...range === undefined ? {} : { range }, ...unloaded === undefined ? {} : { unloaded }, ...total === undefined ? {} : { total } })

export function InspectorPanel({
  sessionId: ownSessionId, useTabInfo, t,
  listTurns, loadTurns, loadThrough, getTurn, getRequest, getTurnTiming, getSessionTrend,
}: InspectorTabProps): ReactNode {
  const { tab } = useTabInfo()
  // A navigation may point the panel at another session (a room member's
  // child session); the next navigation without one returns to the own session.
  const [viewed, setViewed] = useState<string | null>(null)
  const sessionId = (viewed ?? ownSessionId) as typeof ownSessionId
  /** The message whose turn the next turn list should select (from a navigation). */
  const pendingMessage = useRef<string | undefined>(undefined)
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
  const [listMeta, setListMeta] = useState<Pick<ListTurnsResult, 'range' | 'unloaded' | 'total'>>({})
  const range = listMeta.range
  const [turnSeq, setTurnSeq] = useState<number | null>(null)
  const [overview, setOverview] = useState<TurnOverview | null>(null)
  const [timing, setTiming] = useState<TurnTiming | null>(null)
  const [request, setRequest] = useState<CapturedRequest | null>(null)
  const [mainTab, setMainTab] = useState<MainTab>('token')
  const [filterCat, setFilterCat] = useState<CompositionFilter>(null)
  const [requestTrail, setRequestTrail] = useState<{ turnSeq: number; scopeId: string; seq: number }[]>([])
  const [scopeId, setScopeId] = useState<string>('main')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
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
  const lastNavRevision = useRef(0)
  useEffect(() => {
    if (revision === 0 || revision === lastNavRevision.current) return
    lastNavRevision.current = revision
    const target = navParams?.sessionId
    setViewed(target === undefined || target === ownSessionId ? null : target)
    pendingMessage.current = navParams?.messageId
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
      const asked = pendingMessage.current === undefined ? undefined : resolveTurnSeq(result.value.turns, pendingMessage.current)
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

  /** Scroll the conversation to one selected turn (real turns only; pseudo-turns never scroll). */
  const syncScrollToTurn = (seq: number, list: readonly TurnListItem[] | null = turns): void => {
    const target = list?.find(candidate => candidate.turnSeq === seq)
    // Real turns key on the host's turn number (M5), so a positive seq is the
    // anchor even before the list resolves (the navigation-params path).
    const hostTurn = target?.hostTurn ?? (seq > 0 ? seq : undefined)
    if (hostTurn === undefined) return
    const jump = ++jumpToken.current
    if (hasTurnAnchor(hostTurn) || !loadThrough || target?.startSeq === undefined) {
      scrollConversationToTurn(hostTurn)
      return
    }
    // The chat has not rendered that turn yet: page its history back to the
    // turn's start (the session's own loader), then land once the row mounts.
    // A newer jump supersedes this one; no progress falls back to the nearest row.
    void loadThrough(sessionId, target.startSeq).catch(() => undefined).then(() => {
      let frames = 0
      const land = (): void => {
        if (jump !== jumpToken.current) return
        if (hasTurnAnchor(hostTurn) || frames >= 60) { scrollConversationToTurn(hostTurn); return }
        frames += 1
        requestAnimationFrame(land)
      }
      land()
    })
  }

  const onSelectTurn = (next: number): void => {
    if (next === turnSeq) return
    selectTurnState(next)
    syncScrollToTurn(next)
  }

  /** The latest REAL turn or room round — the 最新 button's target (pseudo-turns have no conversation anchor). */
  const latestRealTurn = (turns ?? []).filter(candidate => candidate.hostTurn !== undefined || candidate.room !== undefined).at(-1)
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
    if (next === effectiveScope?.scopeId) return
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
          selectedSeq={selectedRequestSeq}
          request={request}
          filterCat={filterCat}
          previousResponseNumber={previousResponseNumber}
          onSelect={seq => { setSelectedSeq(seq); setFilterCat(null) }}
          onToggleFilter={category => { setFilterCat(previous => previous === category ? null : category) }}
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
          if (mainTab !== 'time') onOpenRequest(seq, targetScope)
        }} />}
        {turn !== undefined && (turn.query !== '' || turn.trigger !== undefined) && <div className={css.query}>
          {turnNumber(turn) !== undefined && <span className={css.queryTurn}>{t('query.turn', { turn: String(turnNumber(turn)) })}</span>}
          {turn.room !== undefined && <code className={css.querySource}>{t('query.room')}{turn.room.targets.length > 0 ? ` → ${turn.room.targets.join('、')}` : ''}</code>}
          {turn.query === '' && turn.trigger !== undefined && <code className={css.querySource}>{turn.trigger.source}</code>}
          <b title={turn.query !== '' ? turn.query : turn.trigger?.text}>{turn.hostTurn === undefined && turn.query === 'compaction' ? t('compaction.title') : turn.query !== '' ? turn.query : turn.trigger!.text}</b>
        </div>}
        {/* Below it, the selected turn's participants: nothing that did not take part. */}
        {scopes.length > 0 && (
          <AgentTabs
            scopes={scopes}
            value={effectiveScope?.scopeId ?? 'main'}
            onSelect={onSelectScope}
            onOpenRequest={link => { setTurnSeq(link.turnSeq); onOpenRequest(link.seq, link.scopeId) }}
            t={t}
          />
        )}
      </div>
      <div className={css.body}>{body}</div>
    </PanelRoot>
  )
}
