/**
 * The matrix sub-page (ui-spec §五 and §九): rows are always the item, the
 * columns are always CONDITIONS, and every cell carries the same four things —
 * the rep dots, the stage word, the stuck warning, and whether its item
 * material agrees with the rest of its row. Under it, the run-level summary as
 * one band.
 *
 * Three things the I5 walkthrough found here, and what replaced them.
 *
 * **The columns were factor VALUES.** A column headed `["DEEPSEEK_API_KEY",
 * "DSH_HOME"]` is what that looks like when the value is an array. ui-spec §九
 * fixes the heading as the condition id — the thing a person names when they
 * talk about the run — with the factor value as its subtitle, which is where
 * `v4-flash` belongs. The pivot is unchanged: a column still IS a factor
 * value, and {@link EvalMatrixColumn.conditions} already said which conditions
 * carry it. Only the heading changed sides.
 *
 * **Every differing key was offered as a factor.** The pivot reports what
 * varies, honestly and without choosing (`conditionFactors`), so a run varying
 * the model also varies `home.sha`, `env.keys` and `unit.scopedHome.var`. Four
 * of those are derived from the other one, and a reader cannot hold a derived
 * field fixed. {@link splitFactors} keeps the designed factors as controls and
 * folds the rest into one line at the bottom — shown, named, never a chip.
 *
 * **The arrangement bar was always there.** A single-factor experiment has
 * nothing to arrange, so it gets no bar at all; a multi-factor one gets one
 * disclosure, closed, because choosing the column is a rare act and the matrix
 * is what the page is for.
 */

import { useState } from 'react'
import type { EvalMatrixCell, EvalMatrixInvariant, EvalMatrixView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { Chip, EmptyState, Section, Word, invariantTone, stageTone } from './parts.tsx'
import { distinctStates, factorPhrase, factorValueText, splitFactors, stagePhrase } from './vocab.ts'
import css from './LabView.module.css'

/** The dot glyphs, in the spec's own words: 实心已判 / 半心进行中 / 空心未起. */
const DOTS: Readonly<Record<string, string>> = { filled: '●', half: '◐', empty: '○' }

/** One invariant of the summary band: the verdict word, and why when it is not ok. */
function Invariant(props: { label: string; value: EvalMatrixInvariant; t: LabViewProps['t'] }) {
  const { label, value, t } = props
  return (
    <span className={css.summaryItem} title={value.detail}>
      <span className={css.summaryLabel}>{label}</span>
      <Chip tone={invariantTone(value.status)}>{t(`invariant.${value.status}`)}</Chip>
    </span>
  )
}

/** The stage word of one cell: the state its reps agree on, or 「多态」. */
function StageChip(props: { cell: EvalMatrixCell; t: LabViewProps['t'] }) {
  const { cell, t } = props
  const states = distinctStates(cell.reps)
  if (states.length === 0) return <span className={css.dim}>—</span>
  const only = states[0] as string
  if (states.length === 1) {
    return <Chip tone={stageTone(only)} title={only}><Word phrase={stagePhrase(only)} t={t} /></Chip>
  }
  const words = states.map((state) => {
    const phrase = stagePhrase(state)
    return phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)
  })
  return <Chip tone="busy" title={states.join(' / ')}>{t('stage.mixed', { states: words.join(' / ') })}</Chip>
}

/** One (item × column) cell: the dots, the stage, and the two warnings. */
function MatrixCellBody(props: {
  cell: EvalMatrixCell
  stuckMinutes: number
  onOpen: (missionId: string) => void
  t: LabViewProps['t']
}) {
  const { cell, stuckMinutes, onOpen, t } = props
  return (
    <div
      className={css.matrixCell}
      data-mismatch={cell.hashMismatch ? '' : undefined}
      data-stuck={cell.stuck ? '' : undefined}
    >
      <div className={css.matrixDots}>
        {cell.reps.map((rep) => {
          const phrase = stagePhrase(rep.state)
          const word = phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)
          return (
            <button
              key={rep.missionId}
              type="button"
              className={css.matrixDot}
              data-dot={rep.dot}
              data-stuck={rep.stuck ? '' : undefined}
              aria-label={t('matrix.repLabel', {
                task: cell.task, condition: rep.condition ?? '—', rep: rep.rep ?? '—', stage: word,
              })}
              onClick={() => { onOpen(rep.missionId) }}
            >
              {DOTS[rep.dot] ?? '○'}
            </button>
          )
        })}
      </div>
      <StageChip cell={cell} t={t} />
      {/* The two warnings ui-spec §九 keeps as chips rather than as sentences:
          the sentence is on the chip's title, the colour is the signal. */}
      {cell.hashMismatch && <Chip tone="danger" title={t('matrix.hashMismatch')}>{t('matrix.hashMismatchChip')}</Chip>}
      {cell.hashUnknown && !cell.hashMismatch && (
        <Chip tone="neutral" title={t('matrix.hashUnknown')}>{t('matrix.hashUnknownChip')}</Chip>
      )}
      {cell.stuck && (
        <Chip tone="warn" title={t('matrix.stuck', { minutes: stuckMinutes })}>
          {t('matrix.stuckChip', { minutes: stuckMinutes })}
        </Chip>
      )}
    </div>
  )
}

