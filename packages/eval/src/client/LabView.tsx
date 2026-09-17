/**
 * The lab conversation view (the '实验室 / Experiments' tab beside chat and
 * trajectory): the experiment list, and one experiment's detail.
 *
 * The list is one row per experiment — drafts and runs in the same table,
 * because to the person planning the next comparison they are the same kind
 * of thing (ui-spec §五): name, dataset snapshot, condition count (+ judges),
 * items, reps, the factors a condition diff derived, status, progress, start
 * time. Its one action is 新建实验, which opens the draft form (I5·T34) — the
 * same service verb `eval_plan_draft` reaches, so a plan a person fills in and
 * a plan an agent drafts in one sentence arrive in this list as the same row.
 * The detail is the seven-tab shell the spec fixes, and all seven are built:
 * OVERVIEW (snapshot, matrix shape, factors, judge, environment, the readiness
 * records verbatim, the run.meta digest), PLAN REVIEW (validate line by line
 * and the two human buttons), CONDITIONS (the registry and the two-condition
 * diff), MATRIX, CELLS, REPORT and the JUDGE BENCH.
 *
 * The report page (T38) is fetched the same lazy way, and for a stronger
 * reason: it reads a mission export BUNDLE off disk and analyzes it, which is
 * the most expensive read in the tab and means nothing until the run has been
 * exported at all.
 *
 * A DRAFT's overview is rendered from the list row: there is no run to fetch,
 * and the row already carries the plan digest. Only a started experiment
 * spends an RPC. The plan review and the conditions registry are fetched
 * LAZILY, when their tab is opened: a validate walks the dataset tree, and
 * spending one on every visit to the overview would make the cheap page pay
 * for the expensive one.
 *
 * Visual language follows the missions and datasets tabs: compact rows,
 * hairline separators, tokenized colors, official primitives throughout.
 */

import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EvalDraftResult, EvalExperimentDetail, EvalExperimentRow } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ConditionsPage } from './ConditionsPage.tsx'
import {
  Chip, Detail, EmptyState, FactorCell, Field, StartedRun,
  bucketTone, repoName, snapshotCell, stageTone, stamp, statusKey, statusTone, Word,
} from './parts.tsx'
import { PlanReviewPage } from './PlanReviewPage.tsx'
import { LAB_PAGES } from './store.ts'
import { CellsPage } from './CellsPage.tsx'
import { ErrorState } from './ErrorState.tsx'
import { ExportDialog } from './ExportDialog.tsx'
import { JudgingPage } from './JudgingPage.tsx'
import { MatrixPage } from './MatrixPage.tsx'
import { NewExperimentDialog } from './NewExperimentDialog.tsx'
import { ReportPage } from './ReportPage.tsx'
import { bucketPhrase, preferredColumn, stagePhrase } from './vocab.ts'
import css from './LabView.module.css'

/**
 * A `token → count` histogram as chips in the word table's own vocabulary.
 *
 * The tokens are mission's (`ws-ready`, `done`) and the page is not allowed to
 * print them (ui-spec §九), so each one becomes a chip carrying its word, its
 * count and — on hover — the token a person greps the ledger with.
 * @param props - the counts, which table to read them through, and the locale seat.
 */
function Histogram(props: {
  counts: Record<string, number>
  kind: 'bucket' | 'stage'
  t: LabViewProps['t']
}) {
  const { counts, kind, t } = props
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (entries.length === 0) return <span className={css.dim}>—</span>
  return (
    <span className={css.chipRow}>
      {entries.map(([token, count]) => (
        <Chip key={token} tone={kind === 'bucket' ? bucketTone(token) : stageTone(token)} title={token}>
          <Word phrase={kind === 'bucket' ? bucketPhrase(token) : stagePhrase(token)} t={t} />
          <span className={css.chipCount}>{count}</span>
        </Chip>
      ))}
    </span>
  )
}

/**
 * The overview page. Everything it shows about the PLAN comes from the list
 * row (a draft has nothing else); everything about the RUN comes from the
 * detail payload, which a draft simply does not have — until an approval in
 * this visit starts one, and then the job's ids and its log are all there is
 * until the mission ledger catches up.
 */
