/**
 * The judge bench (ui-spec §五, step 8): the blind queue on the left, the
 * de-fingerprinted artifacts in the middle, the criteria table on the right —
 * every llm-draft sample beside the box a person types their own verdict
 * into — and the run's agreement numbers across the top.
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

import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalJudgeCriterionRow, EvalJudgeDraftSample, EvalJudgeQueueCell, EvalJudgeQueueView,
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

/** One queue group: the cells that still need a verdict, or the ones that have one. */
function QueueGroup(props: {
  label: string
  cells: readonly EvalJudgeQueueCell[]
  selection: string | null
  onPick: (ticket: string) => void
  t: LabViewProps['t']
}) {
  const { label, cells, selection, onPick, t } = props
  return (
    <>
      <div className={css.queueGroup}>{label}</div>
      {cells.map(cell => (
        <button
          key={cell.ticket}
          type="button"
          className={css.queueRow}
          aria-pressed={selection === cell.ticket}
          onClick={() => { onPick(cell.ticket) }}
        >
          {/* The cell's whole visible identity: an ordinal and the item. No
              condition, no harness, no model — and no mission id, which would
              carry the condition inside it. */}
          <span className={css.queueNo}>{t('judge.cell', { no: cell.cellNo })}</span>
          <span className={css.queueTask}>{cell.task ?? DASH}</span>
          <span className={css.dim}>rep {cell.rep ?? DASH}</span>
        </button>
      ))}
    </>
  )
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
  criterion: EvalJudgeCriterionRow
  drafts: readonly EvalJudgeDraftSample[]
  recorded: { pass: boolean; evidence: string | null } | undefined
  answer: { pass: boolean; evidence: string } | undefined
  onAnswer: (value: { pass: boolean; evidence: string }) => void
  t: LabViewProps['t']
}) {
  const { criterion, drafts, recorded, answer, onAnswer, t } = props
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
          aria-label={`${t('judge.evidence')} ${criterion.id}`}
        />
        {answer === undefined && <span className={css.dim}>{t('judge.unanswered')}</span>}
      </div>
    </div>
  )
}

/**
 * The judge bench body.
 * @param props - the blind queue, the open cell's draft answers, and the one write.
 */