/**
 * The arrangement disclosure — the column chooser, the bands and the pins.
 *
 * Closed by default and absent entirely below two designed factors: ui-spec §九
 * («单因子实验的矩阵页不该有筛选行»). What it offers is exactly the designed
 * factors; the derived ones are reported at the bottom of the page instead.
 */
function Arrange(props: {
  matrix: EvalMatrixView
  named: readonly string[]
  onColumn: (factor: string) => void
  onToggleGroup: (factor: string) => void
  onFilter: (factor: string, value: string | null) => void
  t: LabViewProps['t']
}) {
  const { matrix, named, onColumn, onToggleGroup, onFilter, t } = props
  const others = named.filter(factor => factor !== matrix.column)
  return (
    <details className={css.arrange}>
      <summary className={css.arrangeSummary}>{t('matrix.arrange')}</summary>
      <div className={css.arrangeBody}>
        <div className={css.matrixBar}>
          <span className={css.fieldLabel}>{t('matrix.column')}</span>
          {named.map(factor => (
            <button
              key={factor}
              type="button"
              className={css.chip}
              aria-pressed={matrix.column === factor}
              title={factor}
              onClick={() => { onColumn(factor) }}
            >
              <Word phrase={factorPhrase(factor)} t={t} />
            </button>
          ))}
        </div>
        {others.length > 0 && (
          <div className={css.matrixBar}>
            <span className={css.fieldLabel}>{t('matrix.group')}</span>
            {others.map(factor => (
              <button
                key={factor}
                type="button"
                className={css.chip}
                aria-pressed={matrix.groupBy.includes(factor)}
                title={factor}
                onClick={() => { onToggleGroup(factor) }}
              >
                <Word phrase={factorPhrase(factor)} t={t} />
              </button>
            ))}
          </div>
        )}
        {/* The filter pins a REMAINING factor to one value. The column's own
            factor is never offered: pinning it would collapse the comparison
            to a single column, which is the opposite of what the page is for. */}
        {others.map((factor) => {
          const values = matrix.factorValues.find(entry => entry.factor === factor)?.values ?? []
          if (values.length < 2) return null
          const pinned = matrix.filter[factor]
          return (
            <div key={factor} className={css.matrixBar}>
              <span className={css.fieldLabel}>
                {t('matrix.filter')} <Word phrase={factorPhrase(factor)} t={t} title={factor} />
              </span>
              <button
                type="button"
                className={css.chip}
                aria-pressed={pinned === undefined}
                onClick={() => { onFilter(factor, null) }}
              >
                {t('matrix.filterAll')}
              </button>
              {values.map((value) => {
                const shown = factorValueText(value.key, value.label)
                return (
                  <button
                    key={value.key}
                    type="button"
                    className={css.chip}
                    aria-pressed={pinned === value.key}
                    title={value.conditions.join(', ')}
                    onClick={() => { onFilter(factor, value.key) }}
                  >
                    {shown.text}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </details>
  )
}

/**
 * The fields that vary because something else does — named, never a control.
 * @param props - the derived paths, the value sets, and the locale seat.
 */
function Incidental(props: { matrix: EvalMatrixView; paths: readonly string[]; t: LabViewProps['t'] }) {
  const { matrix, paths, t } = props
  if (paths.length === 0) return null
  return (
    <details className={css.errorDetails}>
      <summary className={css.errorSummary}>{t('matrix.incidental', { count: paths.length })}</summary>
      <div className={css.errorDetailLine}>{t('matrix.incidentalHint')}</div>
      {paths.map((path) => {
        const values = matrix.factorValues.find(entry => entry.factor === path)?.values ?? []
        return (
          <div key={path} className={css.incidentalRow}>
            <span className={css.summaryLabel} title={path}>
              <Word phrase={factorPhrase(path)} t={t} />
            </span>
            <span className={css.dim}>
              {values
                .map(value => `${value.conditions.join(', ')}: ${factorValueText(value.key, value.label).text}`)
                .join(' · ')}
            </span>
          </div>
        )
      })}
    </details>
  )
}

/**
 * The matrix page body.
 * @param props - the arranged matrix, the reader's controls, and the drawer opener.
 */
export function MatrixPage(props: {
  matrix: EvalMatrixView | null
  loading: boolean
  error: string | null
  onColumn: (factor: string) => void
  onToggleGroup: (factor: string) => void
  onFilter: (factor: string, value: string | null) => void
  onOpenCell: (missionId: string) => void
  t: LabViewProps['t']
}) {
  const { matrix, loading, error, onColumn, onToggleGroup, onFilter, onOpenCell, t } = props
  const [legendOpen, setLegendOpen] = useState(false)
  if (error !== null) return <ErrorState what={t('matrix.error')} message={error} t={t} />
  if (matrix === null) return <div className={css.empty}>{t('matrix.loading')}</div>

  const stuckMinutes = Math.round(matrix.stuckMs / 60_000)
  const { named, incidental } = splitFactors(matrix.factors)
  // The column's own word, shown as a quiet line when there is nothing to
  // arrange — the reader still has to know what separates the columns.
  const columnPhrase = matrix.column === null ? null : factorPhrase(matrix.column)

  return (
    <div className={css.matrixPage}>
      <div className={css.matrixTop}>
        {matrix.factors.length === 0
          ? <span className={css.dim}>{t('matrix.noFactor')}</span>
          : columnPhrase !== null && (
            <span className={css.dim} title={matrix.column ?? undefined}>
              {t('matrix.columnIs')} <Word phrase={columnPhrase} t={t} />
            </span>
          )}
        <span className={css.barSpacer} />
        {loading && <span className={css.dim}>{t('matrix.loading')}</span>}
        <button
          type="button"
          className={css.chip}
          aria-pressed={legendOpen}
          onClick={() => { setLegendOpen(!legendOpen) }}
        >
          {t('matrix.legendToggle')}
        </button>
      </div>
      {legendOpen && <div className={css.legend}>{t('matrix.legend')}</div>}
      {named.length >= 2 && (
        <Arrange
          matrix={matrix}
          named={named}
          onColumn={onColumn}
          onToggleGroup={onToggleGroup}
          onFilter={onFilter}
          t={t}
        />
      )}

      {matrix.groups.every(group => group.rows.length === 0)
        ? <EmptyState title={t('matrix.empty')} hint={t('matrix.emptyHint')} />
        : matrix.groups.map(group => (
          <div key={group.key} className={css.matrixGroup}>
            {group.label !== '' && <div className={css.matrixGroupLabel}>{group.label}</div>}
            <table className={css.matrixTable}>
              <thead>
                <tr>
                  <th className={css.matrixCorner}>{t('matrix.task')}</th>
                  {matrix.columns.map((column) => {
                    const shown = factorValueText(column.key, column.label)
                    return (
                      <th key={column.key} className={css.matrixHead} title={column.conditions.join(', ')}>
                        {/* ui-spec §九: the heading is the condition, always. */}
                        <div className={css.matrixHeadId}>
                          {column.conditions.length === 0 ? t('matrix.noCondition') : column.conditions.join(' · ')}
                        </div>
                        {columnPhrase !== null && (
                          <div className={css.matrixHeadFactor} title={shown.title}>
                            <Word phrase={columnPhrase} t={t} /> {shown.text}
                          </div>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => (
                  <tr key={row.task}>
                    <th className={css.matrixRowHead}>{row.task}</th>
                    {row.cells.map((cell, index) => (
                      <td key={matrix.columns[index]?.key ?? String(index)} className={css.matrixTd}>
                        {cell === null
                          ? <span className={css.dim}>—</span>
                          : <MatrixCellBody cell={cell} stuckMinutes={stuckMinutes} onOpen={onOpenCell} t={t} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      <Section title={t('summary.title')}>
        <div className={css.summaryBar}>
          <Invariant label={t('summary.materialization')} value={matrix.summary.materialization} t={t} />
          <Invariant label={t('summary.fingerprint')} value={matrix.summary.fingerprint} t={t} />
          <span className={css.summaryItem}>
            <span className={css.summaryLabel}>{t('summary.unreleased')}</span>
            <Chip tone={matrix.summary.unreleased > 0 ? 'warn' : 'neutral'}>{matrix.summary.unreleased}</Chip>
          </span>
          <span className={css.summaryItem}>
            <span className={css.summaryLabel}>{t('summary.stuck')}</span>
            <Chip tone={matrix.summary.stuck > 0 ? 'warn' : 'neutral'}>{matrix.summary.stuck}</Chip>
          </span>
          <span className={css.summaryItem}>
            <span className={css.summaryLabel}>{t('summary.judge')}</span>
            <span className={css.dim}>{matrix.summary.judgeConsistency ?? t('summary.judgePending')}</span>
          </span>
          <span className={css.summaryItem}>
            <span className={css.summaryLabel}>{t('summary.cells')}</span>
            <span className={css.dim}>{matrix.summary.cells}</span>
          </span>
        </div>
        {/* An invariant that HOLDS does not have to explain itself; one that
            does not is the reason a reader opened this page. */}
        {matrix.summary.materialization.status !== 'ok' && (
          <div className={css.summaryWhy}>{matrix.summary.materialization.detail}</div>
        )}
        {matrix.summary.fingerprint.status !== 'ok' && (
          <div className={css.summaryWhy}>{matrix.summary.fingerprint.detail}</div>
        )}
        <Incidental matrix={matrix} paths={incidental} t={t} />
      </Section>
    </div>
  )
}
