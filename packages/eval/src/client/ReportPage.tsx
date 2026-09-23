/**
 * The report sub-page (ui-spec §五, step 7): the four invariants, the paired
 * difference table, the efficiency table and the judge numbers — plus the two
 * human actions, finalize and export — and, since T57, what this run is still
 * holding: the containers lab has not reclaimed, counted at the top of the
 * page with a 回收 action beside them.
 *
 * The page renders what the bundle's own analysis decided and adds no judgment
 * of its own. That is the whole design: the four invariants gate the
 * comparison host-side, so `pairs` simply arrives EMPTY when one of them did
 * not hold, and this file cannot show a delta the report refused to compute.
 * What it shows instead is the one line ui-spec asks for — 比较节未开, naming
 * the invariant that closed it — because a reader who cannot see the numbers
 * still has to know why.
 *
 * Three smaller honesty rules travel with the tables. A dash is not a zero:
 * a condition whose harness never reported tool calls prints `—`, because
 * "nobody counted" and "it used none" are different facts. Tokens are
 * comparable only within one model, so a run spanning two says so above the
 * table rather than leaving a reader to subtract across them. And a paired row
 * whose judges include the row's own model is marked 自评 — decision 9 lets a
 * judge be a player and discloses it per cell instead of dropping it.
 */

