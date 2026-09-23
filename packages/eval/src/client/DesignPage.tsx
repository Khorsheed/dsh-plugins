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

import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalConditionDiffView, EvalConditionProvisionView, EvalConditionRow, EvalConditionsView,
  EvalExperimentDetail, EvalExperimentRow, EvalPlanCheck, EvalPlanCondition, EvalPlanReview,
  EvalRunOutputView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import { ConditionsTable } from './ConditionsPage.tsx'
import { ErrorState } from './ErrorState.tsx'
import { RunGrid, plannedRows, type GridColumn } from './Grid.tsx'
import {
  Chip, Detail, EmptyState, FactorCell, Field, ReadyBadge, Section, StartedRun, Word,
  listOrDash, repoName, severityKey, severityTone, snapshotCell,
} from './parts.tsx'
import { factorPhrase, preferredColumn } from './vocab.ts'
import { fixLabel, readinessFix, readinessKey, splitReadiness, type ReadinessFix } from './journey.ts'
import type { ConditionActionNote, LabStartedRun } from './store.ts'
import css from './LabView.module.css'

/**
 * Why ONE comparison group is not ready, in words, for the badge's cross row.
 *
 * The cross used to carry a name and nothing else, and the reasons sat below
 * it inside validate's English warnings — so the page said 「5 个对比组里有 5
 * 个未就绪」 and made a reader go hunting for five separate explanations
 * (I5·T67 · W15).
 *
 * Read from the review's STRUCTURE wherever it can be: `status`, whether a
 * lock is beside the declaration, whether it still matches, whether a scoped
 * home was ever hashed. Only the unresolved endpoint has no structural field
 * to read, so that one is recovered from the check list — by the `condition
 * <id>: ` prefix validate itself writes. Nothing here parses a sentence for
 * its MEANING: the code decides the word, the message only decides which
 * group the check belongs to.
 * @param entry - the review's row for this group.
 * @param checks - validate's flat list, for the one field structure omits.
 * @returns the reasons, most specific first; empty when it IS ready.
 */
function whyNotReady(entry: EvalPlanCondition, checks: readonly EvalPlanCheck[]): EvalKey[] {
  if (entry.status === 'ready') return []
  // No file is the whole answer — the other three cannot even be asked.
  if (entry.status === 'missing') return ['why.file']
  const why: EvalKey[] = []
  const mine = checks.filter(check => check.message.includes(`condition ${entry.id}: `))
  if (mine.some(check => check.code === 'UNRESOLVED_FIELD' && check.message.includes('model.endpoint'))) {
    why.push('why.endpoint')
  }
  if (entry.lock.homeSha === null) why.push('why.homeSha')
  if (!entry.lock.present) why.push('why.lock')
  else if (!entry.lock.matches) why.push('conditions.lockStale')
  return why.length > 0 ? why : ['why.other']
}

/**
 * Every subject this experiment names, with whether it is ready and why not.
 *
 * The UNION is the fix for a badge that read 「✓ 环境就绪」 over an experiment
 * whose two players were not in the repository at all (I5·T67 · W12): the
 * readiness records only cover what the run actually PROBED, so a group that
 * never got that far was not a red cross — it was absent, and absent counted
 * as nothing rather than as a problem. Walking the plan's own subject list
 * means a group can no longer disappear out of the count.
 * @param subjects - the group ids the plan names, players then judges.
 * @param detail - the started run's readiness records, when there are any.
 * @param review - the plan review, when it has loaded.
 * @param t - the locale seat.
 * @returns one row per subject, in plan order.
 */
function readinessRows(
  subjects: readonly string[],
  detail: EvalExperimentDetail | null,
  review: EvalPlanReview | null,
  t: LabViewProps['t'],
): Array<{ id: string; ok: boolean; note?: string | undefined }> {
  const probed = new Map((detail?.readiness ?? []).map(line => [line.condition, line]))
  const reviewed = new Map((review?.conditions ?? []).map(entry => [entry.id, entry]))
  return subjects.map((id) => {
    const line = probed.get(id)
    if (line !== undefined) return { id, ok: line.ok, note: line.reason ?? undefined }
    const entry = reviewed.get(id)
    if (entry !== undefined) {
      const why = whyNotReady(entry, review?.checks ?? [])
      return { id, ok: why.length === 0, note: why.length === 0 ? undefined : why.map(key => t(key)).join(' · ') }
    }
    // Named by the plan, and neither probed nor resolved: nothing knows about
    // this group, which is a state the badge must show rather than skip.
    return { id, ok: false, note: t('conditions.missing') }
  })
}

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
 * The READINESS CHECKLIST (T72 §4): validate's lines in two groups, each with
 * a human sentence and the one button that fixes it.
 *
 * 阻塞项 are what the start would refuse; 提醒 are what to have read. The
 * sentence is the dictionary's for the code (`readiness.<CODE>`), with
 * validate's own message kept on hover beside the code, because the message
 * names the file and the field and the sentence does not. A code the
 * dictionary does not know shows the message itself.
 *
 * Numbered across both groups in display order, so 「第 k 条」 in the
 * sentence handed to the agent names the line the reader is looking at.
 */
