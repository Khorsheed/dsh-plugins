/**
 * TaskPilot job detail drawer: a right-side overlay (root scope) showing one
 * job's metadata from the `jobsBySession` mirror and its execution trail
 * folded from the durable session log. Rows collapse by default; the full
 * tool-result text expands on click. Reads only product-provided data — no
 * new RPC surface, no product change.
 *
 * @module dsh-taskpilot/client/drawer
 */

import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// JobView moved onto the remotes assembly in 0.1.2-alpha.1 (SessionJob,
// re-exported as JobView); HistoryEntry retired with the apiproxy — the
// drawer now reads the generated session remote's history records, unwrapped
// at the seam into the fold's narrow row shape.
import type { JobView, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { buildJobTrajectory, type SessionLogRow } from './job-trajectory.ts'
import { computeDrawerInset } from './drawer-inset.ts'
import type { TrajectoryEntry } from '../types.ts'
import type { createDrawerStore } from './drawer-store.ts'
import type { NS } from './locales.ts'
import css from './JobDrawer.module.css'

/** One history page as the drawer reads it: raw wire rows, oldest first. */
export interface HistoryPage {
  readonly events: readonly SessionLogRow[]
  readonly hasMore: boolean
}

/** Injected data channel; the apply closure wires it to the session remote. */
export interface JobDrawerInjected {
  loadHistory: (
    sessionId: SessionId,
    beforeSeq: number | undefined,
    maxMessages: number,
  ) => Promise<HistoryPage | undefined>
  close: () => void
}

export type JobDrawerProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createDrawerStore>>
  & JobDrawerInjected
  & PropsLocale<typeof NS>

const PAGE_MESSAGES = 200

/** Document mark set while the drawer pushes the conversation column. */
const DRAWER_MARK = 'data-taskpilot-drawer-open'
/** Document-level width variable the push rule reads (0px = overlay). */
const DRAWER_W = '--dsh-taskpilot-drawer-w'

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

export function JobDrawer(props: JobDrawerProps): React.ReactElement | null {
  const { useSessions, useStore, loadHistory, close, t } = props
  const open = useStore(s => s.open)
  const sessionId = useStore(s => s.sessionId)
  const jobId = useStore(s => s.jobId)

  const job: JobView | undefined = useSessions(
    state => sessionId === null ? undefined : state.jobsBySession[sessionId]?.find(j => j.id === jobId),
  )

  const [entries, setEntries] = useState<readonly TrajectoryEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [beforeSeq, setBeforeSeq] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadRev, setReloadRev] = useState(0)

  // Load the newest history page whenever the drawer opens or the selection moves.
  useEffect(() => {
    if (!open || sessionId === null || jobId === null) return
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
  }, [open, sessionId, jobId, loadHistory, reloadRev])

  // Push-layout: while the drawer is open the document carries a mark and the
  // inset the drawer claims, so the conversation column (the chat scroll
  // region and the composer seat inside it) shifts left instead of sitting
  // under the drawer. The inset is responsive — narrow viewports keep the
  // overlay behavior (inset 0) rather than crushing the column.
  useEffect(() => {
    if (!open || sessionId === null || jobId === null) return
    const root = document.documentElement
    const apply = (): void => {
      const inset = computeDrawerInset(window.innerWidth)
      root.style.setProperty(DRAWER_W, `${inset}px`)
      if (inset > 0) root.setAttribute(DRAWER_MARK, '')
      else root.removeAttribute(DRAWER_MARK)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      root.style.removeProperty(DRAWER_W)
      root.removeAttribute(DRAWER_MARK)
    }
  }, [open, sessionId, jobId])

  const loadOlder = async (): Promise<void> => {
    if (sessionId === null || jobId === null || beforeSeq === undefined || loading) return
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

  const durationMs = useMemo(() => {
    if (job === undefined) return 0
    return (job.finishedAt ?? job.startedAt) - job.startedAt
  }, [job])

  if (!open || sessionId === null || jobId === null) return null

  return (
    <div className={css.drawer} role="dialog" aria-label={t('drawer.title')}>
      <header className={css.header}>
        <div className={css.title}>
          {t('drawer.title')}
          {job !== undefined && <span className={css.subtitle}>{job.id} · {job.label}</span>}
        </div>
        <button
          type="button"
          className={css.close}
          onClick={() => { close() }}
          title={t('drawer.close')}
          aria-label={t('drawer.close')}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

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
            <div className={css.metaRow}><span className={css.metaKey}>{t('drawer.meta.duration')}</span><span className={css.metaValue}>{formatDuration(durationMs, t)}</span></div>
          </section>
        )}

        <section className={css.trajectory} aria-label={t('drawer.trajectory.title')}>
          <h3 className={css.trajectoryTitle}>{t('drawer.trajectory.title')}</h3>
          {loading && entries.length === 0 && <div className={css.empty}>{t('drawer.trajectory.loading')}</div>}
          {!loading && error !== null && <div className={css.empty}>{error}</div>}
          {!loading && error === null && entries.length === 0 && (
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
