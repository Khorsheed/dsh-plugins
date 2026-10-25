/**
 * The task page (right sidebar): every task in the room — one human request
 * and the subtask tree it set in motion — with filters, and a detail view
 * per task: what the human said (and how follow-ups were filed), stop the
 * whole task, follow up through the main composer's tag, what needs the
 * human (uncertain outcomes, held messages), the formal goal it belongs to,
 * the subtask tree, and a member swimlane timeline. The room goal sits on
 * top of the list. The page has no input of its own: 「追问」 and
 * 「＋ 新任务」 tag the main composer.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { RoomDelivery, RoomJob, RoomMember, RoomState } from '../types.ts'
import type { RoomComposerProps, RoomMutationOutcome } from './slots.ts'
import { executionRows } from './executions.ts'
import { formatClock, formatDurationMs } from './format.ts'
import { memberColor } from './member-color.ts'
import { RoomPlanView } from './RoomPlanView.tsx'
import { RoomRecoveryView } from './RoomRecoveryView.tsx'
import {
  TASK_FILTERS, filterJobs, isOpenDelivery, jobDeliveries, jobElapsed, needsAttention, pendingRelays, runningMembers, segmentsOf, subtaskTree,
  type SubtaskNode, type TaskFilter,
} from './tasks.ts'
import { IconChevronLeftOutlineMedium } from './icons.tsx'
import css from './TasksView.module.css'

type T = RoomComposerProps['t']

/** What the task page can do. */
export interface TasksViewActions {
  readonly setGoal?: ((text: string) => Promise<RoomMutationOutcome>) | undefined
  readonly stopJob?: ((task: string) => Promise<RoomMutationOutcome>) | undefined
  /** Stop a member's running round (only the one with that run id, when given). */
  readonly stopDelivery?: ((member: string, deliveryId?: string) => void) | undefined
  readonly reconcile?: RoomComposerProps['reconcileDelivery']
  readonly confirmRelay?: ((relayId: string) => Promise<void>) | undefined
  readonly dismissRelay?: ((relayId: string) => Promise<void>) | undefined
  readonly planCommand?: ((command: string) => Promise<RoomMutationOutcome>) | undefined
  readonly openSession?: ((sessionId: string) => void) | undefined
  /** Tag the main composer (「任务 N」 or 「新任务」) and hand it focus. */
  readonly compose?: ((tag: { readonly task: string; readonly label: string }) => void) | undefined
}

export interface TasksViewProps extends TasksViewActions {
  readonly state: RoomState
  /** Open this task (a navigation param); each revision re-opens. */
  readonly focus?: { readonly task: string; readonly revision: number } | undefined
  readonly t: T
}

const memberOf = (state: RoomState, id: string): RoomMember | undefined =>
  state.members.find(member => member.id === id) ?? state.members.find(member => member.name === id)

function Avatars({ state, ids }: { readonly state: RoomState; readonly ids: readonly string[] }): ReactNode {
  return <span className={css.avatars}>{ids.map(id => {
    const name = memberOf(state, id)?.name ?? id
    return <span key={id} className={css.avatar} style={{ '--member-color': memberColor(name) } as CSSProperties} title={name}>{name.slice(0, 1).toUpperCase()}</span>
  })}</span>
}

/** The task's time split into queue / held / exec, across all its deliveries. */
function Bar({ rows, from, to, now }: { readonly rows: readonly RoomDelivery[]; readonly from: number; readonly to: number; readonly now: number }): ReactNode {
  const span = Math.max(1, to - from)
  return <span className={css.bar} aria-hidden>{rows.flatMap(row => segmentsOf(row, now)).map((segment, index) =>
    <span key={index} className={css.seg} data-kind={segment.kind}
      style={{ left: `${(segment.from - from) / span * 100}%`, width: `${Math.max(0.6, (segment.to - segment.from) / span * 100)}%` }} />)}
  </span>
}

function useNow(live: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [live])
  return now
}