export function JudgingPage(props: {
  view: EvalJudgeQueueView | null
  loading: boolean
  error: string | null
  /** The open cell's ticket, or null while the queue is showing. */
  selection: string | null
  /** criterion id → the verdict being composed for the open cell. */
  draft: Record<string, { pass: boolean; evidence: string }>
  submitting: boolean
  onPick: (ticket: string | null) => void
  onAnswer: (criterion: string, value: { pass: boolean; evidence: string }) => void
  onSubmit: () => void
  t: LabViewProps['t']
}) {
  const { view, loading, error, selection, draft, submitting, onPick, onAnswer, onSubmit, t } = props

  if (error !== null) return <ErrorState what={t('judge.error')} message={error} t={t} />
  if (view === null) return <div className={css.empty}>{t('judge.loading')}</div>

  const open = view.cells.find(cell => cell.ticket === selection) ?? null
  const ungraded = view.cells.filter(cell => !cell.graded)
  const graded = view.cells.filter(cell => cell.graded)
  // Only answers with evidence are sendable — the host refuses a blank one,
  // and a button that could produce that refusal is a worse button.
  const answers = Object.entries(draft).filter(([, value]) => value.evidence.trim() !== '')
  const recordedByCriterion = new Map<string, { pass: boolean; evidence: string | null }>()
  for (const verdict of open?.humanFinal ?? []) {
    // Append-only means a criterion can carry several; the latest is the one
    // the report reads, so it is the one shown beside the input.
    recordedByCriterion.set(verdict.criterion, { pass: verdict.pass, evidence: verdict.evidence })
  }

  return (
    <div className={css.judgePage}>
      <div className={css.notice}>{t('judge.blindNotice')}</div>
      {/* A re-read over an already-rendered queue: say so rather than blanking
          the page, so a grader watching their own submission land can see it
          is in flight. */}
      {loading && <div className={css.dim}>{t('judge.loading')}</div>}
      {view.notes.map(note => <div key={note} className={css.note}>{note}</div>)}
      <Stats view={view} t={t} />

      {view.cells.length === 0
        ? <EmptyState title={t('judge.empty')} hint={t('judge.emptyHint')} />
        : (
          <div className={css.judgeColumns}>
            <div className={css.judgeQueue}>
              <div className={css.sectionTitle}>{t('judge.queue')}</div>
              <QueueGroup
                label={t('judge.ungraded', { count: ungraded.length })}
                cells={ungraded} selection={selection} onPick={onPick} t={t}
              />
              <QueueGroup
                label={t('judge.graded', { count: graded.length })}
                cells={graded} selection={selection} onPick={onPick} t={t}
              />
            </div>

            {open === null
              ? <EmptyState title={t('judge.pick')} hint={t('judge.pickHint')} />
              : (
                <>
                  <div className={css.judgeMaterial}>
                    <div className={css.sectionTitle}>{t('judge.material')}</div>
                    {open.materials.length === 0
                      ? <div className={css.dim}>{t('judge.materialNone')}</div>
                      : open.materials.map(material => (
                        <div key={material.path}>
                          <div className={css.materialHead}>
                            <span className={css.mono}>{material.path}</span>
                            <span className={css.dim}>{t('judge.scrubbed', { count: material.replacements })}</span>
                          </div>
                          {/* The stage file VERBATIM, after scrubbing: a
                              summary would hide exactly what a verdict has to
                              rest on. */}
                          <pre className={css.pre}>{material.text}</pre>
                        </div>
                      ))}
                  </div>

                  <div className={css.judgeCriteria}>
                    <div className={css.sectionTitle}>
                      {t('judge.cellTitle', { no: open.cellNo, task: open.task ?? DASH, rep: open.rep ?? DASH })}
                    </div>
                    {open.graded && <div className={css.notice}>{t('judge.regrade')}</div>}
                    {/* The cost of the first verdict on this cell. The report
                        scores a cell from ONE namespace — the most
                        authoritative that has any verdict — so a single human
                        answer here drops every llm-draft-only criterion from
                        this cell's score. The bench cannot change that rule
                        without moving every report ever produced; what it can
                        do is refuse to let a person spend it unknowingly. */}
                    {open.draftOnlyCriteria.length > 0 && (
                      <div className={css.blocked}>
                        {t('judge.scoringWarning', {
                          count: open.draftOnlyCriteria.length,
                          criteria: open.draftOnlyCriteria.join(', '),
                        })}
                      </div>
                    )}
                    {open.criteria.length === 0
                      ? (
                        <div className={css.dim}>
                          {t('judge.criteriaNone', { reason: open.criteriaNote ?? DASH })}
                        </div>
                      )
                      : open.criteria.map(criterion => (
                        <CriterionRow
                          key={criterion.id}
                          criterion={criterion}
                          drafts={open.drafts.filter(sample => sample.criterion === criterion.id)}
                          recorded={recordedByCriterion.get(criterion.id)}
                          answer={draft[criterion.id]}
                          onAnswer={(value) => { onAnswer(criterion.id, value) }}
                          t={t}
                        />
                      ))}
                    {open.criteria.length > 0 && (
                      <div className={css.actions}>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={submitting || answers.length === 0}
                          onClick={onSubmit}
                        >
                          {submitting ? t('judge.submitting') : t('judge.submit', { count: answers.length })}
                        </Button>
                        {answers.length === 0 && <span className={css.dim}>{t('judge.submitBlocked')}</span>}
                      </div>
                    )}
                  </div>
                </>
              )}
          </div>
        )}
    </div>
  )
}
