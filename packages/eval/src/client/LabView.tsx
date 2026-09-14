/**
 * The lab conversation view (the '实验室 / Experiments' tab beside chat and
 * trajectory): the experiment list, and the shell of one experiment's detail.
 *
 * The list is one row per experiment — drafts and runs in the same table,
 * because to the person planning the next comparison they are the same kind
 * of thing (ui-spec §五): name, dataset snapshot, condition count (+ judges),
 * items, reps, the factors a condition diff derived, status, progress, start
 * time. The detail is the seven-tab shell the spec fixes; this slice fills
 * the OVERVIEW page (snapshot, matrix shape, factors, judge, environment, the
 * readiness records verbatim, and the run.meta digest) and leaves each other
 * tab a placeholder naming the task that owns it — a tab that lies about
 * being empty is worse than one that says who is building it.
 *
 * A DRAFT's overview is rendered from the list row: there is no run to fetch,
 * and the row already carries the plan digest. Only a started experiment
 * spends an RPC.
 *
 * Visual language follows the missions and datasets tabs: compact rows,
 * hairline separators, tokenized colors, official primitives throughout.
 */

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EvalExperimentDetail, EvalExperimentRow, EvalExperimentStatus } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import { LAB_PAGES, type LabPage } from './store.ts'
import { CellsPage } from './CellsPage.tsx'
import { ExportDialog } from './ExportDialog.tsx'
import { MatrixPage } from './MatrixPage.tsx'
import css from './LabView.module.css'

/** The dictionary key of one status word — the union keeps the copy exhaustive. */
function statusKey(status: EvalExperimentStatus): `status.${EvalExperimentStatus}` {
  return `status.${status}`
}

/** `2026-09-13 14:02`, in the reader's own zone; em dash for a draft. */
function stamp(at: number | null): string {
  if (at === null) return '—'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `dataset @ abcdef1`; whichever half is missing simply does not print. */
function snapshotCell(row: EvalExperimentRow): string {
  const { datasetId, commit } = row.snapshot
  if (datasetId === null && commit === null) return '—'
  const short = commit === null ? null : commit.slice(0, 7)
  if (datasetId === null) return short as string
  return short === null ? datasetId : `${datasetId} @ ${short}`
}

/** The factor cell: the differing paths, or why there are none. */
function factorCell(row: EvalExperimentRow, t: LabViewProps['t']): string {
  if (row.conditions.length < 2) return t('factors.single')
  return row.factors.length === 0 ? t('factors.none') : row.factors.join(', ')
}

/** One labelled block of the overview. */
function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className={css.field}>
      <div className={css.fieldLabel}>{props.label}</div>
      <div className={css.fieldValue}>{props.children}</div>
    </div>
  )
}

/** name → count, rendered as a single compact line (`ready 2 · done 10`). */
function histogram(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  return entries.length === 0 ? '—' : entries.map(([name, count]) => `${name} ${count}`).join(' · ')
}

/**
 * The overview page. Everything it shows about the PLAN comes from the list
 * row (a draft has nothing else); everything about the RUN comes from the
 * detail payload, which a draft simply does not have.
 */