/** The room goal, editable in place. */
function Goal({ goal, setGoal, t }: { readonly goal?: string | undefined; readonly setGoal: TasksViewActions['setGoal']; readonly t: T }): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    if (draft === null || setGoal === undefined) return
    const outcome = await setGoal(draft.trim())
    if (outcome.ok) setDraft(null)
    else setError(outcome.message)
  }
  if (draft !== null) {
    return <div className={css.goal}>
      <input className={css.goalInput} value={draft} placeholder={t('goal.placeholder')} autoFocus aria-label={t('job.goal')}
        onChange={event => { setDraft(event.target.value) }}
        onKeyDown={event => { if (event.key === 'Enter') void save(); else if (event.key === 'Escape') setDraft(null) }} />
      <button type="button" className={css.link} onClick={() => { void save() }}>{t('goal.save')}</button>
      <button type="button" className={css.link} onClick={() => { setDraft(null) }}>{t('goal.cancel')}</button>
      {error !== null && <span role="alert" className={css.error}>{error}</span>}
    </div>
  }
  return <div className={css.goal}>
    <span className={css.goalKey}>{t('job.goal')}</span>
    <span className={goal === undefined ? css.muted : css.goalText}>{goal ?? t('job.goalNone')}</span>
    {setGoal !== undefined && <button type="button" className={css.link} onClick={() => { setDraft(goal ?? ''); setError(null) }}>{goal === undefined ? t('goal.set') : t('goal.edit')}</button>}
  </div>
}

function statusOf(state: RoomState, job: RoomJob): RoomJob['status'] {
  return needsAttention(state, job) ? 'attention' : job.status
}

/** The one-line summary under a row's title: who it is waiting on, or what needs the human. */
function waitingLine(state: RoomState, job: RoomJob, t: T): string | undefined {
  if (needsAttention(state, job)) return t('job.need')
  const running = runningMembers(state, job).map(id => memberOf(state, id)?.name ?? id)
  return running.length === 0 ? undefined : t('job.waiting', { member: running.join('、') })
}

function JobRow({ state, job, now, open, t }: { readonly state: RoomState; readonly job: RoomJob; readonly now: number; readonly open: () => void; readonly t: T }): ReactNode {
  const status = statusOf(state, job)
  const waiting = waitingLine(state, job, t)
  return <button type="button" className={css.row} data-task={job.id} onClick={open}>
    <span className={css.rowHead}>
      <span className={css.dot} data-status={status} aria-hidden />
      <span className={css.rowTitle} title={job.title}>{job.title}</span>
      <span className={css.elapsed}>{formatDurationMs(jobElapsed(job, now))}</span>
    </span>
    <span className={css.rowMeta}>
      <Avatars state={state} ids={job.members} />
      <span className={css.tag} data-status={status}>{t(`job.status.${status}`)}</span>
      {waiting !== undefined && <span className={status === 'attention' ? css.need : css.now}>{waiting}</span>}
      {job.goalId !== undefined && job.goalId === state.plan?.id && <span className={css.tag} data-status="goal">{t('job.goalTag', { objective: state.plan.objective })}</span>}
    </span>
    <Bar rows={jobDeliveries(state, job)} from={job.startedAt} to={job.endedAt ?? now} now={now} />
  </button>
}

function SubtaskTree({ state, nodes, now, actions, t }: { readonly state: RoomState; readonly nodes: readonly SubtaskNode[]; readonly now: number; readonly actions: TasksViewActions; readonly t: T }): ReactNode {
  const executions = new Map(executionRows(state).map(row => [row.id, row]))
  const render = (node: SubtaskNode): ReactNode => {
    const row = node.delivery
    const member = memberOf(state, row.memberId)
    const name = member?.name ?? row.memberId
    const segments = segmentsOf(row, now)
    const from = segments[0]?.from ?? row.queuedAt
    const to = segments.at(-1)?.to ?? from
    const tokens = executions.get(row.id)?.tokens
    return <li key={row.id}>
      <div className={css.node} data-delivery={row.id}>
        <span className={css.nodeState} data-status={row.status} aria-label={t(`team.status.${row.status}`)} />
        <span className={css.avatar} style={{ '--member-color': memberColor(name) } as CSSProperties} aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
        <span className={css.nodeName}>{name}</span>
        <span className={css.nodeText} title={row.text}>{row.kind === 'notify' ? `${t('job.notify')} · ` : ''}{row.text.replace(/\s+/g, ' ')}</span>
        <Bar rows={[row]} from={from} to={Math.max(to, from + 1)} now={now} />
        <span className={css.elapsed}>{formatDurationMs(Math.max(0, to - from))}{tokens === undefined ? '' : ` · ${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)} tok`}</span>
        {row.status === 'running' && actions.stopDelivery !== undefined && member !== undefined
          ? <button type="button" className={css.small} onClick={() => { actions.stopDelivery?.(member.name, row.id) }}>{t('job.node.stop')}</button>
          : member?.childSessionId !== undefined && actions.openSession !== undefined && <button type="button" className={css.small} onClick={() => { actions.openSession?.(member.childSessionId!) }}>{t('job.node.session')}</button>}
      </div>
      {row.error !== undefined && <p className={css.nodeError}>{row.error}</p>}
      {node.children.length > 0 && <ul className={css.tree}>{node.children.map(render)}</ul>}
    </li>
  }
  return <ul className={css.tree} data-root>{nodes.map(render)}</ul>
}

