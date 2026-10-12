import type { SessionTrend } from '../types.ts'
import { Trend } from './Trend.tsx'
/** Session/turn/scope navigation; request detail owns its JSON toggle. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChipRow, PanelRoot } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type {
  AgentScopeOverview, BackfillInfo, CapturedRequest, TurnListItem, TurnOverview, TurnTiming,
} from '../types.ts'
import { fmtSpan, latestTurnSeq, type CompositionFilter } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import type { RequestInspectorTabParams } from './definition.tsx'
import { scrollConversationToBottom, scrollConversationToTurn } from './scroll-sync.ts'
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

/** One delegation run's chip label: ▸ #scopeSeq label ✓/✗ (never merged, never grouped). */
function scopeChipLabel(scope: AgentScopeOverview): ReactNode {
  const label = scope.label ?? scope.scopeId
  return (
    <>
      ▸ {`#${scope.scopeSeq} `}{label}
      {scope.status === 'ok' && <span className={css.okMark}> ✓</span>}
      {scope.status === 'failed' && <span className={css.failMark}> ✗</span>}
    </>
  )
}

/** The tab body. */
export function InspectorPanel({
  sessionId, useTabInfo, t,
  listTurns, getTurn, getRequest, getTurnTiming, getSessionTrend,
}: InspectorTabProps): ReactNode {
  const { tab } = useTabInfo()
  const [trend, setTrend] = useState<SessionTrend | null>(null)
  useEffect(() => {
    let cancelled = false
    setTrend(null)
    if (getSessionTrend) void getSessionTrend(sessionId).then(r => { if (!cancelled && r.ok) setTrend(r.value) }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, getSessionTrend, tab.navigation.revision])
  const [turns, setTurns] = useState<readonly TurnListItem[] | null>(null)
  const [backfill, setBackfill] = useState<BackfillInfo | null>(null)
  const [turnSeq, setTurnSeq] = useState<number | null>(null)
  const [overview, setOverview] = useState<TurnOverview | null>(null)
  const [timing, setTiming] = useState<TurnTiming | null>(null)
  const [request, setRequest] = useState<CapturedRequest | null>(null)
  const [mainTab, setMainTab] = useState<MainTab>('token')
  const [filterCat, setFilterCat] = useState<CompositionFilter>(null)
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
    setTurns(null)
    setOverview(null)
    setReloadKey(key => key + 1)
  }

  // Navigation params apply once per revision (a repeat open re-navigates the
  // one tab): the turn action's { turnSeq } selects that turn and scroll-syncs
  // the conversation to it.
  const revision = tab.navigation.revision
  const navTurnSeq = (tab.navigation.params as RequestInspectorTabParams | undefined)?.turnSeq
  const lastNavRevision = useRef(0)
  useEffect(() => {
    if (revision === 0 || revision === lastNavRevision.current) return
    lastNavRevision.current = revision
    if (navTurnSeq === undefined) return
    setTurnSeq(navTurnSeq)
    setScopeId('main')
    setSelectedSeq(null)
    setFilterCat(null)
    setMainTab('token')
    // Real turns key on the host's turn number, so a positive seq scrolls even
    // before the turn list resolves; pseudo-turns (negative) never scroll.
    if (navTurnSeq > 0) scrollConversationToTurn(navTurnSeq)
  }, [revision, navTurnSeq])

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
      setTurnSeq(previous => previous !== null && result.value.turns.some(turn => turn.turnSeq === previous)
        ? previous
        : latestTurnSeq(result.value.turns) ?? null)
    }).catch((cause: unknown) => {
      // A call that rejects (e.g. the gateway's arity gate, a disconnected
      // carrier) is the same load failure as a refusal: the error state, not
      // a spinner that never resolves.
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [sessionId, listTurns, tab.signal, reloadKey])

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

  const previousResponseSeq = ((): number | null => {
    if (selectedIndex > 0) return scopeRequests[selectedIndex - 1]?.seq ?? null
    if (selectedIndex === 0 && effectiveScope !== undefined && previousTurn !== null) {
      const previousScope = previousTurn.scopes.find(candidate => candidate.scopeId === effectiveScope.scopeId)
      return previousScope?.requests.at(-1)?.seq ?? null
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
  const syncScrollToTurn = (seq: number): void => {
    const target = turns?.find(candidate => candidate.turnSeq === seq)
    // Real turns key on the host's turn number (M5), so a positive seq is the
    // anchor even before the list resolves (the navigation-params path).
    const hostTurn = target?.hostTurn ?? (seq > 0 ? seq : undefined)
    if (hostTurn !== undefined) scrollConversationToTurn(hostTurn)
  }

  const onSelectTurn = (next: number): void => {
    if (next === turnSeq) return
    selectTurnState(next)
    syncScrollToTurn(next)
  }

  /** The latest REAL turn — the 最新 button's target (pseudo-turns have no conversation anchor). */
  const latestRealTurn = (turns ?? []).filter(candidate => candidate.hostTurn !== undefined).at(-1)
  const onLatest = (): void => {
    if (latestRealTurn === undefined) return
    if (turnSeq !== latestRealTurn.turnSeq) selectTurnState(latestRealTurn.turnSeq)
    scrollConversationToBottom()
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

  const chips = scopes.map(candidate => ({
    id: candidate.scopeId,
    label: candidate.kind === 'main'
      ? t('scope.main', { count: String(candidate.requests.length) })
      : scopeChipLabel(candidate),
  }))

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
          scope={effectiveScope}
          selectedSeq={selectedRequestSeq}
          request={request}
          filterCat={filterCat}
          previousResponseSeq={previousResponseSeq}
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
            <button type="button" aria-label={t('lens.previous')} disabled={!turns || turns.findIndex(v => v.turnSeq === turnSeq) <= 0} onClick={() => { const i = turns?.findIndex(v => v.turnSeq === turnSeq) ?? -1; const next = turns?.[i - 1]; if (next) onSelectTurn(next.turnSeq) }}>‹</button>
            <TurnMenu turns={turns ?? []} turnSeq={turnSeq} onSelect={onSelectTurn} t={t} />
            <button type="button" aria-label={t('lens.next')} disabled={!turns || turns.findIndex(v => v.turnSeq === turnSeq) >= turns.length - 1} onClick={() => { const i = turns?.findIndex(v => v.turnSeq === turnSeq) ?? -1; const next = turns?.[i + 1]; if (next) onSelectTurn(next.turnSeq) }}>›</button>
          </div>
          {latestRealTurn && turnSeq !== latestRealTurn.turnSeq && <button type="button" className={css.latestText} aria-label={t('turn.latest')} onClick={onLatest}>{t('lens.latest')}</button>}
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
        {turn !== undefined && <div className={css.query}><b>{turn.query}</b></div>}
        {backfill?.state === 'partial' && <div className={css.stateNote}>{t('hint.backfillTruncated')}</div>}
        {chips.length > 0 && (
          <ChipRow
            className={css.agentNav}
            chips={chips}
            value={effectiveScope?.scopeId ?? 'main'}
            onSelect={onSelectScope}
            label={t('tab.title')}
          />
        )}
        {trend && effectiveScope && <Trend data={trend} turnSeq={turnSeq} selectedSeq={selectedRequestSeq} scopeId={effectiveScope.scopeId} scopeLabel={effectiveScope.kind === 'main' ? t('scope.mainName') : `#${effectiveScope.scopeSeq} ${effectiveScope.label ?? effectiveScope.scopeId}`} t={t} onSelect={(next, seq, targetScope) => { onSelectTurn(next); onOpenRequest(seq, targetScope) }} />}
      </div>
      <div className={css.body}>{body}</div>
    </PanelRoot>
  )
}
