/**
 * The GRID — one component, two lives (ui-spec §五 v2).
 *
 * Rows are items, columns are comparison groups, and the SAME table is drawn
 * twice in the life of an experiment: on 实验设计 before anything runs, where
 * each seat says 「计划 n 次」, and at the top of 运行记录 while it runs, where
 * the seat says what that cell is doing, whether it has a verdict, and what is
 * wrong with it. v1 had a whole sub-page for the second one and nothing at all
 * for the first, so the shape of an experiment was invisible until it was too
 * late to change it. Two renderers over one table would drift; one table with
 * two kinds of seat cannot.
 *
 * What the columns are is settled and does not vary with the life stage
 * (ui-spec §九): the heading is the comparison group's id — the thing a person
 * names out loud — and the factor value rides underneath as a subtitle.
 *
 * The arrangement controls, the run-level summary and the derived-field fold
 * belong to the LIVE grid only and travel with it here, unchanged from the
 * matrix page they came from: a single-factor experiment gets no arrangement
 * bar at all, and the derived fields are named at the bottom rather than
 * offered as controls.
 */

import { useState, type ReactNode } from 'react'
import type { EvalMatrixCell, EvalMatrixInvariant, EvalMatrixView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { Chip, EmptyState, Word, invariantTone, recordTone } from './parts.tsx'
import {
  distinctStates, factorPhrase, factorValueText, recordPhrase, shortenValue, splitFactors,
  verdictKey, type VerdictSource,
} from './vocab.ts'
import css from './LabView.module.css'

/** The dot glyphs, in the spec's own words: 实心已判 / 半心进行中 / 空心未起. */
const DOTS: Readonly<Record<string, string>> = { filled: '●', half: '◐', empty: '○' }

/** One column of the grid: the comparison group, and what separates it. */
export interface GridColumn {
  /** Stable key (the pivot's column key, or the group id before a run). */
  key: string
  /** The heading — always a comparison group id (ui-spec §九). */
  title: string
  /** The factor value under it; null when nothing separates the columns. */
  sub: ReactNode | null
  /** The whole value for the heading's hover. */
  hint?: string | undefined
}

/**
 * One seat of the grid. `planned` is what a plan implies, `live` is what the
 * ledger says — the two shapes the same table is filled with.
 */
export type GridCell =
  | { kind: 'planned'; reps: number }
  | { kind: 'live'; cell: EvalMatrixCell }

/** One row of the grid: an item, and one seat per column (null where nothing ran). */
export interface GridRow {
  task: string
  cells: Array<GridCell | null>
}

/**
 * The word of one live seat, in the run-records vocabulary (T80c P1-7): the
 * word its reps agree on, or 「多态」. Reps are compared by WORD, not token,
 * so a seat whose reps sit in `judged` and `released` reads 「完成」 once —
 * the difference is the ledger's bookkeeping, not the reader's.
 */
function StageChip(props: { cell: EvalMatrixCell; t: LabViewProps['t'] }) {
  const { cell, t } = props
  const states = distinctStates(cell.reps)
  if (states.length === 0) return <span className={css.dim}>—</span>
  const wordOf = (state: string) => {
    const phrase = recordPhrase(state)
    return phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)
  }
  const words = [...new Set(states.map(wordOf))]
  if (words.length === 1) {
    return <Chip tone={recordTone(states[0] as string)} title={states.join(' / ')}>{words[0]}</Chip>
  }
  return <Chip tone="busy" title={states.join(' / ')}>{t('stage.mixed', { states: words.join(' / ') })}</Chip>
}