/** One lane per member, each delivery's queue / held / exec stretches along the task's span. */
function Timeline({ state, job, now, t }: { readonly state: RoomState; readonly job: RoomJob; readonly now: number; readonly t: T }): ReactNode {
  const rows = jobDeliveries(state, job)
  const lanes = [...new Set(rows.map(row => row.memberId))]
  const to = job.endedAt ?? now
  return <div className={css.timeline}>
    {lanes.map(id => {
      const name = memberOf(state, id)?.name ?? id
      return <div key={id} className={css.lane}>
        <span className={css.laneName} title={name}>{name}</span>
        <Bar rows={rows.filter(row => row.memberId === id)} from={job.startedAt} to={to} now={now} />
      </div>
    })}
    <div className={css.axis}><span>{formatClock(job.startedAt)}</span><span>{formatDurationMs(Math.max(0, to - job.startedAt))}</span></div>
    <div className={css.legend}>
      {(['queue', 'held', 'exec'] as const).map(kind => <span key={kind}><i className={css.seg} data-kind={kind} />{t(`job.seg.${kind}`)}</span>)}
    </div>
  </div>
}

function JobDetail({ state, job, now, actions, back, t }: { readonly state: RoomState; readonly job: RoomJob; readonly now: number; readonly actions: TasksViewActions; readonly back: () => void; readonly t: T }): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const status = statusOf(state, job)
  const rows = jobDeliveries(state, job)
  const open = rows.filter(isOpenDelivery)
  const relays = pendingRelays(state).filter(relay => relay.intent?.task === job.id)
  const label = t('job.number', { number: job.number })
  const stop = async (): Promise<void> => {
    if (actions.stopJob === undefined || busy) return
    setBusy(true)
    try {
      const outcome = await actions.stopJob(job.id)
      setMessage(outcome.ok ? null : outcome.message)
      setConfirming(false)
    } finally { setBusy(false) }
  }
  const stopping = [...new Set(open.map(row => memberOf(state, row.memberId)?.name ?? row.memberId))]
  return <div className={css.detail} data-task={job.id}>
    <button type="button" className={css.back} onClick={back}><IconChevronLeftOutlineMedium size={18} />{t('job.back')}</button>
    <div className={css.card}>
      <strong className={css.cardTitle}>{label} · {job.title}</strong>
      <div className={css.rowMeta}>
        <span className={css.tag} data-status={status}>{t(`job.status.${status}`)}</span>
        <span className={css.muted}>{t('job.elapsed', { time: formatDurationMs(jobElapsed(job, now)) })}</span>
        <Avatars state={state} ids={job.members} />
      </div>
      <ul className={css.messages}>{job.messages.map(entry =>
        <li key={entry.id}>
          <span className={css.muted}>{formatClock(entry.time)}</span>
          <span className={css.messageText}>{t('job.you')}{entry.text}</span>
          {entry.by !== undefined && <span className={css.attr}>{entry.by === 'model'
            ? t('job.by.model', { probability: (entry.probability ?? 0).toFixed(2) })
            : t(`job.by.${entry.by}`)}</span>}
        </li>)}
      </ul>
      <Bar rows={rows} from={job.startedAt} to={job.endedAt ?? now} now={now} />
    </div>
    <div className={css.actions}>
      {open.length > 0 && actions.stopJob !== undefined && !confirming
        && <button type="button" className={css.danger} onClick={() => { setConfirming(true) }}>{t('job.stop')}</button>}
      {actions.compose !== undefined && <button type="button" className={css.primary} onClick={() => { actions.compose?.({ task: job.id, label }) }}>{t('job.followUp')}</button>}
      {actions.compose !== undefined && <span className={css.muted}>{t('job.followUpHint', { label })}</span>}
    </div>
    {confirming && <div className={css.confirm} role="alertdialog" aria-label={t('job.stop')}>
      <p>{t('job.stopConfirm', { members: stopping.join('、') })}</p>
      <div className={css.actions}>
        <button type="button" className={css.danger} disabled={busy} onClick={() => { void stop() }}>{t('job.stopYes')}</button>
        <button type="button" className={css.small} onClick={() => { setConfirming(false) }}>{t('goal.cancel')}</button>
      </div>
    </div>}
    {message !== null && <p role="alert" className={css.error}>{message}</p>}
    {actions.reconcile !== undefined && <RoomRecoveryView deliveries={rows} members={state.members} reconcile={actions.reconcile} openSession={actions.openSession} t={t} />}
    {relays.map(relay => <div key={relay.id} className={css.need}>
      <p>{t('job.relay', { from: relay.from, to: relay.to })}</p>
      <p className={css.messageText}>{relay.content}</p>
      <div className={css.actions}>
        {actions.confirmRelay !== undefined && <button type="button" className={css.small} onClick={() => { void actions.confirmRelay?.(relay.id) }}>{t('job.relayConfirm')}</button>}
        {actions.dismissRelay !== undefined && <button type="button" className={css.small} onClick={() => { void actions.dismissRelay?.(relay.id) }}>{t('job.relayDismiss')}</button>}
      </div>
    </div>)}
    {job.goalId !== undefined && job.goalId === state.plan?.id && actions.planCommand !== undefined && <section className={css.section}>
      <h4>{t('job.goalTag', { objective: state.plan.objective })}</h4>
      <RoomPlanView plan={state.plan} members={state.members} command={actions.planCommand} openSession={actions.openSession} stopMember={actions.stopDelivery} t={t} />
    </section>}
    <section className={css.section}>
      <h4>{t('job.subtasks')}</h4>
      <SubtaskTree state={state} nodes={subtaskTree(state, job)} now={now} actions={actions} t={t} />
    </section>
    <section className={css.section}>
      <h4>{t('job.timeline')}</h4>
      <Timeline state={state} job={job} now={now} t={t} />
    </section>
  </div>
}