function Overview(props: {
  row: EvalExperimentRow
  detail: EvalExperimentDetail | null
  started: Parameters<typeof StartedRun>[0]['started'] | null
  output: Parameters<typeof StartedRun>[0]['output']
  outputError: string | null
  t: LabViewProps['t']
}) {
  const { row, detail, started, output, outputError, t } = props
  // A STARTED experiment knows how many cells it really has; the product is
  // only the shape a plan implies, and a subset run (`--only` / `--max-cells`)
  // legitimately has fewer. Prefer the fact over the arithmetic.
  const cells = row.progress?.total ?? row.items * row.conditions.length * row.reps
  const meta = detail?.meta ?? null
  const judgeSamples = meta?.judge.samples ?? null
  return (
    <div className={css.overview}>
      {detail === null && row.runId === null && started === null && (
        <div className={css.notice}>{t('overview.draftNotice')}</div>
      )}
      <Field label={t('overview.snapshot')}>
        <span className={css.mono}>{snapshotCell(row)}</span>
        {row.snapshot.repo !== null && (
          <span className={css.dim} title={row.snapshot.repo}> · {repoName(row.snapshot.repo)}</span>
        )}
      </Field>
      <Field label={t('overview.shape')}>
        {t('overview.shapeValue', { items: row.items, conditions: row.conditions.length, reps: row.reps, cells })}
        <div className={css.dim}>{row.conditions.join(', ') || '—'}</div>
      </Field>
      <Field label={t('overview.factors')}><FactorCell row={row} t={t} /></Field>
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
      {started !== null && <StartedRun started={started} output={output} outputError={outputError} t={t} />}
      {detail !== null && (
        <>
          <Field label={t('overview.buckets')}><Histogram counts={detail.buckets} kind="bucket" t={t} /></Field>
          <Field label={t('overview.states')}><Histogram counts={detail.states} kind="stage" t={t} /></Field>
          {detail.unreleased.length > 0 && (
            <Field label={t('overview.unreleased')}>
              <span className={css.warning}>{detail.unreleased.join(', ')}</span>
            </Field>
          )}
          {detail.job !== null && (
            <Field label={t('overview.job')}>
              <span className={css.mono}>{detail.job.jobId}</span>
              <span className={css.dim}> · {detail.job.status}</span>
              {/* The job's own line is the host's sentence about a background
                  process — English, and sometimes a path. It is evidence, so
                  it is kept; §九 keeps it folded rather than on the page. */}
              {detail.job.detail !== null && (
                <Detail summary={t('error.details')}>
                  <pre className={css.errorRaw}>{detail.job.detail}</pre>
                </Detail>
              )}
            </Field>
          )}
          <Field label={t('overview.readiness')}>
            {detail.readiness.length === 0
              ? t('overview.readinessNone')
              : (
                <div className={css.readiness}>
                  {detail.readiness.map(line => (
                    <div key={`${line.condition}:${line.role}:${line.startedAt}`} className={css.readinessLine}>
                      <Chip tone={line.ok ? 'ok' : 'danger'}>{line.ok ? t('ready.ok') : t('ready.failed')}</Chip>
                      <span className={css.mono}>{line.condition}</span>
                      <span className={css.dim}>
                        {t(line.role === 'judge' ? 'role.judge' : 'role.player')} · {line.harness} · {line.provider}
                      </span>
                    </div>
                  ))}
                  {/* The refusal sentence and the records verbatim: written by
                      the host for whoever debugs it, and the only place a
                      refused run's reason exists (the ledger never saw it). §九
                      keeps both under «详情» rather than on the page. */}
                  <Detail summary={t('overview.readinessRaw')}>
                    {detail.readiness.filter(line => line.reason !== null).map(line => (
                      <div key={`why:${line.condition}:${line.startedAt}`} className={css.errorDetailLine}>
                        {line.condition}: {line.reason}
                      </div>
                    ))}
                    <pre className={css.errorRaw}>{JSON.stringify(detail.readiness, null, 2)}</pre>
                  </Detail>
                </div>
              )}
          </Field>
          {meta !== null && (
            <Field label={t('overview.meta')}>
              {/* A JSON document is not a page (ui-spec §九). The facts a
                  reader needs are the fields above; this is the receipt. */}
              <Detail summary={t('overview.metaRaw')}>
                <pre className={css.errorRaw}>{JSON.stringify(meta, null, 2)}</pre>
              </Detail>
            </Field>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The lab tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function LabView(props: LabViewProps) {
  const {
    sessionId, useStore, actions, t,
    fetchExperiments, fetchExperiment, fetchPlanReview, fetchConditions, fetchConditionDiff, approvePlan, fetchRunOutput,
    provisionCondition, setConditionEndpoint,
    fetchDraftOptions, draftExperiment,
    fetchMatrix, fetchCells, fetchCell, retryCell, releaseCheck, planExport, exportRun, openSession,
    fetchReport, finalizeRun, fetchRunUnits, fetchJudgeQueue, submitHumanFinal,
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
  const review = useStore(s => s.review)
  const reviewLoading = useStore(s => s.reviewLoading)
  const reviewError = useStore(s => s.reviewError)
  const sentBack = useStore(s => s.sentBack)
  const approving = useStore(s => s.approving)
  const approveRefusal = useStore(s => s.approveRefusal)
  const approveError = useStore(s => s.approveError)
  const started = useStore(s => s.started)
  const output = useStore(s => s.output)
  const outputError = useStore(s => s.outputError)
  const conditions = useStore(s => s.conditions)
  const conditionsLoading = useStore(s => s.conditionsLoading)
  const conditionsError = useStore(s => s.conditionsError)
  const conditionBusy = useStore(s => s.conditionBusy)
  const provision = useStore(s => s.provision)
  const conditionAction = useStore(s => s.conditionAction)
  const endpointEditing = useStore(s => s.endpointEditing)
  const diffPair = useStore(s => s.diffPair)
  const diff = useStore(s => s.diff)
  const diffError = useStore(s => s.diffError)
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
  const report = useStore(s => s.report)
  const reportLoading = useStore(s => s.reportLoading)
  const reportError = useStore(s => s.reportError)
  const finalizing = useStore(s => s.finalizing)
  const finalizeResult = useStore(s => s.finalizeResult)
  const runUnits = useStore(s => s.runUnits)
  const runUnitsError = useStore(s => s.runUnitsError)
  const lookIn = useStore(s => s.lookIn)
  const judge = useStore(s => s.judge)
  const judgeLoading = useStore(s => s.judgeLoading)
  const judgeError = useStore(s => s.judgeError)
  const judgeTicket = useStore(s => s.judgeTicket)
  const judgeDraft = useStore(s => s.judgeDraft)
  const judgeSubmitting = useStore(s => s.judgeSubmitting)
  const exportOpen = useStore(s => s.exportOpen)
  const notice = useStore(s => s.notice)
  const noticeError = useStore(s => s.noticeError)
  // A draft made in THIS visit, held until its row shows up in the refreshed
  // list. The row does not exist client-side the moment the file lands, so
  // opening it by id immediately would drop the reader back to the list; the
  // effect below opens it when the list catches up, and the same sentence is
  // shown over the list meanwhile.
  const [newOpen, setNewOpen] = useState(false)
  const [drafted, setDrafted] = useState<EvalDraftResult | null>(null)

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
  // The row id changes under the selection exactly once: a plan approved in
  // this visit is `plan:<path>` until the orchestrator calls `runCreate`, and
  // its run id afterwards. Re-finding it by the plan that was approved keeps
  // the detail open across that switch instead of dropping the reviewer back
  // to the list mid-run.
  const openRow = selection === null
    ? undefined
    : rows.find(row => row.id === selection)
      ?? (started === null ? undefined : rows.find(row => row.planPath === started.planPath))
  const openRunId = openRow?.runId ?? null
  const planPath = openRow?.planPath ?? null

  // What the draft's own sentence says: the paths, and whether validate found
  // anything. A draft with errors is still a draft — it is on disk and in the
  // list — so the notice reports rather than apologizes.
  // The experiment's own name is the plan's file stem — the drafting verb
  // answers with the path, and the row that carries the name does not exist
  // client-side yet when this sentence is composed.
  const draftName = drafted === null
    ? ''
    : (drafted.planPath.split('/').pop() ?? drafted.planPath).replace(/\.json$/, '')
  // The plan's PATH is not in the sentence (ui-spec §九): the name is what a
  // person calls the experiment, and the path is on the plan-review page under
  // «详情», beside the file it names.
  const draftNotice = drafted === null
    ? null
    : (drafted.review.errors === 0
      ? t('notice.drafted', { name: draftName })
      : t('notice.draftedWithErrors', { name: draftName, errors: drafted.review.errors }))

  // Keyed on `list`, NOT on `rows`: `rows` is a fresh array on every render
  // (`list?.rows ?? []`), which would re-run this on every render for nothing.
  // The effect does write `drafted`, but it writes it to null and then early
  // returns — it cancels no request, so this is not the self-cancelling shape
  // T47 hit.
  useEffect(() => {
    if (drafted === null) return
    const row = (list?.rows ?? []).find(entry => entry.planPath === drafted.planPath)
    if (row === undefined) return
    actions.open(row.id)
    // `open` lands on the overview and clears the per-experiment notice, so
    // the page and the sentence are set after it, never before.
    actions.setPage('plan')
    if (draftNotice !== null) actions.setNotice(draftNotice)
    setDrafted(null)
  }, [list, drafted, draftNotice, actions])

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

  // The plan review, fetched when its tab is open: validate walks the dataset
  // tree, so it is paid for by the page that asked for it.
  useEffect(() => {
    if (page !== 'plan' || planPath === null) return
    let cancelled = false
    actions.setReviewLoading(true)
    void fetchPlanReview(sessionId, { planPath }).then((result) => {
      if (cancelled) return
      actions.setReviewLoading(false)
      if (result.ok) actions.setReview(result.value)
      else actions.setReviewError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, page, planPath, refreshRev, actions, fetchPlanReview])

  // The condition registry, likewise — it is the REPOSITORY's, so it is not
  // re-read when the open experiment changes, only when its tab is opened.
  useEffect(() => {
    if (page !== 'conditions') return
    let cancelled = false
    actions.setConditionsLoading(true)
    void fetchConditions(sessionId, {}).then((result) => {
      if (cancelled) return
      actions.setConditionsLoading(false)
      if (result.ok) actions.setConditions(result.value)
      else actions.setConditionsError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, page, refreshRev, actions, fetchConditions])

  // Two picked conditions are a diff; one or none is not.
  const [pairA, pairB] = diffPair
  useEffect(() => {
    if (pairA === undefined || pairB === undefined) return
    let cancelled = false
    void fetchConditionDiff(sessionId, { a: pairA, b: pairB }).then((result) => {
      if (cancelled) return
      if (result.ok) actions.setDiff(result.value)
      else actions.setDiffError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, pairA, pairB, refreshRev, actions, fetchConditionDiff])

  // The started job's log. The ONLY place a readiness refusal is written: the
  // run never reaches `runCreate`, so no ledger row for it ever exists.
  const startedJobId = started?.jobId ?? null
  useEffect(() => {
    if (startedJobId === null) return
    let cancelled = false
    // `.catch` and not only the result envelope: the gateway's client proxy
    // rejects on its own (a namespace it never mounted, an arity it refuses)
    // before any envelope exists, and an unhandled rejection here would leave
    // the block saying "no line yet" forever with the reason only in the
    // browser console.
    void fetchRunOutput(startedJobId).then((result) => {
      if (cancelled) return
      if (result.ok) actions.setOutput(result.value)
      else actions.setOutputError(result.error.message)
    }, (error: unknown) => {
      if (!cancelled) actions.setOutputError(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [startedJobId, refreshRev, actions, fetchRunOutput])

  /**
   * PROVISION one condition — ui-spec step 4, and a human's click.
   *
   * The whole action: the same call resolves the scoped home, checks the
   * declaration against it field by field, corrects `home.sha`, re-hashes the
   * condition and writes the lock. What comes back carries the row as it now
   * reads, so the table updates from the answer rather than from a second read
   * of the same directory.
   * @param row - the condition to provision.
   */
  function provisionRow(row: { id: string; dataset: string }): void {
    actions.setConditionBusy(row.id)
    actions.setProvision(null)
    void provisionCondition(sessionId, { dataset: row.dataset, condition: row.id }).then((result) => {
      actions.setConditionBusy(null)
      if (!result.ok) {
        actions.setConditionAction({ kind: 'failure', what: t('conditions.provisionFailed'), message: result.error.message })
        return
      }
      actions.setProvision(result.value)
      if (result.value.row !== null) actions.applyConditionRow(result.value.row)
    })
  }

  /**
   * Set one condition's declared `model.endpoint`.
   *
   * A factor edit, so the answer may say the lock beside it is now stale. The
   * notice says so and provisioning again is the next click — deliberately not
   * something this does on the person's behalf.
   * @param row - the condition being edited.
   * @param endpoint - the value typed (empty declares "not resolved yet").
   */
  function setEndpoint(row: { id: string; dataset: string }, endpoint: string): void {
    actions.setConditionBusy(row.id)
    void setConditionEndpoint(sessionId, { dataset: row.dataset, condition: row.id, endpoint }).then((result) => {
      actions.setConditionBusy(null)
      if (!result.ok) {
        actions.setConditionAction({ kind: 'failure', what: t('conditions.endpointFailed'), message: result.error.message })
        return
      }
      const value = result.value
      actions.editEndpoint(null)
      const said = value.written
        ? t('conditions.endpointWritten', { id: value.condition, value: value.after ?? t('conditions.endpointUnset') })
        : t('conditions.endpointUnchanged', { id: value.condition, value: value.after ?? t('conditions.endpointUnset') })
      actions.setConditionAction({
        kind: 'receipt',
        text: value.lockStale ? `${said} ${t('conditions.endpointLockStale')}` : said,
      })
      if (value.row !== null) actions.applyConditionRow(value.row)
    })
  }

  /**
   * Approve and start the open plan — the human act of ui-spec step 5.
   * @param keepUnits - the dialog's 保留单元 box: stop every cell at
   *   `archived` and keep its container. Off is the default, and the run then
   *   walks the release gate cell by cell.
   */
  function approve(keepUnits: boolean): void {
    if (planPath === null) return
    actions.setApproving(true)
    void approvePlan(sessionId, { planPath, ...(keepUnits ? { keepUnits: true } : {}) }).then((result) => {
      actions.setApproving(false)
      if (!result.ok) {
        actions.setApproveError(result.error.message)
        return
      }
      const value = result.value
      if (!value.started || value.jobId === null || value.runId === null) {
        actions.setApproveRefusal(value.refusal ?? '')
        // Re-read the plan: a refusal means validate said something, and the
        // check list on screen must be the one the refusal came from.
        actions.refresh()
        return
      }
      actions.setStarted({
        planPath,
        jobId: value.jobId,
        runId: value.runId,
        parentSessionId: value.parentSessionId ?? '',
      })
      // Land on the overview, where the run's own fields appear as the ledger
      // fills in, and refresh the list so the row leaves 待批准.
      actions.setPage('overview')
      actions.refresh()
    })
  }

  // 退回修改 shows the experiment as a draft. The plan file is untouched: the
  // status is the reviewer's verdict on this page, not a new fact on disk.
  const shownStatus = sentBack && openRow !== undefined && openRow.runId === null ? 'draft' : openRow?.status

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
      if (!result.ok) {
        actions.setMatrixError(result.error.message)
        return
      }
      actions.setMatrix(result.value)
      // ui-spec §九: the columns separate CONDITIONS by a designed factor. The
      // pivot takes the first factor when the request names none, and «first»
      // is alphabetical over every path the declarations disagree on — which
      // is how `env.keys` became the column of a run that varied the model,
      // and how a JSON array became a column heading. The browser half is the
      // side that knows which fields are designed factors, so it corrects the
      // arrangement once, here. Naming the column puts `matrixColumn` past
      // null, so this branch cannot run twice.
      if (matrixColumn === null) {
        const want = preferredColumn(result.value.factors)
        if (want !== null && want !== result.value.column) actions.setMatrixColumn(want)
      }
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

  // The report: the bundle read, paid for by the page that asked for it. A
  // directory named in THIS visit — exported into, or typed on the page — is
  // tried first: a run started with `--out` records nothing about where its
  // bundle went, so without that the page would call an exported bundle
  // 未导出.
  useEffect(() => {
    if (openRunId === null || page !== 'report') return
    let cancelled = false
    actions.setReportLoading(true)
    void fetchReport(sessionId, {
      runId: openRunId,
      ...(lookIn === null ? {} : { outDir: lookIn }),
    }).then((result) => {
      if (cancelled) return
      actions.setReportLoading(false)
      if (result.ok) actions.setReport(result.value)
      else actions.setReportError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, page, refreshRev, lookIn, actions, fetchReport])

  // The containers this run still holds, read beside the report and NOT as
  // part of it: the report is a projection of an exported bundle (a fact
  // about the past), and this is what `docker ps` would say right now. Tying
  // them together would make a page about a bundle depend on a live daemon.
  //
  // `refreshRev` is in the list, so the finalize walk's own refresh re-reads
  // the count — which is the whole point of showing it after a walk.
  useEffect(() => {
    if (openRunId === null || page !== 'report') return
    let cancelled = false
    void fetchRunUnits(sessionId, { runId: openRunId }).then((result) => {
      if (cancelled) return
      if (result.ok) actions.setRunUnits(result.value)
      else actions.setRunUnitsError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, page, refreshRev, actions, fetchRunUnits])

  // The judge bench's blind queue, paid for by the page that asked for it: it
  // reads every cell's archived material off disk and scrubs it, which is not
  // a read to spend on a visit to the overview.
  //
  // `judge` is deliberately NOT in this dependency list. The effect writes it,
  // and an effect that depends on what it writes re-runs on its own answer —
  // the cleanup then cancels the request that produced it (the shape T47 hit
  // in the datasets tab). The refresh counter is the only re-fetch lever.
  useEffect(() => {
    if (openRunId === null || page !== 'judging') return
    let cancelled = false
    actions.setJudgeLoading(true)
    void fetchJudgeQueue(sessionId, { runId: openRunId }).then((result) => {
      if (cancelled) return
      actions.setJudgeLoading(false)
      if (result.ok) actions.setJudge(result.value)
      else actions.setJudgeError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, page, refreshRev, actions, fetchJudgeQueue])

  // ── the drawer's three human gestures ──────────────────────────────────
  const onRetry = (reason: string, category: string): void => {
    if (openRunId === null || cellSelection === null) return
    const missionId = cellSelection
    void retryCell(sessionId, { runId: openRunId, missionId, reason, category }).then((result) => {
      if (result.ok) {
        actions.setNotice(t('notice.retried', { id: missionId, attempt: result.value.attempt }))
        actions.refresh()
      } else {
        actions.setNoticeError(result.error.message)
      }
    })
  }

  const onRelease = (): void => {
    if (openRunId === null || cellSelection === null) return
    const missionId = cellSelection
    void releaseCheck(sessionId, { runId: openRunId, missionId }).then((result) => {
      if (result.ok) {
        actions.setNotice(t(result.value.releasable ? 'notice.releasable' : 'notice.notReleasable', { id: missionId }))
      } else {
        actions.setNoticeError(result.error.message)
      }
    })
  }

  /**
   * FINALIZE — ui-spec step 7's human act. Every archived cell of the run
   * walks the release gate; a refusal is recorded against its cell and the
   * walk carries on, which is why the answer is rendered whole rather than
   * reduced to a success line.
   */
  const onFinalize = (): void => {
    if (openRunId === null) return
    actions.setFinalizing(true)
    actions.setFinalizeResult(null)
    void finalizeRun(sessionId, { runId: openRunId }).then((result) => {
      actions.setFinalizing(false)
      if (!result.ok) {
        actions.setNoticeError(result.error.message)
        return
      }
      actions.setFinalizeResult(result.value)
      // The containers are in the notice because they are the half a reader
      // could not see before: a walk that said only "3 released" is what left
      // two units up on 3171 with nothing on screen about them.
      actions.setNotice(t('notice.finalized', {
        released: result.value.released, refused: result.value.refused, skipped: result.value.skipped,
        unitsReleased: result.value.unitsReleased, unitsHeld: result.value.unitsHeld.length,
      }))
      // Released cells change the run's states, which the overview and the
      // matrix both show.
      actions.refresh()
    })
  }

  /**
   * Record the open cell's human-final verdicts — ui-spec step 8, and the one
   * write in this tab with no model-facing twin anywhere in the family.
   *
   * Only answered criteria are sent (an untouched criterion is not a verdict
   * of "false"), and the ledger is append-only, so a second pass over the
   * same cell adds rather than replaces. The queue is re-read afterwards
   * because the cell has just moved from 未评 to 已评 and the agreement
   * numbers at the top have just changed.
   */
  const onHumanFinal = (): void => {
    if (openRunId === null || judgeTicket === null) return
    const ticket = judgeTicket
    const cellNo = judge?.cells.find(cell => cell.ticket === ticket)?.cellNo ?? 0
    const verdicts = Object.entries(judgeDraft)
      .filter(([, value]) => value.evidence.trim() !== '')
      .map(([criterion, value]) => ({ criterion, pass: value.pass, evidence: value.evidence.trim() }))
    if (verdicts.length === 0) return
    actions.setJudgeSubmitting(true)
    void submitHumanFinal(sessionId, { runId: openRunId, ticket, verdicts }).then((result) => {
      actions.setJudgeSubmitting(false)
      if (!result.ok) {
        actions.setNoticeError(result.error.message)
        return
      }
      actions.setNotice(result.value.duplicate
        ? t('notice.humanFinalDuplicate', { no: cellNo })
        : t('notice.humanFinal', { no: cellNo, count: result.value.written, by: result.value.by }))
      // Clears the composed answers with the selection, then re-reads: the
      // cell's group, its recorded verdicts and the header's agreement
      // numbers all changed with this write.
      actions.openJudgeCell(null)
      actions.refresh()
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
              <Chip tone={statusTone(shownStatus ?? openRow.status)}>{t(statusKey(shownStatus ?? openRow.status))}</Chip>
            </>
          )}
        <span className={css.barSpacer} />
        <Button size="sm" onClick={() => { actions.refresh() }}>{t('list.refresh')}</Button>
        {openRow === undefined && (
          <Button size="sm" variant="primary" onClick={() => { setNewOpen(true) }}>{t('list.new')}</Button>
        )}
      </div>
      {draftNotice !== null && openRow === undefined && <div className={css.notice}>{draftNotice}</div>}
      {notice !== null && openRow !== undefined && <div className={css.notice}>{notice}</div>}
      {noticeError !== null && openRow !== undefined && (
        <ErrorState what={t('notice.failed')} message={noticeError} compact t={t} />
      )}
      {openRow === undefined
        ? (
          <div className={css.body}>
            {loading && list === null && <div className={css.empty}>{t('list.loading')}</div>}
            {!loading && error !== null && list === null && (
              <ErrorState what={t('list.error')} message={error} t={t} />
            )}
            {(list?.notes ?? []).map(note => <div key={note} className={css.note}>{note}</div>)}
            {list !== null && rows.length === 0 && (
              // The seat's call to action says what it is FOR ("the first
              // one"), so it reads as the next step rather than as a second
              // copy of the toolbar button standing beside it.
              <EmptyState title={t('list.empty')} hint={t('list.emptyHint')}>
                <Button size="sm" variant="primary" onClick={() => { setNewOpen(true) }}>
                  {t('list.emptyAction')}
                </Button>
              </EmptyState>
            )}
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
                    <span className={css.colFactors}><FactorCell row={row} t={t} /></span>
                    <span className={css.colStatus}>
                      <Chip tone={statusTone(row.status)}>{t(statusKey(row.status))}</Chip>
                    </span>
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
                    <ErrorState what={t('detail.error')} message={detailError} t={t} />
                  )}
                  <Overview
                    row={openRow}
                    detail={detail}
                    started={started}
                    output={output}
                    outputError={outputError}
                    t={t}
                  />
                </>
              )}
              {page === 'plan' && (
                <PlanReviewPage
                  row={openRow}
                  review={review}
                  loading={reviewLoading}
                  error={reviewError}
                  sentBack={sentBack}
                  approving={approving}
                  refusal={approveRefusal}
                  approveError={approveError}
                  started={started}
                  output={output}
                  outputError={outputError}
                  onApprove={approve}
                  onSendBack={() => { actions.sendBack() }}
                  t={t}
                />
              )}
              {page === 'conditions' && (
                <ConditionsPage
                  view={conditions}
                  loading={conditionsLoading}
                  error={conditionsError}
                  pair={diffPair}
                  diff={diff}
                  diffError={diffError}
                  busy={conditionBusy}
                  provision={provision}
                  action={conditionAction}
                  editing={endpointEditing}
                  onPick={(id: string) => { actions.pickCondition(id) }}
                  onProvision={provisionRow}
                  onEditEndpoint={(id: string | null) => { actions.editEndpoint(id) }}
                  onSetEndpoint={setEndpoint}
                  t={t}
                />
              )}
              {page === 'matrix' && (
                openRunId === null
                  ? <EmptyState title={t('draft.notStarted')} hint={t('draft.notStartedHint')} />
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
                  ? <EmptyState title={t('draft.notStarted')} hint={t('draft.notStartedHint')} />
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
              {page === 'report' && (
                openRunId === null
                  ? <EmptyState title={t('draft.notStarted')} hint={t('draft.notStartedHint')} />
                  : (
                    <ReportPage
                      report={report}
                      loading={reportLoading}
                      error={reportError}
                      finalizing={finalizing}
                      finalizeResult={finalizeResult}
                      units={runUnits}
                      unitsError={runUnitsError}
                      onFinalize={onFinalize}
                      onExport={() => { actions.setExportOpen(true) }}
                      onLookIn={(dir) => { actions.setLookIn(dir) }}
                      t={t}
                    />
                  )
              )}
              {page === 'judging' && (
                openRunId === null
                  ? <EmptyState title={t('draft.notStarted')} hint={t('draft.notStartedHint')} />
                  : (
                    <JudgingPage
                      view={judge}
                      loading={judgeLoading}
                      error={judgeError}
                      selection={judgeTicket}
                      draft={judgeDraft}
                      submitting={judgeSubmitting}
                      onPick={(ticket) => { actions.openJudgeCell(ticket) }}
                      onAnswer={(criterion, value) => { actions.setJudgeDraft(criterion, value) }}
                      onSubmit={onHumanFinal}
                      t={t}
                    />
                  )
              )}
            </div>
            <ExportDialog
              runId={openRunId ?? ''}
              open={exportOpen && openRunId !== null}
              onClose={() => { actions.setExportOpen(false) }}
              onDone={(text, outDir) => {
                actions.setNotice(text)
                // Where the bundle just landed — the first place the report
                // page looks, ahead of the plan's own `exports`.
                if (outDir !== '') actions.setLookIn(outDir)
              }}
              planExport={planExport}
              exportRun={exportRun}
              sessionId={sessionId}
              t={t}
            />
          </>
        )}
      <NewExperimentDialog
        open={newOpen}
        onClose={() => { setNewOpen(false) }}
        onDrafted={(result) => {
          setNewOpen(false)
          setDrafted(result)
          // The row is the LIST's; ask for it and let the effect above open it.
          actions.refresh()
        }}
        fetchDraftOptions={fetchDraftOptions}
        fetchConditions={fetchConditions}
        draftExperiment={draftExperiment}
        sessionId={sessionId}
        t={t}
      />
    </div>
  )
}
