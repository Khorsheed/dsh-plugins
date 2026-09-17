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

import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalFinalizeView, EvalReportJudgeTag, EvalReportPair, EvalRunReportView, EvalRunUnitsView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { Chip, Detail, EmptyState, Section, Word, invariantTone, stageTone } from './parts.tsx'
import { stagePhrase } from './vocab.ts'
import css from './LabView.module.css'

const DASH = '—'

/** Integers stay integers; a mean keeps three decimals (summary.md's rule). */
function fmtNum(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

/** The same duration wording summary.md uses, so page and file agree. */
function fmtMs(ms: number | null): string {
  if (ms === null) return DASH
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

function fmtCount(value: number | null): string {
  return value === null ? DASH : value.toLocaleString('en-US')
}

/** `12/14`, or a dash when the run produced no such pair at all. */
function fmtAgreement(value: { agreed: number; total: number } | null): string {
  return value === null ? DASH : `${value.agreed}/${value.total}`
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
function PairBlock(props: { pair: EvalReportPair; t: LabViewProps['t'] }) {
  const { pair, t } = props
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
                  <td className={css.reportTd}>{fmtNum(row.aMean)}</td>
                  <td className={css.reportTd}>{fmtNum(row.bMean)}</td>
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
      {pair.ci !== null && (
        <div className={css.dim}>
          {t('report.ci', {
            mean: fmtNum(pair.ci.mean), lo: fmtNum(pair.ci.lo), hi: fmtNum(pair.ci.hi),
            samples: pair.ci.samples, seed: pair.ci.seed,
          })}
        </div>
      )}
      {/* The rank verdict is the report's own sentence — including the one
          that refuses to rank, which is the sentence a reader must not lose. */}
      <div className={css.rankReason}>{t('report.rank')}: {pair.rankReason}</div>
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
                    <td className={css.reportTd}>{fmtMs(row.activeMs)}</td>
                    <td className={css.reportTd}>{fmtCount(row.rounds)}</td>
                    <td className={css.reportTd}>{fmtCount(row.toolCalls)}</td>
                    <td className={css.reportTd}>{fmtCount(row.outputTokens)}</td>
                    <td className={css.reportTd}>{fmtCount(row.inputTokens)}</td>
                    <td className={css.reportTd}>{fmtCount(row.cacheReadTokens)}</td>
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
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('report.judgeSame')}</span>
        <span>{t('report.judgeSameValue', {
          criteria: judge.multiSampled,
          agreement: fmtAgreement(judge.llmAgreement),
          kappa: judge.llmKappa === null ? DASH : judge.llmKappa.toFixed(3),
        })}</span>
      </div>
      <div className={css.summaryRow}>
        <span className={css.summaryLabel}>{t('report.judgeCross')}</span>
        <span>{t('report.judgeCrossValue', {
          criteria: judge.crossJudged,
          agreement: fmtAgreement(judge.crossAgreement),
          kappa: judge.crossKappa === null ? DASH : judge.crossKappa.toFixed(3),
        })}</span>
      </div>
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
  onFinalize: () => void
  onExport: () => void
  /** Look for the bundle under this export directory instead. */
  onLookIn: (dir: string) => void
  t: LabViewProps['t']
}) {
  const { report, loading, error, finalizing, finalizeResult, units, unitsError, onFinalize, onExport, onLookIn, t } = props
  // finalize walks EVERY archived cell of the run through the release gate.
  // One click from a reading page is too few for a run-wide write, so the
  // button asks once — the gate itself never forces, but the reader should
  // still have meant it.
  const [confirming, setConfirming] = useState(false)
  const [dir, setDir] = useState('')

  if (error !== null) return <ErrorState what={t('report.error')} message={error} t={t} />
  if (report === null) return <div className={css.empty}>{t('report.loading')}</div>

  const failing = report.invariants.filter(check => check.status !== 'ok')

  return (
    <div className={css.reportPage}>
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
        {/* 回收 is the SAME walk as finalize — reclaiming a container IS its
            cell passing the gate — so it shares the in-flight flag and the
            action behind it, and differs only in what the reader came for. */}
        <UnitsStrip units={units} error={unitsError} reclaiming={finalizing} onReclaim={onFinalize} t={t} />
        <span className={css.barSpacer} />
        {loading && <span className={css.dim}>{t('report.loading')}</span>}
      </div>

      {report.bundleDir === null
        ? (
          // Never blank: a run nobody exported is a state with a button, not
          // an empty page — and the directories that were looked in are what
          // tell a reader which of the two situations they are in.
          <div className={css.reportSection}>
            <EmptyState title={t('report.noBundle')} hint={t('report.noBundleHint')}>
              <Button size="sm" variant="primary" onClick={onExport}>{t('report.exportNow')}</Button>
            </EmptyState>
            {/* Where it looked, and what the host said about not finding it.
                Absolute paths and a host sentence — both kept, both folded
                (ui-spec §九); they are what tells a reader WHICH of the two
                situations they are in. */}
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
        )
        : (
          <>
            <div className={css.dim}>
              {/* The bundle's own name, not the path it happens to sit at. */}
              <span className={css.mono} title={report.bundleDir}>
                {(report.bundleDir ?? '').split('/').filter(Boolean).pop() ?? ''}
              </span>
              {' · '}
              {t('report.counts', {
                rows: report.counts.rows, missions: report.counts.missions,
                attempts: report.counts.attempts, retries: report.counts.retries,
              })}
            </div>
            {/* The path and the shell line that reproduces this page belong to
                whoever is at a terminal; §九 keeps both out of the page body. */}
            <Detail summary={t('report.whereFold')}>
              <div className={css.errorDetailLine}>{report.bundleDir}</div>
              {report.cliHint !== null && (
                <div className={css.errorDetailLine}>{t('report.cliHint')}: {report.cliHint}</div>
              )}
            </Detail>
            {report.toolOnlyNs.map(ns => (
              <div key={ns} className={css.warning}>{t('report.toolOnlyNs', { ns })}</div>
            ))}

            <Section title={t('report.invariants')}>
              {report.invariants.map(check => (
                <div key={check.id} className={css.invariantRow} title={check.id}>
                  <Chip tone={invariantTone(check.status)}>{t(`invariant.${check.status}`)}</Chip>
                  <span className={css.invariantTitle}>{check.title}</span>
                  {check.details.map(detail => <div key={detail} className={css.invariantDetail}>{detail}</div>)}
                </div>
              ))}
            </Section>

            {!report.comparisonAllowed
              ? (
                <div className={css.blocked}>
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
                ? <div className={css.dim}>{t('report.singleCondition')}</div>
                : report.pairs.length === 0
                  ? <div className={css.dim}>{t('report.noPairs')}</div>
                  : report.pairs.map(pair => <PairBlock key={`${pair.a}|${pair.b}`} pair={pair} t={t} />)}

            <Efficiency report={report} t={t} />
            <JudgeConsistency report={report} t={t} />

            {report.notes.length > 0 && (
              <Section title={t('report.notes')}>
                {report.notes.map(note => <div key={note} className={css.dim}>{note}</div>)}
              </Section>
            )}
          </>
        )}

      {units !== null && units.available && units.units.length > 0 && <UnitsSection units={units} t={t} />}
      {finalizeResult !== null && <FinalizeResult result={finalizeResult} t={t} />}
    </div>
  )
}
