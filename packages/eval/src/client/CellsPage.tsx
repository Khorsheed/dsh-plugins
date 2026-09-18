/**
 * The cells sub-page (ui-spec §五): the old missions queue, filtered to THIS
 * run — item × condition × rep, bucket, stage, attempt, time in state — with
 * the cell drawer on the right.
 *
 * The drawer is where the three human gestures live: re-run with a reason,
 * ask the release gate, and export the bundle. It also opens the delegation's
 * child session through the host's own session controller, which is how a
 * person reads what the player actually did — a read, not an intervention.
 *
 * Every ledger token on this page goes through the word table (ui-spec §九):
 * the bucket chips, the stage column, the attempt list and the retry category
 * picker all showed mission's own English tokens before, which is the half of
 * 「mixed (archived / ws-ready)」 that this page was responsible for. The
 * VERIFY block is the one exception and stays verbatim on purpose — ui-spec §五
 * asks for 「verify 原样输出」, and an exit code nobody translated is the whole
 * reason the drawer is opened.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalCellDetail, EvalCellsResult } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { Chip, Duration, EmptyState, Hash, Word, bucketTone, stageTone } from './parts.tsx'
import { BUCKETS, RETRY_CATEGORIES, bucketPhrase, retryPhrase, stagePhrase } from './vocab.ts'
import css from './LabView.module.css'

export { RETRY_CATEGORIES } from './vocab.ts'

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
        <span className={css.title}>
          {cell === null ? '' : t('drawer.title', { task: cell.task ?? '—', condition: cell.condition ?? '—', rep: cell.rep ?? '—' })}
        </span>
        <span className={css.barSpacer} />
        <Button size="sm" onClick={onClose}>{t('drawer.close')}</Button>
      </div>
      <div className={css.drawerBody}>
        {loading && cell === null && <div className={css.empty}>{t('drawer.loading')}</div>}
        {error !== null && <ErrorState what={t('drawer.error')} message={error} compact t={t} />}
        {cell !== null && (
          <>
            <div className={css.chipRow}>
              <Chip tone={bucketTone(cell.bucket)} title={cell.bucket}>
                <Word phrase={bucketPhrase(cell.bucket)} t={t} />
              </Chip>
              <Chip tone={stageTone(cell.state)} title={cell.state}>
                <Word phrase={stagePhrase(cell.state)} t={t} />
              </Chip>
              <Chip>{t('drawer.attemptNo', { attempt: cell.attempt })}</Chip>
              <Chip><Duration ms={cell.inStateMs} t={t} /></Chip>
            </div>
            <Field label={t('drawer.refs')}>
              {cell.refs.resource === null
                ? <span className={css.dim}>{t('drawer.resourceNone')}</span>
                : <span className={css.mono}>{cell.refs.resource}</span>}
              {cell.refs.fingerprint !== null && (
                <div className={css.dim}>{t('drawer.fingerprint')}: <Hash value={cell.refs.fingerprint} /></div>
              )}
            </Field>
            <Field label={t('drawer.materialization')}>
              <Hash value={cell.materializationSha} />
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
                <div key={attempt.attempt} className={css.annotationLine}>
                  <span className={css.dim}>{t('drawer.attemptNo', { attempt: attempt.attempt })}</span>
                  {attempt.state === null
                    ? <span className={css.dim}>—</span>
                    : (
                      <Chip tone={stageTone(attempt.state)} title={attempt.state}>
                        <Word phrase={stagePhrase(attempt.state)} t={t} />
                      </Chip>
                    )}
                  {attempt.retry !== null && (
                    <span className={css.dim}>
                      {attempt.retry.category === null
                        ? ''
                        : <Word phrase={retryPhrase(attempt.retry.category)} t={t} title={attempt.retry.category} />}
                      {attempt.retry.reason === null ? '' : `: ${attempt.retry.reason}`}
                    </span>
                  )}
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
                        <Chip tone={probe.ok ? 'ok' : 'warn'} title={probe.outcome ?? undefined}>
                          {t(probe.ok ? 'drawer.probeOk' : 'drawer.probeFailed')}
                        </Chip>
                        <span className={css.mono}>{probe.probe ?? '—'}</span>
                        <span className={css.dim}>
                          {probe.outcome ?? '—'}
                          {probe.exitCode === null ? '' : ` · exit ${probe.exitCode}`}
                          {probe.reason === null ? '' : ` · ${probe.reason}`}
                          {probe.error === null ? '' : ` · ${probe.error}`}
                        </span>
                      </div>
                    ))}
                    {/* Verbatim: the exit codes and skip reasons are exactly
                        what this drawer is opened for (ui-spec §五). */}
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
                {RETRY_CATEGORIES.map((entry) => {
                  const phrase = retryPhrase(entry)
                  return (
                    <option key={entry} value={entry}>
                      {phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)}
                    </option>
                  )
                })}
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
  const counts = cells?.buckets ?? {}
  return (
    <div className={css.cellsPage}>
      <div className={css.matrixBar}>
        <button type="button" className={css.chip} aria-pressed={bucket === null} onClick={() => { onBucket(null) }}>
          {t('cells.bucketAll')}
          {cells !== null && <span className={css.chipCount}>{cells.total}</span>}
        </button>
        {BUCKETS.map(entry => (
          <button
            key={entry}
            type="button"
            className={css.chip}
            aria-pressed={bucket === entry}
            title={entry}
            onClick={() => { onBucket(entry) }}
          >
            <Word phrase={bucketPhrase(entry)} t={t} />
            <span className={css.chipCount}>{counts[entry] ?? 0}</span>
          </button>
        ))}
        <span className={css.barSpacer} />
        {cells !== null && (
          <span className={css.dim}>{t('cells.matched', { matched: cells.matched, total: cells.total })}</span>
        )}
      </div>
      <div className={css.cellsSplit}>
        <div className={css.cellsTable}>
          {error !== null && <ErrorState what={t('cells.error')} message={error} t={t} />}
          {cells === null && error === null && <div className={css.empty}>{t('cells.loading')}</div>}
          {cells !== null && rows.length === 0 && (
            <EmptyState title={t('cells.empty')} hint={t('cells.emptyHint')}>
              {bucket !== null && (
                <Button size="sm" onClick={() => { onBucket(null) }}>{t('cells.emptyClear')}</Button>
              )}
            </EmptyState>
          )}
          {rows.length > 0 && (
            <>
              <div className={css.cellsHead}>
                <span className={css.colCell}>{t('cells.col.cell')}</span>
                <span className={css.colState}>{t('cells.col.state')}</span>
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
                  {/* One 运行状态 column (ui-spec §九 术语表 v2). The STAGE is the
                      specific fact and always shows; the bucket only adds
                      something the stage cannot say — «阻塞» (a dependency is
                      unmet) and «排期» (it is waiting for a clock). For every
                      other bucket the stage already implies it, and two chips
                      saying one thing is the noise this pass is removing. */}
                  <span className={css.colState}>
                    <Chip tone={stageTone(row.state)} title={row.state}>
                      <Word phrase={stagePhrase(row.state)} t={t} />
                    </Chip>
                    {(row.bucket === 'blocked' || row.bucket === 'scheduled') && (
                      <Chip tone={bucketTone(row.bucket)} title={row.bucket}>
                        <Word phrase={bucketPhrase(row.bucket)} t={t} />
                      </Chip>
                    )}
                  </span>
                  <span className={css.colAttempt}>{row.attempt}</span>
                  <span className={css.colDuration}><Duration ms={row.inStateMs} t={t} /></span>
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
