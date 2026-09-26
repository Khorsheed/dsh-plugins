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
 * The detail is the FOUR-STAGE shell ui-spec §五 v2 fixes — 实验设计 / 运行记录
 * / 结果对比 / 人工评估 — and each stage carries one primary action, chosen by
 * the experiment's own status (see {@link stageAction}). v1 had seven sub-pages
 * and the walkthrough's verdict on them was that every one was a correctly
 * labelled pile of fields with nothing to do on it; the four here are the four
 * things a person does, and the bar above them says which one is next.
 *
 * The report page (T38) is fetched the same lazy way, and for a stronger
 * reason: it reads a mission export BUNDLE off disk and analyzes it, which is
 * the most expensive read in the tab and means nothing until the run has been
 * exported at all.
 *
 * A DRAFT's design page is rendered from the list row plus the plan review:
 * there is no run to fetch, and the row already carries the shape. The review
 * IS fetched on the design stage — it is what that stage is about, and the
 * primary action ('批准并启动') may not be offered until validate has spoken.
 * Everything else stays lazy: the report reads a bundle off disk and the
 * judge queue scrubs every archived artifact, and neither is a read to spend
 * on a visit to the design page.
 *
 * Visual language follows the missions and datasets tabs: compact rows,
 * hairline separators, tokenized colors, official primitives throughout.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EvalClosureExit, EvalDraftResult, EvalExperimentRow, EvalPlanCheck } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { DesignPage, type PlanNumbersAnswer, type PlanNumbersDraft } from './DesignPage.tsx'
import {
  Chip, Detail, EmptyState, FactorCell, snapshotCell, stageAction, stalledFor, stamp, statusKey, statusTone,
} from './parts.tsx'
import { LAB_PAGES, START_FOLLOWUP_LIMIT, START_FOLLOWUP_MS, type LabPage, type RunFilter } from './store.ts'
import { RunsPage } from './RunsPage.tsx'
import { AnswerView } from './AnswerView.tsx'
import { rowsOfSheet } from './answer-view.ts'
import { ErrorState } from './ErrorState.tsx'
import { ExportDialog } from './ExportDialog.tsx'
import { JudgingPage } from './JudgingPage.tsx'
import { NewExperimentDialog } from './NewExperimentDialog.tsx'
import { ReportPage, type ReadAnalysis } from './ReportPage.tsx'
import { preferredColumn } from './vocab.ts'
import {
  LIST_GROUPS, fixLabel, groupRows, readinessFix as readinessFixOf, readListScope, scopeRows, splitReadiness, writeListScope,
  type ListScope, type ReadinessFix,
} from './journey.ts'
import css from './LabView.module.css'