function Overview(props: { row: EvalExperimentRow; detail: EvalExperimentDetail | null; t: LabViewProps['t'] }) {
  const { row, detail, t } = props
  // A STARTED experiment knows how many cells it really has; the product is
  // only the shape a plan implies, and a subset run (`--only` / `--max-cells`)
  // legitimately has fewer. Prefer the fact over the arithmetic.
  const cells = row.progress?.total ?? row.items * row.conditions.length * row.reps
  const meta = detail?.meta ?? null
  const judgeSamples = meta?.judge.samples ?? null
  return (
    <div className={css.overview}>
      {detail === null && row.runId === null && (
        <div className={css.notice}>{t('overview.draftNotice')}</div>
      )}
      <Field label={t('overview.snapshot')}>
        <span className={css.mono}>{snapshotCell(row)}</span>
        {row.snapshot.repo !== null && <span className={css.dim}> · {row.snapshot.repo}</span>}
      </Field>
      <Field label={t('overview.shape')}>
        {t('overview.shapeValue', { items: row.items, conditions: row.conditions.length, reps: row.reps, cells })}
        <div className={css.dim}>{row.conditions.join(', ') || '—'}</div>
      </Field>
      <Field label={t('overview.factors')}>{factorCell(row, t)}</Field>
      <Field label={t('overview.judge')}>
        {row.judges.length === 0
          ? t('overview.judgeNone')
          : `${row.judges.join(', ')}${judgeSamples === null ? '' : ` · ${t('overview.judgeSamples', { samples: judgeSamples })}`}`}
      </Field>
      <Field label={t('overview.environment')}>
        {row.unit === null
          ? t('overview.environmentHost')
          : (
            <span className={css.mono}>
              {row.unit.image}
              {row.unit.network !== null && ` · network ${row.unit.network}`}
              {row.unit.user !== null && ` · user ${row.unit.user}`}
            </span>
          )}
      </Field>
      {row.validation !== null && (
        <Field label={t('overview.validation')}>
          {row.validation.ok
            ? t('overview.validationOk')
            : t('overview.validationFailed', { errors: row.validation.errors, warnings: row.validation.warnings })}
        </Field>
      )}
      {detail !== null && (
        <>
          <Field label={t('overview.buckets')}>{histogram(detail.buckets)}</Field>
          <Field label={t('overview.states')}>{histogram(detail.states)}</Field>
          {detail.unreleased.length > 0 && (
            <Field label={t('overview.unreleased')}>
              <span className={css.warning}>{detail.unreleased.join(', ')}</span>
            </Field>
          )}
          {detail.job !== null && (
            <Field label={t('overview.job')}>
              <span className={css.mono}>{detail.job.jobId} · {detail.job.status}</span>
              {detail.job.detail !== null && <div className={css.dim}>{detail.job.detail}</div>}
            </Field>
          )}
          <Field label={t('overview.readiness')}>
            {detail.readiness.length === 0
              ? t('overview.readinessNone')
              : (
                <div className={css.readiness}>
                  {detail.readiness.map(line => (
                    <div key={`${line.condition}:${line.role}:${line.startedAt}`} className={css.readinessLine}>
                      <span className={line.ok ? css.ok : css.warning}>{line.ok ? t('ready.ok') : t('ready.failed')}</span>
                      <span className={css.mono}>{line.condition}</span>
                      <span className={css.dim}>{line.role} · {line.harness} · {line.provider}</span>
                      {line.reason !== null && <span className={css.warning}>{line.reason}</span>}
                    </div>
                  ))}
                  <pre className={css.pre}>{JSON.stringify(detail.readiness, null, 2)}</pre>
                </div>
              )}
          </Field>
          {meta !== null && (
            <Field label={t('overview.meta')}>
              <pre className={css.pre}>{JSON.stringify(meta, null, 2)}</pre>
            </Field>
          )}
        </>
      )}
    </div>
  )
}

/** The sub-pages this slice still does not build, and who owns each. */
const PAGE_PLACEHOLDER: Readonly<Record<'plan' | 'conditions' | 'report' | 'judging', EvalKey>> = {
  plan: 'placeholder.plan',
  conditions: 'placeholder.conditions',
  report: 'placeholder.report',
  judging: 'placeholder.judging',
}

/** Whether a sub-page is one of the four still waiting on its task. */
function isPlaceholderPage(page: LabPage): page is 'plan' | 'conditions' | 'report' | 'judging' {
  return page === 'plan' || page === 'conditions' || page === 'report' || page === 'judging'
}

