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
 *   ⓪ 问题 — what the experiment is FOR (plan v1-rev14, T74): the person's
 *     question verbatim, what they expect, what counts as answered. Absent on
 *     a plan that says none of the three — no empty block, no placeholder.
 *   ① 实验规模与对比变量 — how big it is and what it varies. Four lines, and
 *     the three NUMBERS (次数, 每格预算, 判官采样) are editable in place until
 *     the experiment starts (T74); anything structural goes back to the agent.
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

import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalConditionDiffView, EvalConditionProvisionView, EvalConditionRow, EvalConditionsView,
  EvalExperimentDetail, EvalExperimentRow, EvalPlanCheck, EvalPlanCondition, EvalPlanNumbersResult,
  EvalPlanQuestion, EvalPlanReview, EvalRunOutputView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import { ConditionsTable } from './ConditionsPage.tsx'
import { ErrorState } from './ErrorState.tsx'
import { RunGrid, plannedRows, type GridColumn } from './Grid.tsx'
import {
  Chip, Detail, Field, ReadyBadge, StartedRun, Word,
  listOrDash, severityKey, severityTone, snapshotCell,
} from './parts.tsx'
import { factorPhrase, preferredColumn } from './vocab.ts'
import {
  fixLabel, readinessFix, readinessSentence, reminderConsequenceKey, splitReadiness, type ReadinessFix,
} from './journey.ts'
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

/** The stages whose next step is starting this plan (again). */
const CHECKLIST_STAGES: ReadonlySet<EvalExperimentRow['status']> = new Set(['draft', 'pending-approval', 'refused', 'stalled'])

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
  /** A stalled run's checklist is about the NEXT run; the lead line says so. */
  forRerun: boolean
  onFix: (fix: ReadinessFix, check: EvalPlanCheck, k: number) => void
  t: LabViewProps['t']
}) {
  const { blockers, reminders, forRerun, onFix, t } = props
  const line = (check: EvalPlanCheck, k: number) => {
    const fix = readinessFix(check)
    const label = fixLabel(fix)
    const said = readinessSentence(check)
    const sentence = said === null ? check.message : t(said.key, said.params)
    // A reminder says what it will cost, so 「不影响启动」 is not read as
    // 「不重要」 (T80d · P2-7). Blockers need no such line: they stop the start.
    const then = k > blockers.length ? reminderConsequenceKey(check.code) : null
    return (
      <div key={`${check.code}:${String(k)}`} className={css.readinessLine}>
        <span className={css.readinessNo}>{k}</span>
        <span className={css.checkMessage} title={`${check.code} · ${check.message}`}>
          {sentence}
          {then !== null && <span className={css.readinessThen}>{t(then)}</span>}
        </span>
        <Button size="sm" onClick={() => { onFix(fix, check, k) }}>
          {label.params === undefined ? t(label.key) : t(label.key, label.params)}
        </Button>
      </div>
    )
  }
  return (
    <div className={css.readiness}>
      {forRerun && <div className={css.dim}>{t('readiness.forRerun')}</div>}
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
            <span className={css.dim}>{t('readiness.remindersNote')}</span>
          </div>
          {reminders.map((check, index) => line(check, blockers.length + index + 1))}
        </div>
      )}
    </div>
  )
}

/**
 * ⓪ The question block (plan v1-rev14). Rendered only when the plan has one.
 *
 * The one raised card on the page (T80d · P1-4): the question IS the title,
 * and what the person expects and what counts as answered sit under it as two
 * labelled lines — it is what the result page answers, so it reads as the
 * heading of the whole experiment rather than as one more field list.
 */
function QuestionSection(props: { question: EvalPlanQuestion; t: LabViewProps['t'] }) {
  const { question, t } = props
  return (
    <section className={css.questionCard} aria-label={t('design.question')}>
      <div className={css.questionEyebrow}>{t('design.question')}</div>
      {question.question !== null && <div className={css.questionTitle}>{question.question}</div>}
      {(question.expectation !== null || question.answeredWhen !== null) && (
        <dl className={css.questionRows}>
          {question.expectation !== null && (
            <><dt>{t('design.expectation')}</dt><dd>{question.expectation}</dd></>
          )}
          {question.answeredWhen !== null && (
            <><dt>{t('design.answeredWhen')}</dt><dd>{question.answeredWhen}</dd></>
          )}
        </dl>
      )}
    </section>
  )
}

/**
 * One flat block of the design page (T80d · P1-4): a title line and its body,
 * no card. Only the question and the stage bar are raised; the rest reads as
 * one document, in the order the decision is made.
 */
