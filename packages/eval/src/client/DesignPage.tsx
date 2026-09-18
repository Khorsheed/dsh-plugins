/**
 * 实验设计 — the first of the four stages (ui-spec §五 v2).
 *
 * It replaces three v1 sub-pages that were, between them, one definition list
 * printed twice and a table nobody could act on: 概览 and 计划审阅 showed very
 * nearly the same fields and neither had an action, and 对比组 sat somewhere
 * else entirely from the plan that used it. What a person does here is ONE
 * thing — decide whether this comparison is worth starting — so everything
 * that decision needs is on this page, in the order the decision is made:
 *
 *   ① 实验规模与对比变量 — how big it is and what it varies. Four lines.
 *   ② 对比组与就绪 — who the subjects are, whether they can run, and the
 *     planned grid, which is where the shape of the experiment becomes a
 *     picture rather than an arithmetic expression.
 *   ③ 高级设置 — folded. Seed, stages, budget, verdict sources, environment,
 *     the run.meta receipt, the readiness records and the author's note.
 *
 * Two things this page still deliberately does NOT do, both inherited from
 * the plan-review page it absorbed. It does not re-validate in the browser:
 * the check list is `validatePlan`'s own output, so this page and
 * `dsh-eval validate` cannot disagree. And 退回修改 does not touch the plan
 * file — it records a verdict here and shows the experiment as a draft, because
 * sending a plan back is a message to its author and a button that rewrote the
 * document would make the reviewer the author.
 */

import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalConditionDiffView, EvalConditionProvisionView, EvalConditionRow, EvalConditionsView,
  EvalExperimentDetail, EvalExperimentRow, EvalPlanCheck, EvalPlanReview, EvalRunOutputView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ConditionsTable } from './ConditionsPage.tsx'
import { ErrorState } from './ErrorState.tsx'
import { RunGrid, plannedRows, type GridColumn } from './Grid.tsx'
import {
  Chip, Detail, EmptyState, FactorCell, Field, ReadyBadge, Section, StartedRun, Word,
  listOrDash, repoName, severityKey, severityTone, snapshotCell,
} from './parts.tsx'
import { factorPhrase, preferredColumn } from './vocab.ts'
import type { ConditionActionNote, LabStartedRun } from './store.ts'
import css from './LabView.module.css'

/**
 * The value of the experiment's primary comparison variable for one group —
 * the subtitle ui-spec §九 puts under the column heading.
 *
 * The registry row is FLAT (it is the table's own shape) while a factor is a
 * dotted path into the declaration, so the five paths a person actually
 * designs around are mapped by hand. Anything else has no value to show and
 * the column carries its id alone, which is the honest outcome — better than
 * repeating the harness that is already spelled out in the table above.
 * @param row - the registry row, or undefined when the group is not declared.
 * @param factor - the dotted path the columns separate on, or null.
 * @returns the value to print, or null when there is none to print.
 */
function groupValue(row: EvalConditionRow | undefined, factor: string | null): string | null {
  if (row === undefined || factor === null) return null
  if (factor === 'model.declared') return row.model
  if (factor === 'model.endpoint') return row.endpoint
  if (factor === 'harness.name') return row.harness
  if (factor === 'scope') return row.scope
  if (factor === 'preset') return row.preset
  return null
}

/**
 * One `ok / warn / error` line of the validate list.
 *
 * The diagnostic CODE is the host's handle on the check, not a word — it goes
 * in the row's `title` (ui-spec §九), and the sentence beside the chip is what
 * the reviewer reads.
 */
function CheckLine(props: { check: EvalPlanCheck; t: LabViewProps['t'] }) {
  const { check, t } = props
  return (
    <div className={css.checkLine} title={check.code}>
      <Chip tone={severityTone(check.severity)}>{t(severityKey(check.severity))}</Chip>
      <span className={css.checkMessage}>{check.message}</span>
    </div>
  )
}

