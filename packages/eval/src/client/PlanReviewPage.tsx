/**
 * The detail's PLAN-REVIEW page (ui-spec §五, step 3 and step 5): what the
 * plan says, what validate makes of it line by line, and the two buttons that
 * are the human's — 批准并启动 and 退回修改.
 *
 * The page exists because approving is a decision, not a formality. Everything
 * the decision needs is on one screen: the snapshot the run will pin, the
 * matrix it will expand, the factors the conditions actually differ in, the
 * judge and its sampling, the environment, and every diagnostic — including
 * the passing ones, because "cond-a is ready, cond-b is ready" is exactly what
 * the reviewer is approving.
 *
 * Two things this page deliberately does NOT do. It does not re-validate in
 * the browser: the check list is `validatePlan`'s own output, so the page and
 * `dsh-eval validate` cannot disagree. And 退回修改 does not touch the plan
 * file — it records a note here and shows the experiment as a draft. Sending
 * a plan back is a message to its author; a button that rewrote the document
 * would make the reviewer the author.
 */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalExperimentRow, EvalPlanCheck, EvalPlanCondition, EvalPlanDigest, EvalPlanReview, EvalRunOutputView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import type { LabStartedRun } from './store.ts'
import { Field, StartedRun, factorCell, listOrDash, snapshotCell } from './parts.tsx'
import { ErrorState } from './ErrorState.tsx'
import css from './LabView.module.css'

/** The readiness word of one condition, keyed so the copy stays exhaustive. */
const STATUS_KEY: Readonly<Record<string, EvalKey>> = {
  ready: 'conditions.ready',
  unready: 'conditions.unready',
  missing: 'conditions.missing',
}

/** The lock word of one condition of the review list. */
function lockKey(lock: EvalPlanCondition['lock']): EvalKey {
  if (!lock.present) return 'review.lockNone'
  return lock.matches ? 'review.lockOk' : 'review.lockStale'
}

/** One `ok / warn / error` line of the validate list. */
function CheckLine(props: { check: EvalPlanCheck; t: LabViewProps['t'] }) {
  const { check, t } = props
  return (
    <div className={css.checkLine}>
      <span className={css.checkSeverity} data-severity={check.severity}>{t(`severity.${check.severity}`)}</span>
      <span className={css.mono}>{check.code}</span>
      <span className={css.checkMessage}>{check.message}</span>
    </div>
  )
}

/** The kv block: everything the run will be pinned to, before it is pinned. */
function PlanFields(props: { row: EvalExperimentRow; digest: EvalPlanDigest; t: LabViewProps['t'] }) {
  const { row, digest, t } = props
  const cells = row.items * row.conditions.length * row.reps
  const samples = digest.judge.samples
  return (
    <>
      <Field label={t('overview.snapshot')}>
        <span className={css.mono}>{snapshotCell(row)}</span>
        {digest.dataset.repo !== null && <span className={css.dim}> · {digest.dataset.repo}</span>}
      </Field>
      <Field label={t('overview.shape')}>
        {t('overview.shapeValue', { items: row.items, conditions: row.conditions.length, reps: row.reps, cells })}
        <div className={css.dim}>{listOrDash(digest.conditions)}</div>
      </Field>
      <Field label={t('overview.factors')}>{factorCell(row, t)}</Field>
      <Field label={t('overview.judge')}>
        {digest.judge.conditions.length === 0
          ? t('overview.judgeNone')
          : `${digest.judge.conditions.join(', ')}${samples === null ? '' : ` · ${t('overview.judgeSamples', { samples })}`}`}
      </Field>
      <Field label={t('review.items')}>
        <span className={css.mono}>{listOrDash(digest.items)}</span>
      </Field>
      <Field label={t('review.order')}>
        {digest.order.seed === null ? '—' : t('review.orderValue', { seed: digest.order.seed })}
        <span className={css.dim}> · {digest.order.interleave === false ? t('review.orderSequential') : t('review.orderInterleaved')}</span>
      </Field>
      <Field label={t('review.stages')}>{listOrDash(digest.stages)}</Field>
      <Field label={t('overview.environment')}>
        {digest.unit === null
          ? t('overview.environmentHost')
          : (
            <span className={css.mono}>
              {digest.unit.image}
              {digest.unit.network !== null && ` · network ${digest.unit.network}`}
              {digest.unit.user !== null && ` · user ${digest.unit.user}`}
            </span>
          )}
      </Field>
      <Field label={t('review.budget')}>
        {digest.budget === null
          ? '—'
          : t('review.budgetValue', { minutes: digest.budget.activeMinutes ?? '—', turns: digest.budget.turns ?? '—' })}
      </Field>
      <Field label={t('review.expectedNs')}>{listOrDash(digest.expectedNs)}</Field>
      <Field label={t('review.retry')}>
        {digest.retryInfrastructure === null ? t('review.retryDefault') : String(digest.retryInfrastructure)}
      </Field>
      <Field label={t('review.exports')}>
        <span className={css.mono}>{digest.exports ?? t('review.exportsDefault')}</span>
      </Field>
      {digest.notes !== null && <Field label={t('review.notes')}>{digest.notes}</Field>}
    </>
  )
}

