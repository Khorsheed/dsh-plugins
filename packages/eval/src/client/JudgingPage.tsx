/**
 * 人工评估 (ui-spec §五 v2, step 8): the items on the left, and the answers to
 * ONE item side by side on the right — de-fingerprinted, numbered in the run's
 * own seeded order, each with its own criteria form and its own button.
 *
 * Side by side because a grader reading four answers to the same question
 * applies one standard to all four, and reading them one page at a time is
 * exactly how a standard drifts between the first answer and the last. v1
 * made a person click 「格子 1」, 「格子 2」 in turn and hold the last one in
 * their head.
 *
 * It is NOT a choice between the answers. The verdict contract is unchanged —
 * one score per cell, written against that cell's own criteria — so every
 * column carries a full form and records on its own. Putting them beside each
 * other changes what a grader can SEE, not what the ledger receives.
 *
 * BLIND is the page's whole shape, and it is enforced one layer down: the
 * payload this file renders contains no condition id, no harness, no model
 * and no mission id, so there is nothing here that careless markup could
 * leak. What arrives is an ordinal, an opaque ticket, and the item being
 * answered. Cells are numbered in the run's own seeded order, which is itself
 * part of the blind — consecutive numbers say nothing about which cells share
 * a condition. The report page is where the same run is read with its labels
 * on, and that is the right place for it: unblinding after the verdict is
 * recorded cannot change the verdict.
 *
 * The write is a person's and the page says so. `human-final` is APPEND-ONLY
 * — a cell that already carries one shows what it carries and warns that
 * recording again appends rather than replaces — and every verdict needs
 * evidence before the button will send it, because the protocol asks for a
 * checkable fact and a blank box is how a grader's reasoning gets lost.
 */

import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalClosure, EvalClosureExit, EvalJudgeCriterionRow, EvalJudgeDraftSample, EvalJudgeQueueCell, EvalJudgeQueueView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { Chip, EmptyState, Section } from './parts.tsx'
import css from './LabView.module.css'

const DASH = '—'

/** `12/14`, or a dash when the run produced no such pair at all. */
function fmtAgreement(value: { agreed: number; total: number } | null): string {
  return value === null ? DASH : `${value.agreed}/${value.total}`
}

function fmtKappa(value: number | null): string {
  return value === null || Number.isNaN(value) ? DASH : value.toFixed(3)
}

/** The run's agreement numbers, computed off the LIVE ledger. */
function Stats(props: { view: EvalJudgeQueueView; t: LabViewProps['t'] }) {
  const { view, t } = props
  const c = view.consistency
  return (
    <Section title={t('judge.stats')}>
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('judge.statsSame')}</span>
        <span>{t('report.judgeSameValue', {
          criteria: c.multiSampled, agreement: fmtAgreement(c.llmAgreement), kappa: fmtKappa(c.llmKappa),
        })}</span>
      </div>
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('judge.statsCross')}</span>
        <span>{t('report.judgeCrossValue', {
          criteria: c.crossJudged, agreement: fmtAgreement(c.crossAgreement), kappa: fmtKappa(c.crossKappa),
        })}</span>
      </div>
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('judge.statsHuman')}</span>
        <span>{fmtAgreement(c.humanAgreement)}</span>
      </div>
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('judge.statsSelf')}</span>
        <Chip tone={c.selfJudgedCriteria > 0 ? 'warn' : 'neutral'}>{c.selfJudgedCriteria}</Chip>
      </div>
      <div className={css.dim}>{t('judge.panel', { count: view.judgeCount })}</div>
    </Section>
  )
}

/** One item in the queue: how many answers it has, and how many are graded. */
interface QueueItem {
  task: string
  cells: EvalJudgeQueueCell[]
  graded: number
}

/**
 * Group the blind queue by item, keeping the run's seeded order inside each.
 *
 * The order is part of the blind — consecutive numbers say nothing about
 * which cells share a comparison group — so grouping never sorts the cells,
 * only gathers them.
 * @param cells - the queue, in the run's own order.
 * @returns one entry per item, in first-appearance order.
 */
export function byItem(cells: readonly EvalJudgeQueueCell[]): QueueItem[] {
  const items: QueueItem[] = []
  for (const cell of cells) {
    const task = cell.task ?? DASH
    let entry = items.find(candidate => candidate.task === task)
    if (entry === undefined) {
      entry = { task, cells: [], graded: 0 }
      items.push(entry)
    }
    entry.cells.push(cell)
    if (cell.graded) entry.graded += 1
  }
  return items
}

