/**
 * Pieces the lab tab's pages share: the row-derived cells (snapshot, factors,
 * the status key), the labelled field block every page is built out of, and
 * the "what this approval started" block.
 *
 * Extracted rather than left in LabView because the plan-review page shows the
 * same snapshot / matrix / factors / judge / environment header the overview
 * does — the two pages answer different questions ABOUT THE SAME experiment,
 * and copy that drifted between them would read as a data disagreement.
 */

import type { ReactNode } from 'react'
import type { EvalExperimentRow, EvalExperimentStatus, EvalRunOutputView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { LabStartedRun } from './store.ts'
import css from './LabView.module.css'

/** The dictionary key of one status word — the union keeps the copy exhaustive. */
export function statusKey(status: EvalExperimentStatus): `status.${EvalExperimentStatus}` {
  return `status.${status}`
}

/** `2026-09-13 14:02`, in the reader's own zone; em dash for a draft. */
export function stamp(at: number | null): string {
  if (at === null) return '—'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `dataset @ abcdef1`; whichever half is missing simply does not print. */
export function snapshotCell(row: EvalExperimentRow): string {
  const { datasetId, commit } = row.snapshot
  if (datasetId === null && commit === null) return '—'
  const short = commit === null ? null : commit.slice(0, 7)
  if (datasetId === null) return short as string
  return short === null ? datasetId : `${datasetId} @ ${short}`
}

/** The factor cell: the differing paths, or why there are none. */
export function factorCell(row: EvalExperimentRow, t: LabViewProps['t']): string {
  if (row.conditions.length < 2) return t('factors.single')
  return row.factors.length === 0 ? t('factors.none') : row.factors.join(', ')
}

/** One labelled block of a page. */
export function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className={css.field}>
      <div className={css.fieldLabel}>{props.label}</div>
      <div className={css.fieldValue}>{props.children}</div>
    </div>
  )
}

/** A list value, or an em dash — never an empty line pretending to be a value. */
export function listOrDash(values: readonly string[]): string {
  return values.length === 0 ? '—' : values.join(', ')
}

/**
 * What an approval started: the ids, and the job's log VERBATIM.
 *
 * The log is not a convenience. A run the readiness gate refuses never reaches
 * `runCreate`, so the mission ledger holds nothing for it and the readiness
 * block on the overview stays empty forever — the refusal exists only in these
 * lines. Rendering them raw is the difference between "the run was refused"
 * and "the scoped home for cond-b holds no credential".
 */
export function StartedRun(props: {
  started: LabStartedRun
  output: EvalRunOutputView | null
  outputError: string | null
  t: LabViewProps['t']
}) {
  const { started, output, outputError, t } = props
  return (
    <>
      <Field label={t('review.started')}>
        <span className={css.mono}>{t('review.startedValue', { jobId: started.jobId, runId: started.runId })}</span>
        <div className={css.dim}>{t('review.parentSession')}: {started.parentSessionId}</div>
      </Field>
      <Field label={t('review.jobLog')}>
        {outputError !== null
          ? <span className={css.warning}>{t('review.jobLogError')}: {outputError}</span>
          : output === null || output.lines.length === 0
            ? <span className={css.dim}>{t('review.jobLogEmpty')}</span>
            : <pre className={css.pre}>{output.lines.join('\n')}</pre>}
      </Field>
    </>
  )
}
