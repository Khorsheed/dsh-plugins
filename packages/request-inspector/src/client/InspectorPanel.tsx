/**
 * The request-inspector right-Sidebar tab body: the 请求明细 page. Header =
 * title + the Token/耗时 mini switch; the query line carries the turn switcher
 * (default latest); the scope chips row navigates 主对话 + one chip per
 * delegation run; the body is the token tab (request list + four-segment
 * detail), the timing tab (whole-turn buckets/lanes/tools), or the raw JSON
 * view; the footer switches 结构化 / 原始 JSON / wire body (the last is the
 * not-yet-implemented enhancement seat, rendered disabled with its host
 * requirement as the tooltip).
 *
 * Data flow: `listTurns` on mount (navigation params re-assert their turn on
 * every navigation revision), `getTurn` per selected turn, `getRequest` per
 * selected card (cached per turn), `getTurnTiming` when the timing tab shows.
 * The Remote is pull-based — the panel refetches on open / turn switch, per
 * the wire contract.
 *
 * @module @khorsheed/dsh-request-inspector/client
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChipRow, PanelRoot } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type {
  AgentScopeOverview, CapturedRequest, SegmentCategory, TurnListItem, TurnOverview, TurnTiming,
} from '../types.ts'
import { fmtSpan, latestTurnSeq } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import type { RequestInspectorTabParams } from './definition.tsx'
import { RawView } from './RawView.tsx'
import { SegCtl } from './SegCtl.tsx'
import { TimingView } from './TimingView.tsx'
import { TokenView } from './TokenView.tsx'
import css from './InspectorPanel.module.css'

/** The panel's translate face. */
type T = InspectorTabProps['t']

/** The two main views. */
type MainTab = 'token' | 'time'
/** The footer's data views. */
type ViewTab = 'structured' | 'raw'

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
  listTurns, getTurn, getRequest, getTurnTiming,
}: InspectorTabProps): ReactNode {
  const { tab } = useTabInfo()
  const [turns, setTurns] = useState<readonly TurnListItem[] | null>(null)
  const [turnSeq, setTurnSeq] = useState<number | null>(null)
  const [overview, setOverview] = useState<TurnOverview | null>(null)
  const [timing, setTiming] = useState<TurnTiming | null>(null)
  const [request, setRequest] = useState<CapturedRequest | null>(null)
  const [mainTab, setMainTab] = useState<MainTab>('token')
  const [viewTab, setViewTab] = useState<ViewTab>('structured')
  const [filterCat, setFilterCat] = useState<SegmentCategory | null>(null)
  const [scopeId, setScopeId] = useState<string>('main')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [turnMissing, setTurnMissing] = useState(false)
  /** The selected turn's fetched request details (seq → capture). */
  const detailCache = useRef(new Map<number, CapturedRequest>())

  // Navigation params apply once per revision (a repeat open re-navigates the
  // one tab): the turn action's { turnSeq } selects that turn.
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
    setViewTab('structured')
  }, [revision, navTurnSeq])

  // The session's turn list, on mount (pull-based: refetch = reopen).
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
      setTurns(result.value)
      setTurnSeq(previous => previous !== null && result.value.some(turn => turn.turnSeq === previous)
        ? previous
        : latestTurnSeq(result.value) ?? null)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [sessionId, listTurns, tab.signal])

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
    let cancelled = false
    const seq = selectedRequestSeq
    void getRequest(sessionId, seq).then(result => {
      if (cancelled || tab.signal.aborted) return
      if (result.ok && result.value !== undefined) {
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

  const onSelectTurn = (next: number): void => {
    if (next === turnSeq) return
    setTurnSeq(next)
    setScopeId('main')
    setSelectedSeq(null)
    setFilterCat(null)
    setOverview(null)
  }

  const onSelectScope = (next: string): void => {
    if (next === effectiveScope?.scopeId) return
    setScopeId(next)
    setSelectedSeq(null)
    setFilterCat(null)
    setViewTab('structured')
  }

  const onMainTab = (next: MainTab): void => {
    setMainTab(next)
    setViewTab('structured')
  }

  /** A timing tab call row's click-through: the token tab, that scope, that request. */
  const onOpenRequest = (seq: number, targetScopeId: string): void => {
    setMainTab('token')
    setViewTab('structured')
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

  const scopeTag = effectiveScope === undefined || effectiveScope.kind === 'main'
    ? t('scope.tagMain', { count: String(scopeRequests.length) })
    : t('scope.tagSub', {
      label: `#${effectiveScope.scopeSeq} ${effectiveScope.label ?? effectiveScope.scopeId}`,
    })

  let body: ReactNode
  if (turns === null) {
    body = <div className={css.stateNote} role="status">{t('state.loading')}</div>
  } else if (error !== null && (turns.length === 0 || overview === null)) {
    // A failed verb (listTurns or getTurn) outranks the empty states.
    body = <div className={css.stateNote} role="alert">{t('state.error', { message: error })}</div>
  } else if (turns.length === 0) {
    body = <div className={css.stateNote} role="status">{t('state.noTurns')}</div>
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
  } else if (viewTab === 'raw') {
    body = request === null
      ? <div className={css.stateNote} role="status">{t('state.loading')}</div>
      : <RawView request={request} t={t} />
  } else if (mainTab === 'token') {
    body = (
      <div className={css.bodyFill}>
        {effectiveScope.status === 'failed' && <FailureCard scope={effectiveScope} t={t} />}
        <TokenView
          scope={effectiveScope}
          selectedSeq={selectedRequestSeq}
          request={request}
          filterCat={filterCat}
          onSelect={seq => { setSelectedSeq(seq) }}
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
          filterScopeId={effectiveScope.kind === 'subagent' ? effectiveScope.scopeId : undefined}
          filterIsSubagent={effectiveScope.kind === 'subagent'}
          config={effectiveScope.config}
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
        {turn !== undefined && (
          <div className={css.query}>
            {t('query.prefix')}<b>{turn.query}</b>
            <span className={css.querySep}>·</span>
            <select
              className={css.turnSelect}
              aria-label={t('turn.switch')}
              value={turnSeq ?? ''}
              onChange={event => { onSelectTurn(Number(event.target.value)) }}
            >
              {[...(turns ?? [])].reverse().map(candidate => (
                <option key={candidate.turnSeq} value={candidate.turnSeq}>
                  {t('turn.label', { seq: String(candidate.turnSeq) })} · {candidate.query}
                </option>
              ))}
            </select>
            <span className={css.querySep}>·</span>
            <span className={css.scopeTag}>{scopeTag}</span>
          </div>
        )}
        {chips.length > 0 && (
          <ChipRow
            className={css.agentNav}
            chips={chips}
            value={effectiveScope?.scopeId ?? 'main'}
            onSelect={onSelectScope}
            label={t('tab.title')}
          />
        )}
      </div>
      <div className={css.body}>{body}</div>
      <div className={css.foot}>
        <SegCtl
          label={t('view.structured')}
          options={[
            { id: 'structured' as const, label: t('view.structured') },
            { id: 'raw' as const, label: t('view.raw') },
            { id: 'wire' as const, label: 'wire body', disabled: true, hint: t('view.wireHint'), tag: '≥0.1.2' },
          ]}
          value={viewTab}
          onChange={id => { setViewTab(id === 'raw' ? 'raw' : 'structured') }}
        />
        <span className={css.footNote}>{t('foot.note')}</span>
      </div>
    </PanelRoot>
  )
}
