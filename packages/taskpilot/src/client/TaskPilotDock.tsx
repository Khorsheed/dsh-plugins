/**
 * TaskPilot dock pills: two entry capsules above the composer card —
 * "Background jobs" and "Subagents" — each opening a popover listing the
 * current session's rows. Jobs read the same `jobsBySession` mirror as the
 * header list; subagents fold the whole subagent-only descendant lineage from
 * session summaries (the same index the header tree counts), so counts and
 * rows stay consistent with the title by construction. Jobs tick once per
 * second while a popover is open; each row carries its stop/interrupt verb,
 * the detail drawer entry, and the session jump target.
 *
 * @module dsh-taskpilot/client/dock
 */

import { useEffect, useMemo, useState } from 'react'
import { indexSubagentDescendants, type JobView } from '@deepseek-ai/dsh-client-runtime/client'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS, TaskPilotLocale } from './locales.ts'
import css from './TaskPilotDock.module.css'

export type TaskPilotLocaleKey = TaskPilotLocale

/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_JOBS: readonly JobView[] = []

type T = TranslateNS<typeof NS>

/** A job the registry still holds open, and whose duration therefore ticks. */
function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Live rows first in start order, then settled rows newest-first. */
function ordered(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  })
}

/** Elapsed time in at most two adjacent units (same shape as the header list). */
function formatDuration(elapsedMs: number, t: T): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value: number): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Sum the four disjoint durable provider-usage buckets (same as the header tree). */
function tokenTotal(summary: SubagentSummary | undefined): number | undefined {
  const usage = summary?.projectionValues?.tokenUsage
  if (usage === undefined) return undefined
  return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Exact whole-second active-turn duration for one subagent row. */
function activityDuration(
  summary: SubagentSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  const timing = summary?.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running' ? now : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

function dotState(status: JobView['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
  }
}

/** Status word shared with the header list (same key set as ui-jobs). */
function statusLabel(status: JobView['status'], t: T): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'killed': return t('status.killed')
    case 'failed': return t('status.failed')
  }
}

/** Stop icon in the composer-stop visual language (rounded square). */
function StopIcon({ size = 12 }: { size?: number }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
    </svg>
  )
}

/** Injected verbs the dock needs; the apply closure wires them to product services. */
export interface TaskPilotDockInjected {
  stopJob: (jobId: JobView['id']) => Promise<unknown>
  /** Interrupt one subagent; a deep descendant needs its direct parent for authorization. */
  interruptSubagent: (childId: SessionId, parentId?: SessionId) => Promise<unknown>
  openJob: (jobId: JobView['id']) => void
  openSession: (sessionId: SessionId) => void
}

export type TaskPilotDockProps =
  PropsRuntime<'conversation.input.dock'>
  & TaskPilotDockInjected
  & PropsLocale<typeof NS>

/** Narrow view of one session summary (wire-shaped, fields the row reads). */
interface SummaryLike {
  readonly id: SessionId
  readonly parentId?: SessionId
  readonly origin?: 'subagent'
  readonly displayTitle?: string
  readonly running?: boolean
  readonly projectionValues?: SubagentSummary['projectionValues']
}

/** Narrow view of a session summary's subagent projections (wire-shaped). */
interface SubagentSummary {
  readonly projectionValues?: {
    readonly tokenUsage?: {
      readonly uncachedInputTokens: number
      readonly outputTokens: number
      readonly cacheReadTokens: number
      readonly cacheWriteTokens: number
    }
    readonly subagentTiming?: {
      readonly settledMs: number
      readonly active?: { readonly since: number; readonly through: number }
    }
  }
}

/** One flattened subagent descendant row, at its lineage depth. */
interface DescendantRow {
  readonly id: SessionId
  /** Direct parent session, used to authorize the interrupt verb. */
  readonly parentId: SessionId
  readonly label: string
  readonly running: boolean
  readonly level: number
  readonly summary: SubagentSummary | undefined
}

/**
 * Flatten the subagent-only descendant lineage of one session, depth-first,
 * cycles fail soft. The header tree counts the same lineage through
 * `indexSubagentDescendants`; this walk supplies the rows it aggregates.
 * @param summaries - retained session summaries keyed by id.
 * @param parentId - the session whose lineage to walk.
 * @returns descendant rows in tree order with their depth.
 */
export function collectDescendants(
  summaries: Readonly<Record<string, unknown>>,
  parentId: SessionId,
): DescendantRow[] {
  const rows: DescendantRow[] = []
  const seen = new Set<SessionId>()
  const values = Object.values(summaries) as unknown as SummaryLike[]
  const visit = (pid: SessionId, level: number): void => {
    for (const summary of values) {
      if (summary.origin !== 'subagent' || summary.parentId !== pid) continue
      if (seen.has(summary.id)) continue
      seen.add(summary.id)
      rows.push({
        id: summary.id,
        parentId: pid,
        label: summary.displayTitle || summary.id,
        running: summary.running === true,
        level,
        summary: summary as unknown as SubagentSummary | undefined,
      })
      visit(summary.id, level + 1)
    }
  }
  visit(parentId, 0)
  return rows
}