function ReadinessChecklist(props: {
  blockers: readonly EvalPlanCheck[]
  reminders: readonly EvalPlanCheck[]
  onFix: (fix: ReadinessFix, check: EvalPlanCheck, k: number) => void
  t: LabViewProps['t']
}) {
  const { blockers, reminders, onFix, t } = props
  const line = (check: EvalPlanCheck, k: number) => {
    const fix = readinessFix(check)
    const label = fixLabel(fix)
    const key = readinessKey(check.code, check.condition ?? null)
    const sentence = key === null ? check.message : t(key, { condition: check.condition ?? '' })
    return (
      <div key={`${check.code}:${String(k)}`} className={css.readinessLine}>
        <span className={css.readinessNo}>{k}</span>
        <span className={css.checkMessage} title={`${check.code} · ${check.message}`}>{sentence}</span>
        <Button size="sm" onClick={() => { onFix(fix, check, k) }}>
          {label.params === undefined ? t(label.key) : t(label.key, label.params)}
        </Button>
      </div>
    )
  }
  return (
    <div className={css.readiness}>
      {blockers.length > 0 && (
        <div className={css.readinessGroup}>
          <div className={css.readinessHead}>
            <Chip tone="danger">{t('readiness.blockers', { count: blockers.length })}</Chip>
          </div>
          {blockers.map((check, index) => line(check, index + 1))}
        </div>
      )}
      {reminders.length > 0 && (
        <div className={css.readinessGroup}>
          <div className={css.readinessHead}>
            <Chip tone="warn">{t('readiness.reminders', { count: reminders.length })}</Chip>
          </div>
          {reminders.map((check, index) => line(check, blockers.length + index + 1))}
        </div>
      )}
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
  /** The bind dialog is the stage bar's too (登记仓库), so its state lives above. */
  binding: boolean
  onBinding: (open: boolean) => void
  /** Run one checklist line's fix; `k` is its number on screen. */
  onFix: (fix: ReadinessFix, check: EvalPlanCheck, k: number) => void
  t: LabViewProps['t']
}) {
  const {
    row, detail, review, reviewLoading, reviewError,
    conditions, conditionsLoading, conditionsError, conditionBusy, provision, conditionAction, endpointEditing,
    pair, diff, diffError, sentBack, started, output, outputError, refusal, approveError,
    keepUnits, onKeepUnits, onSendBack, onRecheck, onPick, onProvision, onEditEndpoint, onSetEndpoint,
    onAddGroup, binding, onBinding: setBinding, onFix, t,
  } = props
  const digest = review?.digest ?? null
  // The grid's columns are the PLAYERS; the table and the badge also carry the
  // judges, because a judge that cannot run stops the experiment just as a
  // player does and it is declared the same way.
  const groups = digest?.conditions ?? row.conditions
  const subjects = [...groups, ...(digest?.judge.conditions ?? row.judges)]
  // The readiness verdict, from whichever half of the payload has one: a
  // started run recorded probes, an unstarted plan only has what validate
  // resolved. Same badge either way (ui-spec §九: one component).
  const readyRows = readinessRows(subjects, detail, review, t)
  // Only the lines that need reading: a clean plan renders as no list at all
  // rather than as a wall of green, and the passing ones stay under the fold.
  // PLAN_UNREADABLE is pulled out of the list entirely — it is not a line
  // about the plan, it is the plan not being there, and rendering it as one
  // put `cannot read plan file: /Users/…` on the page (I5·T67 · W11).
  const unreadable = (review?.checks ?? []).find(check => check.code === 'PLAN_UNREADABLE') ?? null
  const { blockers, reminders } = splitReadiness(review?.checks ?? [], review?.conditions ?? [])
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
      {/* The plan document is gone — usually with the dataset working tree it
          lived in. Three-part seat, so the English sentence and the absolute
          path are evidence under the fold rather than the page (§九). */}
      {unreadable !== null && (
        <ErrorState
          what={t('error.planUnreadable')}
          message={unreadable.message}
          fix="error.planUnreadable.fix"
          path={review?.planPath}
          t={t}
        />
      )}
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
        {(blockers.length > 0 || reminders.length > 0) && (
          <ReadinessChecklist blockers={blockers} reminders={reminders} onFix={onFix} t={t} />
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