/**
 * The plan-review page.
 * @param props - the row, the review payload, and the two human actions.
 */
export function PlanReviewPage(props: {
  row: EvalExperimentRow
  review: EvalPlanReview | null
  loading: boolean
  error: string | null
  sentBack: boolean
  approving: boolean
  refusal: string | null
  /** The approval call's own failure (not the gate's refusal); three-part seat. */
  approveError: string | null
  started: LabStartedRun | null
  output: EvalRunOutputView | null
  outputError: string | null
  /** Approve and start; the flag is the 保留单元 box's state. */
  onApprove: (keepUnits: boolean) => void
  onSendBack: () => void
  t: LabViewProps['t']
}) {
  const {
    row, review, loading, error, sentBack, approving, refusal, approveError, started, output, outputError, t,
  } = props
  const [keepUnits, setKeepUnits] = useState(false)
  // A run whose meta records no plan document has nothing to review; its
  // run.meta is the overview's business, and inventing a review of a file
  // nobody can name would be a page of guesses.
  if (row.planPath === null) return <div className={css.empty}>{t('review.noPlan')}</div>
  // Already started, here or in an earlier visit: the buttons are the
  // approval, and an experiment is approved once.
  const startable = row.runId === null && started === null
  return (
    <div className={css.overview}>
      {loading && review === null && <div className={css.empty}>{t('review.loading')}</div>}
      {error !== null && <ErrorState what={t('review.error')} message={error} t={t} />}
      {sentBack && <div className={css.notice}>{t('review.sentBack')}</div>}
      {review !== null && (
        <>
          {review.digest !== null && <PlanFields row={row} digest={review.digest} t={t} />}
          <Field label={t('review.planPath')}>
            <span className={css.mono}>{review.planPath}</span>
          </Field>
          <Field label={t('review.checks')}>
            {review.checks.length === 0
              ? <span className={css.dim}>{t('review.checksNone')}</span>
              : (
                <div className={css.checks}>
                  {review.checks.map((check, index) => (
                    <CheckLine key={`${check.severity}:${check.code}:${String(index)}`} check={check} t={t} />
                  ))}
                </div>
              )}
          </Field>
          {review.conditions.length > 0 && (
            <Field label={t('review.conditions')}>
              <div className={css.checks}>
                {review.conditions.map(condition => (
                  <div key={`${condition.role}:${condition.id}`} className={css.checkLine}>
                    <span className={condition.status === 'ready' ? css.ok : css.warning}>
                      {t(STATUS_KEY[condition.status] ?? 'conditions.unready')}
                    </span>
                    <span className={css.mono}>{condition.id}</span>
                    <span className={css.dim}>{condition.role}</span>
                    <span className={css.dim}>{t(lockKey(condition.lock))}</span>
                  </div>
                ))}
              </div>
            </Field>
          )}
          {startable && (
            <div className={css.actions}>
              <Button
                size="sm"
                variant="primary"
                disabled={approving || !review.ok}
                onClick={() => { props.onApprove(keepUnits) }}
              >
                {approving ? t('review.approving') : t('review.approve')}
              </Button>
              <Button size="sm" onClick={props.onSendBack}>{t('review.sendBack')}</Button>
              {/* The debugging switch, and it is OFF unless someone ticks it.
                  Left on by default it would be T33b's shape again: every
                  cell's container survives the run, and the matrix stops at
                  lab's ceiling. The hint under it says what it costs. */}
              <label className={css.guardedItem}>
                <input type="checkbox" checked={keepUnits} onChange={(e) => { setKeepUnits(e.target.checked) }} />
                <span>{t('review.keepUnits')}</span>
              </label>
            </div>
          )}
          {startable && keepUnits && <div className={css.notice}>{t('review.keepUnitsHint')}</div>}
          {startable && !review.ok && (
            <div className={css.notice}>{t('review.approveBlocked', { errors: review.errors })}</div>
          )}
        </>
      )}
      {approveError !== null && (
        <ErrorState what={t('review.approveError')} message={approveError} compact t={t} />
      )}
      {refusal !== null && (
        <Field label={t('review.refusal')}>
          <pre className={css.pre}>{refusal}</pre>
        </Field>
      )}
      {started !== null && <StartedRun started={started} output={output} outputError={outputError} t={t} />}
    </div>
  )
}