/**
 * Where a dataset binding comes from.
 *
 * It is NOT a form: binding is a person's act made in the 题集 tab, this tab's
 * Remote has no verb for it, and a client bundle never reaches into a sibling
 * plugin (ui-spec §八). What the page owes a reader is therefore the next step
 * in words rather than a command line (§九) — which tab, which action, and
 * what that action will ask for.
 */
function BindDialog(props: { open: boolean; onClose: () => void; t: LabViewProps['t'] }) {
  const { open, onClose, t } = props
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('design.bindTitle')}
      closeLabel={t('export.close')}
      footer={<Button size="sm" onClick={onClose}>{t('export.close')}</Button>}
    >
      <div className={css.newForm}>
        <div>{t('design.bindWhere')}</div>
        <div className={css.dim}>{t('design.bindShape')}</div>
      </div>
    </Modal>
  )
}

/** ① The scale, the variables, the dataset version and the judges. Four lines. */
function ScaleSection(props: {
  row: EvalExperimentRow
  judgeSamples: number | null
  t: LabViewProps['t']
}) {
  const { row, judgeSamples, t } = props
  // A STARTED experiment knows how many cells it really has; the product is
  // only the shape a plan implies, and a subset run (`--only` / `--max-cells`)
  // legitimately has fewer. Prefer the fact over the arithmetic.
  const cells = row.progress?.total ?? row.items * row.conditions.length * row.reps
  return (
    <Section title={t('design.scale')}>
      <Field label={t('overview.shape')}>
        {t('overview.shapeValue', { items: row.items, conditions: row.conditions.length, reps: row.reps, cells })}
        <div className={css.dim}>{row.conditions.join(', ') || '—'}</div>
      </Field>
      <Field label={t('overview.factors')}><FactorCell row={row} t={t} /></Field>
      <Field label={t('overview.snapshot')}>
        <span className={css.mono}>{snapshotCell(row)}</span>
        {row.snapshot.repo !== null && (
          <span className={css.dim} title={row.snapshot.repo}> · {repoName(row.snapshot.repo)}</span>
        )}
      </Field>
      <Field label={t('overview.judge')}>
        {row.judges.length === 0
          ? t('overview.judgeNone')
          : `${row.judges.join(', ')}${judgeSamples === null ? '' : ` · ${t('overview.judgeSamples', { samples: judgeSamples })}`}`}
      </Field>
    </Section>
  )
}