/** The task page body. */
export function TasksView({ state, focus, t, ...actions }: TasksViewProps): ReactNode {
  const jobs = state.jobs ?? []
  const [filter, setFilter] = useState<TaskFilter>(() => jobs.some(job => job.status === 'running' || needsAttention(state, job)) ? 'running' : 'all')
  const [selected, setSelected] = useState<string | null>(focus?.task ?? null)
  useEffect(() => { if (focus !== undefined) setSelected(focus.task) }, [focus?.task, focus?.revision])
  const now = useNow(jobs.some(job => job.status === 'running' || job.status === 'attention'))
  const job = jobs.find(entry => entry.id === selected)
  if (job !== undefined) return <div className={css.page}><JobDetail state={state} job={job} now={now} actions={actions} back={() => { setSelected(null) }} t={t} /></div>
  const shown = filterJobs(state, filter)
  // A formal goal no task has picked up yet still needs a home.
  const looseGoal = state.plan !== undefined && !jobs.some(entry => entry.goalId === state.plan?.id)
  return <div className={css.page}>
    <Goal goal={state.goal} setGoal={actions.setGoal} t={t} />
    <div className={css.filters} role="group" aria-label={t('job.title')}>
      {TASK_FILTERS.map(value => <button key={value} type="button" className={css.filter} data-kind={value} aria-pressed={filter === value} onClick={() => { setFilter(value) }}>
        {t(`job.filter.${value}`)}<span className={css.count}>{filterJobs(state, value).length}</span>
      </button>)}
      {actions.compose !== undefined && <button type="button" className={css.newTask} onClick={() => { actions.compose?.({ task: 'new', label: t('job.tagNew') }) }}>{t('job.new')}</button>}
    </div>
    <div className={css.list}>
      {shown.map(entry => <JobRow key={entry.id} state={state} job={entry} now={now} open={() => { setSelected(entry.id) }} t={t} />)}
      {shown.length === 0 && <p className={css.muted}>{jobs.length === 0 ? t('job.empty') : t('job.emptyFilter')}</p>}
    </div>
    {looseGoal && actions.planCommand !== undefined && <section className={css.section}>
      <h4>{t('job.goalTag', { objective: state.plan!.objective })}</h4>
      <RoomPlanView plan={state.plan} members={state.members} command={actions.planCommand} openSession={actions.openSession} stopMember={actions.stopDelivery} t={t} />
    </section>}
  </div>
}