import { Fragment, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalFinalizeView, EvalReportCriterionCell, EvalReportCriterionSample, EvalReportJudgeTag,
  EvalReportPair, EvalReportTaskCriteria, EvalRunReportView, EvalRunUnitsView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import {
  Agreement, Chip, Count, Detail, Duration, EmptyState, Section, Word,
  invariantTone, stageTone, stamp,
} from './parts.tsx'
import { compactCount, durationParts, sourceOf, sourceShares, stagePhrase, verdictKey } from './vocab.ts'
import { conclusionSourceKey, validityCount } from './journey.ts'
import type { EvalKey } from './locales.ts'
import css from './LabView.module.css'

const DASH = '—'

/** Integers stay integers; a mean keeps three decimals (summary.md's rule). */
function fmtNum(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

/** `12/14`, or a dash when the run produced no such pair at all. */
function fmtAgreement(value: { agreed: number; total: number } | null): string {
  return value === null ? DASH : `${value.agreed}/${value.total}`
}

/**
 * Why one invariant affects the comparison — the hover ui-spec §五 v2 asks for.
 *
 * COPY, not data. The sentence is the same for every run an invariant can
 * fail on, so it belongs in the dictionary (where it exists in both
 * languages) rather than riding the projection as a host-composed Chinese
 * string. The `details` beside it are the opposite kind of thing: those are
 * this run's own facts and they come from the bundle.
 * @param id - the invariant's stable id.
 * @returns the dictionary key, or null for an id this tab has no sentence for.
 */
function invariantWhy(id: string): EvalKey | null {
  if (id === 'materialization') return 'invariant.why.materialization'
  if (id === 'fingerprint') return 'invariant.why.fingerprint'
  if (id === 'subject') return 'invariant.why.subject'
  if (id === 'procedure') return 'invariant.why.procedure'
  if (id === 'verdict-coverage') return 'invariant.why.verdict-coverage'
  return null
}

/** The three efficiency metrics the bars compare, in the order §五 v2 names them. */
const CHART_METRICS = [
  { key: 'activeMs', label: 'report.chart.activeMs' },
  { key: 'outputTokens', label: 'report.chart.outputTokens' },
  { key: 'cacheRead', label: 'report.chart.cacheRead' },
] as const

/**
 * The efficiency table, seen at a glance.
 *
 * One bar group per metric, each scaled against the LARGEST value in its own
 * metric: the three have no common unit (milliseconds, tokens, tokens read
 * from a cache), so a shared scale would be a lie with a picture attached.
 * The number stays beside its bar — the bar carries the ratio, the number
 * carries the fact — and a metric nobody measured prints a sentence rather
 * than a row of empty tracks. No charting library: this is three numbers per
 * comparison group, and the host ships no chart primitive this tab may use.
 * @param props - the report payload and the locale seat.
 */
function EfficiencyChart(props: { report: EvalRunReportView; t: LabViewProps['t'] }) {
  const { report, t } = props
  const valueOf = (row: EvalRunReportView['efficiency'][number], key: string): number | null => {
    if (key === 'activeMs') return row.activeMs
    if (key === 'outputTokens') return row.outputTokens
    return row.cacheReadTokens
  }
  const shown = (key: string, value: number): string => {
    if (key !== 'activeMs') return compactCount(value)
    const parts = durationParts(value)
    return parts === null ? '—' : t(parts.key, parts.params)
  }
  return (
    <>
      <div className={css.sectionTitle}><span>{t('report.chart')}</span></div>
      {CHART_METRICS.map((metric) => {
        const rows = report.efficiency
          .map(row => ({ condition: row.condition, value: valueOf(row, metric.key) }))
          .filter((row): row is { condition: string; value: number } => row.value !== null)
        const max = Math.max(0, ...rows.map(row => row.value))
        return (
          <div key={metric.key} className={css.chartGroup}>
            <div className={css.chartTitle}>{t(metric.label)}</div>
            {rows.length === 0 || max === 0
              ? <div className={css.dim}>{t('report.chartNone')}</div>
              : rows.map(row => (
                <div key={row.condition} className={css.chartRow}>
                  <span className={css.chartLabel} title={row.condition}>{row.condition}</span>
                  <span className={css.chartTrack}>
                    <span className={css.chartBar} style={{ width: `${String(Math.round((row.value / max) * 100))}%` }} />
                  </span>
                  <span className={css.chartValue}>{shown(metric.key, row.value)}</span>
                </div>
              ))}
          </div>
        )
      })}
    </>
  )
}

/** One judge tag, with the 自评 mark when its model is the cell's own. */
function JudgeTags(props: { judges: readonly EvalReportJudgeTag[]; t: LabViewProps['t'] }) {
  const { judges, t } = props
  if (judges.length === 0) return <span className={css.dim}>{DASH}</span>
  return (
    <>
      {judges.map(judge => (
        <span key={judge.condition} className={css.judgeTag}>
          <span className={css.mono}>{judge.condition}</span>
          {judge.model !== null && <span className={css.dim}> · {judge.model}</span>}
          {judge.selfJudged && <Chip tone="warn">{t('report.selfJudged')}</Chip>}
        </span>
      ))}
    </>
  )
}

/** The factor line of one pair: single field, 多因子, or unknown. */
function factorLine(pair: EvalReportPair, t: LabViewProps['t']): string {
  if (!pair.factor.known) return t('report.factorUnknown', { detail: pair.factor.detail })
  if (pair.factor.factor !== null) return t('report.factorSingle', { factor: pair.factor.factor, detail: pair.factor.detail })
  return t('report.factorMulti', { fields: (pair.factor.multi ?? []).join(', '), detail: pair.factor.detail })
}

/** One condition pair: the factor, the per-item deltas, the CI and the verdict. */
function PairBlock(props: {
  pair: EvalReportPair
  /**
   * Open the records behind one (题目 × 对比组) on the 运行记录 stage. A
   * report number is a MEAN over the run's reps, so the honest jump names the
   * pair and lets the record list resolve how many that is — one rep opens
   * its detail, several leave the list standing under a chip (I5·T69).
   */
  onOpenRecords: (task: string, condition: string) => void
  t: LabViewProps['t']
}) {
  const { pair, onOpenRecords, t } = props
  // The weighted columns appear only when the rubric carried weights for both
  // sides — an empty pair of columns would read as "weight zero".
  const weighted = pair.rows.some(row => row.aWeighted !== null && row.bWeighted !== null)
  return (
    <Section title={t('report.pairTitle', { a: pair.a, b: pair.b })}>
      <div className={css.dim}>{factorLine(pair, t)}</div>
      {pair.rows.length === 0
        ? <div className={css.dim}>{t('report.pairNoTasks')}</div>
        : (
          <table className={css.reportTable}>
            <thead>
              <tr>
                <th className={css.reportHead}>{t('report.col.task')}</th>
                <th className={css.reportHead}>{pair.a}</th>
                <th className={css.reportHead}>{pair.b}</th>
                <th className={css.reportHead}>{t('report.col.delta')}</th>
                {weighted && <th className={css.reportHead}>{t('report.col.weightedDelta')}</th>}
                <th className={css.reportHead}>{t('report.col.deltas')}</th>
                <th className={css.reportHead}>{t('report.col.n')}</th>
                <th className={css.reportHead}>{t('report.col.judges')}</th>
              </tr>
            </thead>
            <tbody>
              {pair.rows.map(row => (
                <tr key={row.task}>
                  <th className={css.reportRowHead}>{row.task}</th>
                  {/* Each side's number opens the records it was computed
                      from. A mean nobody can get behind is a number a reader
                      has to take on faith, and this table is exactly where
                      「为什么是这个数」 gets asked. */}
                  <td className={css.reportTd}>
                    <button
                      type="button"
                      className={css.reportJump}
                      title={t('report.openRecords', { task: row.task, condition: pair.a })}
                      onClick={() => { onOpenRecords(row.task, pair.a) }}
                    >
                      {fmtNum(row.aMean)}
                    </button>
                  </td>
                  <td className={css.reportTd}>
                    <button
                      type="button"
                      className={css.reportJump}
                      title={t('report.openRecords', { task: row.task, condition: pair.b })}
                      onClick={() => { onOpenRecords(row.task, pair.b) }}
                    >
                      {fmtNum(row.bMean)}
                    </button>
                  </td>
                  <td className={css.reportTd}>{fmtNum(row.delta)}</td>
                  {weighted && (
                    <td className={css.reportTd}>
                      {row.weightedDelta === null ? DASH : fmtNum(row.weightedDelta)}
                    </td>
                  )}
                  <td className={css.reportTd}>{row.deltas.map(fmtNum).join(', ') || DASH}</td>
                  <td className={css.reportTd}>{row.n}</td>
                  <td className={css.reportTd}><JudgeTags judges={row.judges} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Section>
  )
}

/**
 * One pair's verdict line on the conclusion card: the report's own rank
 * sentence VERBATIM, then exactly one of the interval, the reason there is no
 * interval, or the reason the interval is only advisory (T72 §6).
 */
export function pairVerdictLine(pair: EvalReportPair, t: LabViewProps['t']): string {
  if (pair.ci === null) {
    return pair.ciWithheld === null ? '' : t('report.ciWithheld', { k: pair.ciWithheld.tasksWithDelta })
  }
  const ci = t('report.ci', {
    mean: fmtNum(pair.ci.mean), lo: fmtNum(pair.ci.lo), hi: fmtNum(pair.ci.hi),
    samples: pair.ci.samples, seed: pair.ci.seed,
  })
  return pair.ciAdvisory ? `${t('report.ciAdvisoryShort')}：${ci}` : ci
}

/**
 * The CONCLUSION CARD (T72 §6) — the first thing on the page, because the
 * question a reader opens this stage with is «so which one is better, and can
 * I believe it», and v1 answered it at the bottom of four sections of
 * evidence. Evidence stays, collapsed, under 审计.
 *
 * The source line is decided by the closure, not by the bundle: a human's
 * final verdicts exist or not whatever was exported, and 「判官初判，未经人工
 * 确认」 is the honest default when nobody took an exit.
 */
function ConclusionCard(props: {
  report: EvalRunReportView
  onOpenAudit: () => void
  t: LabViewProps['t']
}) {
  const { report, onOpenAudit, t } = props
  const sourceKey = conclusionSourceKey(report.closure)
  const validity = validityCount(report.invariants)
  const allPass = validity.total > 0 && validity.passed === validity.total
  const flagged = report.closure?.exit === 'flagged' ? report.closure.reason : null
  const failing = report.invariants.filter(check => check.status !== 'ok' && check.id !== 'verdict-coverage')
  return (
    <section className={css.conclusionCard} aria-label={t('report.conclusion')}>
      {flagged !== null && <div className={css.conclusionFlag}>{t('report.flagged', { reason: flagged })}</div>}
      <div className={css.conclusionTitle}>{t('report.conclusion')}</div>
      {!report.comparisonAllowed
        ? (
          <div>
            <div>{t('report.comparisonClosed', { count: failing.length })}</div>
            <div className={css.chipRow}>
              {failing.map(check => (
                <span key={check.id} className={css.summaryItem}>
                  <Chip tone={invariantTone(check.status)}>{t(`invariant.${check.status}`)}</Chip>
                  <span>{check.title}</span>
                </span>
              ))}
            </div>
          </div>
        )
        : report.singleCondition
          ? <div>{t('report.singleCondition')}</div>
          : report.pairs.length === 0
            ? <div className={css.dim}>{t('report.noPairs')}</div>
            : report.pairs.map((pair) => {
              const line = pairVerdictLine(pair, t)
              return (
                <div key={`${pair.a}|${pair.b}`} className={css.conclusionPair}>
                  <div className={css.conclusionPairName}>{t('report.pairTitle', { a: pair.a, b: pair.b })}</div>
                  <div className={css.rankReason}>{pair.rankReason}</div>
                  {line !== '' && <div className={css.dim}>{line}</div>}
                </div>
              )
            })}
      <div className={css.conclusionMeta}>
        {sourceKey !== null && <span>{t(sourceKey)}</span>}
        {validity.total > 0 && (
          <button
            type="button"
            className={css.reportJump}
            title={t('report.validityOpen')}
            onClick={onOpenAudit}
          >
            <Chip tone={allPass ? 'ok' : 'warn'}>
              {t(allPass ? 'report.validityAll' : 'report.validitySome', validity)}
            </Chip>
          </button>
        )}
      </div>
    </section>
  )
}

/**
 * Where one criteria-table cell's score came from: 「人」 alone when one layer
 * scored the whole cell, 「人 1 / 判官 3」 when the merge mixed them.
 */
function SourceMix(props: { sources: Readonly<Record<string, number>>; t: LabViewProps['t'] }) {
  const shares = sourceShares(props.sources)
  if (shares.length === 0) return null
  return (
    <span className={css.criteriaSource}>
      {shares.map(share => (shares.length === 1
        ? props.t(share.key)
        : `${props.t(share.key)} ${String(share.count)}`)).join(' / ')}
    </span>
  )
}

/**
 * The records behind one criteria cell, de-duplicated.
 *
 * A cell aggregates every rep of one (题目 × 对比组), and every sample under
 * it carries the `missionId` it was written on — including the superseded
 * ones, because the judge draft a person replaced was written on that same
 * record. One id means the cell has exactly one record behind it.
 * @param cell - the projected cell.
 * @returns the distinct mission ids, in the order the samples list them.
 */
function recordsOf(cell: EvalReportCriterionCell): string[] {
  return [...new Set([...cell.samples, ...cell.superseded].map(sample => sample.missionId))]
}

/** The conclusion in one cell: ✓ / ✗, a proportion, or how many reps it held in. */
function criterionMark(cell: EvalReportCriterionCell): string {
  if (cell.reps === 0) return DASH
  if (cell.proportional) return cell.credit === null ? DASH : `${String(Math.round(cell.credit * 100))}%`
  const mark = cell.holds === true ? '✓' : '✗'
  return cell.reps > 1 ? `${mark} ${String(cell.heldReps)}/${String(cell.reps)}` : mark
}

/** One recorded verdict, with the judge un-blinded and its evidence folded. */
function CriterionSampleLine(props: {
  sample: EvalReportCriterionSample
  superseded: boolean
  t: LabViewProps['t']
}) {
  const { sample, superseded, t } = props
  const [open, setOpen] = useState(false)
  const judge = sample.judge
  return (
    <div className={css.criteriaSample}>
      <span className={css.dim}>
        {t('report.sampleLine', { rep: sample.rep ?? DASH, source: t(verdictKey(sourceOf(sample.ns))) })}
      </span>
      <Chip tone={sample.pass ? 'ok' : 'neutral'}>{t(sample.pass ? 'report.holds' : 'report.holdsNot')}</Chip>
      {sample.ratio !== null && (
        <span className={css.mono}>{sample.ratio.passed}/{sample.ratio.total}</span>
      )}
      {/* Un-blinded on purpose: the bench hides the judge so a grader cannot
          be swayed, and the REPORT is where a reader must be able to weigh
          whose opinion a number rests on (decision 9). */}
      {judge === null
        ? <span className={css.dim}>{sample.by === '' ? DASH : sample.by}</span>
        : (
          <span className={css.judgeTag}>
            <span className={css.mono}>{judge.condition}</span>
            {judge.model !== null && <span className={css.dim}> · {judge.model}</span>}
            {judge.selfJudged && <Chip tone="warn">{t('report.selfJudged')}</Chip>}
          </span>
        )}
      {superseded && <Chip tone="warn">{t('report.supersededBy')}</Chip>}
      {sample.evidence === ''
        ? <span className={css.dim}>{t('report.criteriaNoEvidence')}</span>
        : (
          <span
            className={css.criteriaEvidence}
            data-open={open ? '' : undefined}
            role="button"
            tabIndex={0}
            onClick={() => { setOpen(!open) }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setOpen(!open) }}
          >
            {sample.evidence}
          </span>
        )}
    </div>
  )
}

/**
 * One task's 判据 × 对比组 table: rows are criteria, columns are comparison
 * groups, the bottom row is the task's own score, and every cell opens onto
 * the verdicts it was computed from.
 *
 * The page adds no arithmetic. The conclusion, the source mix and the total
 * all arrive decided by `analyzeBundle` — including the bottom row, which is
 * the SAME number the pair table prints rather than this table's column sum,
 * so the two can never disagree about one item.
 */
function CriteriaTable(props: {
  table: EvalReportTaskCriteria
  /** The pair table's jump: land on 运行记录 narrowed to one (题目 × 对比组). */
  onOpenRecords: (task: string, condition: string) => void
  /**
   * The same jump, but straight to ONE record — available here and not on the
   * pair table because a criteria cell carries the `missionId` of every
   * verdict behind it. With one record behind the cell there is nothing to
   * pick, so picking it is not picking FOR the reader (I5·T69).
   */
  onOpenRecord: (task: string, condition: string, missionId: string) => void
  t: LabViewProps['t']
}) {
  const { table, onOpenRecords, onOpenRecord, t } = props
  const [open, setOpen] = useState<string | null>(null)
  const columns = 4 + table.conditions.length
  // Same rule as the pair table: the weighted figure shows only when every
  // column carries one, because a blank beside a number reads as zero.
  const weighted = table.totals.length > 0 && table.totals.every(total => total.weighted !== null)
  return (
    <Section title={table.task} meta={t('report.criteriaHint')}>
      <table className={css.reportTable}>
        <thead>
          <tr>
            <th className={css.reportHead}>{t('report.col.criterion')}</th>
            <th className={css.reportHead}>{t('report.col.axis')}</th>
            <th className={css.reportHead}>{t('report.col.weight')}</th>
            <th className={css.reportHead}>{t('report.col.polarity')}</th>
            {table.conditions.map(condition => (
              <th key={condition} className={css.reportHead}>{condition}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(row => (
            <Fragment key={row.id}>
              <tr>
                <th className={css.reportRowHead}>
                  <span className={css.mono}>{row.id}</span>
                  {row.undeclared && <Chip tone="warn" title={t('report.criteriaUndeclared')}>⚠</Chip>}
                </th>
                <td className={css.reportTd}>{row.axis ?? DASH}</td>
                <td className={css.reportTd}>{row.weight ?? DASH}</td>
                <td className={css.reportTd}>
                  {t(row.negative ? 'report.polarityNegative' : 'report.polarityPositive')}
                </td>
                {row.cells.map((cell) => {
                  const key = `${row.id}|${cell.condition}`
                  // A negative criterion that HELD is a defect, and a positive
                  // one that did not is a miss: both cost the same point, so
                  // both wear the same colour.
                  const bad = cell.reps > 0 && (row.negative ? cell.holds === true : cell.holds !== true)
                  const empty = cell.samples.length === 0 && cell.superseded.length === 0
                  return (
                    <td key={cell.condition} className={css.reportTd}>
                      <button
                        type="button"
                        className={css.criteriaCell}
                        disabled={empty}
                        aria-expanded={open === key}
                        title={empty ? t('report.criteriaNotJudged') : t('report.criteriaExpand', { criterion: row.id, condition: cell.condition })}
                        onClick={() => { setOpen(open === key ? null : key) }}
                      >
                        <span className={css.criteriaMark} data-bad={bad ? '' : undefined}>
                          {criterionMark(cell)}
                        </span>
                        <SourceMix sources={cell.sources} t={t} />
                      </button>
                    </td>
                  )
                })}
              </tr>
              {row.cells.filter(cell => open === `${row.id}|${cell.condition}`).map(cell => (
                <tr key={`${row.id}|${cell.condition}|open`}>
                  <td className={css.criteriaDetail} colSpan={columns}>
                    <div className={css.sectionTitle}>
                      <span>{t('report.criteriaEvidence')}</span>
                      <span className={css.sectionMeta}>
                        {row.id} · {cell.condition} · {t('report.criteriaReps', { count: cell.reps })}
                      </span>
                      {/* The mark a person who re-judged this cell earned: the
                          criterion now scores on their word, and the judge's
                          original verdict stays right beside it. */}
                      {cell.superseded.length > 0 && (cell.sources['human-final'] ?? 0) > 0 && (
                        <Chip tone="warn">{t('report.humanOverride')}</Chip>
                      )}
                      {/* The same road the pair table's numbers take, keyed
                          off what this cell actually knows: one record behind
                          it opens that record, several leave the list standing
                          under its chip for the reader to choose. */}
                      {recordsOf(cell).length > 0 && (() => {
                        const records = recordsOf(cell)
                        const only = records.length === 1 ? records[0] as string : null
                        return (
                          <button
                            type="button"
                            className={css.reportJump}
                            title={only === null
                              ? t('report.openRecords', { task: table.task, condition: cell.condition })
                              : t('report.openRecord', { record: only })}
                            onClick={() => {
                              if (only === null) onOpenRecords(table.task, cell.condition)
                              else onOpenRecord(table.task, cell.condition, only)
                            }}
                          >
                            {t(only === null ? 'report.criteriaOpenRecords' : 'report.criteriaOpenRecord')}
                          </button>
                        )
                      })()}
                    </div>
                    {cell.samples.map(sample => (
                      <CriterionSampleLine
                        key={`${sample.missionId}|${sample.ns}|${String(sample.judge?.sample ?? 0)}|${sample.evidence}`}
                        sample={sample}
                        superseded={false}
                        t={t}
                      />
                    ))}
                    {cell.superseded.map(sample => (
                      <CriterionSampleLine
                        key={`old|${sample.missionId}|${sample.ns}|${String(sample.judge?.sample ?? 0)}|${sample.evidence}`}
                        sample={sample}
                        superseded
                        t={t}
                      />
                    ))}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className={css.criteriaTotalRow}>
            <th className={css.reportRowHead}>{t('report.criteriaTotal')}</th>
            <td className={css.reportTd} />
            <td className={css.reportTd} />
            <td className={css.reportTd} />
            {table.totals.map(total => (
              <td key={total.condition} className={css.reportTd}>
                {total.scored === null ? DASH : fmtNum(total.scored)}
                {weighted && total.weighted !== null && (
                  <span className={css.dim}> ({t('report.criteriaWeighted', { value: fmtNum(total.weighted) })})</span>
                )}
                <span className={css.criteriaSource}> {t('report.criteriaReps', { count: total.reps })}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Section>
  )
}

/** The efficiency table: parallel columns, never one score. */
function Efficiency(props: { report: EvalRunReportView; t: LabViewProps['t'] }) {
  const { report, t } = props
  const models = [...new Set(report.efficiency.map(row => row.model).filter((model): model is string => model !== null))]
  const excluded = report.efficiencyExcluded
  return (
    <Section title={t('report.efficiency')} meta={t('report.efficiencyScope')}>
      {report.efficiency.length === 0
        ? <div className={css.dim}>{t('report.efficiencyNone')}</div>
        : (
          <>
            <table className={css.reportTable}>
              <thead>
                <tr>
                  <th className={css.reportHead}>{t('report.col.condition')}</th>
                  <th className={css.reportHead}>{t('report.col.model')}</th>
                  <th className={css.reportHead}>{t('report.col.activeMs')}</th>
                  <th className={css.reportHead}>{t('report.col.rounds')}</th>
                  <th className={css.reportHead}>{t('report.col.toolCalls')}</th>
                  <th className={css.reportHead}>{t('report.col.outputTokens')}</th>
                  <th className={css.reportHead}>{t('report.col.inputTokens')}</th>
                  <th className={css.reportHead}>{t('report.col.cacheRead')}</th>
                </tr>
              </thead>
              <tbody>
                {report.efficiency.map(row => (
                  <tr key={row.condition}>
                    <th className={css.reportRowHead}>{row.condition}</th>
                    <td className={css.reportTd}>{row.model ?? DASH}</td>
                    <td className={css.reportTd}><Duration ms={row.activeMs} t={t} /></td>
                    <td className={css.reportTd}><Count value={row.rounds} /></td>
                    <td className={css.reportTd}><Count value={row.toolCalls} /></td>
                    <td className={css.reportTd}><Count value={row.outputTokens} /></td>
                    <td className={css.reportTd}><Count value={row.inputTokens} /></td>
                    <td className={css.reportTd}><Count value={row.cacheReadTokens} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 冻结决策 10: tokens compare only within one model. Two models on
                the table is exactly when a reader would otherwise subtract. */}
            <div className={models.length > 1 ? css.warning : css.dim}>
              {models.length > 1
                ? t('report.tokensCrossModel')
                : t('report.tokensSameModel', { model: models[0] ?? DASH })}
            </div>
            <div className={css.dim}>
              {excluded.length === 0
                ? t('report.excludedNone')
                : t('report.excluded', {
                  total: excluded.reduce((sum, entry) => sum + entry.count, 0),
                  detail: excluded.map(entry => `${entry.condition} ${entry.state} × ${entry.count}`).join('; '),
                })}
            </div>
            <EfficiencyChart report={report} t={t} />
          </>
        )}
    </Section>
  )
}

/** Judge consistency: one judge sampled twice, and the panel across judges. */
function JudgeConsistency(props: { report: EvalRunReportView; t: LabViewProps['t'] }) {
  const { report, t } = props
  const judge = report.judge
  return (
    <Section title={t('report.judge')}>
      {/* ui-spec §九: the WORD a reader acts on, κ beside it and the exact
          value on the hover — 「评分者一致性：高（κ 0.85）」, not three numbers
          in a row. The counts stay, quietly, because «high» over two pairs and
          «high» over forty are not the same claim. */}
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('report.judgeSame')}</span>
        <Agreement kappa={judge.llmKappa} t={t} />
        <span className={css.dim}>
          {t('report.judgeSampleCount', {
            criteria: judge.multiSampled, agreement: fmtAgreement(judge.llmAgreement),
          })}
        </span>
      </div>
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('report.judgeCross')}</span>
        <Agreement kappa={judge.crossKappa} t={t} />
        <span className={css.dim}>
          {t('report.judgeSampleCount', {
            criteria: judge.crossJudged, agreement: fmtAgreement(judge.crossAgreement),
          })}
        </span>
      </div>
      {/* Low agreement is the one number on this page a reader can act on. */}
      {judge.llmKappa !== null && judge.llmKappa < 0.6 && (
        <div className={css.summaryWhy}>{t('judge.addJudge')}</div>
      )}
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('report.judgeHuman')}</span>
        <span>{fmtAgreement(judge.humanAgreement)}</span>
      </div>
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('report.judgeSelf')}</span>
        <span className={judge.selfJudgedCriteria > 0 ? css.warning : css.dim}>
          {judge.selfJudgedCriteria}
        </span>
      </div>
      {judge.details.map(detail => <div key={detail} className={css.dim}>{detail}</div>)}
    </Section>
  )
}

/**
 * The run's UNRECLAIMED containers, at the top of the page where a reader
 * actually looks — the count first, then which ones and what state their cell
 * is in.
 *
 * The count is lab's, not the ledger's: mission's `unreleased` is derived from
 * the refs a cell registered, and the case this strip exists for is the one
 * where the two disagree — a cell the ledger has released whose container is
 * still up (T39's G18, found by typing `docker ps` because no page said it).
 *
 * `available: false` renders as UNKNOWN, never as 0. A composition with no lab
 * holds no containers, but this page cannot tell that from a lab it failed to
 * reach, and printing a confident zero for both is how a leak stays invisible.
 * @param props - the payload, the read error, and the reclaim action.
 */
function UnitsStrip(props: {
  units: EvalRunUnitsView | null
  error: string | null
  reclaiming: boolean
  onReclaim: () => void
  t: LabViewProps['t']
}) {
  const { units, error, reclaiming, onReclaim, t } = props
  const [confirming, setConfirming] = useState(false)
  if (error !== null) return <ErrorState what={t('report.unitsError')} message={error} compact t={t} />
  if (units === null) return <span className={css.dim}>{t('report.unitsLoading')}</span>
  if (!units.available) {
    return <span className={css.dim} title={units.refusal ?? ''}>{t('report.unitsUnknown')}</span>
  }
  const held = units.units.length
  if (held === 0) return <span className={css.dim}>{t('report.unitsNone')}</span>
  return (
    <>
      <span className={css.warning}>{t('report.unitsHeld', { count: held })}</span>
      {confirming
        ? (
          <>
            {/* The same gate, said plainly: 回收 releases what the gate
                allows and records what it refuses. Nothing here forces. */}
            <span className={css.warning}>{t('report.reclaimConfirmAsk')}</span>
            <Button size="sm" variant="primary" disabled={reclaiming}
              onClick={() => { setConfirming(false); onReclaim() }}>
              {t('report.reclaimConfirm')}
            </Button>
            <Button size="sm" onClick={() => { setConfirming(false) }}>{t('report.finalizeCancel')}</Button>
          </>
        )
        : (
          <Button size="sm" disabled={reclaiming} onClick={() => { setConfirming(true) }}>
            {t('report.reclaim')}
          </Button>
        )}
    </>
  )
}

/**
 * The held containers in full, under the page's own heading: which container,
 * which cell, and the cell's state — the field that says whether 回收 can
 * still take it (`archived`) or only a human with `--force` can (`released`).
 * @param props - the payload and the locale face.
 */
function UnitsSection(props: { units: EvalRunUnitsView; t: LabViewProps['t'] }) {
  const { units, t } = props
  return (
    <Section title={t('report.unitsTitle')}>
      {units.units.map(unit => (
        <div key={unit.id} className={css.checkLine}>
          <span className={css.mono}>{unit.resource}</span>
          <span className={css.dim}>{unit.missionId ?? DASH}</span>
          {unit.missionState === null
            ? <span className={css.dim}>{DASH}</span>
            : (
              <Chip tone={stageTone(unit.missionState)} title={unit.missionState}>
                <Word phrase={stagePhrase(unit.missionState)} t={t} />
              </Chip>
            )}
          <Chip tone={unit.running ? 'warn' : 'neutral'}>
            {t(unit.running ? 'report.unitRunning' : 'report.unitStopped')}
          </Chip>
        </div>
      ))}
      <div className={css.dim}>{t('report.unitsHint')}</div>
    </Section>
  )
}

/** What a finalize walk did, verbatim: the counts, the containers, the refusals, the log. */
function FinalizeResult(props: { result: EvalFinalizeView; t: LabViewProps['t'] }) {
  const { result, t } = props
  const refused = result.cells.filter(cell => cell.action === 'refused')
  // The skipped cells, by the stage they were skipped AT — in the word table's
  // vocabulary, because `3 ws-ready` is the English half of the sentence §九
  // set out to remove.
  const skips = Object.entries(result.skippedByState).map(([state, count]) => {
    const phrase = stagePhrase(state)
    return `${count} ${phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)}`
  }).join('、')
  return (
    <Section title={t('report.finalizeResult')}>
      <div>
        {t('report.finalizeCounts', {
          released: result.released, refused: result.refused, skipped: result.skipped, skips: skips === '' ? DASH : skips,
        })}
      </div>
      {/* Said even when nothing was held: a walk that reports only cells reads
          as "and the containers went away", which is the reading that left two
          of them up with nothing on screen about it. */}
      <div className={result.unitsHeld.length > 0 ? css.warning : css.dim}>
        {result.unitsKnown
          ? t('report.finalizeUnits', { released: result.unitsReleased, held: result.unitsHeld.length })
          : t('report.finalizeUnitsUnknown')}
      </div>
      {/* A gate's refusal is a host sentence written for whoever debugs it.
          The FACT — which container, which cell, at which stage — is the page;
          the sentence and the walk's log go under «详情» (ui-spec §九). */}
      {result.unitsHeld.map(held => (
        <div key={held.id} className={css.checkLine}>
          <Chip tone="warn">{t('report.unitHeldChip')}</Chip>
          <span className={css.mono}>{held.resource}</span>
        </div>
      ))}
      {refused.map(cell => (
        <div key={cell.missionId} className={css.checkLine}>
          <Chip tone="warn">{t('report.refusedChip')}</Chip>
          <span className={css.mono}>{cell.missionId}</span>
          <Chip tone={stageTone(cell.finalState)} title={cell.finalState}>
            <Word phrase={stagePhrase(cell.finalState)} t={t} />
          </Chip>
        </div>
      ))}
      {(result.unitsHeld.length > 0 || refused.length > 0 || result.log.length > 0) && (
        <Detail summary={t('report.finalizeRaw')}>
          {result.unitsHeld.map(held => (
            <div key={`raw:${held.id}`} className={css.errorDetailLine}>{held.resource}: {held.reason}</div>
          ))}
          {refused.map(cell => (
            <div key={`raw:${cell.missionId}`} className={css.errorDetailLine}>
              {cell.missionId}: {cell.reason ?? ''}
            </div>
          ))}
          {result.log.length > 0 && <pre className={css.errorRaw}>{result.log.join('\n')}</pre>}
        </Detail>
      )}
    </Section>
  )
}

/**
 * The report page body.
 * @param props - the payload, the two actions, and the finalize outcome.
 */
export function ReportPage(props: {
  report: EvalRunReportView | null
  loading: boolean
  error: string | null
  finalizing: boolean
  finalizeResult: EvalFinalizeView | null
  /** lab's own list of containers this run still holds; null before it loads. */
  units: EvalRunUnitsView | null
  unitsError: string | null
  /** Whether a one-click re-export is in flight. */
  reexporting: boolean
  onFinalize: () => void
  onExport: () => void
  /** Repeat the recorded export into a fresh directory, report included. */
  onReexport: () => void
  /** Look for the bundle under this export directory instead. */
  onLookIn: (dir: string) => void
  /** Jump from a number to the records it was computed from (I5·T69). */
  onOpenRecords: (task: string, condition: string) => void
  /** Land on 运行记录 AND open ONE record — the criteria table's jump. */
  onOpenRecord: (task: string, condition: string, missionId: string) => void
  /** Go to 运行记录 — the one link a voided experiment's page keeps. */
  onOpenRuns: () => void
  t: LabViewProps['t']
}) {
  const {
    report, loading, error, finalizing, finalizeResult, units, unitsError, reexporting,
    onFinalize, onExport, onReexport, onLookIn, onOpenRecords, onOpenRecord, onOpenRuns, t,
  } = props
  // finalize walks EVERY archived cell of the run through the release gate.
  // One click from a reading page is too few for a run-wide write, so the
  // button asks once — the gate itself never forces, but the reader should
  // still have meant it.
  const [confirming, setConfirming] = useState(false)
  const [dir, setDir] = useState('')
  // The audit fold is controlled so the card's validity line can open it.
  const [auditOpen, setAuditOpen] = useState(false)

  if (error !== null) return <ErrorState what={t('report.error')} message={error} t={t} />
  if (report === null) return <div className={css.empty}>{t('report.loading')}</div>

  // 评估不成立 (closure exit ④): the page says that and nothing else. Any
  // number printed under it would be read as a result the person who voided
  // the evaluation has just said does not stand (T72 §6).
  if (report.closure?.exit === 'void') {
    return (
      <div className={css.reportPage}>
        <EmptyState
          title={t('report.void', { reason: report.closure.reason ?? DASH })}
          hint={t('report.voidHint')}
        >
          <Button size="sm" onClick={onOpenRuns}>{t('cta.void')}</Button>
        </EmptyState>
      </div>
    )
  }

  const openAudit = (): void => {
    setAuditOpen(true)
    // After the fold has rendered open; a missing element is not an error.
    setTimeout(() => {
      try {
        globalThis.document?.getElementById('eval-report-audit')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      } catch {
        // scrolling is a convenience
      }
    }, 0)
  }

  const bar = (
    <div className={css.reportBar}>
      {confirming
        ? (
          <>
            <span className={css.warning}>{t('report.finalizeConfirmAsk')}</span>
            <Button size="sm" variant="primary" disabled={finalizing}
              onClick={() => { setConfirming(false); onFinalize() }}>
              {t('report.finalizeConfirm')}
            </Button>
            <Button size="sm" onClick={() => { setConfirming(false) }}>{t('report.finalizeCancel')}</Button>
          </>
        )
        : (
          <Button size="sm" disabled={finalizing || report.bundleDir === null} onClick={() => { setConfirming(true) }}>
            {t('report.finalize')}
          </Button>
        )}
      <Button size="sm" onClick={onExport}>{t('action.export')}</Button>
      {/* The repeat, beside the dialog that made the first one. It is
          disabled with a reason rather than hidden: a reader who has just
          written a final verdict looks here for it. */}
      <Button
        size="sm"
        disabled={reexporting || report.reexportable !== true}
        title={report.reexportable === true ? '' : t('report.reexportNeedsDialog')}
        onClick={onReexport}
      >
        {reexporting ? t('report.reexporting') : t('report.reexport')}
      </Button>
      {/* 回收 is the SAME walk as finalize — reclaiming a container IS its
          cell passing the gate — so it shares the in-flight flag and the
          action behind it, and differs only in what the reader came for. */}
      <UnitsStrip units={units} error={unitsError} reclaiming={finalizing} onReclaim={onFinalize} t={t} />
      <span className={css.barSpacer} />
      {loading && <span className={css.dim}>{t('report.loading')}</span>}
    </div>
  )

  if (report.bundleDir === null) {
    return (
      <div className={css.reportPage}>
        {bar}
        {/* Never blank: a run nobody exported is a state with a button, not
            an empty page — and the directories that were looked in are what
            tell a reader which of the two situations they are in. */}
        <div className={css.reportSection}>
          <EmptyState title={t('report.noBundle')} hint={t('report.noBundleHint')}>
            <Button size="sm" variant="primary" onClick={onExport}>{t('report.exportNow')}</Button>
          </EmptyState>
          {/* Where it looked, and what the host said about not finding it.
              Absolute paths and a host sentence — both kept, both folded
              (ui-spec §九). */}
          <Detail summary={t('report.searched')}>
            {report.refusal !== null && <div className={css.errorDetailLine}>{report.refusal}</div>}
            {report.searched.map(dir => (
              <div key={dir} className={css.errorDetailLine}>{dir}/{report.runId}-bundle</div>
            ))}
          </Detail>
          {/* A run started with `--out <dir>` records nothing about where
              its bundle went: run.meta names the plan and the repository,
              and the bundle is under neither. Without this box the page
              would keep calling an exported bundle 未导出, and the only way
              out would be to export it a second time. */}
          <div className={css.actions}>
            <Input
              value={dir}
              onChange={(event) => { setDir(event.target.value) }}
              placeholder={t('report.lookInDir')}
              aria-label={t('report.lookInDir')}
            />
            <Button size="sm" disabled={dir.trim() === ''} onClick={() => { onLookIn(dir.trim()) }}>
              {t('report.lookInGo')}
            </Button>
          </div>
        </div>
        {units !== null && units.available && units.units.length > 0 && <UnitsSection units={units} t={t} />}
        {finalizeResult !== null && <FinalizeResult result={finalizeResult} t={t} />}
      </div>
    )
  }

  // T72 §6 order: 结论卡 → (收尾 / 导出 / 重新导出) → 判据表 → 效率 → 审计（折叠）.
  return (
    <div className={css.reportPage}>
      <ConclusionCard report={report} onOpenAudit={openAudit} t={t} />
      {bar}
      {/* The whole of G17, said once, right under the buttons that fix it:
          the bundle was exported before the last final verdict, so the card
          above was computed without it. */}
      {report.staleAfterFinal && (
        <div className={css.blocked}>
          <div>{t('report.staleAfterFinal', { final: stamp(report.lastHumanFinalAt) })}</div>
          <div className={css.actions}>
            <Button size="sm" variant="primary" disabled={reexporting} onClick={onReexport}>
              {reexporting ? t('report.reexporting') : t('report.reexport')}
            </Button>
          </div>
        </div>
      )}
      {report.toolOnlyNs.map(ns => (
        <div key={ns} className={css.warning}>{t('report.toolOnlyNs', { ns })}</div>
      ))}

      {/* Where a reader who has just read the verdict asks WHICH dimension
          moved and on what grounds. `criteria` is empty when the invariants
          closed the comparison, and a single-group run still gets the table. */}
      {report.criteria.map(table => (
        <CriteriaTable
          key={table.task}
          table={table}
          onOpenRecords={onOpenRecords}
          onOpenRecord={onOpenRecord}
          t={t}
        />
      ))}

      <Efficiency report={report} t={t} />

      {/* 审计: everything the card was computed from, folded. The paired
          tables, the five checks with the reason each matters on hover, the
          judges' agreement, and which bundle this is and when it was written
          against the latest final verdict. */}
      <Detail summary={t('report.audit')} open={auditOpen} onToggle={setAuditOpen} id="eval-report-audit">
        <div className={css.dim}>
          {/* The bundle's own name, not the path it happens to sit at. */}
          <span className={css.mono} title={report.bundleDir}>
            {report.bundleDir.split('/').filter(Boolean).pop() ?? ''}
          </span>
          {' · '}
          {t('report.counts', {
            rows: report.counts.rows, missions: report.counts.missions,
            attempts: report.counts.attempts, retries: report.counts.retries,
          })}
        </div>
        <div className={css.dim}>
          {report.exportedAt === null
            ? t('report.exportedAtUnknown')
            : t('report.exportedAt', { at: stamp(report.exportedAt) })}
          {report.lastHumanFinalAt !== null && <> · {t('report.lastFinalAt', { at: stamp(report.lastHumanFinalAt) })}</>}
          {report.summaryWritten && <> · {t('report.summaryIn')}</>}
        </div>
        {!report.summaryWritten && !report.staleAfterFinal && (
          <div className={css.dim}>{t('report.summaryMissing')}</div>
        )}

        <Section title={t('report.invariants')}>
          {report.invariants.map((check) => {
            // The hover says why this check affects the COMPARISON — the
            // one thing the title and the facts under it never said, and
            // the reason a reader can act on a ⚠ instead of shrugging.
            const why = invariantWhy(check.id)
            return (
              <div key={check.id} className={css.invariantRow} title={why === null ? check.id : t(why)}>
                <Chip tone={invariantTone(check.status)}>{t(`invariant.${check.status}`)}</Chip>
                <span className={css.invariantTitle}>{check.title}</span>
                {check.details.map(detail => <div key={detail} className={css.invariantDetail}>{detail}</div>)}
              </div>
            )
          })}
        </Section>

        {report.comparisonAllowed && !report.singleCondition && report.pairs.map(pair => (
          <PairBlock key={`${pair.a}|${pair.b}`} pair={pair} onOpenRecords={onOpenRecords} t={t} />
        ))}

        <JudgeConsistency report={report} t={t} />

        {report.notes.length > 0 && (
          <Section title={t('report.notes')}>
            {report.notes.map(note => <div key={note} className={css.dim}>{note}</div>)}
          </Section>
        )}

        {/* The path and the shell line that reproduces this page belong to
            whoever is at a terminal; §九 keeps both out of the page body. */}
        <Detail summary={t('report.whereFold')}>
          <div className={css.errorDetailLine}>{report.bundleDir}</div>
          {report.cliHint !== null && (
            <div className={css.errorDetailLine}>{t('report.cliHint')}: {report.cliHint}</div>
          )}
        </Detail>
      </Detail>

      {units !== null && units.available && units.units.length > 0 && <UnitsSection units={units} t={t} />}
      {finalizeResult !== null && <FinalizeResult result={finalizeResult} t={t} />}
    </div>
  )
}
