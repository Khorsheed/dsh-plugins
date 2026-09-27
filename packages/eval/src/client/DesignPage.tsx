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
  EvalPlanEstimate, EvalPlanItemFacts, EvalPlanItemsView, EvalPlanQuestion, EvalPlanReview, EvalRunOutputView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import { ConditionsTable } from './ConditionsPage.tsx'
import { ErrorState } from './ErrorState.tsx'
import { MarkdownDoc } from './MarkdownDoc.tsx'
import { RunGrid, plannedRows, type GridColumn } from './Grid.tsx'
import {
  Chip, Detail, Field, Fold, Seg, StartedRun, Word,
  listOrDash, severityKey, severityTone, snapshotCell,
} from './parts.tsx'
import { compactCount, durationParts, factorPhrase, preferredColumn } from './vocab.ts'
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
  /** Each group's readiness verdict — the table's first rows (v5 · ready). */
  ready: ReadonlyArray<{ id: string; ok: boolean; note?: string | undefined }>
  /** Whether the checklist lines are shown at all (the stage asks for a start). */
  lines: boolean
  /** A stalled run's checklist is about the NEXT run; the lead line says so. */
  forRerun: boolean
  onFix: (fix: ReadinessFix, check: EvalPlanCheck, k: number) => void
  onRecheck: () => void
  t: LabViewProps['t']
}) {
  const { blockers, reminders, ready, lines, forRerun, onFix, onRecheck, t } = props
  const said = (check: EvalPlanCheck): string => {
    const sentence = readinessSentence(check)
    return sentence === null ? check.message : t(sentence.key, sentence.params)
  }
  const fixButton = (check: EvalPlanCheck, k: number) => {
    const fix = readinessFix(check)
    const label = fixLabel(fix)
    return (
      <Button variant="outline" size="sm" className={css.smButton} onClick={() => { onFix(fix, check, k) }}>
        {fix.kind === 'agent' && <span className={css.aiMark} aria-hidden="true" />}
        {label.params === undefined ? t(label.key) : t(label.key, label.params)}
      </Button>
    )
  }
  const shownBlockers = lines ? blockers : []
  const shownReminders = lines ? reminders : []
  const anyFailed = ready.some(row => !row.ok)
  return (
    <>
      <Block
        title={t('design.checks')}
        meta={shownBlockers.length > 0 ? t('readiness.blockers', { count: shownBlockers.length }) : undefined}
      >
        {forRerun && lines && <div className={css.dim}>{t('readiness.forRerun')}</div>}
        {ready.length === 0 && shownBlockers.length === 0
          ? <div className={css.dim}>{t('ready.pending')}</div>
          : (
            <div className={css.tableScroll}>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th>{t('design.checkCol.item')}</th>
                    <th>{t('design.checkCol.state')}</th>
                    <th aria-label={t('design.checkCol.state')} />
                  </tr>
                </thead>
                <tbody>
                  {ready.map(row => (
                    <tr key={`ready:${row.id}`}>
                      <td>
                        <span className={css.checkName}>{row.id}</span>
                        {row.note !== undefined && row.note !== '' && <span className={css.readinessThen}>{row.note}</span>}
                      </td>
                      <td>
                        <Chip dot tone={row.ok ? 'ok' : 'danger'}>{t(row.ok ? 'design.checkReady' : 'design.checkNotReady')}</Chip>
                      </td>
                      <td />
                    </tr>
                  ))}
                  {shownBlockers.map((check, index) => (
                    <tr key={`block:${check.code}:${String(index)}`} className={css.readinessLine}>
                      <td title={`${check.code} · ${check.message}`}>
                        <span className={css.readinessNo}>{index + 1}</span>
                        {said(check)}
                      </td>
                      <td><Chip dot tone="danger">{t('design.checkBlocked')}</Chip></td>
                      <td>{fixButton(check, index + 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {anyFailed && (
          // One re-read for every group: the probe runs them together, so a
          // button per failing row would be several doors to the same room.
          <div className={css.tableFoot}>
            <span className={css.tableFootText}>
              {shownBlockers.length === 0 && t('ready.failedCount', { count: ready.filter(row => !row.ok).length, total: ready.length })}
            </span>
            <Button variant="outline" size="sm" className={css.smButton} onClick={onRecheck}>{t('ready.recheck')}</Button>
          </div>
        )}
      </Block>
      {shownReminders.length > 0 && (
        <Block title={t('readiness.reminders', { count: shownReminders.length })} meta={t('readiness.remindersNote')}>
          <div className={css.box}>
            {shownReminders.map((check, index) => {
              const k = shownBlockers.length + index + 1
              // A reminder says what it will cost, so 「不影响启动」 is not read
              // as 「不重要」 (T80d · P2-7).
              const then = reminderConsequenceKey(check.code)
              return (
                <div key={`remind:${check.code}:${String(index)}`} className={`${css.remindRow} ${css.readinessLine}`}>
                  <Chip tone="warn">{t('design.checkRemind')}</Chip>
                  <span className={css.remindText} title={`${check.code} · ${check.message}`}>
                    {said(check)}
                    {then !== null && <span className={css.readinessThen}>{t(then)}</span>}
                  </span>
                  {fixButton(check, k)}
                </div>
              )
            })}
          </div>
        </Block>
      )}
    </>
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
    <Block title={t('design.question')}>
      {/* T83 · v5 plan: the question in a box, its two lines as a kv grid. */}
      <div className={css.box}>
        <div className={css.boxBody}>
          {question.question !== null && <div className={css.questionTitle}>{question.question}</div>}
          {(question.expectation !== null || question.answeredWhen !== null) && (
            <dl className={css.kv}>
              {question.expectation !== null && (
                <><dt>{t('design.expectation')}</dt><dd>{question.expectation}</dd></>
              )}
              {question.answeredWhen !== null && (
                <><dt>{t('design.answeredWhen')}</dt><dd>{question.answeredWhen}</dd></>
              )}
            </dl>
          )}
        </div>
      </div>
    </Block>
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
    // T83 · E7: v5 `.sec` — a bare section, a 13px heading and its body.
    <section className={css.reportSection} aria-label={title}>
      <h5 className={css.sectionTitle}>
        <span>{title}</span>
        {meta !== undefined && meta !== null && <span className={css.sectionMeta}>{meta}</span>}
      </h5>
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
 * 用哪些题 (T80d · P2-5, T83 · phase 4): one row per item — v5's 题 / 考什么 /
 * 怎么判 / 满分 / 看题面.
 *
 * The per-item columns come from the review's `items` face (the pinned
 * dataset, read host-side). Without it — a legacy plan path, or a composition
 * with no datasets service — the table keeps the two columns the digest alone
 * can fill, rather than inventing the rest.
 */
function ItemsTable(props: {
  items: readonly string[]
  expectedNs: readonly string[]
  facts: EvalPlanItemsView | null
  t: LabViewProps['t']
}) {
  const { items, expectedNs, facts, t } = props
  const [open, setOpen] = useState<string | null>(null)
  const how = expectedNs.map(ns => (VERDICT_SOURCE[ns] === undefined ? ns : t(VERDICT_SOURCE[ns]))).join(' · ') || '—'
  if (facts === null || facts.items.length === 0) {
    return (
      <div className={css.tableScroll}>
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('design.itemsCol.item')}</th>
              <th>{t('design.itemsCol.how')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item}>
                <td className={css.itemName}>{item}</td>
                <td className={css.dim}>{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {facts !== null && facts.notes.length > 0 && <div className={css.scaleNote}>{facts.notes.join(' · ')}</div>}
      </div>
    )
  }
  return (
    <div className={css.tableScroll}>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('design.itemsCol.item')}</th>
            <th>{t('design.itemsCol.what')}</th>
            <th>{t('design.itemsCol.how')}</th>
            <th>{t('design.itemsCol.full')}</th>
            <th><span className={css.srOnly}>{t('design.itemsCol.task')}</span></th>
          </tr>
        </thead>
        <tbody>
          {facts.items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              open={open === item.id}
              onToggle={() => setOpen(open === item.id ? null : item.id)}
              t={t}
            />
          ))}
        </tbody>
      </table>
      {facts.notes.length > 0 && <div className={css.scaleNote}>{facts.notes.join(' · ')}</div>}
    </div>
  )
}

/** v5's sub line under an item id: level · stages · container. */
function itemShape(item: EvalPlanItemFacts, t: LabViewProps['t']): string {
  return [
    item.level,
    item.stages > 0 ? t('design.item.stages', { n: item.stages }) : null,
    item.container ? t('design.item.container') : null,
  ].filter((part): part is string => part !== null).join(' · ')
}

/**
 * One item's 怎么判: how many criteria, how many of them are a person's, and
 * whether a check script will run. «没有检查脚本» is the warning v5 raises —
 * but only when there are objective criteria that a script would have judged.
 */
function ItemHow(props: { item: EvalPlanItemFacts; t: LabViewProps['t'] }) {
  const { item, t } = props
  const criteria = item.criteria
  const probesWarn = item.probes === 0 && (criteria === null || criteria.objective > 0)
  const breakdown = criteria === null
    ? undefined
    : t('design.item.kinds', { objective: criteria.objective, judge: criteria.judge, human: criteria.human })
  return (
    <span title={breakdown}>
      {criteria === null
        ? <span className={css.dim}>{t('design.item.noRubric')}</span>
        : t('design.item.criteria', { n: criteria.total })}
      {criteria !== null && criteria.human > 0 && <>{' · '}{t('design.item.human', { n: criteria.human })}</>}
      {' · '}
      {item.probes > 0
        ? t('design.item.probes', { n: item.probes })
        : <span className={probesWarn ? css.warnInk : css.dim}>{t('design.item.noProbes')}</span>}
    </span>
  )
}

function ItemRow(props: { item: EvalPlanItemFacts; open: boolean; onToggle: () => void; t: LabViewProps['t'] }) {
  const { item, open, onToggle, t } = props
  const shape = itemShape(item, t)
  return (
    <>
      <tr>
        <td>
          <span className={css.itemName}>{item.id}</span>
          {shape !== '' && <span className={css.itemSub}>{shape}</span>}
        </td>
        <td>{item.title ?? <span className={css.dim}>—</span>}</td>
        <td><ItemHow item={item} t={t} /></td>
        <td className={css.num}>{item.fullScore ?? <span className={css.dim}>—</span>}</td>
        <td className={css.rowAction}>
          {item.task !== null && (
            <Button variant="ghost" size="sm" className={css.smButton} aria-expanded={open} onClick={onToggle}>
              {open ? t('design.item.taskClose') : t('design.item.task')}
            </Button>
          )}
        </td>
      </tr>
      {open && item.task !== null && (
        <tr>
          <td colSpan={5} className={css.taskCell}>
            <MarkdownDoc text={item.task} {...(item.taskPath === null ? {} : { banner: item.taskPath })} t={t} />
          </td>
        </tr>
      )}
    </>
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
    <dl className={css.kv}>
      <dt>{t('design.how.judge')}</dt>
      <dd>
        {judges.length === 0 || !on('llm-draft')
          ? <span className={css.dim}>{t('overview.judgeNone')}</span>
          : <><span>{judges.join(', ')}</span>{samples === null ? '' : ` · ${t('overview.judgeSamples', { samples })}`}</>}
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
  /** Numbers another control on the page already edits (次数 · the 1/3/5 seg). */
  skip?: ReadonlySet<keyof PlanNumbersNow> | undefined
  t: LabViewProps['t']
}) {
  const { now, frozen, onSave, skip, t } = props
  const inputs = NUMBER_INPUTS.filter(spec => skip?.has(spec.key) !== true)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'receipt' | 'failure'; text: string } | null>(null)
  const shown = (key: keyof PlanNumbersNow): string => draft[key] ?? (now[key] === null ? '' : String(now[key]))
  const dirty = inputs.some(spec => draft[spec.key] !== undefined && draft[spec.key] !== String(now[spec.key] ?? ''))

  function save(): void {
    const numbers: PlanNumbersDraft = {}
    for (const spec of inputs) {
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
    <div className={css.numbersField}>
      <div className={css.numbersRow}>
        {inputs.map(spec => (
          <label key={spec.key} className={css.numberCell}>
            <span className={css.dim}>{t(spec.label)}</span>
            {frozen || now[spec.key] === null
              ? <span>{now[spec.key] ?? '—'}</span>
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
            <Button variant="outline" size="sm" disabled={busy || !dirty} onClick={save}>{t('design.numbers.save')}</Button>
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
    </div>
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
  /** The review's estimate; null (or absent) is «无估算». */
  estimate: EvalPlanEstimate | null
  frozen: boolean
  onSetNumbers: (numbers: PlanNumbersDraft) => Promise<PlanNumbersAnswer>
  t: LabViewProps['t']
}) {
  const { row, numbers, estimate, frozen, onSetNumbers, t } = props
  const [repsBusy, setRepsBusy] = useState(false)
  const [repsNote, setRepsNote] = useState<{ kind: 'receipt' | 'failure'; text: string } | null>(null)
  // A STARTED experiment knows how many cells it really has; the product is
  // only the shape a plan implies, and a subset run (`--only` / `--max-cells`)
  // legitimately has fewer. Prefer the fact over the arithmetic.
  const cells = row.progress?.total ?? row.items * row.conditions.length * row.reps
  // v5 · plan: 每组次数 as a 1 / 3 / 5 seg while the plan is editable; a plan
  // that says some other number keeps it as one more option.
  const reps = numbers?.reps ?? null
  const repsEditable = numbers !== null && reps !== null && !frozen
  const repOptions = [...new Set([1, 3, 5, ...(reps === null ? [] : [reps])])].sort((x, y) => x - y)
  const setReps = (next: number): void => {
    setRepsBusy(true)
    setRepsNote(null)
    void onSetNumbers({ reps: next }).then((answer) => {
      setRepsBusy(false)
      if (!answer.ok) {
        setRepsNote({ kind: 'failure', text: answer.message })
        return
      }
      // The receipt quotes the server's before → after, as NumbersField does.
      const changes = answer.value.changes
      setRepsNote({
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
    <Block title={t('design.scaleCost')}>
      <div className={css.dim}>
        {t('overview.shapeValue', { items: row.items, conditions: row.conditions.length, reps: row.reps, cells })}
      </div>
      {repsNote !== null && (
        <div className={repsNote.kind === 'failure' ? css.warning : css.dim} role="status">{repsNote.text}</div>
      )}
      {/* v5 · plan: one row, label over value — 每组次数 (a 1 / 3 / 5 seg while
          the plan is editable), then the three numbers. Time and tokens are
          the same groups' past answers to the same items, scaled by 每组次数
          here so they follow the seg; with no such history they say 无估算
          rather than a guess (T83 · phase 4). */}
      <div className={css.bigNums}>
        {repsEditable && (
          <div className={css.bigNum}>
            <span>{t('design.scale.reps')}</span>
            <Seg
              label={t('design.scale.reps')}
              value={reps}
              disabled={repsBusy}
              onChange={setReps}
              options={repOptions.map(value => ({ value, label: String(value) }))}
            />
          </div>
        )}
        <div className={css.bigNum}><span>{t('design.scale.answers')}</span><b>{cells}</b></div>
        <div className={css.bigNum}>
          <span>{t('design.scale.duration')}</span>
          {estimate?.perRep.activeMs == null
            ? <b data-none="">{t('design.scale.none')}</b>
            : <b>{approxDuration(estimate.perRep.activeMs * (reps ?? row.reps), isFloor(estimate, 'activeMs'), t)}</b>}
        </div>
        <div className={css.bigNum}>
          <span>{t('design.scale.tokens')}</span>
          {estimate?.perRep.outputTokens == null
            ? <b data-none="">{t('design.scale.none')}</b>
            : (
              <b>
                {t(isFloor(estimate, 'outputTokens') ? 'design.scale.atLeast' : 'design.scale.approx', {
                  value: compactCount(Math.round(estimate.perRep.outputTokens * (reps ?? row.reps))),
                })}
              </b>
            )}
        </div>
      </div>
      <div className={css.scaleNote}>{estimate == null ? t('design.scale.noneNote') : estimateSource(estimate, t)}</div>
    </Block>
  )
}

/** A sum over only some of the plan's items is a floor: «≥», never «≈». */
function isFloor(estimate: EvalPlanEstimate, field: 'activeMs' | 'outputTokens'): boolean {
  return estimate.covered[field].length < estimate.items.length
}

/** 「≈ 10 分钟」 (or 「≥」 for a floor): whole minutes under an hour, the two-unit phrase past it. */
function approxDuration(ms: number, floor: boolean, t: LabViewProps['t']): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return t(floor ? 'design.scale.atLeastMinutes' : 'design.scale.approxMinutes', { m: minutes })
  const parts = durationParts(minutes * 60_000)
  return t(floor ? 'design.scale.atLeast' : 'design.scale.approx', { value: parts === null ? String(minutes) : t(parts.key, parts.params) })
}

/** How many past answers are listed one by one before the line only counts them. */
const SAMPLES_LISTED = 4

/**
 * v5's footnote: 「估算来自这两个对比组过去在 P0 上的 2 次作答（4 分 14 秒 /
 * 4 分 34 秒，25.1k / 31.0k）」 — which groups, which items, how many answers,
 * and the answers themselves while there are few enough to read.
 */
function estimateSource(estimate: EvalPlanEstimate, t: LabViewProps['t']): string {
  // Partial coverage names what the floor covers and what it leaves out —
  // 「只含 P0（2 次作答）；F2、F3 没有过往作答，无估算」.
  const covered = estimate.covered.activeMs.length > 0 ? estimate.covered.activeMs : estimate.covered.outputTokens
  if (covered.length < estimate.items.length) {
    const missing = estimate.items.filter(item => !covered.includes(item))
    const someAnswered = missing.some(item => estimate.samples.some(sample => sample.task === item))
    return t(someAnswered ? 'design.scale.partialSome' : 'design.scale.partial', {
      covered: covered.map(item => t('design.scale.coveredItem', {
        item, n: estimate.samples.filter(sample => sample.task === item).length,
      })).join(t('design.scale.itemJoin')),
      missing: missing.join(t('design.scale.itemJoin')),
    })
  }
  const groups = new Set(estimate.samples.map(sample => sample.condition)).size
  const tasks = [...new Set(estimate.samples.map(sample => sample.task))]
  const items = tasks.length <= 3 ? tasks.join(t('design.scale.itemJoin')) : t('design.scale.itemsCount', { n: tasks.length })
  const lead = t('design.scale.from', {
    who: groups === 1 ? t('design.scale.fromOne') : t('design.scale.fromMany', { n: groups }),
    items,
    n: estimate.samples.length,
  })
  if (estimate.samples.length > SAMPLES_LISTED) return lead
  const times = estimate.samples.map((sample) => {
    const parts = durationParts(sample.activeMs)
    return parts === null ? '—' : t(parts.key, parts.params)
  }).join(' / ')
  const tokens = estimate.samples.map(sample => (sample.outputTokens === null ? '—' : compactCount(sample.outputTokens))).join(' / ')
  return t('design.scale.fromDetail', { lead, times, tokens })
}

const REPS_ONLY: ReadonlySet<keyof PlanNumbersNow> = new Set(['reps'])

/** ③ Everything a reader needs once and then never again. Folded by default. */
function AdvancedSection(props: {
  row: EvalExperimentRow
  review: EvalPlanReview | null
  detail: EvalExperimentDetail | null
  /** The plan's editable numbers (T74), or null when the plan has none to edit. */
  numbers: PlanNumbersNow | null
  frozen: boolean
  onSetNumbers: (numbers: PlanNumbersDraft) => Promise<PlanNumbersAnswer>
  /** The 保留单元 debugging switch; null once a run started (nothing left to keep). */
  keepUnits: { on: boolean; set: (keep: boolean) => void } | null
  t: LabViewProps['t']
}) {
  const { row, review, detail, numbers, frozen, onSetNumbers, keepUnits, t } = props
  const digest = review?.digest ?? null
  const meta = detail?.meta ?? null
  return (
    <details className={css.arrange}>
      <summary className={css.arrangeSummary}>{t('design.advanced')}</summary>
      <div className={css.arrangeBody}>
        <div className={css.dim}>{t('design.advancedHint')}</div>
        {/* 每格预算 and 判官采样 (T83 · design): numbers a reviewer rarely
            touches, so they sit here; 每组次数 stays the 1 / 3 / 5 seg above
            while it can change. */}
        {numbers !== null && (
          <NumbersField
            now={numbers}
            frozen={frozen}
            onSave={onSetNumbers}
            skip={!frozen && numbers.reps !== null ? REPS_ONLY : undefined}
            t={t}
          />
        )}
        {/* The debugging switch, and it is OFF unless someone ticks it. Left
            on by default it would be T33b's shape again: every cell's
            container survives the run. The hint under it says what it costs. */}
        {keepUnits !== null && (
          <>
            <label className={css.guardedItem}>
              <input type="checkbox" checked={keepUnits.on} onChange={(e) => { keepUnits.set(e.target.checked) }} />
              <span>{t('review.keepUnits')}</span>
            </label>
            {keepUnits.on && <div className={css.notice}>{t('review.keepUnitsHint')}</div>}
          </>
        )}
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
            <Field label={t('review.items')}>{listOrDash(digest.items)}</Field>
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
            <span>{detail.job.jobId}</span>
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
    keepUnits, onKeepUnits, onRecheck, onPick, onProvision, onEditEndpoint, onSetEndpoint,
    onAddGroup, onSetNumbers, onFix, t,
  } = props
  const digest = review?.digest ?? null
  const numbers: PlanNumbersNow | null = digest === null || row.planPath === null || row.experimentId === null
    ? null
    : {
      reps: digest.reps,
      activeMinutes: digest.budget?.activeMinutes ?? null,
      turns: digest.budget?.turns ?? null,
      judgeSamples: digest.judge.samples,
    }
  // The plan a run was started from IS that run's record: past the start, the
  // numbers are text and the reason is said beside them.
  const frozen = row.runId !== null || started !== null
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
              <Button variant="outline" size="sm" onClick={onAddGroup}>{t('design.addGroup')}</Button>
              <span className={css.dim}>{t('design.addGroupHint')}</span>
            </div>
          </div>
        )}
      </Block>

      <Block title={t('design.items')} meta={<span className={css.mono}>{snapshotCell(row)}</span>}>
        {digest === null || digest.items.length === 0
          ? <div className={css.dim}>{t('new.itemsEmpty')}</div>
          : <ItemsTable items={digest.items} expectedNs={digest.expectedNs} facts={review?.items ?? null} t={t} />}
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

      <ScaleSection row={row} numbers={numbers} estimate={review?.estimate ?? null} frozen={frozen} onSetNumbers={onSetNumbers} t={t} />

      <ReadinessChecklist
        blockers={blockers}
        reminders={reminders}
        ready={readyRows}
        lines={checklistShown}
        forRerun={row.status === 'stalled'}
        onFix={onFix}
        onRecheck={onRecheck}
        t={t}
      />
      {/* The list row already carries validate's COUNTS, so the page can
          answer «can this be approved» before the review walk lands. Once it
          has landed the lines above say it better. */}
      {review === null && row.validation !== null && (
        <Field label={t('overview.validation')}>
          {row.validation.ok
            ? t('overview.validationOk')
            : t('overview.validationFailed', { errors: row.validation.errors, warnings: row.validation.warnings })}
        </Field>
      )}
      {review !== null && review.checks.length === 0 && (
        <div className={css.dim}>{t('review.checksNone')}</div>
      )}

      {digest !== null && digest.items.length > 0 && (
        <Fold title={t('design.gridFold', { cells: digest.items.length * groups.length * row.reps })}>
          <div className={css.dim}>{t('design.gridHint')}</div>
          <RunGrid
            columns={columns}
            rows={plannedRows(digest.items, groups, row.reps)}
            t={t}
          />
        </Fold>
      )}
      {/* v5 · ready: 校验原文 is the closing fold — the passing lines, which
          a clean plan never needs to read. */}
      {passing.length > 0 && (
        <Fold title={t('review.checks')} aside={passing.length}>
          {passing.map((check, index) => (
            <CheckLine key={`ok:${check.code}:${String(index)}`} check={check} t={t} />
          ))}
        </Fold>
      )}
      {/* 让 agent 改… and 批准并启动 are the stage bar's (v5 · next); the
          keep-containers switch is an advanced setting. */}
      <AdvancedSection
        row={row}
        review={review}
        detail={detail}
        numbers={numbers}
        frozen={frozen}
        onSetNumbers={onSetNumbers}
        keepUnits={frozen ? null : { on: keepUnits, set: onKeepUnits }}
        t={t}
      />

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