/** One LIVE seat: the dots, the run state, the verdict when there is one, the warnings. */
function LiveSeat(props: {
  cell: EvalMatrixCell
  stuckMinutes: number
  verdictOf: (missionId: string) => VerdictSource | null
  onOpen: (missionId: string) => void
  t: LabViewProps['t']
}) {
  const { cell, stuckMinutes, verdictOf, onOpen, t } = props
  // 有判定即显示 (ui-spec §五 v2). The SOURCE, not a number — see
  // `verdictSourceOf`'s note on why this projection has no score to show.
  const sources = cell.reps.map(rep => verdictOf(rep.missionId)).filter((v): v is VerdictSource => v !== null)
  const verdict = sources.includes('human-final')
    ? 'human-final'
    : sources.includes('llm-draft') ? 'llm-draft' : sources[0] ?? null
  return (
    <div
      className={css.matrixCell}
      data-mismatch={cell.hashMismatch ? '' : undefined}
      data-stuck={cell.stuck ? '' : undefined}
    >
      <div className={css.matrixDots}>
        {cell.reps.map((rep) => {
          const phrase = recordPhrase(rep.state)
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
      {verdict !== null && (
        <Chip tone={verdict === 'human-final' ? 'ok' : 'neutral'} title={t('verdict.hint')}>
          {t(verdictKey(verdict))}
        </Chip>
      )}
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

/** One PLANNED seat: what the plan says will happen here, and nothing more. */
function PlannedSeat(props: { reps: number; t: LabViewProps['t'] }) {
  return (
    <div className={css.matrixCell}>
      <Chip>{props.t('design.planned', { reps: props.reps })}</Chip>
    </div>
  )
}

/**
 * The grid itself.
 * @param props - the columns, the rows, and (for live seats) the stuck
 *   threshold, the verdict lookup and the drawer opener.
 */
export function RunGrid(props: {
  columns: readonly GridColumn[]
  rows: readonly GridRow[]
  label?: string | undefined
  stuckMinutes?: number
  verdictOf?: (missionId: string) => VerdictSource | null
  onOpenCell?: (missionId: string) => void
  t: LabViewProps['t']
}) {
  const {
    columns, rows, label, stuckMinutes = 0,
    verdictOf = () => null, onOpenCell = () => {}, t,
  } = props
  return (
    <div className={css.matrixGroup}>
      {label !== undefined && label !== '' && <div className={css.matrixGroupLabel}>{label}</div>}
      <table className={css.matrixTable}>
        <thead>
          <tr>
            <th className={css.matrixCorner}>{t('matrix.task')}</th>
            {columns.map(column => (
              <th key={column.key} className={css.matrixHead} title={column.hint}>
                {/* ui-spec §九: the heading is the comparison group, always. */}
                <div className={css.matrixHeadId}>{column.title}</div>
                {column.sub !== null && <div className={css.matrixHeadFactor}>{column.sub}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.task}>
              <th className={css.matrixRowHead}>{row.task}</th>
              {row.cells.map((cell, index) => (
                <td key={columns[index]?.key ?? String(index)} className={css.matrixTd}>
                  {cell === null
                    ? <span className={css.dim}>—</span>
                    : cell.kind === 'planned'
                      ? <PlannedSeat reps={cell.reps} t={t} />
                      : (
                        <LiveSeat
                          cell={cell.cell}
                          stuckMinutes={stuckMinutes}
                          verdictOf={verdictOf}
                          onOpen={onOpenCell}
                          t={t}
                        />
                      )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The PLANNED grid's model: every item against every comparison group, each
 * seat carrying the rep count the plan asks for.
 * @param items - the item ids the plan names.
 * @param groups - the comparison group ids, in plan order.
 * @param reps - independent samples per cell.
 * @returns the rows to hand {@link RunGrid}.
 */
export function plannedRows(
  items: readonly string[],
  groups: readonly string[],
  reps: number,
): GridRow[] {
  return items.map(task => ({
    task,
    cells: groups.map((): GridCell => ({ kind: 'planned', reps })),
  }))
}

/**
 * The LIVE grid's columns, from the pivot.
 * @param matrix - the arranged matrix payload.
 * @param t - the locale seat.
 * @returns one column per pivot column, headed by its comparison groups.
 */
export function liveColumns(matrix: EvalMatrixView, t: LabViewProps['t']): GridColumn[] {
  const columnPhrase = matrix.column === null ? null : factorPhrase(matrix.column)
  const factorWord = columnPhrase === null
    ? ''
    : (columnPhrase.params === undefined ? t(columnPhrase.key) : t(columnPhrase.key, columnPhrase.params))
  return matrix.columns.map((column) => {
    const shown = factorValueText(column.key, column.label)
    return {
      key: column.key,
      title: column.conditions.length === 0 ? t('matrix.noCondition') : column.conditions.join(' · '),
      sub: columnPhrase === null ? null : <>{factorWord} {shown.text}</>,
      hint: column.conditions.join(', '),
    }
  })
}

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
            to a single column, which is the opposite of what the grid is for. */}
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
                .map(value => `${value.conditions.join(', ')}: ${shortenValue(factorValueText(value.key, value.label).text)}`)
                .join(' · ')}
            </span>
          </div>
        )
      })}
    </details>
  )
}

/**
 * 实验卫生 — the run-level invariants, FOLDED (T80c P1-7).
 *
 * It sat open under every grid as 「本次实验汇总」 with 未释放单元 / 卡住的记录 /
 * 显示的记录 as its headings, which is the ledger's own bookkeeping read out to
 * someone who came to see whether the answers are in. Folded, its one line
 * still says the four things worth a glance; it opens by itself when an
 * invariant does NOT hold, because then it is the reason the page was opened.
 * @param props - the matrix payload (the summary and the derived fields).
 */
export function Hygiene(props: { matrix: EvalMatrixView; t: LabViewProps['t'] }) {
  const { matrix, t } = props
  const { summary } = matrix
  const { incidental } = splitFactors(matrix.factors)
  const broken = summary.materialization.status !== 'ok' || summary.fingerprint.status !== 'ok'
  const mark = (value: EvalMatrixInvariant) => (value.status === 'ok' ? '✓' : t(`invariant.${value.status}`))
  return (
    <details className={css.hygiene} open={broken}>
      <summary className={css.hygieneSummary}>
        <span className={css.hygieneTitle}>{t('summary.title')}</span>
        <span className={css.dim}>
          {t('summary.line', {
            materialization: mark(summary.materialization),
            fingerprint: mark(summary.fingerprint),
            unreleased: summary.unreleased,
            stuck: summary.stuck,
          })}
        </span>
      </summary>
      <div className={css.summaryBar}>
        <Invariant label={t('summary.materialization')} value={summary.materialization} t={t} />
        <Invariant label={t('summary.fingerprint')} value={summary.fingerprint} t={t} />
        <span className={css.summaryItem}>
          <span className={css.summaryLabel}>{t('summary.unreleased')}</span>
          <Chip tone={summary.unreleased > 0 ? 'warn' : 'neutral'}>{summary.unreleased}</Chip>
        </span>
        <span className={css.summaryItem}>
          <span className={css.summaryLabel}>{t('summary.stuck')}</span>
          <Chip tone={summary.stuck > 0 ? 'warn' : 'neutral'}>{summary.stuck}</Chip>
        </span>
        <span className={css.summaryItem}>
          <span className={css.summaryLabel}>{t('summary.judge')}</span>
          <span className={css.dim}>{summary.judgeConsistency ?? t('summary.judgePending')}</span>
        </span>
        <span className={css.summaryItem}>
          <span className={css.summaryLabel}>{t('summary.cells')}</span>
          <span className={css.dim}>{summary.cells}</span>
        </span>
      </div>
      {/* An invariant that HOLDS does not have to explain itself; one that
          does not is the reason a reader opened this page. */}
      {summary.materialization.status !== 'ok' && (
        <div className={css.summaryWhy}>{summary.materialization.detail}</div>
      )}
      {summary.fingerprint.status !== 'ok' && (
        <div className={css.summaryWhy}>{summary.fingerprint.detail}</div>
      )}
      <Incidental matrix={matrix} paths={incidental} t={t} />
    </details>
  )
}

/**
 * The LIVE grid in full: the arrangement bar and the banded tables. The
 * run-level summary is {@link Hygiene}, which the page places under the grid
 * or under the record cards, whichever it drew.
 * @param props - the matrix payload, the reader's controls, the verdict
 *   lookup and the drawer opener.
 */
export function LiveGrid(props: {
  matrix: EvalMatrixView
  loading: boolean
  verdictOf: (missionId: string) => VerdictSource | null
  onColumn: (factor: string) => void
  onToggleGroup: (factor: string) => void
  onFilter: (factor: string, value: string | null) => void
  onOpenCell: (missionId: string) => void
  t: LabViewProps['t']
}) {
  const { matrix, loading, verdictOf, onColumn, onToggleGroup, onFilter, onOpenCell, t } = props
  const [legendOpen, setLegendOpen] = useState(false)
  const stuckMinutes = Math.round(matrix.stuckMs / 60_000)
  const { named } = splitFactors(matrix.factors)
  const columns = liveColumns(matrix, t)
  const columnPhrase = matrix.column === null ? null : factorPhrase(matrix.column)

  return (
    <>
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
          <RunGrid
            key={group.key}
            columns={columns}
            label={group.label}
            rows={group.rows.map(row => ({
              task: row.task,
              cells: row.cells.map((cell): GridCell | null => (cell === null ? null : { kind: 'live', cell })),
            }))}
            stuckMinutes={stuckMinutes}
            verdictOf={verdictOf}
            onOpenCell={onOpenCell}
            t={t}
          />
        ))}

    </>
  )
}
