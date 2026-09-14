/**
 * The cells sub-page (ui-spec §五): the old missions queue, filtered to THIS
 * run — item × condition × rep, bucket, stage, attempt, time in state — with
 * the cell drawer on the right.
 *
 * The drawer is where the three human gestures live: re-run with a reason,
 * ask the release gate, and export the bundle. It also opens the delegation's
 * child session through the host's own session controller, which is how a
 * person reads what the player actually did — a read, not an intervention.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalCellDetail, EvalCellsResult } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import css from './LabView.module.css'

/** mission's own retry vocabulary, restated (eval imports nothing from mission). */
export const RETRY_CATEGORIES: readonly string[] = ['infrastructure', 'operator', 'outcome']

/** The five buckets mission projects into, plus the all-chip. */
const BUCKETS: readonly string[] = ['ready', 'scheduled', 'blocked', 'active', 'done']

/** `47m`, `2h`, `3d` — the duration column's compact form. */
function humanDuration(ms: number | null): string {
  if (ms === null) return '—'
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** One labelled block of the drawer. */
function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className={css.field}>
      <div className={css.fieldLabel}>{props.label}</div>
      <div className={css.fieldValue}>{props.children}</div>
    </div>
  )
}

/** The cell drawer: what this cell is, what it did, and the three gestures. */
function CellDrawer(props: {
  cell: EvalCellDetail | null
  loading: boolean
  error: string | null
  onClose: () => void
  onRetry: (reason: string, category: string) => void
  onRelease: () => void
  onExport: () => void
  onOpenSession: (sessionId: string) => void
  t: LabViewProps['t']
}) {
  const { cell, loading, error, onClose, onRetry, onRelease, onExport, onOpenSession, t } = props
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState<string>(RETRY_CATEGORIES[0] as string)

  return (
    <div className={css.drawer}>
      <div className={css.drawerBar}>
        <span className={css.title}>{cell?.missionId ?? ''}</span>
        <span className={css.barSpacer} />
        <Button size="sm" onClick={onClose}>{t('drawer.close')}</Button>
      </div>
      <div className={css.drawerBody}>
        {loading && cell === null && <div className={css.empty}>{t('drawer.loading')}</div>}
        {error !== null && <div className={css.empty}>{t('drawer.error')}: {error}</div>}
        {cell !== null && (
          <>
            <Field label={t('cells.col.cell')}>
              {cell.task ?? '—'} × {cell.condition ?? '—'} × rep {cell.rep ?? '—'}
              <div className={css.dim}>
                {cell.bucket} · {cell.state} · attempt {cell.attempt} · {humanDuration(cell.inStateMs)}
              </div>
            </Field>
            <Field label={t('drawer.refs')}>
              {cell.refs.resource === null
                ? <span className={css.dim}>{t('drawer.resourceNone')}</span>
                : <span className={css.mono}>{cell.refs.resource}</span>}
              {cell.refs.fingerprint !== null && <div className={css.dim}>{cell.refs.fingerprint}</div>}
            </Field>
            <Field label={t('drawer.materialization')}>
              <span className={css.mono}>{cell.materializationSha ?? '—'}</span>
            </Field>
            <Field label={t('drawer.checkpoints')}>
              {(cell.attempts.find(attempt => attempt.attempt === cell.attempt)?.checkpoints ?? [])
                .map(checkpoint => checkpoint.name).join(' → ') || '—'}
            </Field>
            <Field label={t('drawer.artifacts')}>
              {(cell.attempts.find(attempt => attempt.attempt === cell.attempt)?.artifacts ?? [])
                .map(artifact => `${artifact.path} (${artifact.kind})`).join(', ') || '—'}
            </Field>
            <Field label={t('drawer.annotations')}>
              {cell.annotations.length === 0
                ? '—'
                : cell.annotations.map(ns => (
                  <div key={ns.ns} className={css.annotationLine}>
                    <span className={css.mono}>{ns.ns}</span>
                    <span>{ns.count}</span>
                    <span className={css.dim}>{ns.latest ?? ''}{ns.by === null ? '' : ` · ${ns.by}`}</span>
                  </div>
                ))}
            </Field>
            <Field label={t('drawer.attempts')}>
              {cell.attempts.map(attempt => (
                <div key={attempt.attempt} className={css.dim}>
                  #{attempt.attempt} {attempt.state ?? '—'}
                  {attempt.retry !== null && ` · ${attempt.retry.category ?? ''}: ${attempt.retry.reason ?? ''}`}
                </div>
              ))}
            </Field>
            <Field label={t('drawer.probes')}>
              {cell.probes.length === 0
                ? <span className={css.dim}>{t('drawer.probesNone')}</span>
                : cell.probes.map(run => (
                  <div key={run.at} className={css.probeRun}>
                    <div className={css.dim}>{run.where ?? '—'}</div>
                    {run.probes.map(probe => (
                      <div key={`${probe.probe ?? ''}:${probe.origin ?? ''}`} className={css.annotationLine}>
                        <span className={probe.ok ? css.ok : css.warning}>{probe.outcome ?? '—'}</span>
                        <span className={css.mono}>{probe.probe ?? '—'}</span>
                        <span className={css.dim}>
                          exit {probe.exitCode ?? '—'}
                          {probe.reason === null ? '' : ` · ${probe.reason}`}
                          {probe.error === null ? '' : ` · ${probe.error}`}
                        </span>
                      </div>
                    ))}
                    {/* Verbatim: the exit codes and skip reasons are exactly
                        what this drawer is opened for. */}
                    <pre className={css.pre}>{run.raw}</pre>
                  </div>
                ))}
            </Field>
            <div className={css.drawerActions}>
              <Button
                size="sm"
                disabled={cell.childSessionId === null}
                title={cell.childSessionId === null ? t('drawer.noSession') : undefined}
                onClick={() => { if (cell.childSessionId !== null) onOpenSession(cell.childSessionId) }}
              >
                {t('drawer.openSession')}
              </Button>
              <select
                className={css.select}
                value={category}
                aria-label={t('retry.category')}
                onChange={(event) => { setCategory(event.target.value) }}
              >
                {RETRY_CATEGORIES.map(entry => <option key={entry} value={entry}>{entry}</option>)}
              </select>
              <Input
                value={reason}
                onChange={(event) => { setReason(event.target.value) }}
                placeholder={t('retry.reason')}
                aria-label={t('retry.reason')}
              />
              <Button
                size="sm"
                disabled={reason.trim() === ''}
                onClick={() => { onRetry(reason.trim(), category); setReason('') }}
              >
                {t('action.retry')}
              </Button>
              <Button size="sm" onClick={onRelease}>{t('action.release')}</Button>
              <Button size="sm" variant="outline" onClick={onExport}>{t('action.export')}</Button>
            </div>
            {cell.childSessionId === null && <div className={css.dim}>{t('drawer.noSession')}</div>}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The cells page body: the table, the bucket chips, and the drawer.
 * @param props - the cell list, the open cell, and every gesture's handler.
 */
export function CellsPage(props: {
  cells: EvalCellsResult | null
  loading: boolean
  error: string | null
  bucket: string | null
  onBucket: (bucket: string | null) => void
  selection: string | null
  cell: EvalCellDetail | null
  cellLoading: boolean
  cellError: string | null
  onOpenCell: (missionId: string | null) => void
  onRetry: (reason: string, category: string) => void
  onRelease: () => void
  onExport: () => void
  onOpenSession: (sessionId: string) => void
  t: LabViewProps['t']
}) {
  const { cells, loading, error, bucket, onBucket, selection, t } = props
  const rows = cells?.rows ?? []
  return (
    <div className={css.cellsPage}>
      <div className={css.matrixBar}>
        <button type="button" className={css.chip} aria-pressed={bucket === null} onClick={() => { onBucket(null) }}>
          {t('cells.bucketAll')}
        </button>
        {BUCKETS.map(entry => (
          <button
            key={entry}
            type="button"
            className={css.chip}
            aria-pressed={bucket === entry}
            onClick={() => { onBucket(entry) }}
          >
            {entry}
          </button>
        ))}
        {cells !== null && (
          <span className={css.dim}>{t('cells.matched', { matched: cells.matched, total: cells.total })}</span>
        )}
      </div>
      <div className={css.cellsSplit}>
        <div className={css.cellsTable}>
          {error !== null && <div className={css.empty}>{t('cells.error')}: {error}</div>}
          {cells === null && error === null && <div className={css.empty}>{t('cells.loading')}</div>}
          {cells !== null && rows.length === 0 && <div className={css.empty}>{t('cells.empty')}</div>}
          {rows.length > 0 && (
            <>
              <div className={css.cellsHead}>
                <span className={css.colCell}>{t('cells.col.cell')}</span>
                <span className={css.colBucket}>{t('cells.col.bucket')}</span>
                <span className={css.colStage}>{t('cells.col.stage')}</span>
                <span className={css.colAttempt}>{t('cells.col.attempt')}</span>
                <span className={css.colDuration}>{t('cells.col.duration')}</span>
              </div>
              {rows.map(row => (
                <button
                  key={row.missionId}
                  type="button"
                  className={selection === row.missionId ? `${css.cellsRow} ${css.rowSelected}` : css.cellsRow}
                  onClick={() => { props.onOpenCell(selection === row.missionId ? null : row.missionId) }}
                >
                  <span className={css.colCell}>
                    {row.task ?? '—'} × {row.condition ?? '—'} × {row.rep ?? '—'}
                  </span>
                  <span className={css.colBucket} data-bucket={row.bucket}>{row.bucket}</span>
                  <span className={css.colStage}>{row.state}</span>
                  <span className={css.colAttempt}>{row.attempt}</span>
                  <span className={css.colDuration}>{humanDuration(row.inStateMs)}</span>
                </button>
              ))}
            </>
          )}
          {loading && cells !== null && <div className={css.dim}>{t('cells.loading')}</div>}
        </div>
        {selection !== null && (
          <CellDrawer
            cell={props.cell}
            loading={props.cellLoading}
            error={props.cellError}
            onClose={() => { props.onOpenCell(null) }}
            onRetry={props.onRetry}
            onRelease={props.onRelease}
            onExport={props.onExport}
            onOpenSession={props.onOpenSession}
            t={t}
          />
        )}
      </div>
    </div>
  )
}