/**
 * The lab tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function LabView(props: LabViewProps) {
  const {
    sessionId, useStore, actions, t,
    fetchExperiments, fetchExperiment, fetchPlanReview, fetchConditions, fetchConditionDiff, approvePlan, fetchRunOutput,
    provisionCondition, setConditionEndpoint, setPlanNumbers,
    fetchDraftOptions, draftExperiment,
    fetchMatrix, fetchCells, fetchCell, fetchCellArtifact, retryCell, releaseCheck, planExport, exportRun, reexportRun, openSession,
    fetchReport, finalizeRun, fetchRunUnits, fetchJudgeQueue, fetchCellAnswers, submitHumanFinal, fetchExperimentArtifact,
    closeRun, archiveRun, insertDraft, focus,
  } = props
  const list = useStore(s => s.list)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const refreshRev = useStore(s => s.refreshRev)
  const selection = useStore(s => s.selection)
  const page = useStore(s => s.page)
  const detail = useStore(s => s.detail)
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
  const runFilter = useStore(s => s.runFilter)
  const cells = useStore(s => s.cells)
  const cellsLoading = useStore(s => s.cellsLoading)
  const cellsError = useStore(s => s.cellsError)
  const cellSelection = useStore(s => s.cellSelection)
  const cell = useStore(s => s.cell)
  const cellLoading = useStore(s => s.cellLoading)
  const cellError = useStore(s => s.cellError)
  const artifactPath = useStore(s => s.artifactPath)
  const artifact = useStore(s => s.artifact)
  const artifactLoading = useStore(s => s.artifactLoading)
  const artifactError = useStore(s => s.artifactError)
  const recordFocus = useStore(s => s.recordFocus)
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
  const judgeTask = useStore(s => s.judgeTask)
  const judgeDraft = useStore(s => s.judgeDraft)
  const judgeSubmitting = useStore(s => s.judgeSubmitting)
  const answers = useStore(s => s.answers)
  const answerSheet = useStore(s => s.answerSheet)
  const answerLoading = useStore(s => s.answerLoading)
  const answerError = useStore(s => s.answerError)
  const exportOpen = useStore(s => s.exportOpen)
  const reexporting = useStore(s => s.reexporting)
  const startFollowUps = useStore(s => s.startFollowUps)
  const notice = useStore(s => s.notice)
  const noticeError = useStore(s => s.noticeError)
  // A draft made in THIS visit, held until its row shows up in the refreshed
  // list. The row does not exist client-side the moment the file lands, so
  // opening it by id immediately would drop the reader back to the list; the
  // effect below opens it when the list catches up, and the same sentence is
  // shown over the list meanwhile.
  const [newOpen, setNewOpen] = useState(false)
  const [drafted, setDrafted] = useState<EvalDraftResult | null>(null)
  // The 保留单元 debugging switch. Visit-local like the two above: it is a
  // property of THIS approval, not of the plan on disk.
  const [keepUnits, setKeepUnits] = useState(false)
  // 本会话发起 / 全部 (T72 §1). A per-viewer convenience, so browser storage
  // is the right home — read once, and every access is guarded (journey.ts).
  const [scope, setScopeState] = useState<ListScope>(() => readListScope())
  const setScope = (next: ListScope): void => {
    setScopeState(next)
    writeListScope(next)
  }
  // The list's own one-line notice (a re-run started, an archive failed): the
  // store's notice belongs to the open experiment and is cleared by `open`.
  const [listNotice, setListNotice] = useState<string | null>(null)
  // The experiment the tool-row card asked for (T76): marked in the list until
  // the reader opens a row. The host has no tab switch a plugin can call, so
  // this is as far as 打开实验 can carry the reader — the tab is theirs.
  const [marked, setMarked] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

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

  // Take this session's pending 打开实验 on mount and on every new request:
  // back to the list and a fresh read, so a draft made seconds ago is in it.
  useEffect(() => {
    if (focus === undefined) return
    const take = (): void => {
      const experimentId = focus.take(sessionId)
      if (experimentId === null) return
      setListNotice(null)
      actions.open(null)
      actions.refresh()
      setMarked(experimentId)
    }
    take()
    return focus.subscribe(take)
  }, [focus, sessionId, actions])

  const rows = list?.rows ?? []
  // A marked row the session filter would hide switches the filter to 全部 —
  // a mark nobody can see is not an answer to 打开实验.
  const markedRow = marked === null ? undefined : rows.find(row => row.experimentId === marked)
  const markedHidden = markedRow !== undefined
    && scopeRows(rows, list?.session ?? null, scope).shown.every(row => row.id !== markedRow.id)
  useEffect(() => {
    if (markedHidden) setScopeState('all')
  }, [markedHidden])
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
  const openExperimentId = openRow?.experimentId ?? null

  // Until the list carries the new row, the list-level notice names the draft
  // by its id's slug (the name, lower-cased) — the row's own name replaces it
  // the moment the row lands.
  const draftNotice = drafted === null
    ? null
    : (drafted.review.errors === 0
      ? t('notice.drafted', { name: drafted.experimentId.replace(/-\d{8}-[0-9a-f]{4}$/, '') })
      : t('notice.draftedWithErrors', { name: drafted.experimentId.replace(/-\d{8}-[0-9a-f]{4}$/, ''), errors: drafted.review.errors }))

  // What the draft's own sentence says: the name, and whether validate found
  // anything. A draft with errors is still a draft — it is on disk and in the
  // list — so the notice reports rather than apologizes. The name is the
  // experiment row's (its plan file is `plan.json` for every experiment since
  // T73, so the file stem names nothing); the path is not in the sentence
  // (ui-spec §九).
  //
  // Keyed on `list`, NOT on `rows`: `rows` is a fresh array on every render
  // (`list?.rows ?? []`), which would re-run this on every render for nothing.
  // The effect does write `drafted`, but it writes it to null and then early
  // returns — it cancels no request, so this is not the self-cancelling shape
  // T47 hit.
  useEffect(() => {
    if (drafted === null) return
    const row = (list?.rows ?? []).find(entry => entry.experimentId === drafted.experimentId)
    if (row === undefined) return
    actions.open(row.id)
    // `open` already lands on 实验设计 and clears the per-experiment notice, so
    // the sentence is set after it, never before.
    actions.setNotice(drafted.review.errors === 0
      ? t('notice.drafted', { name: row.name })
      : t('notice.draftedWithErrors', { name: row.name, errors: drafted.review.errors }))
    setDrafted(null)
  }, [list, drafted, actions, t])

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

  // The plan review, fetched on the DESIGN stage: it is what that stage shows
  // (the shape, the checks, the readiness), and the stage bar cannot offer
  // 批准并启动 before validate has spoken. Still gated on the page, so the
  // dataset walk is not spent by a reader who went straight to the report.
  useEffect(() => {
    if (page !== 'design' || planPath === null) return
    let cancelled = false
    actions.setReviewLoading(true)
    // An experiment is reviewed by id — that is what brings its meta.json pin
    // along; only a legacy run's plan is still named by path.
    const request = openExperimentId !== null ? { experimentId: openExperimentId } : { planPath }
    void fetchPlanReview(sessionId, request).then((result) => {
      if (cancelled) return
      actions.setReviewLoading(false)
      if (result.ok) actions.setReview(result.value)
      else actions.setReviewError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, page, planPath, openExperimentId, refreshRev, actions, fetchPlanReview])

  // The comparison-group registry, likewise — it is the REPOSITORY's, so it is
  // not re-read when the open experiment changes, only when the design stage
  // that shows it is opened.
  useEffect(() => {
    if (page !== 'design') return
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
   * WAIT for the approved run to reach the ledger — ui-spec step 5 → 6, and
   * I5·T39's G11.
   *
   * `runStart` answers with the run id before `runCreate` has been called, so
   * the refresh the approval fires reads a list that still has no run on this
   * plan. Nothing re-read afterwards: the matrix and the cells sat on 未开始
   * while the overview showed `Running`, and a person pressed Refresh to find
   * out that everything was fine.
   *
   * Re-reading here, and only here: the effect arms while a run was started in
   * this visit and its row still has no run id, and disarms the moment the id
   * appears — a wait with an end, not a polling cadence. The counter bounds
   * it, because a run the readiness gate refused never appears at all and its
   * refusal is in the job log above, not in this list.
   */
  useEffect(() => {
    if (started === null || openRunId !== null) return
    if (startFollowUps >= START_FOLLOWUP_LIMIT) return
    const timer = setTimeout(() => {
      actions.countStartFollowUp()
      actions.refresh()
    }, START_FOLLOWUP_MS)
    return () => { clearTimeout(timer) }
  }, [started, openRunId, startFollowUps, actions])

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
  function provisionRow(row: { id: string }): void {
    actions.setConditionBusy(row.id)
    actions.setProvision(null)
    void provisionCondition(sessionId, { condition: row.id }).then((result) => {
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
  function setEndpoint(row: { id: string }, endpoint: string): void {
    actions.setConditionBusy(row.id)
    void setConditionEndpoint(sessionId, { condition: row.id, endpoint }).then((result) => {
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
   * Write the open plan's numbers in place (T74). The answer carries the
   * plan-review payload read AFTER the write, so the page shows the file as it
   * now is; the list is refreshed too, because its scale column reads reps.
   * @param numbers - the values the person typed.
   */
  function setNumbers(numbers: PlanNumbersDraft): Promise<PlanNumbersAnswer> {
    const experimentId = openRow?.experimentId ?? null
    if (experimentId === null) return Promise.resolve({ ok: false, message: t('design.numbers.noPlan') })
    return setPlanNumbers(sessionId, { experimentId, ...numbers }).then((result): PlanNumbersAnswer => {
      if (!result.ok) return { ok: false, message: result.error.message }
      actions.setReview(result.value.review)
      if (result.value.written) actions.refresh()
      return { ok: true, value: result.value }
    })
  }

  /**
   * Approve and start the open plan — the human act of ui-spec step 5.
   * @param keepUnits - the dialog's 保留单元 box: stop every cell at
   *   `archived` and keep its container. Off is the default, and the run then
   *   walks the release gate cell by cell.
   */
  function approve(keepUnits: boolean): void {
    const experimentId = openRow?.experimentId ?? null
    if (planPath === null || experimentId === null) return
    const approvedPlan = planPath
    actions.setApproving(true)
    void approvePlan(sessionId, { experimentId, ...(keepUnits ? { keepUnits: true } : {}) }).then((result) => {
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
        planPath: approvedPlan,
        jobId: value.jobId,
        runId: value.runId,
        parentSessionId: value.parentSessionId ?? '',
      })
      // STAY on 实验设计. The job's log is rendered here and a readiness
      // refusal is written NOWHERE else — the run never reaches `runCreate`,
      // so the ledger holds nothing for it. Walking the reader to 运行记录
      // automatically would land them on an empty grid with the reason they
      // are about to look for left behind on the page they left. The stage bar
      // offers 看运行记录 the moment the status turns, which is one click and
      // the reader's own.
      actions.refresh()
    })
  }

  /**
   * 重跑 a STALLED experiment (T72 §1/§7). There is no resume verb: mission
   * holds no way to pick a dead orchestrator's run back up, so the fallback
   * is the plan approved again, which starts a NEW run beside the stalled one.
   * The old row is left exactly where it is — the notice suggests archiving
   * it rather than doing so, because what to keep is the reader's call.
   * @param row - the stalled row (its plan path is what is approved).
   */
  function rerun(row: EvalExperimentRow): void {
    if (row.experimentId === null) return
    const experimentId = row.experimentId
    setListNotice(null)
    void approvePlan(sessionId, { experimentId }).then((result) => {
      const said = !result.ok
        ? t('notice.rerunFailed', { message: result.error.message })
        : (!result.value.started || result.value.runId === null)
            ? t('notice.rerunRefused', { reason: result.value.refusal ?? '' })
            : t('notice.rerun', { name: row.name, runId: result.value.runId })
      setListNotice(said)
      actions.setNotice(said)
      actions.refresh()
    }, (error: unknown) => {
      setListNotice(t('notice.rerunFailed', { message: error instanceof Error ? error.message : String(error) }))
    })
  }

  /**
   * 归档 / 取消归档 (T72 §8). Grouping only — the status on the row does not
   * change, and nothing about the run is touched.
   */
  function setArchived(row: EvalExperimentRow, archived: boolean): void {
    if (row.runId === null) return
    void archiveRun(sessionId, { runId: row.runId, archived }).then((result) => {
      if (!result.ok || !result.value.recorded) {
        setListNotice(t('notice.archiveFailed', {
          message: result.ok ? (result.value.detail ?? '') : result.error.message,
        }))
        return
      }
      setListNotice(null)
      actions.refresh()
    })
  }

  /**
   * Take one of the four exits (T72 §5). The server enforces every rule — a
   * reason for ② and ④, nothing after ④ — and answers with a structured
   * refusal the page turns into a sentence.
   */
  function closeWith(exit: EvalClosureExit, reason: string): void {
    if (openRunId === null) return
    setClosing(true)
    void closeRun(sessionId, { runId: openRunId, exit, reason: reason.trim() === '' ? null : reason.trim() }).then((result) => {
      setClosing(false)
      if (!result.ok) {
        actions.setNoticeError(result.error.message)
        return
      }
      if (!result.value.recorded) {
        actions.setNoticeError(result.value.detail ?? t(`closure.refused.${result.value.refusal ?? 'ledger'}`))
        return
      }
      actions.setNotice(t(`closure.done.${exit}`))
      actions.refresh()
    })
  }

  /**
   * Hand a sentence to the agent: pre-filled in the composer, NEVER sent
   * (T72 §4). The host's conversation input when this session has one; the
   * clipboard otherwise, and the notice says which happened.
   * @param text - the sentence.
   */
  function handToAgent(text: string): void {
    if (insertDraft(sessionId, text)) {
      actions.setNotice(t('agent.inserted'))
      return
    }
    void writeClipboard(text).then((ok) => {
      actions.setNotice(t(ok ? 'agent.copied' : 'agent.copyFailed', { text }))
    })
  }

  const fixText = (fix: ReadinessFix): string => {
    const label = fixLabel(fix)
    return label.params === undefined ? t(label.key) : t(label.key, label.params)
  }

  // 退回修改 shows the experiment as a draft. The plan file is untouched: the
  // status is the reviewer's verdict on this page, not a new fact on disk.
  //
  // An approval made in THIS visit outranks both. `runStart` answers before
  // `runCreate`, so the list row still reads 待批准 for a few seconds after the
  // run exists — and a primary action that says 批准并启动 over a run that is
  // already going is the one mislabelled button in this bar that could do
  // real damage.
  const shownStatus = started !== null
    ? 'running' as const
    : (sentBack && openRow !== undefined && openRow.runId === null ? 'draft' as const : openRow?.status)

  // What the four run-scoped sub-pages put in their empty seat when they have
  // no run id yet. An approval in this visit means the run EXISTS — the receipt
  // named it — so 还没启动 would be false there; it is the wait above that has
  // not landed (I5·T39 · G11). Same component and same seat either way
  // (ui-spec §九), only the two sentences differ.
  const notStarted = started !== null
    ? { title: 'draft.starting', hint: 'draft.startingHint' } as const
    : { title: 'draft.notStarted', hint: 'draft.notStartedHint' } as const

  // The matrix, re-arranged whenever the reader moves a factor. The
  // arrangement is the host's — the browser only says what it wants.
  const matrixGroupKey = matrixGroupBy.join(',')
  const matrixFilterKey = JSON.stringify(matrixFilter)
  useEffect(() => {
    if (openRunId === null || page !== 'runs') return
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
    if (openRunId === null || page !== 'runs') return
    let cancelled = false
    actions.setCellsLoading(true)
    // No bucket on the wire: the five filters are applied in the browser over
    // the whole run (see `passesFilter`), so this reads the run once and the
    // counts beside the chips count one population.
    void fetchCells(sessionId, { runId: openRunId }).then((result) => {
      if (cancelled) return
      actions.setCellsLoading(false)
      if (result.ok) actions.setCells(result.value)
      else actions.setCellsError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, page, refreshRev, actions, fetchCells])

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

  // The expanded attachment. Keyed on the open record's CURRENT attempt as
  // well as its path: a retry opens a fresh attempt directory, and the same
  // filename there is a different file.
  const artifactAttempt = cell?.attempt ?? null
  useEffect(() => {
    if (openRunId === null || cellSelection === null || artifactPath === null || artifactAttempt === null) return
    let cancelled = false
    const request = { runId: openRunId, missionId: cellSelection, attempt: artifactAttempt, path: artifactPath }
    actions.setArtifactLoading(true)
    void fetchCellArtifact(sessionId, request).then((result) => {
      if (cancelled) return
      actions.setArtifactLoading(false)
      if (result.ok) actions.setArtifact(result.value)
      else actions.setArtifactError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, cellSelection, artifactPath, artifactAttempt, actions, fetchCellArtifact])

  // A click on the 结果对比 page's tables lands here: when the (题目 × 对比组)
  // it named holds exactly ONE record, that record's detail opens by itself —
  // which is what «跳到该条运行记录» means when there is one. With several
  // reps the list stays put under its chip, because picking one of them would
  // be picking for the reader.
  const focusMatches = recordFocus === null
    ? []
    : (cells?.rows ?? []).filter(row => row.task === recordFocus.task && row.condition === recordFocus.condition)
  const soleFocusMatch = focusMatches.length === 1 ? (focusMatches[0]?.missionId ?? null) : null
  useEffect(() => {
    if (soleFocusMatch === null || cellSelection === soleFocusMatch) return
    actions.openCell(soleFocusMatch)
  }, [soleFocusMatch, cellSelection, actions])

  // The report: the bundle read, paid for by the page that asked for it. A
  // directory named in THIS visit — exported into, or typed on the page — is
  // tried first: a run started with `--out` records nothing about where its
  // bundle went, so without that the page would call an exported bundle
  // 未导出.
  useEffect(() => {
    if (openRunId === null || page !== 'compare') return
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

  // Block ⑤'s one read: an analysis file of the experiment the open report
  // belongs to. Stable per report so the block's effect does not re-fire.
  const reportExperiment = useStore(s => s.report?.experimentId ?? null)
  const readAnalysis = useCallback<ReadAnalysis>((path: string) => (
    reportExperiment === null
      ? Promise.resolve({ ok: false as const, error: { message: t('report.analysisNoExperiment') } })
      : fetchExperimentArtifact(sessionId, { experimentId: reportExperiment, path })
  ), [sessionId, reportExperiment, fetchExperimentArtifact, t])

  // The containers this run still holds, read beside the report and NOT as
  // part of it: the report is a projection of an exported bundle (a fact
  // about the past), and this is what `docker ps` would say right now. Tying
  // them together would make a page about a bundle depend on a live daemon.
  //
  // `refreshRev` is in the list, so the finalize walk's own refresh re-reads
  // the count — which is the whole point of showing it after a walk.
  useEffect(() => {
    if (openRunId === null || page !== 'compare') return
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
    if (openRunId === null || page !== 'review') return
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

  // The answer view's read (I5·T75): one 题, every group and rep, once per
  // 题 — the entry's group and rep only mark and narrow what is already read,
  // so moving between the cells of one 题 costs no round trip.
  const answerTask = answers?.task ?? null
  useEffect(() => {
    if (openRunId === null || answerTask === null) return
    let cancelled = false
    actions.setAnswerLoading(true)
    void fetchCellAnswers(sessionId, { runId: openRunId, task: answerTask }).then((result) => {
      if (cancelled) return
      actions.setAnswerLoading(false)
      if (result.ok) actions.setAnswerSheet(result.value)
      else actions.setAnswerError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRunId, answerTask, refreshRev, actions, fetchCellAnswers])

  /**
   * The stage bar: the ONE action this experiment's state asks for.
   *
   * Three of the six verbs move the reader to the stage that holds the work,
   * one re-reads, and 批准并启动 is the human act itself (ui-spec R1) —
   * pressed here rather than hunted for on a sub-page, which is the whole
   * complaint v1 answered with a definition list. It is DISABLED with its
   * reason beside it while validate reports errors: a button that could only
   * produce a refusal is a worse button than one that says why it is off.
   */
  const action = stageAction(shownStatus ?? openRow?.status ?? 'draft')
  // The review's own count once it has landed; the LIST row's before that —
  // the row carries validate's verdict without an RPC, and a primary action
  // that is briefly enabled on a plan validate already rejected is a button
  // that can only produce a refusal.
  const validation = review === null
    ? (openRow?.validation ?? null)
    : { ok: review.ok, errors: review.errors }
  // 待批准 (T72 §3): the stage bar offers the FIRST blocker's fix, and
  // 批准并启动 only once the checklist has none. Before the review lands the
  // row's own counts decide, as they always did.
  const blockers = review === null ? [] : splitReadiness(review.checks, review.conditions).blockers
  const firstBlocker = action.verb === 'approve' && blockers.length > 0 ? blockers[0] ?? null : null
  const firstFix = firstBlocker === null ? null : readinessFixOf(firstBlocker)
  const blockedBy = action.verb === 'approve' && firstFix === null && validation !== null && !validation.ok
    ? validation.errors
    : null

  const runAction = (): void => {
    if (firstBlocker !== null && firstFix !== null) {
      applyFix(firstFix, firstBlocker, 1)
      return
    }
    if (action.verb === 'approve') {
      approve(keepUnits)
      return
    }
    if (action.verb === 'rerun') {
      if (openRow !== undefined) rerun(openRow)
      return
    }
    if (action.verb === 'refresh') {
      actions.refresh()
      return
    }
    actions.setPage(action.verb satisfies LabPage)
  }

  /**
   * Run one readiness line's fix (T72 §4). Provision and the endpoint edit
   * are the design page's own gestures; everything else goes to the agent as
   * a sentence in the composer, never sent.
   * @param fix - what the line's button does.
   * @param check - the line.
   * @param k - its number on screen.
   */
  function applyFix(fix: ReadinessFix, check: EvalPlanCheck, k: number): void {
    if (page !== 'design') actions.setPage('design')
    switch (fix.kind) {
      case 'provision': {
        const target = conditions?.rows.find(entry => entry.id === fix.condition)
        if (target !== undefined) {
          provisionRow(target)
          return
        }
        break
      }
      case 'endpoint':
        actions.editEndpoint(fix.condition)
        return
      case 'agent':
        break
    }
    handToAgent(t('readiness.agentAsk', { name: openRow?.name ?? '', k, text: check.message }))
  }

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
   * EXPORT AGAIN — the report page's and the judge bench's answer to "the
   * final verdicts are not in the bundle" (I5·T39 · G17).
   *
   * One click because it repeats an export this run already recorded: the
   * same layers, into a fresh directory beside the first, with the report
   * written into it. Nothing guarded is widened here — mission re-checks the
   * layer set against a fresh plan and refuses if one of them became guarded,
   * which is when a reader goes to the dialog and confirms it on purpose.
   */
  const onReexport = (): void => {
    if (openRunId === null) return
    actions.setReexporting(true)
    void reexportRun(sessionId, { runId: openRunId }).then((result) => {
      actions.setReexporting(false)
      if (!result.ok) {
        actions.setNoticeError(result.error.message)
        return
      }
      actions.setNotice(t('notice.reexported', { dir: result.value.bundleDir, count: result.value.files }))
      // The report page looks in the directory the export landed in first, so
      // the page a reader is standing on shows the NEW bundle, not the stale
      // one they just replaced.
      actions.setLookIn(result.value.bundleDir.replace(/\/[^/]+$/, ''))
      actions.refresh()
    })
  }

  /**
   * Record ONE answer's human-final verdicts — ui-spec step 8, and the one
   * write in this tab with no model-facing twin anywhere in the family.
   *
   * One answer and not the open item: several are on screen at once since
   * I5·T67 and each is graded on its own, so the ticket comes from the column
   * that was submitted. Only answered criteria are sent (an untouched
   * criterion is not a verdict of "false"), and the ledger is append-only, so
   * a second pass over the same cell adds rather than replaces. Only THAT
   * column's composed answers are cleared — the ones beside it are still
   * being written.
   * @param ticket - the answer whose button was pressed.
   */
  const onHumanFinal = (ticket: string): void => {
    if (openRunId === null) return
    const cellNo = judge?.cells.find(cell => cell.ticket === ticket)?.cellNo ?? 0
    const verdicts = Object.entries(judgeDraft[ticket] ?? {})
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
      // The recorded verdicts, this cell's queue group and the header's
      // agreement numbers all changed with this write.
      actions.clearJudgeDraft(ticket)
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
      {listNotice !== null && openRow === undefined && <div className={css.notice}>{listNotice}</div>}
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
              <ExperimentList
                rows={rows}
                session={list?.session ?? null}
                scope={scope}
                onScope={setScope}
                marked={markedRow?.id ?? null}
                onOpen={(id) => { setListNotice(null); setMarked(null); actions.open(id) }}
                onRerun={rerun}
                onArchive={setArchived}
                t={t}
              />
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
            {/* The stage bar (ui-spec §五 v2): what is true right now, and the
                ONE thing to do about it. Every stage carries it, so a reader
                who lands anywhere in this shell can answer «下一步做什么»
                without reading the page. */}
            <div className={css.stageBar}>
              <span className={css.stageHint}>
                {firstBlocker !== null ? t('cta.pendingBlocked', { count: blockers.length }) : t(action.hint)}
              </span>
              <span className={css.barSpacer} />
              {blockedBy !== null && <span className={css.warning}>{t('cta.blocked', { errors: blockedBy })}</span>}
              <span className={css.stageAction}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={approving || blockedBy !== null}
                  onClick={runAction}
                >
                  {approving && action.verb === 'approve'
                    ? t('cta.waiting')
                    : firstFix !== null
                      ? fixText(firstFix)
                      : t(action.cta)}
                </Button>
              </span>
            </div>
            <div className={css.body}>
              {answers !== null && openRunId !== null && (
                answerSheet === null
                  ? (answerError !== null
                      ? (
                        <div>
                          <Button size="sm" onClick={() => { actions.openAnswers(null) }}>{t('answer.back')}</Button>
                          <ErrorState what={t('answer.error')} message={answerError} t={t} />
                        </div>
                      )
                      : <div className={css.dim}>{answerLoading ? t('answer.loading') : ''}</div>)
                  : (
                    <AnswerView
                      // Remount per entry: the rep chips and the blind switch
                      // start from what THIS door named.
                      key={`${answers.task}|${answers.condition ?? ''}|${String(answers.rep)}`}
                      task={answerSheet.task}
                      rows={rowsOfSheet(answerSheet, { condition: answers.condition, rep: null })}
                      criteria={answerSheet.criteria}
                      criteriaNote={answerSheet.criteriaNote}
                      notes={answerSheet.notes}
                      scoring={null}
                      rep={answers.rep}
                      onOpenSession={(childId, parentId) => { openSession(childId as SessionId, parentId === null ? null : parentId as SessionId) }}
                      onBack={() => { actions.openAnswers(null) }}
                      t={t}
                    />
                  )
              )}
              {/* The stage stays mounted under the answer view, so 返回 lands
                  on the table exactly as it was left (an expanded criteria
                  cell, a scrolled list). */}
              <div style={{ display: answers !== null && openRunId !== null ? 'none' : 'contents' }}>
              {page === 'design' && (
                <>
                  {detailError !== null && (
                    <ErrorState what={t('detail.error')} message={detailError} t={t} />
                  )}
                  <DesignPage
                    row={openRow}
                    detail={detail}
                    review={review}
                    reviewLoading={reviewLoading}
                    reviewError={reviewError}
                    conditions={conditions}
                    conditionsLoading={conditionsLoading}
                    conditionsError={conditionsError}
                    conditionBusy={conditionBusy}
                    provision={provision}
                    conditionAction={conditionAction}
                    endpointEditing={endpointEditing}
                    pair={diffPair}
                    diff={diff}
                    diffError={diffError}
                    sentBack={sentBack}
                    started={started}
                    output={output}
                    outputError={outputError}
                    refusal={approveRefusal}
                    approveError={approveError}
                    keepUnits={keepUnits}
                    onKeepUnits={setKeepUnits}
                    onSendBack={() => { actions.sendBack() }}
                    onRecheck={() => { actions.refresh() }}
                    onPick={(id: string) => { actions.pickCondition(id) }}
                    onProvision={provisionRow}
                    onEditEndpoint={(id: string | null) => { actions.editEndpoint(id) }}
                    onSetEndpoint={setEndpoint}
                    onAddGroup={() => { setNewOpen(true) }}
                    onSetNumbers={setNumbers}
                    onFix={applyFix}
                    t={t}
                  />
                </>
              )}
              {page === 'runs' && (
                openRunId === null
                  ? <EmptyState title={t(notStarted.title)} hint={t(notStarted.hint)} />
                  : (
                    <RunsPage
                      matrix={matrix}
                      matrixLoading={matrixLoading}
                      matrixError={matrixError}
                      onColumn={(factor) => { actions.setMatrixColumn(factor) }}
                      onToggleGroup={(factor) => { actions.toggleMatrixGroup(factor) }}
                      onFilter={(factor, value) => { actions.setMatrixFilter(factor, value) }}
                      cells={cells}
                      loading={cellsLoading}
                      error={cellsError}
                      filter={runFilter}
                      onSetFilter={(entry: RunFilter) => { actions.setRunFilter(entry) }}
                      selection={cellSelection}
                      cell={cell}
                      cellLoading={cellLoading}
                      cellError={cellError}
                      onOpenCell={(missionId) => { actions.openCell(missionId) }}
                      onRetry={onRetry}
                      onRelease={onRelease}
                      onExport={() => { actions.setExportOpen(true) }}
                      onOpenSession={(childId, parentId) => { openSession(childId as SessionId, parentId === null ? null : parentId as SessionId) }}
                      onOpenAnswers={(focus) => { actions.openAnswers(focus) }}
                      artifactPath={artifactPath}
                      artifact={artifact}
                      artifactLoading={artifactLoading}
                      artifactError={artifactError}
                      onOpenArtifact={(path) => { actions.openArtifact(path) }}
                      focus={recordFocus}
                      onClearFocus={() => { actions.focusRecords(null) }}
                      onAddGroup={() => { setNewOpen(true) }}
                      stalledMinutes={openRow.status === 'stalled' ? openRow.stalledMinutes : null}
                      onRerun={() => { rerun(openRow) }}
                      t={t}
                    />
                  )
              )}
              {page === 'compare' && (
                openRunId === null
                  ? <EmptyState title={t(notStarted.title)} hint={t(notStarted.hint)} />
                  : (
                    <ReportPage
                      report={report}
                      loading={reportLoading}
                      error={reportError}
                      finalizing={finalizing}
                      finalizeResult={finalizeResult}
                      units={runUnits}
                      unitsError={runUnitsError}
                      reexporting={reexporting}
                      onFinalize={onFinalize}
                      onExport={() => { actions.setExportOpen(true) }}
                      onReexport={onReexport}
                      onLookIn={(dir) => { actions.setLookIn(dir) }}
                      onOpenRecords={(task, condition) => { actions.focusRecords({ task, condition }) }}
                      // The same landing, then the record the criteria cell
                      // already named. `focusRecords` is what moves the stage
                      // and sets the chip; `openCell` is what selects the row
                      // — the sole-match effect above would pick the same one
                      // when there IS only one, so the two never disagree.
                      onOpenRecord={(task, condition, missionId) => {
                        actions.focusRecords({ task, condition })
                        actions.openCell(missionId)
                      }}
                      onOpenAnswers={(focus) => { actions.openAnswers(focus) }}
                      onOpenRuns={() => { actions.setPage('runs') }}
                      readAnalysis={readAnalysis}
                      onRejudge={(condition) => {
                        handToAgent(t('report.rejudgeAsk', { name: openRow.name, condition }))
                      }}
                      onAskAnalysis={() => { handToAgent(t('report.analysisAsk', { name: openRow.name })) }}
                      t={t}
                    />
                  )
              )}
              {page === 'review' && (
                openRunId === null
                  ? <EmptyState title={t(notStarted.title)} hint={t(notStarted.hint)} />
                  : (
                    <JudgingPage
                      view={judge}
                      loading={judgeLoading}
                      error={judgeError}
                      selection={judgeTask}
                      draft={judgeDraft}
                      submitting={judgeSubmitting}
                      reexporting={reexporting}
                      onReexport={onReexport}
                      onPick={(task) => { actions.openJudgeTask(task) }}
                      onAnswer={(ticket, criterion, value) => { actions.setJudgeDraft(ticket, criterion, value) }}
                      onSubmit={onHumanFinal}
                      closure={openRow.closure}
                      closing={closing}
                      onClose={closeWith}
                      onRejudge={(cellNos) => {
                        handToAgent(t('judge.rejudgeAsk', { name: openRow.name, cells: cellNos.join('、') }))
                      }}
                      t={t}
                    />
                  )
              )}
              </div>
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

/** One list row: the columns, and the row's own actions after them. */
function ExperimentRowLine(props: {
  row: EvalExperimentRow
  marked: boolean
  onOpen: (id: string) => void
  onRerun: (row: EvalExperimentRow) => void
  onArchive: (row: EvalExperimentRow, archived: boolean) => void
  t: LabViewProps['t']
}) {
  const { row, marked, onOpen, onRerun, onArchive, t } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (marked) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [marked])
  // A div with the button role rather than a <button>: the row carries its
  // own buttons (重跑, 归档), and a button may not contain buttons.
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      className={css.row}
      data-status={row.status}
      data-marked={marked ? 'true' : undefined}
      onClick={() => { onOpen(row.id) }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(row.id)
        }
      }}
    >
      <span className={css.colName} title={row.experimentId ?? row.name}>
        <span className={css.nameLine}>
          <span className={css.nameText}>{row.name}</span>
          {/* A run from before experiments were deployment-level that no
              imported experiment claims: said, not hidden (T73) — so the name
              takes the ellipsis and the chip never shrinks. */}
          {row.legacy && <span className={css.nameChip}><Chip tone="neutral">{t('list.legacy')}</Chip></span>}
        </span>
        {/* The question the experiment is run to answer (rev14, T74): one
            line under the name, cut with an ellipsis, whole on hover. A plan
            without one keeps the single-line row it always had. */}
        {row.question !== null && <span className={css.questionLine} title={row.question}>{row.question}</span>}
      </span>
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
      <span className={css.colActions}>
        {row.status === 'stalled' && row.experimentId !== null && !row.archived && (
          <Button size="sm" variant="primary" onClick={(event) => { event.stopPropagation(); onRerun(row) }}>
            {t('cta.stalled')}
          </Button>
        )}
        {row.runId !== null && (
          <Button size="sm" onClick={(event) => { event.stopPropagation(); onArchive(row, !row.archived) }}>
            {t(row.archived ? 'list.unarchive' : 'list.archive')}
          </Button>
        )}
      </span>
      {row.status === 'stalled' && row.stalledMinutes !== null && (
        <span className={css.rowMeta}>{t('list.stalledMeta', { duration: stalledFor(row.stalledMinutes, t) })}</span>
      )}
    </div>
  )
}

/**
 * The experiment list (T72 §1): the session filter, then four groups —
 * 需要你处理 / 运行中 / 已完成 / 已归档 — with the archive folded.
 *
 * The filter never HIDES silently: rows it leaves out are counted in the
 * header, and the count is the switch to 全部. A run the CLI started has no
 * session at all, and a list that dropped it without a word is how a person
 * decides an experiment they started from a terminal never happened.
 */
function ExperimentList(props: {
  rows: readonly EvalExperimentRow[]
  session: string | null
  scope: ListScope
  onScope: (scope: ListScope) => void
  /** The row 打开实验 asked for (T76), marked until the reader opens a row. */
  marked: string | null
  onOpen: (id: string) => void
  onRerun: (row: EvalExperimentRow) => void
  onArchive: (row: EvalExperimentRow, archived: boolean) => void
  t: LabViewProps['t']
}) {
  const { rows, session, scope, onScope, marked, onOpen, onRerun, onArchive, t } = props
  const { shown, others } = scopeRows(rows, session, scope)
  const groups = groupRows(shown)
  const line = (row: EvalExperimentRow) => (
    <ExperimentRowLine key={row.id} row={row} marked={row.id === marked} onOpen={onOpen} onRerun={onRerun} onArchive={onArchive} t={t} />
  )
  return (
    <>
      <div className={css.listScope}>
        <div className={css.segmented} role="group" aria-label={t('list.scope')}>
          {(['session', 'all'] as const).map(value => (
            <button
              key={value}
              type="button"
              className={css.chip}
              aria-pressed={scope === value}
              onClick={() => { onScope(value) }}
            >
              {t(value === 'session' ? 'list.scopeSession' : 'list.scopeAll')}
            </button>
          ))}
        </div>
        {scope === 'session' && others > 0 && (
          <button type="button" className={css.reportJump} onClick={() => { onScope('all') }}>
            {t('list.others', { count: others })}
          </button>
        )}
      </div>
      {shown.length === 0
        ? <EmptyState title={t('list.scopeEmpty')} hint={t('list.scopeEmptyHint')} />
        : (
          <div className={css.listTable}>
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
              <span className={css.colActions} />
            </div>
            {LIST_GROUPS.filter(group => group !== 'archived' && groups[group].length > 0).map(group => (
              <div key={group} className={css.listGroup} data-group={group}>
                <div className={css.listGroupHead}>
                  {t(`list.group.${group}`)}
                  <span className={css.dim}> {groups[group].length}</span>
                </div>
                {groups[group].map(line)}
              </div>
            ))}
            {groups.archived.length > 0 && (
              <Detail summary={t('list.group.archivedCount', { count: groups.archived.length })}>
                <div className={css.listGroup} data-group="archived">{groups.archived.map(line)}</div>
              </Detail>
            )}
          </div>
        )}
    </>
  )
}
