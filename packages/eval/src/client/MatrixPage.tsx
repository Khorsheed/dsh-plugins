/**
 * The matrix sub-page (ui-spec §五): rows are always the item, the columns are
 * the ONE factor the reader picked, the remaining factors band the rows or are
 * pinned away, and every cell carries the same four things — the rep dots, the
 * stage, the stuck warning, and whether its item material agrees with the rest
 * of its row. Under it, the run-level summary.
 *
 * The arrangement itself is computed host-side by `pivotMatrix`; this file
 * renders what it returns and sends back the reader's choices. That split is
 * why "why is this cell red" has one answer instead of two.
 */

import type { EvalMatrixCell, EvalMatrixInvariant, EvalMatrixView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import css from './LabView.module.css'

/** The dot glyphs, in the spec's own words: 实心已判 / 半心进行中 / 空心未起. */
const DOTS: Readonly<Record<string, string>> = { filled: '●', half: '◐', empty: '○' }

/** One invariant line of the footer, with its status word. */
function Invariant(props: { label: string; value: EvalMatrixInvariant; t: LabViewProps['t'] }) {
  const { label, value, t } = props
  return (
    <div className={css.summaryRow}>
      <span className={css.summaryLabel}>{label}</span>
      <span className={css.summaryStatus} data-status={value.status}>{t(`invariant.${value.status}`)}</span>
      <span className={css.dim}>{value.detail}</span>
    </div>
  )
}

/** One (item × column) cell: the dots, the stage, and the two warnings. */
function MatrixCellBody(props: {
  cell: EvalMatrixCell
  stuckMinutes: number
  onOpen: (missionId: string) => void
  t: LabViewProps['t']
}) {
  const { cell, stuckMinutes, onOpen, t } = props
  const title = [
    cell.conditions.join(', '),
    cell.hashMismatch ? t('matrix.hashMismatch') : '',
    cell.hashUnknown ? t('matrix.hashUnknown') : '',
    cell.stuck ? t('matrix.stuck', { minutes: stuckMinutes }) : '',
  ].filter(line => line !== '').join(' · ')
  return (
    <div
      className={css.matrixCell}
      data-mismatch={cell.hashMismatch ? '' : undefined}
      data-stuck={cell.stuck ? '' : undefined}
      title={title}
    >
      <div className={css.matrixDots}>
        {cell.reps.map(rep => (
          <button
            key={rep.missionId}
            type="button"
            className={css.matrixDot}
            data-dot={rep.dot}
            data-stuck={rep.stuck ? '' : undefined}
            aria-label={`${cell.task} ${rep.condition ?? ''} rep ${rep.rep ?? '?'} ${rep.state}`}
            onClick={() => { onOpen(rep.missionId) }}
          >
            {DOTS[rep.dot] ?? '○'}
          </button>
        ))}
      </div>
      <div className={css.matrixStage}>{cell.stage}</div>
      {cell.hashMismatch && <div className={css.warning}>{t('matrix.hashMismatch')}</div>}
      {cell.stuck && <div className={css.warning}>{t('matrix.stuck', { minutes: stuckMinutes })}</div>}
    </div>
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
  if (error !== null) return <ErrorState what={t('matrix.error')} message={error} t={t} />
  if (matrix === null) return <div className={css.empty}>{t('matrix.loading')}</div>

  const stuckMinutes = Math.round(matrix.stuckMs / 60_000)
  // Every distinct value a non-column factor takes, so the filter can offer
  // them. The columns already carry the column factor's values.
  const others = matrix.factors.filter(factor => factor !== matrix.column)

  return (
    <div className={css.matrixPage}>
      <div className={css.matrixBar}>
        <span className={css.fieldLabel}>{t('matrix.column')}</span>
        {matrix.factors.length === 0
          ? <span className={css.dim}>{t('matrix.noFactor')}</span>
          : matrix.factors.map(factor => (
            <button
              key={factor}
              type="button"
              className={css.chip}
              aria-pressed={matrix.column === factor}
              onClick={() => { onColumn(factor) }}
            >
              {factor}
            </button>
          ))}
        {others.length > 0 && (
          <>
            <span className={css.fieldLabel}>{t('matrix.group')}</span>
            {others.map(factor => (
              <button
                key={factor}
                type="button"
                className={css.chip}
                aria-pressed={matrix.groupBy.includes(factor)}
                onClick={() => { onToggleGroup(factor) }}
              >
                {factor}
              </button>
            ))}
          </>
        )}
      </div>
      {/* The filter pins a REMAINING factor to one value. The column's own
          factor is never offered: pinning it would collapse the comparison to
          a single column, which is the opposite of what the page is for. */}
      {others.map((factor) => {
        const values = matrix.factorValues.find(entry => entry.factor === factor)?.values ?? []
        if (values.length < 2) return null
        const pinned = matrix.filter[factor]
        return (
          <div key={factor} className={css.matrixBar}>
            <span className={css.fieldLabel}>{t('matrix.filter')} {factor}</span>
            <button
              type="button"
              className={css.chip}
              aria-pressed={pinned === undefined}
              onClick={() => { onFilter(factor, null) }}
            >
              {t('matrix.filterAll')}
            </button>
            {values.map(value => (
              <button
                key={value.key}
                type="button"
                className={css.chip}
                aria-pressed={pinned === value.key}
                title={value.conditions.join(', ')}
                onClick={() => { onFilter(factor, value.key) }}
              >
                {value.label}
              </button>
            ))}
          </div>
        )
      })}
      <div className={css.dim}>{t('matrix.legend')}{loading ? ` · ${t('matrix.loading')}` : ''}</div>

      {matrix.groups.every(group => group.rows.length === 0)
        ? <div className={css.empty}>{t('matrix.empty')}</div>
        : matrix.groups.map(group => (
          <div key={group.key} className={css.matrixGroup}>
            {group.label !== '' && <div className={css.matrixGroupLabel}>{group.label}</div>}
            <table className={css.matrixTable}>
              <thead>
                <tr>
                  <th className={css.matrixCorner}>{t('matrix.task')}</th>
                  {matrix.columns.map(column => (
                    <th key={column.key} className={css.matrixHead} title={column.conditions.join(', ')}>
                      <div>{column.label}</div>
                      <div className={css.dim}>{column.conditions.join(', ')}</div>
                    </th>
                  ))}
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

      <div className={css.summary}>
        <div className={css.fieldLabel}>{t('summary.title')}</div>
        <Invariant label={t('summary.materialization')} value={matrix.summary.materialization} t={t} />
        <Invariant label={t('summary.fingerprint')} value={matrix.summary.fingerprint} t={t} />
        <div className={css.summaryRow}>
          <span className={css.summaryLabel}>{t('summary.unreleased')}</span>
          <span className={matrix.summary.unreleased > 0 ? css.warning : css.dim}>{matrix.summary.unreleased}</span>
        </div>
        <div className={css.summaryRow}>
          <span className={css.summaryLabel}>{t('summary.judge')}</span>
          <span className={css.dim}>{matrix.summary.judgeConsistency ?? t('summary.judgePending')}</span>
        </div>
        <div className={css.summaryRow}>
          <span className={css.summaryLabel}>{t('summary.stuck')}</span>
          <span className={matrix.summary.stuck > 0 ? css.warning : css.dim}>{matrix.summary.stuck}</span>
        </div>
        <div className={css.summaryRow}>
          <span className={css.summaryLabel}>{t('summary.cells')}</span>
          <span className={css.dim}>{matrix.summary.cells}</span>
        </div>
      </div>
    </div>
  )
}