function Block(props: { title: string; meta?: ReactNode; children: ReactNode }) {
  const { title, meta, children } = props
  return (
    <section className={css.designBlock} aria-label={title}>
      <div className={css.designBlockHead}>
        <span className={css.designBlockTitle}>{title}</span>
        {meta !== undefined && meta !== null && <span className={css.dim}>{meta}</span>}
      </div>
      {children}
    </section>
  )
}

/** The words for one verdict layer a plan expects. */
const VERDICT_SOURCE: Readonly<Record<string, EvalKey>> = {
  'script': 'source.script',
  'llm-draft': 'source.llm',
  'human-final': 'source.human',
}

/**
 * 用哪些题 (T80d · P2-5): one row per item, and how it is judged.
 *
 * The plan review carries the item ids and the verdict sources it expects —
 * nothing per item about what an item tests, its full score or a link to its
 * text. Those columns are absent rather than invented; they need a data face
 * of their own (the T80d report lists them).
 */
function ItemsTable(props: { items: readonly string[]; expectedNs: readonly string[]; t: LabViewProps['t'] }) {
  const { items, expectedNs, t } = props
  const how = expectedNs.map(ns => (VERDICT_SOURCE[ns] === undefined ? ns : t(VERDICT_SOURCE[ns]))).join(' · ') || '—'
  return (
    <div className={css.itemsTable}>
      <div className={css.itemsHead}>
        <span>{t('design.itemsCol.item')}</span>
        <span>{t('design.itemsCol.how')}</span>
      </div>
      {items.map(item => (
        <div key={item} className={css.itemsRow}>
          <span className={css.mono}>{item}</span>
          <span className={css.dim}>{how}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * 怎么判 (T80d · P2-5): the three verdict layers written out — who judges and
 * how often, whether a person gives the final verdict, whether check scripts
 * run. A layer the plan does not expect says so rather than disappearing.
 */
function HowJudged(props: {
  judges: readonly string[]
  samples: number | null
  /** null — the plan was not read: only the judges are known. */
  expectedNs: readonly string[] | null
  t: LabViewProps['t']
}) {
  const { judges, samples, expectedNs, t } = props
  const on = (ns: string) => expectedNs === null || expectedNs.includes(ns)
  return (
    <dl className={css.howRows}>
      <dt>{t('design.how.judge')}</dt>
      <dd>
        {judges.length === 0 || !on('llm-draft')
          ? <span className={css.dim}>{t('overview.judgeNone')}</span>
          : <><span className={css.mono}>{judges.join(', ')}</span>{samples === null ? '' : ` · ${t('overview.judgeSamples', { samples })}`}</>}
      </dd>
      {expectedNs !== null && <>
        <dt>{t('design.how.human')}</dt>
        <dd>{on('human-final') ? t('design.how.humanOn') : <span className={css.dim}>{t('design.how.off')}</span>}</dd>
        <dt>{t('design.how.script')}</dt>
        <dd>{on('script') ? t('design.how.scriptOn') : <span className={css.dim}>{t('design.how.off')}</span>}</dd>
      </>}
    </dl>
  )
}

/** The numbers the design page may change, as the person typed them. */
export interface PlanNumbersDraft {
  reps?: number
  activeMinutes?: number
  turns?: number
  judgeSamples?: number
}

/** What one save answered: the server's receipt, or why not. */
export type PlanNumbersAnswer = { ok: true; value: EvalPlanNumbersResult } | { ok: false; message: string }

/** The four numbers as the plan holds them now. */
interface PlanNumbersNow {
  reps: number | null
  activeMinutes: number | null
  turns: number | null
  judgeSamples: number | null
}

const NUMBER_INPUTS: ReadonlyArray<{ key: keyof PlanNumbersNow; label: EvalKey; step: string; min: number }> = [
  { key: 'reps', label: 'design.numbers.reps', step: '1', min: 1 },
  { key: 'activeMinutes', label: 'design.numbers.activeMinutes', step: 'any', min: 0 },
  { key: 'turns', label: 'design.numbers.turns', step: '1', min: 1 },
  { key: 'judgeSamples', label: 'design.numbers.judgeSamples', step: '1', min: 0 },
]

/**
 * The in-place numbers (T74): 次数, 每格预算 (minutes / turns) and 判官采样.
 *
 * Editable only while nothing has started — the plan a run was started from is
 * the record of that run, so once one exists the inputs turn into text and the
 * reason is said beside them. A field the plan does not declare (no budget, no
 * judge) is text too: adding one is a structural edit, which is the agent's.
 * The receipt quotes the server's before → after, which it wrote only after
 * reading the file back — the page does not claim a change it did not see.
 */
function NumbersField(props: {
  now: PlanNumbersNow
  frozen: boolean
  onSave: (numbers: PlanNumbersDraft) => Promise<PlanNumbersAnswer>
  t: LabViewProps['t']
}) {
  const { now, frozen, onSave, t } = props
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'receipt' | 'failure'; text: string } | null>(null)
  const shown = (key: keyof PlanNumbersNow): string => draft[key] ?? (now[key] === null ? '' : String(now[key]))
  const dirty = NUMBER_INPUTS.some(spec => draft[spec.key] !== undefined && draft[spec.key] !== String(now[spec.key] ?? ''))

  function save(): void {
    const numbers: PlanNumbersDraft = {}
    for (const spec of NUMBER_INPUTS) {
      const text = draft[spec.key]
      if (text === undefined || now[spec.key] === null) continue
      const value = Number(text)
      if (text.trim() === '' || !Number.isFinite(value)) {
        setNote({ kind: 'failure', text: t('design.numbers.invalid', { field: t(spec.label) }) })
        return
      }
      numbers[spec.key] = value
    }
    setBusy(true)
    setNote(null)
    void onSave(numbers).then((answer) => {
      setBusy(false)
      if (!answer.ok) {
        setNote({ kind: 'failure', text: answer.message })
        return
      }
      setDraft({})
      const changes = answer.value.changes
      setNote({
        kind: 'receipt',
        text: changes.length === 0
          ? t('design.numbers.unchanged')
          : t('design.numbers.written', {
            changes: changes.map(change => `${t(labelOf(change.field))} ${change.before} → ${change.after}`).join(' · '),
          }),
      })
    })
  }

  return (
    <Field label={t('design.numbers')}>
      <div className={css.numbersRow}>
        {NUMBER_INPUTS.map(spec => (
          <label key={spec.key} className={css.numberCell}>
            <span className={css.dim}>{t(spec.label)}</span>
            {frozen || now[spec.key] === null
              ? <span className={css.mono}>{now[spec.key] ?? '—'}</span>
              : (
                <input
                  className={css.numberInput}
                  type="number"
                  inputMode="decimal"
                  step={spec.step}
                  min={spec.min}
                  value={shown(spec.key)}
                  disabled={busy}
                  aria-label={t(spec.label)}
                  onChange={(event) => { setDraft({ ...draft, [spec.key]: event.target.value }) }}
                  onKeyDown={(event) => { if (event.key === 'Enter' && dirty) save() }}
                />
              )}
          </label>
        ))}
        {!frozen && (
          <span className={css.numbersActions}>
            <Button size="sm" disabled={busy || !dirty} onClick={save}>{t('design.numbers.save')}</Button>
            {dirty && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft({}); setNote(null) }}>
                {t('design.numbers.cancel')}
              </Button>
            )}
          </span>
        )}
      </div>
      <div className={css.dim}>{frozen ? t('design.numbers.frozen') : t('design.numbers.hint')}</div>
      {note !== null && (
        <div className={note.kind === 'failure' ? css.warning : css.dim} role="status">{note.text}</div>
      )}
    </Field>
  )
}

function labelOf(field: EvalPlanNumbersResult['changes'][number]['field']): EvalKey {
  switch (field) {
    case 'reps': return 'design.numbers.reps'
    case 'budget.activeMinutes': return 'design.numbers.activeMinutes'
    case 'budget.turns': return 'design.numbers.turns'
    case 'judge.samples': return 'design.numbers.judgeSamples'
  }
}

/**
 * 规模与花费: the shape in one sentence, plus the editable numbers. What it
 * varies is the compare table's; the dataset version heads 用哪些题; the
 * judges are 怎么判's (T80d · P1-4).
 */
function ScaleSection(props: {
  row: EvalExperimentRow
  numbers: PlanNumbersNow | null
  frozen: boolean
  onSetNumbers: (numbers: PlanNumbersDraft) => Promise<PlanNumbersAnswer>
  t: LabViewProps['t']
}) {
  const { row, numbers, frozen, onSetNumbers, t } = props
  // A STARTED experiment knows how many cells it really has; the product is
  // only the shape a plan implies, and a subset run (`--only` / `--max-cells`)
  // legitimately has fewer. Prefer the fact over the arithmetic.
  const cells = row.progress?.total ?? row.items * row.conditions.length * row.reps
  return (
    <Block title={t('design.scaleCost')}>
      <div>
        {t('overview.shapeValue', { items: row.items, conditions: row.conditions.length, reps: row.reps, cells })}
      </div>
      {numbers !== null && <NumbersField now={numbers} frozen={frozen} onSave={onSetNumbers} t={t} />}
    </Block>
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
  /** Write the plan's numbers in place (T74); refused server-side once started. */
  onSetNumbers: (numbers: PlanNumbersDraft) => Promise<PlanNumbersAnswer>
  /** Run one checklist line's fix; `k` is its number on screen. */
  onFix: (fix: ReadinessFix, check: EvalPlanCheck, k: number) => void
  t: LabViewProps['t']
}) {
  const {
    row, detail, review, reviewLoading, reviewError,
    conditions, conditionsLoading, conditionsError, conditionBusy, provision, conditionAction, endpointEditing,
    pair, diff, diffError, sentBack, started, output, outputError, refusal, approveError,
    keepUnits, onKeepUnits, onSendBack, onRecheck, onPick, onProvision, onEditEndpoint, onSetEndpoint,
    onAddGroup, onSetNumbers, onFix, t,
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
  // The checklist is for a plan someone is about to start — or start again.
  // Past that, the plan as it stands NOW says nothing about the run that
  // already went, and beside the run's own ✓ it read as a contradiction.
  const checklistShown = CHECKLIST_STAGES.has(row.status)
  const passing = (review?.checks ?? []).filter(check => check.severity === 'ok')
  const single = groups.length < 2
  // The sha each subject had when the run started: a declaration edited since
  // carries 「开跑时 / 当前」 in the compare table (T80d · ②).
  const startedShas: Record<string, string | null> = {}
  for (const entry of [...(detail?.meta?.conditions ?? []), ...(detail?.meta?.judge.conditions ?? [])]) {
    startedShas[entry.id] = entry.sha
  }

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

      {digest?.question != null && <QuestionSection question={digest.question} t={t} />}

      <Block title={t('design.compare')} meta={t('design.compareHint')}>
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
          factors={row.factors}
          startedShas={startedShas}
          onPick={onPick}
          onProvision={onProvision}
          onEditEndpoint={onEditEndpoint}
          onSetEndpoint={onSetEndpoint}
          t={t}
        />
        {single && (
          <div className={css.notice}>
            <div>{t('design.single')}</div>
            <div className={css.actions}>
              <Button size="sm" onClick={onAddGroup}>{t('design.addGroup')}</Button>
              <span className={css.dim}>{t('design.addGroupHint')}</span>
            </div>
          </div>
        )}
      </Block>

      <Block title={t('design.items')} meta={<span className={css.mono}>{snapshotCell(row)}</span>}>
        {digest === null || digest.items.length === 0
          ? <div className={css.dim}>{t('new.itemsEmpty')}</div>
          : <ItemsTable items={digest.items} expectedNs={digest.expectedNs} t={t} />}
      </Block>

      {/* No plan review yet: the row still names its judges, and that is
          the one line of 怎么判 worth showing without the plan. */}
      <Block title={t('design.how')}>
        <HowJudged
          judges={digest?.judge.conditions ?? row.judges}
          samples={detail?.meta?.judge.samples ?? digest?.judge.samples ?? null}
          expectedNs={digest?.expectedNs ?? null}
          t={t}
        />
      </Block>

      <ScaleSection
        row={row}
        numbers={digest === null || row.planPath === null || row.experimentId === null
          ? null
          : {
            reps: digest.reps,
            activeMinutes: digest.budget?.activeMinutes ?? null,
            turns: digest.budget?.turns ?? null,
            judgeSamples: digest.judge.samples,
          }}
        // The plan a run was started from IS that run's record: past the
        // start, the numbers are text and the reason is said beside them.
        frozen={row.runId !== null || started !== null}
        onSetNumbers={onSetNumbers}
        t={t}
      />

      <Block title={t('design.ready')}>
        <ReadyBadge rows={readyRows} onRecheck={onRecheck} atStart={row.status === 'stalled'} t={t} />
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
        {checklistShown && (blockers.length > 0 || reminders.length > 0) && (
          <ReadinessChecklist
            blockers={blockers}
            reminders={reminders}
            forRerun={row.status === 'stalled'}
            onFix={onFix}
            t={t}
          />
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
      </Block>

      {digest !== null && digest.items.length > 0 && (
        <Detail summary={t('design.gridFold', { cells: digest.items.length * groups.length * row.reps })}>
          <div className={css.dim}>{t('design.gridHint')}</div>
          <RunGrid
            columns={columns}
            rows={plannedRows(digest.items, groups, row.reps)}
            t={t}
          />
        </Detail>
      )}

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
    </div>
  )
}