/** ③ Everything a reader needs once and then never again. Folded by default. */
function AdvancedSection(props: {
  row: EvalExperimentRow
  review: EvalPlanReview | null
  detail: EvalExperimentDetail | null
  t: LabViewProps['t']
}) {
  const { row, review, detail, t } = props
  const digest = review?.digest ?? null
  const meta = detail?.meta ?? null
  return (
    <details className={css.arrange}>
      <summary className={css.arrangeSummary}>{t('design.advanced')}</summary>
      <div className={css.arrangeBody}>
        <div className={css.dim}>{t('design.advancedHint')}</div>
        {digest !== null && (
          <>
            <Field label={t('review.order')}>
              {digest.order.seed === null ? '—' : t('review.orderValue', { seed: digest.order.seed })}
              <span className={css.dim}> · {digest.order.interleave === false ? t('review.orderSequential') : t('review.orderInterleaved')}</span>
            </Field>
            <Field label={t('review.stages')}>{listOrDash(digest.stages)}</Field>
            <Field label={t('review.budget')}>
              {digest.budget === null
                ? '—'
                : t('review.budgetValue', { minutes: digest.budget.activeMinutes ?? '—', turns: digest.budget.turns ?? '—' })}
            </Field>
            <Field label={t('design.verdictSources')}>{listOrDash(digest.expectedNs)}</Field>
            <Field label={t('review.retry')}>
              {digest.retryInfrastructure === null ? t('review.retryDefault') : String(digest.retryInfrastructure)}
            </Field>
            <Field label={t('review.items')}><span className={css.mono}>{listOrDash(digest.items)}</span></Field>
            <Field label={t('review.exports')}>
              <span className={css.mono}>{digest.exports ?? t('review.exportsDefault')}</span>
            </Field>
          </>
        )}
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
        {/* The author's note, with its line breaks kept. It was a paragraph
            smeared across the page in v1; it is an aside, and an aside belongs
            under the fold with the rest of the receipts. */}
        {digest?.notes !== null && digest?.notes !== undefined && (
          <Field label={t('design.notes')}><div className={css.notesBlock}>{digest.notes}</div></Field>
        )}
        {review !== null && (
          <Field label={t('review.planPath')}>
            {/* An absolute path is not page text (ui-spec §九); the file name
                is what a reviewer says out loud, the path is for the person
                who is about to open an editor. */}
            <span className={css.mono} title={review.planPath}>
              {review.planPath.split('/').pop() ?? review.planPath}
            </span>
            <Detail summary={t('error.details')}>
              <div className={css.errorDetailLine}>{review.planPath}</div>
            </Detail>
          </Field>
        )}
        {detail !== null && detail.readiness.length > 0 && (
          <Field label={t('overview.readiness')}>
            {/* The refusal sentence and the records verbatim: written by the
                host for whoever debugs it, and the only place a refused run's
                reason exists (the ledger never saw it). */}
            <Detail summary={t('ready.rawFold')}>
              {detail.readiness.filter(line => line.reason !== null).map(line => (
                <div key={`why:${line.condition}:${line.startedAt}`} className={css.errorDetailLine}>
                  {line.condition}: {line.reason}
                </div>
              ))}
              <pre className={css.errorRaw}>{JSON.stringify(detail.readiness, null, 2)}</pre>
            </Detail>
          </Field>
        )}
        {detail?.job != null && (
          <Field label={t('overview.job')}>
            <span className={css.mono}>{detail.job.jobId}</span>
            <span className={css.dim}> · {detail.job.status}</span>
            {detail.job.detail !== null && (
              <Detail summary={t('error.details')}>
                <pre className={css.errorRaw}>{detail.job.detail}</pre>
              </Detail>
            )}
          </Field>
        )}
        {meta !== null && (
          <Field label={t('overview.meta')}>
            {/* A JSON document is not a page (ui-spec §九). The facts a reader
                needs are the fields above; this is the receipt. */}
            <Detail summary={t('overview.metaRaw')}>
              <pre className={css.errorRaw}>{JSON.stringify(meta, null, 2)}</pre>
            </Detail>
          </Field>
        )}
      </div>
    </details>
  )
}

/**
 * The design stage.
 * @param props - the row, the two payloads behind it, the comparison-group
 *   registry and every human gesture this stage owns.
 */
