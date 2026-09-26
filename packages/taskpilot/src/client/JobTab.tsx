/**
 * TaskPilot job detail tab: the right-sidebar page body (session scope)
 * showing one job's metadata from the `jobsBySession` mirror and its
 * execution trail folded from the durable session log. Rows collapse by
 * default; the full tool-result text expands on click. The selection arrives
 * as navigation params (`openTab('taskpilot', { params: { jobId } })` from
 * the dock pill); pages deduplicate, so picking another job re-navigates this
 * tab and the body follows `navigation.params` / `navigation.revision`.
 * A live job's duration ticks once per second on the same clock discipline as
 * the dock pill; a duration that cannot be computed renders `—` rather than a
 * misleading `0s`. Reads only product-provided data — no new RPC surface, no
 * product change.
 *
 * @module dsh-taskpilot/client/job-tab
 */

import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// rc.1 retired the remotes-assembly `JobView` re-export together with the
// session-list `jobsBySession` mirror: the view type lives at the registry's
// own subpath now, and the roster rides `ctx.jobs` (see ./jobs-channel.ts —
// 0.1.5 keeps the session-list mirror, both reads converge below).
// HistoryEntry retired with the apiproxy — the tab reads the generated
// session remote's history records, unwrapped at the seam into the fold's
// narrow row shape.
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { buildJobTrajectory, type SessionLogRow } from './job-trajectory.ts'
import type { JobsSnapshotLike } from './jobs-channel.ts'
import type { TaskPilotTabParams } from './definition.ts'
import type { TrajectoryEntry } from '../types.ts'
import type { NS } from './locales.ts'
import css from './JobTab.module.css'

/** One history page as the tab reads it: raw wire rows, oldest first. */
export interface HistoryPage {
  readonly events: readonly SessionLogRow[]
  readonly hasMore: boolean
}

/** 0.1.5's session-list job mirror; rc.1 removed the key (see ./jobs-channel.ts). */
interface LegacySessionListState {
  jobsBySession?: Readonly<Record<string, readonly JobView[]>>
}

/** Injected data channel; the apply closure wires it to the session remote. */
export interface JobTabInjected {
  loadHistory: (
    sessionId: SessionId,
    beforeSeq: number | undefined,
    maxMessages: number,
  ) => Promise<HistoryPage | undefined>
  /** Keep rc.1's job roster for one session current; a no-op disposer on 0.1.5. */
  watchRows: (sessionId: SessionId) => () => void
  hooks: {
    /** rc.1's job-roster mirror (empty on 0.1.5, where the legacy session-list read answers). */
    jobs: {
      getSnapshot(): JobsSnapshotLike
      subscribe(listener: () => void): () => void
    }
  }
}

export type JobTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<JobTabInjected>
  & PropsLocale<typeof NS>

const PAGE_MESSAGES = 200

type T = TranslateNS<typeof NS>

function formatDateTime(time: number): string {
  const date = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDuration(elapsedMs: number, t: T): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/** A job the registry still holds open, and whose duration therefore ticks. */
function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

function statusText(status: JobView['status'], t: T): string {
  switch (status) {
    case 'running': return 'running'
    case 'stopping': return 'stopping'
    case 'completed': return 'completed'
    case 'killed': return 'killed'
    case 'failed': return 'failed'
    /* v8 ignore next -- closed wire status union */
    default: return status
  }
}

function rowClass(kind: TrajectoryEntry['kind']): string {
  const map: Record<TrajectoryEntry['kind'], string> = {
    start: css.rowStart ?? '',
    read: css.rowRead ?? '',
    kill: css.rowKill ?? '',
    notice: css.rowNotice ?? '',
  }
  return map[kind]
}

/** One trajectory row: collapsed by default, expanding its full text on click. */
function TrajectoryRow({ entry, t }: { entry: TrajectoryEntry; t: T }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className={`${css.row} ${rowClass(entry.kind)}`}>
      <button
        type="button"
        className={css.rowMain}
        onClick={() => { if (entry.detail !== undefined) setExpanded(current => !current) }}
        aria-expanded={expanded}
      >
        <span className={css.rowTitle}>{entry.title}</span>
        {entry.detail !== undefined && (
          <span className={css.rowToggle}>
            {expanded ? t('drawer.trajectory.collapse') : t('drawer.trajectory.expand')}
          </span>
        )}
      </button>
      {expanded && entry.detail !== undefined && <pre className={css.rowDetail}>{entry.detail}</pre>}
    </li>
  )
}