/** Every llm-draft value on record for one criterion, by blind panel label. */
function Drafts(props: { drafts: readonly EvalJudgeDraftSample[]; t: LabViewProps['t'] }) {
  const { drafts, t } = props
  if (drafts.length === 0) return <span className={css.dim}>{t('judge.draftsNone')}</span>
  return (
    <>
      {drafts.map((draft, index) => (
        <span key={`${draft.judge}:${draft.sample ?? index}`} className={css.judgeTag}>
          <span className={css.mono}>{draft.judge}</span>
          {draft.sample !== null && <span className={css.dim}> #{draft.sample}</span>}
          {' '}
          <Chip tone={draft.pass ? 'ok' : 'warn'}>{draft.pass ? t('judge.pass') : t('judge.fail')}</Chip>
          {/* 决策 9 lets a judge be a player; the bench discloses it per
              sample rather than hiding the sample or dropping it. */}
          {draft.selfJudged && <Chip tone="warn">{t('judge.selfJudged')}</Chip>}
          {draft.evidence !== null && <div className={css.dim}>{draft.evidence}</div>}
        </span>
      ))}
    </>
  )
}

/** One criterion: what the rubric asks, what the judges said, what the person says. */
function CriterionRow(props: {
  /** Which answer this row belongs to — several are on screen at once. */
  no: number
  criterion: EvalJudgeCriterionRow
  drafts: readonly EvalJudgeDraftSample[]
  recorded: { pass: boolean; evidence: string | null } | undefined
  answer: { pass: boolean; evidence: string } | undefined
  onAnswer: (value: { pass: boolean; evidence: string }) => void
  t: LabViewProps['t']
}) {
  const { no, criterion, drafts, recorded, answer, onAnswer, t } = props
  const evidence = answer?.evidence ?? ''
  return (
    <div className={css.criterionRow}>
      <div className={css.criterionHead}>
        <span className={css.mono}>{criterion.id}</span>
        {/* Polarity is the RUBRIC's property, never the grader's reading of
            it: `pass` always means the criterion HOLDS, and for a negative
            criterion holding means the defect is present. Saying so on the
            row is what keeps a grader from inverting the answer. */}
        {criterion.negative && <Chip tone="warn">{t('judge.negative')}</Chip>}
        {criterion.veto && <Chip tone="danger">{t('judge.veto')}</Chip>}
        {criterion.weight !== null && (
          <span className={css.dim}>{t('judge.weight', { weight: criterion.weight })}</span>
        )}
      </div>
      <div>{criterion.criterion}</div>
      {criterion.evidence !== null && (
        <div className={css.dim}>{t('judge.criterionEvidence', { evidence: criterion.evidence })}</div>
      )}
      {criterion.note !== null && <div className={css.dim}>{criterion.note}</div>}

      <div className={css.criterionDrafts}>
        <span className={css.summaryLabel}>{t('judge.drafts')}</span>
        <Drafts drafts={drafts} t={t} />
      </div>

      {recorded !== undefined && (
        <div className={css.criterionDrafts}>
          <span className={css.summaryLabel}>{t('judge.humanFinal')}</span>
          <Chip tone={recorded.pass ? 'ok' : 'warn'}>{recorded.pass ? t('judge.pass') : t('judge.fail')}</Chip>
          {recorded.evidence !== null && <span className={css.dim}>{recorded.evidence}</span>}
        </div>
      )}

      <div className={css.criterionAnswer}>
        <Button
          size="sm"
          {...(answer?.pass === true ? { variant: 'primary' as const } : {})}
          onClick={() => { onAnswer({ pass: true, evidence }) }}
        >
          {t('judge.pass')}
        </Button>
        <Button
          size="sm"
          {...(answer?.pass === false ? { variant: 'primary' as const } : {})}
          onClick={() => { onAnswer({ pass: false, evidence }) }}
        >
          {t('judge.fail')}
        </Button>
        <Input
          value={evidence}
          onChange={(event) => { onAnswer({ pass: answer?.pass ?? true, evidence: event.target.value }) }}
          placeholder={t('judge.evidencePlaceholder')}
          // The answer's own number is in the label: side by side, four boxes
          // named 「证据 H1」 are four boxes a screen reader cannot tell apart.
          aria-label={`${t('judge.column', { no })} ${t('judge.evidence')} ${criterion.id}`}
        />
        {answer === undefined && <span className={css.dim}>{t('judge.unanswered')}</span>}
      </div>
    </div>
  )
}

/**
 * One answer's column: the material, the criteria, and its own button.
 * @param props - the blind cell, this column's draft answers, and the write.
 */
function AnswerColumn(props: {
  cell: EvalJudgeQueueCell
  draft: Record<string, { pass: boolean; evidence: string }>
  /**
   * Whether ANY column's submission is in flight. Shared on purpose: a write
   * lands and the queue is re-read, so every column beside it is about to be
   * replaced — letting a second one send against the material it is holding
   * would record a verdict about a version of the page that is already gone.
   */
  submitting: boolean
  onAnswer: (criterion: string, value: { pass: boolean; evidence: string }) => void
  onSubmit: () => void
  t: LabViewProps['t']
}) {
  const { cell, draft, submitting, onAnswer, onSubmit, t } = props
  const recordedByCriterion = new Map<string, { pass: boolean; evidence: string | null }>()
  for (const verdict of cell.humanFinal) {
    // Append-only means a criterion can carry several; the latest is the one
    // the report reads, so it is the one shown beside the input.
    recordedByCriterion.set(verdict.criterion, { pass: verdict.pass, evidence: verdict.evidence })
  }
  // Only answers with evidence are sendable — the host refuses a blank one,
  // and a button that could produce that refusal is a worse button.
  const answers = Object.entries(draft).filter(([, value]) => value.evidence.trim() !== '')
  return (
    <div className={css.answerColumn}>
      <div className={css.sectionTitle}>
        <span>{t('judge.column', { no: cell.cellNo })}</span>
        <span className={css.sectionMeta}>rep {cell.rep ?? DASH}</span>
      </div>
      {cell.graded && <div className={css.notice}>{t('judge.regrade')}</div>}
      {/* What a verdict here DOES, said before the button. Until T54 it was a
          warning with a real cost behind it: the report scored a cell from one
          namespace, so a single human answer dropped every llm-draft-only
          criterion from the score. Since the per-criterion merge it is the
          opposite fact — those criteria keep counting on the judge's word —
          and a grader still has to know, because the record's score stops
          having a single author the moment this is sent. */}
      {cell.draftOnlyCriteria.length > 0 && (
        <div className={css.notice}>
          {t('judge.scoringMix', {
            count: cell.draftOnlyCriteria.length,
            criteria: cell.draftOnlyCriteria.join(', '),
          })}
        </div>
      )}

      {/* The material is what a verdict RESTS on, and it is thousands of lines
          of stage json and markdown. Above the criteria it pushed the scoring
          boxes so far down that two columns never showed their forms at the
          same scroll position — which is the one thing side by side exists to
          give (I5·T67 · W9). Folded, the header still carries the file and how
          many fingerprints were scrubbed, so a grader can see the redaction
          ran without opening anything. */}
      {cell.materials.length === 0
        ? <div className={css.dim}>{t('judge.materialNone')}</div>
        : cell.materials.map(material => (
          <details key={material.path} className={css.errorDetails}>
            <summary className={css.errorSummary}>
              <span className={css.mono}>{material.path}</span>
              <span className={css.dim}> {t('judge.scrubbed', { count: material.replacements })}</span>
            </summary>
            {/* The stage file VERBATIM, after scrubbing: a summary would
                hide exactly what a verdict has to rest on. */}
            <pre className={css.pre}>{material.text}</pre>
          </details>
        ))}

      {cell.criteria.length === 0
        ? <div className={css.dim}>{t('judge.criteriaNone', { reason: cell.criteriaNote ?? DASH })}</div>
        : cell.criteria.map(criterion => (
          <CriterionRow
            key={criterion.id}
            no={cell.cellNo}
            criterion={criterion}
            drafts={cell.drafts.filter(sample => sample.criterion === criterion.id)}
            recorded={recordedByCriterion.get(criterion.id)}
            answer={draft[criterion.id]}
            onAnswer={(value) => { onAnswer(criterion.id, value) }}
            t={t}
          />
        ))}
      {cell.criteria.length > 0 && (
        <div className={css.actions}>
          <Button
            size="sm"
            variant="primary"
            disabled={submitting || answers.length === 0}
            onClick={onSubmit}
          >
            {submitting ? t('judge.submitting') : t('judge.submitOne', { no: cell.cellNo, count: answers.length })}
          </Button>
          {answers.length === 0 && <span className={css.dim}>{t('judge.submitBlocked')}</span>}
        </div>
      )}
    </div>
  )
}

/** The four exits in the order the page lists them (T72 §5). */
const EXITS: readonly EvalClosureExit[] = ['final', 'flagged', 'unreviewed', 'void']
/** The two exits whose whole point is the sentence that explains them. */
const NEEDS_REASON: ReadonlySet<EvalClosureExit> = new Set(['flagged', 'void'])

/**
 * The FOUR EXITS at the foot of the bench (T72 §5). Human review ends one of
 * four ways, and until one is taken the experiment stays 评估中 — «the judge
 * is done» is not «a person has said what the result is».
 *
 * ① 提交终评 needs at least one final verdict on record: an exit that says
 * «a human reviewed this» over zero human verdicts would be the one false
 * sentence this page could write. ② and ④ open a reason box, and the server
 * refuses them without one as well. Once ④ is in force the exits are gone:
 * the server refuses anything after it, and the page says why instead of
 * offering buttons that can only fail.
 */
function ClosureExits(props: {
  closure: EvalClosure | null
  anyGraded: boolean
  closing: boolean
  onClose: (exit: EvalClosureExit, reason: string) => void
  t: LabViewProps['t']
}) {
  const { closure, anyGraded, closing, onClose, t } = props
  const [asking, setAsking] = useState<'flagged' | 'void' | null>(null)
  const [reason, setReason] = useState('')
  if (closure?.exit === 'void') {
    return (
      <Section title={t('closure.title')}>
        <div className={css.blocked}>{t('closure.voided', { reason: closure.reason ?? DASH })}</div>
      </Section>
    )
  }
  const take = (exit: EvalClosureExit): void => {
    if (exit === 'flagged' || exit === 'void') {
      setAsking(exit)
      setReason('')
      return
    }
    onClose(exit, '')
  }
  return (
    <Section title={t('closure.title')} meta={t('closure.hint')}>
      {closure !== null && (
        <div className={css.dim}>
          {t('closure.standing', { exit: t(`closure.exit.${closure.exit}`), at: closure.at.slice(0, 16).replace('T', ' ') })}
          {closure.reason !== null && <> · 「{closure.reason}」</>}
        </div>
      )}
      <div className={css.actions}>
        {EXITS.map(exit => (
          <Button
            key={exit}
            size="sm"
            {...(exit === 'final' ? { variant: 'primary' as const } : {})}
            disabled={closing || (exit === 'final' && !anyGraded)}
            title={exit === 'final' && !anyGraded ? t('closure.finalNeedsGrade') : t(`closure.exitHint.${exit}`)}
            onClick={() => { take(exit) }}
          >
            {t(`closure.exit.${exit}`)}{NEEDS_REASON.has(exit) ? '…' : ''}
          </Button>
        ))}
      </div>
      {asking !== null && (
        <div className={css.closureReason}>
          <label className={css.dim} htmlFor="eval-closure-reason">{t(`closure.reasonAsk.${asking}`)}</label>
          <Input
            id="eval-closure-reason"
            value={reason}
            onChange={(event) => { setReason(event.target.value) }}
            placeholder={t('closure.reasonPlaceholder')}
            aria-label={t(`closure.reasonAsk.${asking}`)}
          />
          <div className={css.actions}>
            <Button
              size="sm"
              variant="primary"
              disabled={closing || reason.trim() === ''}
              onClick={() => { onClose(asking, reason); setAsking(null) }}
            >
              {t(`closure.confirm.${asking}`)}
            </Button>
            <Button size="sm" onClick={() => { setAsking(null) }}>{t('closure.cancel')}</Button>
          </div>
        </div>
      )}
    </Section>
  )
}

/**
 * The human-review body.
 * @param props - the blind queue, the open item's draft answers, and the write.
 */
export function JudgingPage(props: {
  view: EvalJudgeQueueView | null
  loading: boolean
  error: string | null
  /** The open ITEM, or null while the queue is showing. */
  selection: string | null
  /** ticket → criterion id → the verdict being composed. */
  draft: Record<string, Record<string, { pass: boolean; evidence: string }>>
  submitting: boolean
  /** Whether a one-click re-export is in flight. */
  reexporting: boolean
  onPick: (task: string | null) => void
  onAnswer: (ticket: string, criterion: string, value: { pass: boolean; evidence: string }) => void
  onSubmit: (ticket: string) => void
  /** Repeat the run's recorded export so the bundle carries these verdicts. */
  onReexport: () => void
  /** The closure in force (from the list row); null while none was taken. */
  closure: EvalClosure | null
  closing: boolean
  onClose: (exit: EvalClosureExit, reason: string) => void
  /**
   * Ask for a re-judge of the answers whose judge is absent. There is no
   * re-judge verb; the page hands the agent a sentence naming the answers by
   * their blind numbers, so nothing here learns what they are.
   */
  onRejudge: (cellNos: readonly number[]) => void
  t: LabViewProps['t']
}) {
  const {
    view, loading, error, selection, draft, submitting, reexporting,
    onPick, onAnswer, onSubmit, onReexport, closure, closing, onClose, onRejudge, t,
  } = props
  // The queue's own filter — view-local, because it narrows what THIS grader
  // is looking at and nothing else on the page (or in the ledger) depends on
  // it. Filtering never reorders: the seeded order IS part of the blind.
  const [mode, setMode] = useState<'all' | 'ungraded' | 'graded'>('all')

  if (error !== null) return <ErrorState what={t('judge.error')} message={error} t={t} />
  if (view === null) return <div className={css.empty}>{t('judge.loading')}</div>

  const items = byItem(view.cells)
  const shown = items.filter(item => (
    mode === 'all' || (mode === 'ungraded' ? item.graded < item.cells.length : item.graded === item.cells.length)
  ))
  const open = items.find(item => item.task === selection) ?? null
  const absent = view.cells.filter(cell => cell.judgeAbsent).map(cell => cell.cellNo)
  const anyGraded = view.cells.some(cell => cell.graded)

  return (
    <div className={css.judgePage}>
      <div className={css.notice}>{t('judge.blindNotice')}</div>
      {/* 判官缺席: the judge ran on these answers and left no parseable
          verdict. Named by blind number only; 补判 is optional because the
          human's own verdict stands without it. */}
      {absent.length > 0 && (
        <div className={css.notice}>
          <div>{t('judge.absent', { cells: absent.join('、'), count: absent.length })}</div>
          <div className={css.actions}>
            <Button size="sm" onClick={() => { onRejudge(absent) }}>{t('judge.rejudge')}</Button>
          </div>
        </div>
      )}
      {/* A re-read over an already-rendered queue: say so rather than blanking
          the page, so a grader watching their own submission land can see it
          is in flight. */}
      {loading && <div className={css.dim}>{t('judge.loading')}</div>}
      {view.notes.map(note => <div key={note} className={css.note}>{note}</div>)}
      {/* A verdict recorded here does NOT reach a bundle that was already
          written, and the bundle is what every downstream number is read from.
          Before I5·T60 nothing on either page said so and the fix was two
          commands nobody mentioned (I5·T39 · G17). */}
      {view.bundleStale && (
        // Same seat and same shape as the report page's copy of this sentence
        // (ui-spec §九: one component, not one per page).
        <div className={css.blocked}>
          <div>{t('judge.bundleStale')}</div>
          <div className={css.actions}>
            <Button size="sm" variant="primary" disabled={reexporting} onClick={onReexport}>
              {reexporting ? t('judge.reexporting') : t('judge.reexport')}
            </Button>
          </div>
        </div>
      )}
      <Stats view={view} t={t} />

      {view.cells.length === 0
        ? <EmptyState title={t('judge.empty')} hint={t('judge.emptyHint')} />
        : (
          <div className={css.judgeColumns}>
            <div className={css.judgeQueue}>
              <div className={css.sectionTitle}>{t('judge.queue')}</div>
              <div className={css.matrixBar}>
                {([['all', 'judge.filterAll'], ['ungraded', 'judge.filterUngraded'], ['graded', 'judge.filterGraded']] as const)
                  .map(([value, key]) => (
                    <button
                      key={value}
                      type="button"
                      className={css.chip}
                      aria-pressed={mode === value}
                      onClick={() => { setMode(value) }}
                    >
                      {t(key)}
                    </button>
                  ))}
              </div>
              {shown.map(item => (
                <button
                  key={item.task}
                  type="button"
                  className={css.queueRow}
                  aria-pressed={selection === item.task}
                  onClick={() => { onPick(item.task) }}
                >
                  <span className={css.queueTask}>{t('judge.itemCount', { task: item.task, count: item.cells.length })}</span>
                  <span className={css.dim}>{t('judge.graded', { count: item.graded })}</span>
                </button>
              ))}
            </div>

            {open === null
              ? <EmptyState title={t('judge.itemPick')} hint={t('judge.pickHint')} />
              : (
                <div className={css.bench}>
                  <div className={css.dim}>{t('judge.sideBySide')}</div>
                  <div className={css.benchColumns}>
                    {open.cells.map(cell => (
                      <AnswerColumn
                        key={cell.ticket}
                        cell={cell}
                        draft={draft[cell.ticket] ?? {}}
                        submitting={submitting}
                        onAnswer={(criterion, value) => { onAnswer(cell.ticket, criterion, value) }}
                        onSubmit={() => { onSubmit(cell.ticket) }}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      <ClosureExits closure={closure} anyGraded={anyGraded} closing={closing} onClose={onClose} t={t} />
    </div>
  )
}
