import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RoomState } from '../types.ts'
import type { RoomComposerProps } from './slots.ts'
import { IconAgentPresetOutlineMedium, IconChecklistOutlineMedium, IconStopFillMedium } from './icons.tsx'
import { descendantRows, executionRows, type ExecutionRow, type BackgroundSessionsStore } from './executions.ts'
import { formatDurationMs } from './format.ts'
import { RoomPlanView } from './RoomPlanView.tsx'
import css from './RoomActivityDock.module.css'

export interface RoomActivityDockProps {
  sessionId?: string
  backgroundSessions?: RoomComposerProps['backgroundSessions']
  activeChildren?: RoomComposerProps['activeChildren']
  stopChild?: RoomComposerProps['stopChild']
  state: RoomState
  openSession?: RoomComposerProps['openPlanSession']
  stopExecution?: RoomComposerProps['stopExecution']
  planCommand?: RoomComposerProps['planCommand']
  openPlan?: RoomComposerProps['openPlan']
  stopMember?: RoomComposerProps['stopMember']
  t: RoomComposerProps['t']
}
const EMPTY_SESSIONS = { byId: {} }
const NO_SESSIONS: BackgroundSessionsStore = { subscribe: () => () => {}, getSnapshot: () => EMPTY_SESSIONS }

/** Composer-owned capsules: panels grow above their triggers, never into the input. */
export function RoomActivityDock({ state, sessionId, backgroundSessions = NO_SESSIONS, activeChildren, stopChild, openSession, stopExecution, planCommand, openPlan, stopMember, t }: RoomActivityDockProps): ReactNode {
  const [expanded, setExpanded] = useState<'agents' | 'plan' | null>(null)
  const [filter, setFilter] = useState<'recent' | 'running' | 'attention' | 'all'>('recent')
  const [detail, setDetail] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const [active, setActive] = useState<readonly string[]>([])
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const sessions = useSyncExternalStore(backgroundSessions.subscribe, backgroundSessions.getSnapshot)
  const descendants = sessionId === undefined ? [] : descendantRows(sessions.byId, sessionId, state, now, active)
  const rows = [...executionRows(state), ...descendants]
  const hasChildren = Object.values(sessions.byId).some(child => child.parentId === sessionId && child.origin === 'subagent')
  useEffect(() => {
    if (!activeChildren || !hasChildren) return
    let disposed = false; let pending = false
    const refresh = async (): Promise<void> => {
      if (pending) return
      pending = true
      try { const value = await activeChildren(); if (!disposed && value !== undefined) setActive(value) }
      catch { /* Unknown is not evidence that a delegation stopped. */ }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 2000)
    return () => { disposed = true; clearInterval(timer) }
  }, [activeChildren, hasChildren])
  const running = rows.filter(row => row.status === 'running')
  useEffect(() => {
    if (expanded === null) return
    const close = (event: PointerEvent): void => { if (event.target instanceof Node && !root.current?.contains(event.target)) setExpanded(null) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setExpanded(null); root.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus() } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [expanded])
  useEffect(() => {
    if (expanded !== 'agents' || running.length === 0) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expanded, running.length])
  const stop = async (row: ExecutionRow): Promise<void> => {
    if (pending !== null) return
    setPending(row.id); setError(null)
    try {
      const result = row.sessionTotal && row.childSessionId ? await stopChild?.(row.childSessionId) : row.execution ? await stopExecution?.(row.member, row.execution) : undefined
      if (!result) return
      if (!result.ok) setError(result.message)
    } catch { setError(t('composer.error.generic')) }
    finally { setPending(null) }
  }
  const leaf = state.plan?.tasks.filter(task => task.kind === 'task' && task.status !== 'cancelled') ?? []
  const accepted = leaf.filter(task => task.status === 'accepted').length
  const visible = filter === 'running' ? running : filter === 'attention'
    ? rows.filter(row => ['failed', 'uncertain', 'submitted'].includes(row.status)) : filter === 'recent' ? rows.slice(0, 6) : rows
  if (rows.length === 0 && state.plan === undefined) return null
  return <div ref={root} className={css.root} data-testid="room-activity-dock">
    {expanded === 'agents' && <section className={css.panel} id={`${id}-agents`} aria-label={t('activity.agents')}>
      <div className={css.heading}><strong>{t('activity.agents')}</strong><div className={css.filters}>
        {(['recent', 'running', 'attention', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`activity.filter.${value}`)}</button>)}
      </div></div>
      {error && <p role="alert">{error}</p>}
      <div className={css.grid}>{visible.map(row => <article key={row.id} className={css.card}>
        <button type="button" className={css.cardMain} disabled={!row.childSessionId || !openSession} onClick={() => row.childSessionId && openSession?.(row.childSessionId)} aria-label={`${t('activity.session')}: ${row.title}`}>
          <span className={css.meta}><span>{row.member}</span><span data-status={row.status}>{t(`activity.status.${row.status}`)}</span></span>
          <span className={css.title} title={row.title}>{row.title}</span>
          <span className={css.secondary}>{[row.provider, row.model, row.effort].filter(Boolean).join(' · ')}</span>
        </button>
        {row.error && <p className={css.error}>{row.error}</p>}
        <div className={css.footer}><span>{row.sessionTotal ? `${t('activity.sessionTotal')} · ` : ''}{row.status === 'queued' ? t('activity.notStarted') : row.status === 'running' && row.startedAt !== undefined ? formatDurationMs(Math.max(0, now - row.startedAt)) : row.elapsedMs === undefined ? '—' : formatDurationMs(row.elapsedMs)}{row.tokens === undefined ? '' : ` · ${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(row.tokens)} tok`}</span>
          {row.status === 'running' && ((row.execution && stopExecution) || (row.sessionTotal && stopChild)) ? <button type="button" disabled={pending !== null} onClick={() => { void stop(row) }} aria-label={`${t('activity.stop')}: ${row.title}`}><IconStopFillMedium size={12} />{t('activity.stop')}</button>
            : row.childSessionId && openSession && <button type="button" onClick={() => openSession(row.childSessionId!)}>{t('activity.session')}</button>}
        </div>
      </article>)}</div>
      {visible.length === 0 && <p className={css.empty}>{t('activity.empty')}</p>}
    </section>}
    {expanded === 'plan' && state.plan && <section className={css.panel} id={`${id}-plan`} aria-label={t('activity.plan')}>
      <div className={css.heading}><strong>{state.plan.objective}</strong><span className={css.secondary}>{t(`plan.status.${state.plan.status}`)} · {t('plan.acceptedCount', { done: accepted, total: leaf.length })}</span></div>
      {state.plan.reason && <p className={css.error}>{state.plan.reason}</p>}
      <div className={css.planList}>{leaf.map(task => {
        const member = state.members.find(member => member.id === task.ownerMemberId)
        return <button type="button" key={task.id} className={css.planRow} onClick={() => { if (openPlan) openPlan(); else setDetail(true) }}>
          <span className={css.taskDot} data-status={task.status} aria-hidden />
          <span>{task.title}</span><span className={css.secondary}>{member?.name} · {t(`plan.status.${task.status}`)}</span>
        </button>
      })}</div>
      {leaf.length === 0 && <p className={css.empty}>{t('activity.planning')}</p>}
      <div className={css.footer}><span /><button type="button" onClick={() => { if (openPlan) openPlan(); else setDetail(value => !value) }}>{t('activity.planDetails')}</button></div>
      {detail && !openPlan && planCommand && <RoomPlanView expanded plan={state.plan} members={state.members} command={planCommand} openSession={openSession} stopMember={stopMember} t={t} />}
    </section>}
    <div className={css.capsules}>
      {rows.length > 0 && <button type="button" className={css.capsule} aria-expanded={expanded === 'agents'} aria-controls={`${id}-agents`} title={running.length > 0 ? t('activity.runningHint', { count: new Set(running.map(row => row.member)).size }) : t('activity.agents')} onClick={() => setExpanded(value => value === 'agents' ? null : 'agents')}>
        <span className={css.icon}>{running.length > 0 ? <span className={css.runningDot} data-testid="room-running-dot" aria-hidden /> : <IconAgentPresetOutlineMedium size={16} />}</span>{t('activity.agents')}
      </button>}
      {state.plan && <button type="button" className={css.capsule} aria-expanded={expanded === 'plan'} aria-controls={`${id}-plan`} onClick={() => setExpanded(value => value === 'plan' ? null : 'plan')}><IconChecklistOutlineMedium size={16} />{t('activity.plan')} <span className={css.secondary}>{accepted}/{leaf.length}</span></button>}
    </div>
  </div>
}