export function JobTab(props: JobTabProps): React.ReactElement {
  const { sessionId, useSessions, useJobs, useTabInfo, loadHistory, watchRows, t } = props
  const { tab } = useTabInfo()
  const params = tab.navigation.params as TaskPilotTabParams | undefined
  const jobId = params?.jobId ?? null
  const revision = tab.navigation.revision

  // Dual-channel roster: rc.1 serves it through the jobs channel, 0.1.5
  // through the session-list mirror (absent on rc.1).
  const legacyJob = useSessions(
    state => jobId === null ? undefined : (state as LegacySessionListState).jobsBySession?.[sessionId]?.find(j => j.id === jobId),
  )
  const controllerJob = useJobs(
    state => jobId === null ? undefined : state.rows[sessionId]?.find(j => j.id === jobId),
  )
  const job: JobView | undefined = controllerJob ?? legacyJob
  useEffect(() => watchRows(sessionId), [sessionId, watchRows])

  const [entries, setEntries] = useState<readonly TrajectoryEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [beforeSeq, setBeforeSeq] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the newest history page whenever the selection moves; re-navigating
  // the tab (another job picked from the dock) bumps the revision even when
  // the params read the same.
  useEffect(() => {
    if (jobId === null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setEntries([])
    setHasMore(false)
    void loadHistory(sessionId, undefined, PAGE_MESSAGES).then((page) => {
      if (cancelled) return
      setLoading(false)
      if (page === undefined) {
        setError('history unavailable')
        return
      }
      const rows = page.events
      const folded = buildJobTrajectory(rows, jobId)
      setEntries(folded)
      setHasMore(page.hasMore)
      setBeforeSeq(minSeq(rows))
    })
    return () => { cancelled = true }
  }, [sessionId, jobId, revision, loadHistory])

  const loadOlder = async (): Promise<void> => {
    if (jobId === null || beforeSeq === undefined || loading) return
    setLoading(true)
    const page = await loadHistory(sessionId, beforeSeq, PAGE_MESSAGES)
    setLoading(false)
    if (page === undefined) return
    const rows = page.events
    const older = buildJobTrajectory(rows, jobId)
    setEntries(current => [...older, ...current])
    setHasMore(page.hasMore)
    setBeforeSeq(minSeq(rows))
  }

  // The duration clock: a live job's elapsed time is `now - startedAt`, so the
  // tab needs the same once-per-second tick as the dock pill — without it a
  // running job froze at 0s (`finishedAt` is absent until settlement).
  const live = job !== undefined && isLive(job)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [live])

  const durationMs = useMemo(() => {
    if (job === undefined) return undefined
    // Settled jobs report their exact span; live ones follow the clock; a
    // terminal row that never carried `finishedAt` has no computable duration
    // and renders `—` (never a fabricated 0s).
    const end = job.finishedAt ?? (isLive(job) ? now : undefined)
    return end === undefined ? undefined : end - job.startedAt
  }, [job, now])

  return (
    <div className={css.body}>
      {job !== undefined && (
        <section className={css.meta} aria-label={t('drawer.title')}>
          <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.command')}</span><span className={css.metaValue} title={job.label}>{job.label}</span></div>
          <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.kind')}</span><span className={css.metaValue}>{job.kind}</span></div>
          <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.status')}</span><span className={css.metaValue}>{statusText(job.status, t)}</span></div>
          {job.detail !== undefined && job.detail.length > 0 && (
            <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.detail')}</span><span className={css.metaValue}>{job.detail}</span></div>
          )}
          <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.started')}</span><span className={css.metaValue}>{formatDateTime(job.startedAt)}</span></div>
          <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.finished')}</span><span className={css.metaValue}>{job.finishedAt === undefined ? '—' : formatDateTime(job.finishedAt)}</span></div>
          <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.duration')}</span><span className={css.metaValue}>{durationMs === undefined ? '—' : formatDuration(durationMs, t)}</span></div>
        </section>
      )}

      <section className={css.trajectory} aria-label={t('drawer.trajectory.title')}>
        <h3 className={css.trajectoryTitle}>{t('drawer.trajectory.title')}</h3>
        {jobId === null && <div className={css.empty}>{t('drawer.trajectory.empty')}</div>}
        {jobId !== null && loading && entries.length === 0 && <div className={css.empty}>{t('drawer.trajectory.loading')}</div>}
        {jobId !== null && !loading && error !== null && <div className={css.empty}>{error}</div>}
        {jobId !== null && !loading && error === null && entries.length === 0 && (
          <div className={css.empty}>{t('drawer.trajectory.empty')}</div>
        )}
        {entries.length > 0 && (
          <>
            <ul className={css.rows}>
              {entries.map(entry => <TrajectoryRow key={entry.seq} entry={entry} t={t} />)}
            </ul>
            {hasMore && (
              <button
                type="button"
                className={css.older}
                onClick={() => { void loadOlder() }}
                disabled={loading}
              >
                {t('drawer.trajectory.older')}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function minSeq(rows: readonly SessionLogRow[]): number | undefined {
  let min: number | undefined
  for (const row of rows) {
    if (min === undefined || row.seq < min) min = row.seq
  }
  return min
}