export function DesignPage(props: {
  row: EvalExperimentRow
  detail: EvalExperimentDetail | null
  review: EvalPlanReview | null
  reviewLoading: boolean
  reviewError: string | null
  /** The comparison-group registry of the session's repository. */
  conditions: EvalConditionsView | null
  conditionsLoading: boolean
  conditionsError: string | null
  conditionBusy: string | null
  provision: EvalConditionProvisionView | null
  conditionAction: ConditionActionNote | null
  endpointEditing: string | null
  pair: readonly string[]
  diff: EvalConditionDiffView | null
  diffError: string | null
  sentBack: boolean
  started: LabStartedRun | null
  output: EvalRunOutputView | null
  outputError: string | null
  refusal: string | null
  approveError: string | null
  /** The 保留单元 debugging switch, kept with the rest of the advanced settings. */
  keepUnits: boolean
  onKeepUnits: (keep: boolean) => void
  onSendBack: () => void
  onRecheck: () => void
  onPick: (id: string) => void
  onProvision: (row: EvalConditionRow) => void
  onEditEndpoint: (id: string | null) => void
  onSetEndpoint: (row: EvalConditionRow, endpoint: string) => void
  onAddGroup: () => void
  t: LabViewProps['t']
}) {
  const {
    row, detail, review, reviewLoading, reviewError,
    conditions, conditionsLoading, conditionsError, conditionBusy, provision, conditionAction, endpointEditing,
    pair, diff, diffError, sentBack, started, output, outputError, refusal, approveError,
    keepUnits, onKeepUnits, onSendBack, onRecheck, onPick, onProvision, onEditEndpoint, onSetEndpoint,
    onAddGroup, t,
  } = props
  const [binding, setBinding] = useState(false)
  const digest = review?.digest ?? null
  // The grid's columns are the PLAYERS; the table and the badge also carry the
  // judges, because a judge that cannot run stops the experiment just as a
  // player does and it is declared the same way.
  const groups = digest?.conditions ?? row.conditions
  const subjects = [...groups, ...(digest?.judge.conditions ?? row.judges)]
  // The readiness verdict, from whichever half of the payload has one: a
  // started run recorded probes, an unstarted plan only has what validate
  // resolved. Same badge either way (ui-spec §九: one component).
  const readyRows = detail !== null && detail.readiness.length > 0
    ? detail.readiness.map(line => ({ id: line.condition, ok: line.ok, note: line.reason ?? undefined }))
    : (review?.conditions ?? []).map(entry => ({
      id: entry.id,
      ok: entry.status === 'ready',
      // The cross already says «not ready»; only a MISSING declaration adds
      // something the badge cannot — the group is not merely unprovisioned,
      // there is no file.
      note: entry.status === 'missing' ? t('conditions.missing') : undefined,
    }))
  // Only the lines that need reading: a clean plan renders as no list at all
  // rather than as a wall of green, and the passing ones stay under the fold.
  const failing = (review?.checks ?? []).filter(check => check.severity !== 'ok')
  const passing = (review?.checks ?? []).filter(check => check.severity === 'ok')
  const single = groups.length < 2
  const repoMissing = conditions !== null && conditions.rows.length === 0 && (conditions.repo === '' || conditions.repo === null)

  // ui-spec §九: the heading is the group, the comparison variable's value is
  // its subtitle. The variable is the one the grid would put on its columns
  // once the run starts, so the planned grid and the live one separate their
  // columns by the same thing.
  const columnFactor = preferredColumn(row.factors)
  const columns: GridColumn[] = groups.map((id) => {
    const value = groupValue(conditions?.rows.find(entry => entry.id === id), columnFactor)
    return {
      key: id,
      title: id,
      sub: value === null || columnFactor === null
        ? null
        : <><Word phrase={factorPhrase(columnFactor)} t={t} /> {value}</>,
      hint: columnFactor ?? id,
    }
  })

  return (
    <div className={css.overview}>
      {reviewLoading && review === null && <div className={css.empty}>{t('review.loading')}</div>}
      {reviewError !== null && <ErrorState what={t('review.error')} message={reviewError} t={t} />}
      {sentBack && <div className={css.notice}>{t('review.sentBack')}</div>}
      {row.planPath === null && <div className={css.notice}>{t('review.noPlan')}</div>}

      <ScaleSection row={row} judgeSamples={detail?.meta?.judge.samples ?? digest?.judge.samples ?? null} t={t} />

      <Section title={t('design.groups')}>
        <ReadyBadge rows={readyRows} onRecheck={onRecheck} t={t} />
        {/* The list row already carries validate's COUNTS, so the page can
            answer «can this be approved» before the review walk lands. Once it
            has landed the lines below say it better, and saying it twice would
            read as two different checks. */}
        {review === null && row.validation !== null && (
          <Field label={t('overview.validation')}>
            {row.validation.ok
              ? t('overview.validationOk')
              : t('overview.validationFailed', { errors: row.validation.errors, warnings: row.validation.warnings })}
          </Field>
        )}
        {failing.length > 0 && (
          <div className={css.checks}>
            {failing.map((check, index) => (
              <CheckLine key={`${check.severity}:${check.code}:${String(index)}`} check={check} t={t} />
            ))}
          </div>
        )}
        {passing.length > 0 && (
          <Detail summary={t('review.checks')}>
            {passing.map((check, index) => (
              <CheckLine key={`ok:${check.code}:${String(index)}`} check={check} t={t} />
            ))}
          </Detail>
        )}
        {review !== null && review.checks.length === 0 && (
          <div className={css.dim}>{t('review.checksNone')}</div>
        )}
        {repoMissing
          ? (
            <EmptyState title={t('design.noRepo')} hint={t('design.noRepoHint')}>
              <Button size="sm" variant="primary" onClick={() => { setBinding(true) }}>{t('design.bind')}</Button>
            </EmptyState>
          )
          : (
            <ConditionsTable
              view={conditions}
              loading={conditionsLoading}
              error={conditionsError}
              pair={pair}
              diff={diff}
              diffError={diffError}
              busy={conditionBusy}
              provision={provision}
              action={conditionAction}
              editing={endpointEditing}
              only={subjects}
              judges={digest?.judge.conditions ?? row.judges}
              onPick={onPick}
              onProvision={onProvision}
              onEditEndpoint={onEditEndpoint}
              onSetEndpoint={onSetEndpoint}
              t={t}
            />
          )}
      </Section>

      <Section title={t('design.grid')} meta={t('design.gridHint')}>
        {single && (
          <div className={css.notice}>
            <div>{t('design.single')}</div>
            <div className={css.actions}>
              <Button size="sm" onClick={onAddGroup}>{t('design.addGroup')}</Button>
              <span className={css.dim}>{t('design.addGroupHint')}</span>
            </div>
          </div>
        )}
        {digest === null || digest.items.length === 0
          ? <div className={css.dim}>{t('new.itemsEmpty')}</div>
          : (
            <RunGrid
              columns={columns}
              rows={plannedRows(digest.items, groups, row.reps)}
              t={t}
            />
          )}
      </Section>

      <AdvancedSection row={row} review={review} detail={detail} t={t} />

      {/* The reviewer's second gesture. The first — 批准并启动 — is the stage
          bar's one primary action, where ui-spec §五 v2 puts it. */}
      {row.runId === null && started === null && (
        <div className={css.actions}>
          <Button size="sm" onClick={onSendBack}>{t('review.sendBack')}</Button>
          {/* The debugging switch, and it is OFF unless someone ticks it. Left
              on by default it would be T33b's shape again: every cell's
              container survives the run. The hint under it says what it costs. */}
          <label className={css.guardedItem}>
            <input type="checkbox" checked={keepUnits} onChange={(e) => { onKeepUnits(e.target.checked) }} />
            <span>{t('review.keepUnits')}</span>
          </label>
        </div>
      )}
      {row.runId === null && started === null && keepUnits && (
        <div className={css.notice}>{t('review.keepUnitsHint')}</div>
      )}

      {approveError !== null && (
        <ErrorState what={t('review.approveError')} message={approveError} compact t={t} />
      )}
      {refusal !== null && (
        <Field label={t('review.refusal')}>
          {/* The readiness gate's own words. The run never reached `runCreate`,
              so this text is the ONLY record of why — it is quoted verbatim
              rather than summarized, and folded rather than printed (§九). */}
          <div className={css.warning}>{t('review.refusalLead')}</div>
          <Detail summary={t('review.refusalRaw')}>
            <pre className={css.errorRaw}>{refusal}</pre>
          </Detail>
        </Field>
      )}
      {started !== null && <StartedRun started={started} output={output} outputError={outputError} t={t} />}
      <BindDialog open={binding} onClose={() => { setBinding(false) }} t={t} />
    </div>
  )
}