export function TaskPilotDock(props: TaskPilotDockProps): React.ReactElement | null {
  const { sessionId, useSessions, stopJob, interruptSubagent, openJob, openSession, t } = props
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_JOBS
  const summaries = useSessions(state => state.byId) ?? {}
  const catalog = useSessions(state => state.subagentsByParent?.[sessionId])

  const rows = useMemo(() => ordered(jobs), [jobs])
  const liveJobs = useMemo(() => jobs.filter(isLive), [jobs])
  const descendants = useMemo(() => collectDescendants(summaries, sessionId), [summaries, sessionId])
  // Direct children carry the durable creation label (descriptor label, same
  // source as the header tree); deep descendants fall back to the summary's
  // displayTitle, whose session-title projection can lag one beat.
  const catalogLabels = useMemo(() => new Map(
    (catalog?.entries ?? [])
      .filter((entry): entry is Extract<typeof entry, { kind: 'child' }> => entry.kind === 'child')
      .map(entry => [entry.id, entry.label]),
  ), [catalog])
  const stats = useMemo(() => indexSubagentDescendants(summaries).get(sessionId), [summaries, sessionId])
  const subagentCount = stats?.count ?? descendants.length
  const runningSubagents = useMemo(() => descendants.filter(row => row.running), [descendants])
  const runningCount = stats?.runningCount ?? runningSubagents.length

  // Which capsule's popover is open: 'jobs' | 'subagents' | null.
  const [open, setOpen] = useState<'jobs' | 'subagents' | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const clockOn = open !== null && (open === 'jobs' ? liveJobs.length > 0 : runningSubagents.length > 0)

  // The clock only runs while an open popover is showing something that moves.
  useEffect(() => {
    if (!clockOn) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [clockOn])

  const toggle = (key: 'jobs' | 'subagents'): void => {
    setNow(Date.now())
    setOpen(current => current === key ? null : key)
  }

  // Per-capsule visibility: a capsule renders only when its own data is
  // non-empty, so a session with only subagents shows only the subagent
  // capsule (and vice versa); a session with neither renders nothing.
  const showJobs = jobs.length > 0
  const showSubagents = subagentCount > 0
  if (!showJobs && !showSubagents) return null

  return (
    <div className={css.dock}>
      <div className={css.inner}>
      {showJobs && (
      <section className={css.group} aria-label={t('dock.jobs.label')}>
        <button
          type="button"
          className={css.capsule}
          aria-expanded={open === 'jobs'}
          onClick={() => toggle('jobs')}
        >
          {liveJobs.length > 0 && <StateDot state="ongoing" className={css.capsuleDot} />}
          <span className={css.capsuleLabel}>{t('dock.jobs.label')}</span>
          <span className={css.capsuleCount}>{jobs.length}</span>
        </button>
        {open === 'jobs' && (
          <ul className={css.popover} aria-label={t('dock.jobs.label')}>
            {rows.map((job) => {
              const live = isLive(job)
              const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt
              return (
                <li key={job.id} className={live ? css.row : `${css.row} ${css.rowSettled}`}>
                  <StateDot state={dotState(job.status)} className={css.rowDot} />
                  <button
                    type="button"
                    className={css.rowMain}
                    onClick={() => { openJob(job.id) }}
                    title={job.label}
                    aria-label={t('dock.aria.details', { jobId: job.id })}
                  >
                    <span className={css.rowKind}>{job.kind}</span>
                    <span className={css.rowLabel}>{job.label}</span>
                    <span className={css.rowStatus} title={job.detail}>
                      {job.detail ?? statusLabel(job.status, t)}
                    </span>
                    <span className={css.rowDuration}>{formatDuration(elapsed, t)}</span>
                  </button>
                  {live && (
                    <button
                      type="button"
                      className={css.stop}
                      onClick={() => { void stopJob(job.id) }}
                      aria-label={t('dock.aria.stop', { jobId: job.id })}
                      title={t('dock.stop')}
                    >
                      <StopIcon />
                    </button>
                  )}
                </li>
              )
            })}
            {rows.length === 0 && <li className={css.empty}>{t('dock.jobs.empty')}</li>}
          </ul>
        )}
      </section>
      )}

      {showSubagents && (
      <section className={css.group} aria-label={t('dock.subagents.label')}>
        <button
          type="button"
          className={css.capsule}
          aria-expanded={open === 'subagents'}
          onClick={() => toggle('subagents')}
        >
          {runningCount > 0 && <StateDot state="ongoing" className={css.capsuleDot} />}
          <span className={css.capsuleLabel}>{t('dock.subagents.label')}</span>
          <span className={css.capsuleCount}>{subagentCount}</span>
        </button>
        {open === 'subagents' && (
          <ul className={css.popover} aria-label={t('dock.subagents.label')}>
            {descendants.map((child) => {
              const tokens = tokenTotal(child.summary)
              const durationMs = activityDuration(child.summary, child.running ? 'running' : 'inactive', now)
              return (
                <li
                  key={child.id}
                  className={child.running ? css.row : `${css.row} ${css.rowSettled}`}
                  style={child.level > 0 ? { paddingLeft: 8 + child.level * 14 } : undefined}
                >
                  <StateDot state={child.running ? 'ongoing' : 'done'} className={css.rowDot} />
                  <button
                    type="button"
                    className={css.rowMain}
                    onClick={() => openSession(child.id)}
                    title={child.id}
                    aria-label={t('dock.aria.open', { childId: child.id })}
                  >
                    <span className={css.rowLabel}>{catalogLabels.get(child.id) ?? child.label}</span>
                    {durationMs !== undefined && (
                      <span className={css.rowDuration}>{formatDuration(durationMs, t)}</span>
                    )}
                    {tokens !== undefined && (
                      <span className={css.rowTokens}>{formatTokens(tokens)}</span>
                    )}
                  </button>
                  {child.running && (
                    <button
                      type="button"
                      className={css.stop}
                      onClick={() => { void interruptSubagent(child.id, child.parentId) }}
                      aria-label={t('dock.aria.interrupt', { childId: child.id })}
                      title={t('dock.interrupt')}
                    >
                      <StopIcon />
                    </button>
                  )}
                </li>
              )
            })}
            {descendants.length === 0 && <li className={css.empty}>{t('dock.subagents.empty')}</li>}
          </ul>
        )}
      </section>
      )}
      </div>
    </div>
  )
}