/**
 * The lab tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function LabView(props: LabViewProps) {
  const {
    sessionId, useStore, actions, t,
    fetchExperiments, fetchExperiment, fetchMatrix, fetchCells, fetchCell,
    retryCell, releaseCheck, planExport, exportRun, openSession,
  } = props
  const list = useStore(s => s.list)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const refreshRev = useStore(s => s.refreshRev)
  const selection = useStore(s => s.selection)
  const page = useStore(s => s.page)
  const detail = useStore(s => s.detail)
  const detailLoading = useStore(s => s.detailLoading)
  const detailError = useStore(s => s.detailError)
  const matrixColumn = useStore(s => s.matrixColumn)
  const matrixGroupBy = useStore(s => s.matrixGroupBy)
  const matrixFilter = useStore(s => s.matrixFilter)
  const matrix = useStore(s => s.matrix)
  const matrixLoading = useStore(s => s.matrixLoading)
  const matrixError = useStore(s => s.matrixError)
  const cellsBucket = useStore(s => s.cellsBucket)
  const cells = useStore(s => s.cells)
  const cellsLoading = useStore(s => s.cellsLoading)
  const cellsError = useStore(s => s.cellsError)
  const cellSelection = useStore(s => s.cellSelection)
  const cell = useStore(s => s.cell)
  const cellLoading = useStore(s => s.cellLoading)
  const cellError = useStore(s => s.cellError)
  const exportOpen = useStore(s => s.exportOpen)
  const notice = useStore(s => s.notice)
  const [newNotice, setNewNotice] = useState(false)

  // Fetch the list on mount and whenever refreshRev moves.
  useEffect(() => {
    let cancelled = false
    actions.setLoading(true)
    void fetchExperiments(sessionId, {}).then((result) => {
      if (cancelled) return
      actions.setLoading(false)
      if (result.ok) actions.setList(result.value)
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, refreshRev, actions, fetchExperiments])

  const rows = list?.rows ?? []
  const openRow = selection === null ? undefined : rows.find(row => row.id === selection)
  const openRunId = openRow?.runId ?? null

  // Fetch the open experiment's detail. A DRAFT has no run: its overview is
  // the row, and spending an RPC on it would only produce a refusal.
  useEffect(() => {
    if (openRunId === null) return
    let cancelled = false
    actions.setDetailLoading(true)
    void fetchExperiment(sessionId, { runId: openRunId }).then((result) => {
      if (cancelled) return
      actions.setDetailLoading(false)
      if (result.ok) actions.setDetail(result.value)
      else actions.setDetailError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, refreshRev, actions, fetchExperiment])

  // The matrix, re-arranged whenever the reader moves a factor. The
  // arrangement is the host's — the browser only says what it wants.
  const matrixGroupKey = matrixGroupBy.join(',')
  const matrixFilterKey = JSON.stringify(matrixFilter)
  useEffect(() => {
    if (openRunId === null || page !== 'matrix') return
    let cancelled = false
    actions.setMatrixLoading(true)
    void fetchMatrix(sessionId, {
      runId: openRunId,
      ...(matrixColumn === null ? {} : { column: matrixColumn }),
      ...(matrixGroupBy.length === 0 ? {} : { groupBy: [...matrixGroupBy] }),
      ...(Object.keys(matrixFilter).length === 0 ? {} : { filter: { ...matrixFilter } }),
    }).then((result) => {
      if (cancelled) return
      actions.setMatrixLoading(false)
      if (result.ok) actions.setMatrix(result.value)
      else actions.setMatrixError(result.error.message)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the two key strings stand in for the arrays they serialize
  }, [sessionId, openRunId, page, refreshRev, matrixColumn, matrixGroupKey, matrixFilterKey, actions, fetchMatrix])

  // The cell list.
  useEffect(() => {
    if (openRunId === null || page !== 'cells') return
    let cancelled = false
    actions.setCellsLoading(true)
    void fetchCells(sessionId, {
      runId: openRunId,
      ...(cellsBucket === null ? {} : { bucket: cellsBucket }),
    }).then((result) => {
      if (cancelled) return
      actions.setCellsLoading(false)
      if (result.ok) actions.setCells(result.value)
      else actions.setCellsError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, page, refreshRev, cellsBucket, actions, fetchCells])

  // The open cell's drawer.
  useEffect(() => {
    if (openRunId === null || cellSelection === null) return
    let cancelled = false
    const missionId = cellSelection
    actions.setCellLoading(true)
    void fetchCell(sessionId, { runId: openRunId, missionId }).then((result) => {
      if (cancelled) return
      actions.setCellLoading(false)
      if (result.ok) actions.setCell(result.value)
      else actions.setCellError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, cellSelection, refreshRev, actions, fetchCell])

  // ── the drawer's three human gestures ──────────────────────────────────
  const onRetry = (reason: string, category: string): void => {
    if (openRunId === null || cellSelection === null) return
    const missionId = cellSelection
    void retryCell(sessionId, { runId: openRunId, missionId, reason, category }).then((result) => {
      if (result.ok) {
        actions.setNotice(t('notice.retried', { id: missionId, attempt: result.value.attempt }))
        actions.refresh()
      } else {
        actions.setNotice(result.error.message)
      }
    })
  }

  const onRelease = (): void => {
    if (openRunId === null || cellSelection === null) return
    const missionId = cellSelection
    void releaseCheck(sessionId, { runId: openRunId, missionId }).then((result) => {
      actions.setNotice(result.ok
        ? t(result.value.releasable ? 'notice.releasable' : 'notice.notReleasable', { id: missionId })
        : result.error.message)
    })
  }

  return (
    <div className={css.view} data-conversation-composer-overlay="">
      <div className={css.bar}>
        {openRow === undefined
          ? <span className={css.title}>{t('list.title')}</span>
          : (
            <>
              <Button size="sm" onClick={() => { actions.open(null) }}>{t('detail.back')}</Button>
              <span className={css.title}>{openRow.name}</span>
              <span className={css.statusPill} data-status={openRow.status}>{t(statusKey(openRow.status))}</span>
            </>
          )}
        <span className={css.barSpacer} />
        <Button size="sm" onClick={() => { actions.refresh() }}>{t('list.refresh')}</Button>
        {openRow === undefined && (
          <Button size="sm" variant="primary" onClick={() => { setNewNotice(true) }}>{t('list.new')}</Button>
        )}
      </div>
      {newNotice && openRow === undefined && (
        <div className={css.notice}>{t('placeholder.new')}</div>
      )}
      {notice !== null && openRow !== undefined && <div className={css.notice}>{notice}</div>}
      {openRow === undefined
        ? (
          <div className={css.body}>
            {loading && list === null && <div className={css.empty}>{t('list.loading')}</div>}
            {!loading && error !== null && list === null && (
              <div className={css.empty}>{t('list.error')}: {error}</div>
            )}
            {(list?.notes ?? []).map(note => <div key={note} className={css.note}>{note}</div>)}
            {list !== null && rows.length === 0 && <div className={css.empty}>{t('list.empty')}</div>}
            {rows.length > 0 && (
              <>
                <div className={css.tableHead}>
                  <span className={css.colName}>{t('col.name')}</span>
                  <span className={css.colSnapshot}>{t('col.snapshot')}</span>
                  <span className={css.colNum}>{t('col.conditions')}</span>
                  <span className={css.colNum}>{t('col.items')}</span>
                  <span className={css.colNum}>{t('col.reps')}</span>
                  <span className={css.colFactors}>{t('col.factors')}</span>
                  <span className={css.colStatus}>{t('col.status')}</span>
                  <span className={css.colProgress}>{t('col.progress')}</span>
                  <span className={css.colStarted}>{t('col.startedAt')}</span>
                </div>
                {rows.map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className={css.row}
                    onClick={() => { actions.open(row.id) }}
                  >
                    <span className={css.colName} title={row.planPath ?? row.name}>{row.name}</span>
                    <span className={css.colSnapshot}>{snapshotCell(row)}</span>
                    <span className={css.colNum}>
                      {row.judges.length === 0
                        ? t('conditions.count', { count: row.conditions.length })
                        : t('conditions.withJudges', { count: row.conditions.length, judges: row.judges.length })}
                    </span>
                    <span className={css.colNum}>{row.items}</span>
                    <span className={css.colNum}>{row.reps}</span>
                    <span className={css.colFactors} title={row.factors.join(', ')}>{factorCell(row, t)}</span>
                    <span className={css.colStatus} data-status={row.status}>{t(statusKey(row.status))}</span>
                    <span className={css.colProgress}>
                      {row.progress === null ? '—' : `${row.progress.done}/${row.progress.total}`}
                    </span>
                    <span className={css.colStarted}>{stamp(row.startedAt)}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )
        : (
          <>
            <div className={css.pages}>
              {LAB_PAGES.map(entry => (
                <button
                  key={entry}
                  type="button"
                  className={css.pageTab}
                  aria-pressed={page === entry}
                  onClick={() => { actions.setPage(entry) }}
                >
                  {t(`page.${entry}`)}
                </button>
              ))}
            </div>
            <div className={css.body}>
              {page === 'overview' && (
                <>
                  {detailLoading && detail === null && <div className={css.empty}>{t('detail.loading')}</div>}
                  {detailError !== null && (
                    <div className={css.empty}>{t('detail.error')}: {detailError}</div>
                  )}
                  <Overview row={openRow} detail={detail} t={t} />
                </>
              )}
              {page === 'matrix' && (
                openRunId === null
                  ? <div className={css.empty}>{t('overview.draftNotice')}</div>
                  : (
                    <MatrixPage
                      matrix={matrix}
                      loading={matrixLoading}
                      error={matrixError}
                      onColumn={(factor) => { actions.setMatrixColumn(factor) }}
                      onToggleGroup={(factor) => { actions.toggleMatrixGroup(factor) }}
                      onFilter={(factor, value) => { actions.setMatrixFilter(factor, value) }}
                      onOpenCell={(missionId) => { actions.setPage('cells'); actions.openCell(missionId) }}
                      t={t}
                    />
                  )
              )}
              {page === 'cells' && (
                openRunId === null
                  ? <div className={css.empty}>{t('overview.draftNotice')}</div>
                  : (
                    <CellsPage
                      cells={cells}
                      loading={cellsLoading}
                      error={cellsError}
                      bucket={cellsBucket}
                      onBucket={(bucket) => { actions.setCellsBucket(bucket) }}
                      selection={cellSelection}
                      cell={cell}
                      cellLoading={cellLoading}
                      cellError={cellError}
                      onOpenCell={(missionId) => { actions.openCell(missionId) }}
                      onRetry={onRetry}
                      onRelease={onRelease}
                      onExport={() => { actions.setExportOpen(true) }}
                      onOpenSession={(childId) => { openSession(childId as SessionId) }}
                      t={t}
                    />
                  )
              )}
              {isPlaceholderPage(page) && <div className={css.empty}>{t(PAGE_PLACEHOLDER[page])}</div>}
            </div>
            <ExportDialog
              runId={openRunId ?? ''}
              open={exportOpen && openRunId !== null}
              onClose={() => { actions.setExportOpen(false) }}
              onDone={(text) => { actions.setNotice(text) }}
              planExport={planExport}
              exportRun={exportRun}
              sessionId={sessionId}
              t={t}
            />
          </>
        )}
    </div>
  )
}
